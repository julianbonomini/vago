// Runs one Step on a Ticket as one Run: the only module that spawns. Hides
// how the Run is recorded and announced, how a Step's command is spawned, how
// a Harness's stream is read and how output reaches the log.

import { closeSync, openSync, writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { findHarness, type HarnessSessionReport } from "./harness/registry.ts";
import { printStepEnded, printStepStarted } from "./progress.ts";
import {
	readGoalBody,
	readTicketBody,
	recordRunEnd,
	recordRunStart,
	type Ticket,
} from "./tickets.ts";
import { type AgentStep, buildPrompt, type Step } from "./workflow.ts";

/**
 * How a Run ended: it succeeded, its process exited non-zero, its Harness
 * streamed nothing for the Step's `idle_timeout` and was killed, or `punt`
 * got SIGINT or SIGTERM and killed it.
 */
export type RunOutcome =
	| { kind: "ok" }
	| { kind: "exit"; code: number }
	| { kind: "idle-timeout" }
	| { kind: "interrupted" };

/** How a Run ended, and what's left of it for later Steps and the human. */
export type FinishedRun = {
	outcome: RunOutcome;
	/**
	 * For later Steps' prompts: a shell Step's exit code and everything it
	 * wrote to stdout and stderr, an agent Step's final result text.
	 */
	output: string;
	/** Absolute path of the Run's log. */
	log: string;
	/**
	 * The command that resumes the Run's Harness session. Absent for a shell
	 * Step, and for a session that ended before reporting its id.
	 */
	resumeHint?: string;
};

/**
 * Runs `step` on `ticket` in the repo root and waits for it to end. The Run
 * gets a `[[runs]]` entry before it starts and its end filled in after, a
 * line on stdout at each, and a log of everything it wrote. An agent Step's
 * prompt reads `stepOutputs`, the outputs of the Steps already run on this
 * Ticket by Step id. SIGINT or SIGTERM while the Step runs kills every
 * process it started and ends the Run `interrupted`, instead of ending
 * `punt`.
 */
export async function runStep(
	step: Step,
	ticket: Ticket,
	stepOutputs: ReadonlyMap<string, string>,
): Promise<FinishedRun> {
	const started = new Date();
	const entry = await recordRunStart(ticket, step, started);
	printStepStarted(ticket, step.id, started);
	await mkdir(dirname(entry.log), { recursive: true });
	// One descriptor for both streams keeps stdout and stderr in the order the
	// Step wrote them, which two separate pipes can't promise.
	const fd = openSync(entry.log, "w");
	// The Step runs in its own process group, out of reach of the terminal's
	// Ctrl-C, so `punt` takes the signal and kills the group itself.
	const interrupt = new AbortController();
	const interruptRun = () => interrupt.abort();
	process.on("SIGINT", interruptRun);
	process.on("SIGTERM", interruptRun);
	let outcome: RunOutcome;
	let output: string;
	let session: HarnessSessionReport | undefined;
	let resumeHint: string | undefined;
	try {
		if (step.type === "agent") {
			({ outcome, session, resumeHint } = await runAgent(
				step,
				ticket,
				stepOutputs,
				fd,
				interrupt.signal,
			));
			output = session.resultText ?? "";
		} else {
			const child = Bun.spawn(["sh", "-c", step.run], {
				cwd: ticket.root,
				stdin: "ignore",
				stdout: fd,
				stderr: fd,
				detached: true,
			});
			const code = await exitCodeOf(child, interrupt.signal);
			outcome = outcomeOf(code);
			// Read back from the log, so a review prompt sees stdout and stderr
			// interleaved the way the Step wrote them.
			output = `exit code ${code}\n${await Bun.file(entry.log).text()}`;
		}
	} finally {
		process.off("SIGINT", interruptRun);
		process.off("SIGTERM", interruptRun);
		closeSync(fd);
	}
	if (interrupt.signal.aborted) outcome = { kind: "interrupted" };
	const ended = new Date();
	// The header and the Step line spell the outcome the same way. Each kind
	// is named as it's spelled, so only `exit` needs its code added.
	const spelled =
		outcome.kind === "exit" ? `exit ${outcome.code}` : outcome.kind;
	await recordRunEnd(entry, spelled, ended, session);
	printStepEnded(ticket, step.id, spelled, started, ended, session?.costUsd);
	return { outcome, output, log: entry.log, resumeHint };
}

// The log gets the raw stream and stderr together, so a Harness that fails
// before streaming (bad login, unknown model) still leaves its reason there.
async function runAgent(
	step: AgentStep,
	ticket: Ticket,
	stepOutputs: ReadonlyMap<string, string>,
	fd: number,
	interrupt: AbortSignal,
): Promise<{
	outcome: RunOutcome;
	session: HarnessSessionReport;
	resumeHint?: string;
}> {
	const prompt = buildPrompt(step, {
		ticket: await readTicketBody(ticket),
		goal: await readGoalBody(ticket),
		stepOutputs,
	});
	const harness = findHarness(step.harness);
	const child = Bun.spawn(harness.command(step.model, step.args), {
		cwd: ticket.root,
		stdin: new Blob([prompt]),
		stdout: "pipe",
		stderr: fd,
		detached: true,
	});
	const idle = new AbortController();
	const exit = exitCodeOf(child, AbortSignal.any([interrupt, idle.signal]));
	const idleTimer = setTimeout(() => idle.abort(), step.idleTimeoutMs);
	let session: HarnessSessionReport = {};
	const decoder = new TextDecoder();
	let partial = "";
	for await (const chunk of child.stdout) {
		idleTimer.refresh();
		// Written as it arrives, so `tail -f` on the log follows the Run live.
		writeSync(fd, chunk);
		const lines = (partial + decoder.decode(chunk, { stream: true })).split(
			"\n",
		);
		partial = lines.pop() ?? "";
		for (const line of lines) {
			session = { ...session, ...harness.readLine(line) };
		}
	}
	clearTimeout(idleTimer);
	session = { ...session, ...harness.readLine(partial + decoder.decode()) };
	const code = await exit;
	return {
		outcome: idle.signal.aborted ? { kind: "idle-timeout" } : outcomeOf(code),
		session,
		resumeHint:
			session.sessionId === undefined
				? undefined
				: harness.resumeHint(session.sessionId),
	};
}

// Stops the child's group when `stop` aborts, at once if it already has, as
// when the signal came while the Step was still being set up. Resolves to the
// exit code once the child has exited and, if it was stopped, once its group
// is gone too, since the leader can exit while the rest of its group still
// ignores SIGTERM.
async function exitCodeOf(
	child: Bun.Subprocess,
	stop: AbortSignal,
): Promise<number> {
	let stopping: Promise<void> | undefined;
	const startStopping = () => {
		stopping = stopGroup(child.pid);
	};
	if (stop.aborted) startStopping();
	else stop.addEventListener("abort", startStopping, { once: true });
	const code = await child.exited;
	stop.removeEventListener("abort", startStopping);
	await stopping;
	return code;
}

// Long enough for a Harness to stop the tool commands it started.
const stopGraceMs = 5_000;

// The whole group, since a process the Step started would otherwise live on
// and could hold the Harness's stdout open, so its stream would never end.
// SIGTERM first, because a Harness can run its tool commands in process groups
// of their own, which no signal to this group reaches, and only the Harness
// can stop them. SIGKILL after the grace period, because a Step that ignores
// SIGTERM must still end. Resolves once the group is gone or has been sent
// SIGKILL.
async function stopGroup(leader: number): Promise<void> {
	const deadline = Date.now() + stopGraceMs;
	signalGroup(leader, "SIGTERM");
	while (signalGroup(leader, 0)) {
		if (Date.now() >= deadline) {
			signalGroup(leader, "SIGKILL");
			return;
		}
		await Bun.sleep(50);
	}
}

// False when the group is gone, as it is already when the signal comes just
// after the Step ended. Signal 0 only asks whether the group is alive.
function signalGroup(leader: number, signal: NodeJS.Signals | 0): boolean {
	try {
		process.kill(-leader, signal);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
		return false;
	}
}

function outcomeOf(code: number): RunOutcome {
	return code === 0 ? { kind: "ok" } : { kind: "exit", code };
}
