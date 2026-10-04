// The Harness interface every coding agent CLI is driven through, the Run
// activity every Harness's stream condenses into, and the map from a
// Workflow's `harness` name to the module that implements it. Hides which
// Harnesses exist.

import { claudeCode } from "./claude-code.ts";

/** What a Harness session has reported about itself so far. */
export type HarnessSessionReport = {
	sessionId?: string;
	tokens?: { input: number; output: number };
	costUsd?: number;
	/** The session's final answer, which later Steps read as its output. */
	resultText?: string;
	/**
	 * The permission mode the session reported running in, when it isn't the
	 * one its command asked for. A Harness can fall back without an error,
	 * for example when the model doesn't offer the mode asked for.
	 */
	permissionModeFallback?: string;
	/** Set once the Harness has refused one of the session's tool calls. */
	permissionDenied?: true;
};

/**
 * What a Run's session did, condensed from its stream for the human to read,
 * in the order it happened. Carries nothing of the Harness that ran it.
 */
export type RunActivity = {
	items: RunActivityItem[];
	/**
	 * The agent has the turn: the session hasn't ended and no tool call is
	 * waiting for its result. It means the agent is thinking only while the
	 * Run is open, which the stream alone can't tell.
	 */
	working: boolean;
};

export type RunActivityItem =
	| { kind: "session-start"; model: string }
	| { kind: "prose"; lines: RunProseLine[] }
	| RunToolCalls
	/** A tool call's result that failed; results that didn't are left out. */
	| { kind: "failed-result"; firstLine: string }
	| { kind: "denied"; tool: string; reason: string }
	| RunSessionEnd;

/**
 * Consecutive calls of one verb, folded into one item. `files` says each
 * call's subject is a file's path.
 */
export type RunToolCalls = {
	kind: "tool-calls";
	verb: string;
	files: boolean;
	calls: RunToolCall[];
};

/** How the session ended, with the numbers it reported. */
export type RunSessionEnd = {
	kind: "session-end";
	/** The Harness's word for how the session failed; absent when it finished. */
	failure?: string;
	durationMs?: number;
	turns?: number;
	/** Input, cached input included, and output. */
	tokens?: number;
	costUsd?: number;
};

/**
 * One line of the agent's prose, its Markdown emphasis and code marks
 * removed. Blank lines between paragraphs are kept, one at most.
 */
export type RunProseLine = { text: string; heading: boolean };

/**
 * What a tool call worked on, such as a file's path, relative to the Project
 * when it is in the Project or the Goal's worktree, or a command's
 * description, and its size when the call has one, such as "120 lines" or
 * "+3 −1".
 */
export type RunToolCall = { subject: string; size?: string };

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
	 * What one stream line of the session started with `command`, the argv
	 * `command()` gave, carries. Fields the line doesn't carry are left out,
	 * so the kernel spreads each result over the last; a line that isn't an
	 * event it knows gives `{}`.
	 */
	readLine(line: string, command: readonly string[]): HarnessSessionReport;
	/**
	 * The activity of the session that streamed `lines`, the stream so far,
	 * in a Goal of the Project at `root`. Works on a session still running:
	 * a line that isn't a whole event it knows, such as one half written,
	 * gives nothing.
	 */
	runActivity(lines: readonly string[], root: string): RunActivity;
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
