// The `vago` commands the TUI starts: a ready Goal's `vago run`, a planning
// turn's `vago plan say` and a Retry response's `vago plan retry`, which it
// lets go of, and `vago plan accept` and `vago plan discard`, which it waits
// for. None of them is the TUI's to stop, and the TUI stops nothing itself:
// `vago plan discard` stops a response (ADR 0005). Hides how each is cut
// loose from the TUI and its terminal, and how a refusal is read back.

import type { GoalRow } from "./goal-rows.ts";

/**
 * Starts `vago run` on the Goal of `row`, of the Project at `root`, as a
 * process of its own that outlives the TUI and writes nothing to its
 * screen, unless the Goal isn't ready. `vago` is the command that runs this
 * same `vago`. Gives back the line telling the human what happened. The
 * Goal shows as running once the new `vago run` takes its lock; a `vago run`
 * that can't start leaves the Goal as it was.
 */
export function startGoal(vago: string[], root: string, row: GoalRow): string {
	if (row.standing !== "ready") {
		return `${row.goal} is ${row.standing}; only a ready Goal starts here.`;
	}
	startDetached(vago, root, ["run", row.goal], "ignore");
	return `Started vago run ${row.goal}.`;
}

/**
 * Starts `vago plan say <item>` with `message` on stdin, as a process of
 * its own that outlives the TUI and writes nothing to its screen. The turn
 * shows in the item's chat once `vago plan say` records it; one refused
 * before that, such as for a blank message, leaves the chat as it was.
 */
export function startPlanningTurn(
	vago: string[],
	root: string,
	item: string,
	message: string,
): void {
	startDetached(
		vago,
		root,
		["plan", "say", item, "--body-file", "-"],
		new Blob([message]),
	);
}

/**
 * Starts `vago plan retry <item>` as a process of its own that outlives the
 * TUI and writes nothing to its screen. The retry shows in the item's chat
 * once `vago plan retry` reopens the turn; one refused before that leaves
 * the chat as it was.
 */
export function startPlanningRetry(
	vago: string[],
	root: string,
	item: string,
): void {
	startDetached(vago, root, ["plan", "retry", item], "ignore");
}

/** How `vago plan accept` ended: accepted, or refused with its reason. */
export type PlanAcceptEnd =
	| { outcome: "accepted" }
	| { outcome: "refused"; reason: string };

/**
 * Runs `vago plan accept <item>` in the Project at `root` as a process of
 * its own that neither a Ctrl-C nor a quit stops, and waits for it. `vago`
 * is the command that runs this same `vago`. A refusal carries the reason
 * the command gave.
 */
export async function runPlanAccept(
	vago: string[],
	root: string,
	item: string,
): Promise<PlanAcceptEnd> {
	const refusal = await runWaited(vago, root, ["plan", "accept", item]);
	return refusal === undefined
		? { outcome: "accepted" }
		: { outcome: "refused", reason: refusal };
}

/** How `vago plan discard` ended: discarded, or refused with its reason. */
export type PlanDiscardEnd =
	| { outcome: "discarded" }
	| { outcome: "refused"; reason: string };

/**
 * Runs `vago plan discard <item>` in the Project at `root`, which stops a
 * response to the item in progress first, as `runPlanAccept` runs
 * `vago plan accept`, and waits for it.
 */
export async function runPlanDiscard(
	vago: string[],
	root: string,
	item: string,
): Promise<PlanDiscardEnd> {
	const refusal = await runWaited(vago, root, ["plan", "discard", item]);
	return refusal === undefined
		? { outcome: "discarded" }
		: { outcome: "refused", reason: refusal };
}

// Runs `vago <args>` in `root` as a process of its own and waits for it.
// Gives back the reason it refused, or undefined once it succeeded.
async function runWaited(
	vago: string[],
	root: string,
	args: string[],
): Promise<string | undefined> {
	const child = Bun.spawn([...vago, ...args], {
		cwd: root,
		// Its own process group, as for `startDetached`, so the command isn't
		// cut short halfway.
		detached: true,
		stdin: "ignore",
		stdout: "ignore",
		stderr: "pipe",
	});
	const [stderr, exitCode] = await Promise.all([
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode === 0) return undefined;
	// `cli.ts` prints a refusal as `vago: <reason>`.
	const reason = stderr.trim().replace(/^vago: /, "");
	return reason === "" ? `vago ${args.join(" ")} exited ${exitCode}` : reason;
}

// Starts `vago <args>` in `root` with `stdin`, and lets go of it.
function startDetached(
	vago: string[],
	root: string,
	args: string[],
	stdin: "ignore" | Blob,
): void {
	const child = Bun.spawn([...vago, ...args], {
		cwd: root,
		// Its own process group, so neither a Ctrl-C nor the terminal closing
		// on the TUI reaches it.
		detached: true,
		stdin,
		stdout: "ignore",
		stderr: "ignore",
	});
	// The TUI quits without waiting for it.
	child.unref();
}
