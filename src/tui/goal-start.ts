// Starting a Goal from the TUI: which Goals may start, and the `vago run`
// started for one, which the TUI never owns (ADR 0005). Hides how that
// process is cut loose from the TUI and its terminal.

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
	const run = Bun.spawn([...vago, "run", row.goal], {
		cwd: root,
		// Its own process group, so neither a Ctrl-C nor the terminal closing
		// on the TUI reaches it.
		detached: true,
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	// The TUI quits without waiting for it.
	run.unref();
	return `Started vago run ${row.goal}.`;
}
