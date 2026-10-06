// One pass through a list of Steps for a Ticket or for the Goal: where it
// picks up, the Steps in order, retries, and how it ends. Hides how a pass
// picks up and rebuilds earlier outputs, the `last-ticket` skip, and the retry count and waits.

import {
	printPassStarted,
	printPickUpRefusal,
	printStepRetry,
	printStepSkipped,
	printStuck,
} from "./progress.ts";
import {
	type FinishedRun,
	readRunOutput,
	runStep,
	spellOutcome,
} from "./step-runner.ts";
import {
	closeOpenRun,
	isLastTicket,
	latestPassStart,
	type RunOwner,
	recordRunRetry,
	runGoesOn,
	setStatus,
	type TicketRun,
} from "./tickets/tickets.ts";
import type { Step } from "./workflow.ts";

/** How `runPass` left the list: every Step went on, one failed, or the pass couldn't be picked up. */
export type PassEnd = "done" | "stuck" | "refused";

/**
 * Runs `steps` for `owner` in `worktree`, picking the pass up from `runs`,
 * the owner's earlier Runs of these Steps. A last Run still open, left by a
 * `vago run` that died, is first closed `lost`. Given no Runs it starts at
 * the first Step; otherwise at the Step of the last Run, with the outputs of
 * the Steps before it rebuilt from the latest pass and an agent Step
 * resuming that Run's session. Prints the pass's heading, then each Step.
 * A failed agent Step is retried after 1, 1 and 5 minutes. A Ticket's pass
 * skips a `last-ticket` Step unless it is the Goal's last Ticket; the Goal's
 * runs every Step. Prints a failed Step as stuck, or a pass that can't be
 * picked up naming the Step, and returns how it ended. A Ticket owner is set `running` once its pass is
 * picked up, before its first Step; setting it `done` or `stuck` after is
 * the caller's. A refused pass writes nothing.
 */
export async function runPass(
	steps: readonly Step[],
	owner: RunOwner,
	worktree: string,
	runs: TicketRun[],
): Promise<PassEnd> {
	let pastRuns = runs;
	const last = runs.at(-1);
	if (last !== undefined && last.ended === undefined) {
		const ended = new Date();
		await closeOpenRun(owner, "lost", ended);
		pastRuns = [...runs.slice(0, -1), { ...last, ended, outcome: "lost" }];
	}
	const pickUp = await pickUpPoint(steps, owner, pastRuns);
	if (pickUp.outcome === "refused") {
		printPickUpRefusal(owner, pickUp.stepName, pickUp.reason);
		return "refused";
	}
	const { from, stepOutputs, resume } = pickUp;
	// Only now, so a refused Ticket's file is left byte for byte.
	if (owner.kind === "ticket") await setStatus(owner.ticket, "running");
	printPassStarted(owner, from > 0 ? steps[from]?.name : undefined);
	for (const [index, step] of steps.slice(from).entries()) {
		if (
			step.when === "last-ticket" &&
			owner.kind === "ticket" &&
			!(await isLastTicket(owner.ticket))
		) {
			printStepSkipped(step.name, new Date());
			continue;
		}
		const run = await runStepWithRetries(
			step,
			owner,
			worktree,
			stepOutputs,
			index === 0 ? resume : undefined,
		);
		stepOutputs.set(step.id, run.output);
		// `on_fail` covers a Step that exits non-zero, never one the human
		// interrupted.
		if (!runGoesOn(step, spellOutcome(run.outcome))) {
			printStuck(
				owner,
				step.name,
				spellOutcome(run.outcome),
				run.log,
				run.resumeHint,
			);
			return "stuck";
		}
	}
	return "done";
}

// How many minutes a failed agent Step waits before each of its retries.
const retryWaitMinutes = [1, 1, 5];

// Tests set `VAGO_RETRY_MINUTE_MS` to shorten the waits without changing
// their count or proportions.
const retryMinuteMs = Number(process.env.VAGO_RETRY_MINUTE_MS ?? 60_000);

// Runs `step` as `runStep` does, then, while an agent Step's Run fails, waits
// and resumes its session in a new Run, up to one Run per wait in
// `retryWaitMinutes`. Returns the last Run. A Run the human interrupted, or
// SIGINT or SIGTERM during a wait, ends the retries there.
async function runStepWithRetries(
	step: Step,
	owner: RunOwner,
	worktree: string,
	stepOutputs: ReadonlyMap<string, string>,
	resume: string | undefined,
): Promise<FinishedRun> {
	let run = await runStep(step, owner, worktree, stepOutputs, resume);
	const waits = step.type === "agent" ? retryWaitMinutes : [];
	for (const minutes of waits) {
		if (run.outcome.kind === "ok" || run.outcome.kind === "interrupted") break;
		const waitMs = minutes * retryMinuteMs;
		const now = new Date();
		// For the TUI, which shows the wait from the owner's file.
		await recordRunRetry(owner, new Date(now.getTime() + waitMs));
		printStepRetry(step.name, now, waitMs);
		if (!(await waitUnlessInterrupted(waitMs))) break;
		run = await runStep(step, owner, worktree, stepOutputs, run.sessionId);
	}
	return run;
}

// Resolves true after `ms`, or false as soon as SIGINT or SIGTERM comes,
// which then ends only the wait instead of `vago`.
function waitUnlessInterrupted(ms: number): Promise<boolean> {
	return new Promise((resolve) => {
		const finish = (waited: boolean) => {
			clearTimeout(timer);
			process.off("SIGINT", interrupted);
			process.off("SIGTERM", interrupted);
			resolve(waited);
		};
		const interrupted = () => finish(false);
		const timer = setTimeout(() => finish(true), ms);
		process.on("SIGINT", interrupted);
		process.on("SIGTERM", interrupted);
	});
}

// Where `owner`'s pass through `steps`, whose Runs are `runs`, continues: at
// the Step of its last Run, with the outputs of the Steps before it rebuilt
// from its latest pass, resuming that Run's session when it had one on the
// Step's Harness. Refused, naming the Step and with a `reason` that goes on
// from its name, when an output can't be rebuilt or the Step isn't in
// `steps`. A Step's output counts when its Run counts, judged by the Step as
// it is now.
async function pickUpPoint(
	steps: readonly Step[],
	owner: RunOwner,
	runs: TicketRun[],
): Promise<
	| {
			outcome: "pick-up";
			from: number;
			stepOutputs: Map<string, string>;
			resume?: string;
	  }
	| { outcome: "refused"; stepName: string; reason: string }
> {
	const stepOutputs = new Map<string, string>();
	const last = runs.at(-1);
	const [first] = steps;
	if (last === undefined || first === undefined) {
		return { outcome: "pick-up", from: 0, stepOutputs };
	}
	// Each reason goes on from the Step's name, in the words of whose pass it is.
	const words =
		owner.kind === "ticket"
			? {
					list: "the Ticket's Workflow",
					pass: "the Ticket's latest pass",
					subject: "the Ticket",
				}
			: {
					list: owner.group,
					pass: `${owner.group}'s latest pass`,
					subject: owner.group,
				};
	const from = steps.findIndex(({ id }) => id === last.step);
	if (from === -1) {
		return {
			outcome: "refused",
			stepName: last.step,
			reason: `isn't in ${words.list}`,
		};
	}
	const pass = runs.slice(latestPassStart(runs, first.id));
	for (const step of steps.slice(0, from)) {
		const run = pass.findLast(({ step: id }) => id === step.id);
		if (run === undefined) {
			// Only a Ticket skips a `last-ticket` Step, so only its pass can lack one.
			if (step.when === "last-ticket" && owner.kind === "ticket") continue;
			return {
				outcome: "refused",
				stepName: step.name,
				reason: `has no Run in ${words.pass}`,
			};
		}
		if (!runGoesOn(step, run.outcome)) {
			return {
				outcome: "refused",
				stepName: step.name,
				reason: `ended ${run.outcome ?? "without an outcome"}, which ${words.subject} didn't go on from`,
			};
		}
		const output = await readRunOutput(run);
		if (output === undefined) {
			return {
				outcome: "refused",
				stepName: step.name,
				reason: "has no log left to rebuild its output from",
			};
		}
		stepOutputs.set(step.id, output);
	}
	const step = steps[from];
	const resume =
		step?.type === "agent" && step.harness === last.harness
			? last.sessionId
			: undefined;
	return { outcome: "pick-up", from, stepOutputs, resume };
}
