// The Harness interface every coding agent CLI is driven through, and the
// map from a Workflow's `harness` name to the module that implements it.
// Hides which Harnesses exist.

import { claudeCode } from "./claude-code.ts";

/** What a Harness session has reported about itself so far. */
export type HarnessSessionReport = {
	sessionId?: string;
	tokens?: { input: number; output: number };
	costUsd?: number;
	/** The session's final answer, which later Steps read as its output. */
	resultText?: string;
};

/**
 * One Harness's CLI. Its functions do no I/O: the kernel spawns the command,
 * writes the prompt to its stdin, and feeds each line it streams to `readLine`.
 */
export type Harness = {
	/**
	 * The argv that starts a fresh session on `model` in guarded mode, with
	 * the Step's `args` appended as given.
	 */
	command(model: string, args: readonly string[]): string[];
	/**
	 * What one stream line carries. Fields the line doesn't carry are left
	 * out, so the kernel spreads each result over the last; a line that isn't
	 * an event it knows gives `{}`.
	 */
	readLine(line: string): HarnessSessionReport;
	/** The shell command the human runs to resume session `sessionId`. */
	resumeHint(sessionId: string): string;
};

const harnesses: Record<string, Harness> = {
	"claude-code": claudeCode,
};

/** Whether a Harness is registered as `name`. */
export function knownHarness(name: string): boolean {
	return Object.hasOwn(harnesses, name);
}

/** Returns the Harness registered as `name`. Throws an Error when none is. */
export function findHarness(name: string): Harness {
	const harness = harnesses[name];
	if (harness === undefined) throw new Error(`unknown harness "${name}"`);
	return harness;
}
