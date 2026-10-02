// Runs one Step as a child process: the only module that spawns. Hides how
// a Step's command is spawned, how a Harness's stream is read and how output
// reaches the log.

import { closeSync, openSync, writeSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { findHarness, type RunReport } from "./harness/registry.ts";
import { buildPrompt, type PromptTexts } from "./prompt.ts";
import type { AgentStep, Step } from "./workflow.ts";

/** How a Step ended: it succeeded, or its process exited non-zero. */
export type Outcome = { kind: "ok" } | { kind: "exit"; code: number };

/** How a Step ended, and what its Harness reported. A shell Step reports `{}`. */
export type StepEnd = {
	outcome: Outcome;
	report: RunReport;
};

/** The outcome as the Ticket header and the Step lines spell it: `ok`, `exit 1`. */
export function outcomeText(outcome: Outcome): string {
	return outcome.kind === "ok" ? "ok" : `exit ${outcome.code}`;
}

/**
 * Runs `step` with `root` as its working directory and waits for it to end.
 * Everything it writes goes to the file at `log`, which is created along with
 * its folder: a shell Step's stdout and stderr, or an agent Step's raw stream
 * and stderr. An agent Step's prompt is built from `texts`.
 */
export async function runStep(
	step: Step,
	root: string,
	log: string,
	texts: PromptTexts,
): Promise<StepEnd> {
	await mkdir(dirname(log), { recursive: true });
	// One descriptor for both streams keeps stdout and stderr in the order the
	// Step wrote them, which two separate pipes can't promise.
	const fd = openSync(log, "w");
	try {
		if (step.type === "agent") return await runAgent(step, texts, root, fd);
		const child = Bun.spawn(["sh", "-c", step.run], {
			cwd: root,
			stdin: "ignore",
			stdout: fd,
			stderr: fd,
		});
		return { outcome: outcomeOf(await child.exited), report: {} };
	} finally {
		closeSync(fd);
	}
}

async function runAgent(
	step: AgentStep,
	texts: PromptTexts,
	root: string,
	fd: number,
): Promise<StepEnd> {
	const harness = findHarness(step.harness);
	const child = Bun.spawn(harness.command(step.model), {
		cwd: root,
		stdin: new Blob([buildPrompt(step.prompt, texts)]),
		stdout: "pipe",
		stderr: fd,
	});
	let report: RunReport = {};
	const decoder = new TextDecoder();
	let partial = "";
	for await (const chunk of child.stdout) {
		// Written as it arrives, so `tail -f` on the log follows the Run live.
		writeSync(fd, chunk);
		const lines = (partial + decoder.decode(chunk, { stream: true })).split(
			"\n",
		);
		partial = lines.pop() ?? "";
		for (const line of lines) report = { ...report, ...harness.readLine(line) };
	}
	report = { ...report, ...harness.readLine(partial + decoder.decode()) };
	return { outcome: outcomeOf(await child.exited), report };
}

function outcomeOf(code: number): Outcome {
	return code === 0 ? { kind: "ok" } : { kind: "exit", code };
}
