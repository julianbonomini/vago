// Runs one Step as a child process: the only module that spawns. Hides how
// a Step's command is spawned and how its output reaches the log.

import { closeSync, openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Step } from "./workflow.ts";

/** How a Step ended: it succeeded, or its process exited non-zero. */
export type Outcome = { kind: "ok" } | { kind: "exit"; code: number };

/**
 * Runs `step` with `root` as its working directory and waits for it to end.
 * Its stdout and stderr, interleaved as they were written, go to the file at
 * `log`, which is created along with its folder.
 */
export async function runStep(
	step: Step,
	root: string,
	log: string,
): Promise<Outcome> {
	await mkdir(dirname(log), { recursive: true });
	// One descriptor for both streams keeps stdout and stderr in the order the
	// Step wrote them, which two separate pipes can't promise.
	const fd = openSync(log, "w");
	try {
		const child = Bun.spawn(["sh", "-c", step.run], {
			cwd: root,
			stdin: "ignore",
			stdout: fd,
			stderr: fd,
		});
		const code = await child.exited;
		return code === 0 ? { kind: "ok" } : { kind: "exit", code };
	} finally {
		closeSync(fd);
	}
}
