// The `vago` processes the TUI starts and lets go of: a ready Goal's
// `vago run` and a planning turn's `vago plan say`, which the TUI never owns
// (ADR 0005). Hides how such a process is cut loose from the TUI and its
// terminal.

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
