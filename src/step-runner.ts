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
 * How a Run ended: it succeeded, its process exited non-zero, or its Harness
 * streamed nothing for the Step's `idle_timeout` and was killed.
 */
export type RunOutcome =
	| { kind: "ok" }
	| { kind: "exit"; code: number }
	| { kind: "idle-timeout" };

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
 * Ticket by Step id.
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
			));
			output = session.resultText ?? "";
		} else {
			const child = Bun.spawn(["sh", "-c", step.run], {
				cwd: ticket.root,
				stdin: "ignore",
				stdout: fd,
				stderr: fd,
			});
			const code = await child.exited;
			outcome = outcomeOf(code);
			// Read back from the log, so a review prompt sees stdout and stderr
			// interleaved the way the Step wrote them.
			output = `exit code ${code}\n${await Bun.file(entry.log).text()}`;
		}
	} finally {
		closeSync(fd);
	}
	const ended = new Date();
	// The header and the Step line spell the outcome the same way.
	const spelled =
		outcome.kind === "exit" ? `exit ${outcome.code}` : outcome.kind;
	await recordRunEnd(entry, spelled, ended, session);
	printStepEnded(ticket, step.id, spelled, started, ended, session?.costUsd);
	return { outcome, output, log: entry.log, resumeHint };
}

// The log gets the raw stream and stderr together, so a Harness that fails
// before streaming (bad login, unknown model) still leaves its reason there.
// An idle Harness is killed with its whole process group: a tool it started
// would otherwise hold stdout open, and the stream would never end.
async function runAgent(
	step: AgentStep,
	ticket: Ticket,
	stepOutputs: ReadonlyMap<string, string>,
	fd: number,
): Promise<{
	outcome: RunOutcome;
	session: HarnessSessionReport;
	resumeHint: string | undefined;
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
		// TODO(08): in its own process group the session misses the terminal's
		// Ctrl-C, so `punt run` must kill the group on SIGINT and SIGTERM.
		detached: true,
	});
	let idle = false;
	const idleTimer = setTimeout(() => {
		idle = true;
		process.kill(-child.pid, "SIGKILL");
	}, step.idleTimeoutMs);
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
	const code = await child.exited;
	return {
		outcome: idle ? { kind: "idle-timeout" } : outcomeOf(code),
		session,
		resumeHint:
			session.sessionId === undefined
				? undefined
				: harness.resumeHint(session.sessionId),
	};
}

function outcomeOf(code: number): RunOutcome {
	return code === 0 ? { kind: "ok" } : { kind: "exit", code };
}
