// A Goal's lifecycle: creating it and its Tickets with the Workflows they
// name, the main loop of `vago run`, which takes the Goal's Tickets one at a
// time through the Steps of their Workflow in the Goal's worktree, a stuck
// one from the Step it stopped on, retries a failed agent Step, and closes
// it once every Ticket is done, and resetting a stuck Ticket. Hides the order
// of a Goal's lifecycle, where its Steps run, where a Ticket picks up and
// when a Step is retried.

import {
	printGoalSummary,
	printPickUpRefusal,
	printStepRetry,
	printStepSkipped,
	printStuck,
	printTicketStarted,
	printWorktree,
	printWorktreeClose,
} from "./progress.ts";
import {
	type FinishedRun,
	readRunOutput,
	runStep,
	shellExitCode,
	spellOutcome,
} from "./step-runner.ts";
import {
	addTicket,
	closeOpenRun,
	createGoal,
	isLastTicket,
	latestPassStart,
	readGoal,
	recordRunRetry,
	setStatus,
	type Ticket,
	type TicketRun,
	withGoalClaimed,
} from "./tickets/tickets.ts";
import { loadWorkflow, type Step, type Workflow } from "./workflow.ts";
import { closeWorktree, openWorktree } from "./worktree.ts";

/** How `vago run` left the Goal: every Ticket `done`, or not. */
export type GoalEnd = "done" | "unfinished";

/**
 * Creates Goal `goal` of the Project at `root`, naming Workflow `workflow`
 * in its `goal.md` header, with `body` exactly as given after it, or a
 * `# <goal>` title without one. Returns the path of `goal.md`. Throws an
 * Error naming the problem, and creates nothing, when `vago run` would
 * refuse the Workflow (one not in `.vago/workflows/` is refused with the
 * names that are), the body is empty or only whitespace, the Goal already
 * exists, or `goal` isn't a valid name.
 */
export async function newGoal(
	root: string,
	goal: string,
	workflow: string,
	body?: string,
): Promise<string> {
	// The check vago run makes, so goal new never writes a Goal vago run would refuse.
	await loadWorkflow(root, workflow);
	return createGoal(root, goal, workflow, body);
}

/**
 * Adds a ready Ticket named `slug` to `goal` of the Project at `root`, as
 * `addTicket` does, going through Workflow `workflow` in place of the Goal's
 * when it's given. Returns the path of the Ticket file. Throws an Error
 * naming the problem, and writes nothing, when `vago run` would refuse the
 * Workflow or `addTicket` refuses the Ticket.
 */
export async function newTicket(
	root: string,
	goal: string,
	slug: string,
	blockedBy: number[],
	workflow: string | undefined,
	body?: string,
): Promise<string> {
	// The check vago run makes, so ticket add never writes a Ticket vago run would refuse.
	if (workflow !== undefined) await loadWorkflow(root, workflow);
	return addTicket(root, goal, slug, blockedBy, workflow, body);
}

/**
 * Runs `goal` of the Project at `root` until no Ticket is ready or stuck, or
 * a Ticket goes stuck, then prints the Goal summary. Its Steps run in the
 * Goal's worktree, whose path it prints before the first Ticket; a Goal with
 * no such Ticket gets none. A Ticket found `running`, left so by a `vago run`
 * that crashed or was killed, goes stuck with its open Run ended `lost`. A
 * stuck Ticket continues at the Step it stopped on, its earlier Steps'
 * outputs rebuilt from its latest pass, and an agent Step resuming the
 * Harness session it stopped in; when an output can't be rebuilt, it prints
 * which Step, leaves the Ticket as it was and stops there. Throws an Error
 * naming the problem, before any Ticket changes, when `goal.md` names no
 * Workflow or one that doesn't exist, or when the Workflow or the Goal's
 * format is bad. The Goal is checked before the first Run and again after
 * each Ticket, so a `goal.md` or Ticket file broken mid-Goal stops it there,
 * without a summary. When this run takes the Goal's last Tickets to done, it
 * then removes the Goal's worktree if nothing in it would be lost, or prints
 * why it keeps it. Throws an Error naming the Goal, before anything changes,
 * when another `vago run` is running it.
 */
export async function runGoal(root: string, goal: string): Promise<GoalEnd> {
	return withGoalClaimed(root, goal, () => runClaimedGoal(root, goal));
}

async function runClaimedGoal(root: string, goal: string): Promise<GoalEnd> {
	let state = await readGoal(root, goal);
	// Each Workflow is loaded once, so every Ticket that names it runs the
	// Workflow as it was when first loaded, even if an agent edits `.vago/`.
	const workflows = new Map<string, Workflow>();
	const workflowNamed = async (name: string): Promise<Workflow> => {
		const loaded = workflows.get(name) ?? (await loadWorkflow(root, name));
		workflows.set(name, loaded);
		return loaded;
	};
	// Loaded before any Run, so a Workflow name that's wrong anywhere in the
	// Goal refuses it before anything changes. A Ticket added mid-Goal loads
	// its Workflow when it comes up.
	await workflowNamed(state.workflow);
	for (const { status, workflow } of state.tickets) {
		if (status !== "done") await workflowNamed(workflow);
	}
	// A lost Ticket goes stuck with its open Run ended `lost`, and is picked
	// up below at that Run's Step like any stuck Ticket.
	for (const { ticket, status } of state.tickets) {
		if (status !== "running") continue;
		await closeOpenRun(ticket, "lost", new Date());
		await setStatus(ticket, "stuck");
	}
	state = await readGoal(root, goal);
	const opened = state.next !== undefined;
	if (opened) {
		const worktree = await openWorktree(root, goal);
		printWorktree(worktree);
		while (state.next !== undefined) {
			const { ticket, status, runs } = state.next;
			const workflow = await workflowNamed(state.next.workflow);
			let from = 0;
			let stepOutputs = new Map<string, string>();
			let resume: string | undefined;
			if (status === "stuck") {
				const pickUp = await pickUpPoint(workflow, runs);
				if (pickUp.outcome === "refused") {
					printPickUpRefusal(ticket, pickUp.stepName, pickUp.reason);
					break;
				}
				({ from, stepOutputs, resume } = pickUp);
			}
			const finished = await runTicket(
				workflow,
				ticket,
				worktree,
				from,
				stepOutputs,
				resume,
			);
			state = await readGoal(root, goal);
			if (!finished) break;
		}
	}
	printGoalSummary(goal, state);
	if (opened && state.done) printWorktreeClose(await closeWorktree(root, goal));
	return state.done ? "done" : "unfinished";
}

/**
 * Sets Ticket `number` of `goal` from `stuck` back to `ready`, keeping its
 * `[[runs]]`, so the next `vago run` starts it over from its first Step.
 * Throws an Error naming the problem when the Goal's format is bad, the Goal
 * has no such Ticket, or the Ticket isn't stuck.
 */
export async function resetTicket(
	root: string,
	goal: string,
	number: number,
): Promise<void> {
	const { tickets } = await readGoal(root, goal);
	const found = tickets.find(({ ticket }) => ticket.number === number);
	if (found === undefined) {
		throw new Error(`Goal ${goal} has no Ticket ${number}`);
	}
	if (found.status !== "stuck") {
		throw new Error(
			`${found.ticket.name} is ${found.status}, not stuck, so there is nothing to reset`,
		);
	}
	await setStatus(found.ticket, "ready");
}

// Runs the Steps of `workflow` on `ticket` in `worktree` from Step `from`
// on, with `stepOutputs` the outputs of the Steps before it and `resume` the
// Harness session Step `from` resumes, if any, skipping a
// `last-ticket` Step unless this is the Goal's last Ticket, and returns
// whether the Ticket got to `done`. A failed Step leaves it `stuck`, once
// its retries failed too, unless it's a shell Step whose failure the
// Workflow lets the Ticket go on from. `on_fail` covers a Step that exits
// non-zero, never one the human interrupted.
async function runTicket(
	workflow: Workflow,
	ticket: Ticket,
	worktree: string,
	from: number,
	stepOutputs: Map<string, string>,
	resume: string | undefined,
): Promise<boolean> {
	await setStatus(ticket, "running");
	printTicketStarted(ticket, from > 0 ? workflow.steps[from]?.name : undefined);
	for (const [index, step] of workflow.steps.slice(from).entries()) {
		if (step.when === "last-ticket" && !(await isLastTicket(ticket))) {
			printStepSkipped(step.name, new Date());
			continue;
		}
		const run = await runStepWithRetries(
			step,
			ticket,
			worktree,
			stepOutputs,
			index === 0 ? resume : undefined,
		);
		stepOutputs.set(step.id, run.output);
		const goesOn =
			run.outcome.kind === "ok" ||
			(run.outcome.kind === "exit" &&
				step.type === "shell" &&
				step.onFail === "continue");
		if (!goesOn) {
			await setStatus(ticket, "stuck");
			printStuck(
				ticket,
				step.name,
				spellOutcome(run.outcome),
				run.log,
				run.resumeHint,
			);
			return false;
		}
	}
	await setStatus(ticket, "done");
	return true;
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
	ticket: Ticket,
	worktree: string,
	stepOutputs: ReadonlyMap<string, string>,
	resume: string | undefined,
): Promise<FinishedRun> {
	let run = await runStep(step, ticket, worktree, stepOutputs, resume);
	const waits = step.type === "agent" ? retryWaitMinutes : [];
	for (const minutes of waits) {
		if (run.outcome.kind === "ok" || run.outcome.kind === "interrupted") break;
		const waitMs = minutes * retryMinuteMs;
		const now = new Date();
		// For the TUI, which shows the wait from the Ticket file.
		await recordRunRetry(ticket, new Date(now.getTime() + waitMs));
		printStepRetry(step.name, now, waitMs);
		if (!(await waitUnlessInterrupted(waitMs))) break;
		run = await runStep(step, ticket, worktree, stepOutputs, run.sessionId);
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

// Where a stuck Ticket whose Runs are `runs` continues in `workflow`: at the
// Step of its last Run, with the outputs of the Steps before it rebuilt from
// its latest pass, resuming that Run's session when it had one on the
// Step's Harness. Refused, naming the Step and with a `reason` that goes on
// from its name, when an output can't be rebuilt or the Step isn't in the
// Workflow. A Step's output counts when its
// Run ended `ok`, or `exit N` on a shell Step the Workflow lets the Ticket
// go on from, as it did when the Run ended.
async function pickUpPoint(
	workflow: Workflow,
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
	const [first] = workflow.steps;
	if (last === undefined || first === undefined) {
		return { outcome: "pick-up", from: 0, stepOutputs };
	}
	const from = workflow.steps.findIndex(({ id }) => id === last.step);
	if (from === -1) {
		return {
			outcome: "refused",
			stepName: last.step,
			reason: "isn't in the Ticket's Workflow",
		};
	}
	const pass = runs.slice(latestPassStart(runs, first.id));
	for (const step of workflow.steps.slice(0, from)) {
		const run = pass.findLast(({ step: id }) => id === step.id);
		if (run === undefined) {
			if (step.when === "last-ticket") continue;
			return {
				outcome: "refused",
				stepName: step.name,
				reason: "has no Run in the Ticket's latest pass",
			};
		}
		const counts =
			run.outcome === "ok" ||
			(step.type === "shell" &&
				step.onFail === "continue" &&
				shellExitCode(run.outcome) !== undefined);
		if (!counts) {
			return {
				outcome: "refused",
				stepName: step.name,
				reason: `ended ${run.outcome ?? "without an outcome"}, which the Ticket didn't go on from`,
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
	const step = workflow.steps[from];
	const resume =
		step?.type === "agent" && step.harness === last.harness
			? last.sessionId
			: undefined;
	return { outcome: "pick-up", from, stepOutputs, resume };
}
