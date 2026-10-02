// Runs one Step on a Ticket as one Run: the only module that spawns. Hides
// how the Run is recorded and announced, how a Step's command is spawned, how
// a Harness's stream is read and how output reaches the log.

import { closeSync, openSync, writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { findHarness, type HarnessSessionReport } from "./harness/registry.ts";
import { printStepEnded, printStepStarted } from "./progress.ts";
import {
	type Outcome,
	readGoalBody,
	readTicketBody,
	recordRunEnd,
	recordRunStart,
	type Ticket,
} from "./tickets.ts";
import { type AgentStep, buildPrompt, type Step } from "./workflow.ts";

/**
 * Runs `step` on `ticket` in the repo root and waits for it to end. The Run
 * gets a `[[runs]]` entry before it starts and its end filled in after, a
 * line on stdout at each, and a log of everything it wrote. Returns how it
 * ended.
 */
export async function runStep(step: Step, ticket: Ticket): Promise<Outcome> {
	const run = await recordRunStart(ticket, step, new Date());
	printStepStarted(run);
	await mkdir(dirname(run.log), { recursive: true });
	// One descriptor for both streams keeps stdout and stderr in the order the
	// Step wrote them, which two separate pipes can't promise.
	const fd = openSync(run.log, "w");
	let outcome: Outcome;
	let session: HarnessSessionReport | undefined;
	try {
		if (step.type === "agent") {
			({ outcome, session } = await runAgent(step, ticket, fd));
		} else {
			const child = Bun.spawn(["sh", "-c", step.run], {
				cwd: ticket.root,
				stdin: "ignore",
				stdout: fd,
				stderr: fd,
			});
			outcome = outcomeOf(await child.exited);
		}
	} finally {
		closeSync(fd);
	}
	const ended = new Date();
	await recordRunEnd(run, outcome, ended, session);
	printStepEnded(run, outcome, ended, session);
	return outcome;
}

// The log gets the raw stream and stderr together, so a Harness that fails
// before streaming (bad login, unknown model) still leaves its reason there.
async function runAgent(
	step: AgentStep,
	ticket: Ticket,
	fd: number,
): Promise<{ outcome: Outcome; session: HarnessSessionReport }> {
	const prompt = buildPrompt(step, {
		ticket: await readTicketBody(ticket),
		goal: await readGoalBody(ticket),
	});
	const harness = findHarness(step.harness);
	const child = Bun.spawn(harness.command(step.model), {
		cwd: ticket.root,
		stdin: new Blob([prompt]),
		stdout: "pipe",
		stderr: fd,
	});
	let session: HarnessSessionReport = {};
	const decoder = new TextDecoder();
	let partial = "";
	for await (const chunk of child.stdout) {
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
	session = { ...session, ...harness.readLine(partial + decoder.decode()) };
	return { outcome: outcomeOf(await child.exited), session };
}

function outcomeOf(code: number): Outcome {
	return code === 0 ? { kind: "ok" } : { kind: "exit", code };
}
