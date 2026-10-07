// The `vago` commands the TUI starts: a ready, stuck or lost Goal's `vago
// run`, which it lets go of, `vago plan accept` and `vago plan discard`,
// which it waits for, and a planning item's `vago plan session`, which it
// owns while the planning view is open and stops when the view closes
// (ADR 0015). It stops nothing else: `vago plan discard` stops a session
// (ADR 0005). Hides how each is cut loose from the TUI and its terminal,
// the session's pseudo-terminal, and how a refusal is read back.

import type { GoalRow } from "./goal-rows.ts";

/**
 * Starts `vago run` on the Goal of `row`, of the Project at `root`, as a
 * process of its own that outlives the TUI and writes nothing to its
 * screen, unless the Goal is running, done or broken. A stuck or lost Goal
 * starts too, and its `vago run` picks it up where it stopped (ADR 0007).
 * `vago` is the command that runs this same `vago`. Gives back the line telling the human what happened. The
 * Goal shows as running once the new `vago run` takes its lock; a `vago run`
 * that can't start leaves the Goal as it was.
 */
export function startGoal(vago: string[], root: string, row: GoalRow): string {
	if (!["ready", "stuck", "lost"].includes(row.standing)) {
		return `${row.goal} is ${row.standing}; only a ready, stuck or lost Goal starts here.`;
	}
	startDetached(vago, root, ["run", row.goal]);
	return `Started vago run ${row.goal}.`;
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
 * Runs `vago plan discard <item>` in the Project at `root`, which stops the
 * item's open session first, as `runPlanAccept` runs `vago plan accept`,
 * and waits for it.
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

// Starts `vago <args>` in `root`, and lets go of it.
function startDetached(vago: string[], root: string, args: string[]): void {
	const child = Bun.spawn([...vago, ...args], {
		cwd: root,
		// Its own process group, so neither a Ctrl-C nor the terminal closing
		// on the TUI reaches it.
		detached: true,
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	// The TUI quits without waiting for it.
	child.unref();
}

/** A `vago plan session` the TUI started and owns. */
export type PlanningSessionProcess = {
	/** Sends `bytes` to the session as typed on its terminal. */
	write(bytes: Uint8Array): void;
	resize(cols: number, rows: number): void;
	/** Ends it and everything it started; calling it again does nothing. */
	stop(): void;
	/** Its exit code, once it has exited and released the item. */
	exited: Promise<number>;
};

/**
 * Runs `vago plan session <item>` in the Project at `root` on a
 * pseudo-terminal of `screen`'s size, whose output reaches
 * `screen.onOutput`. `vago` is the command that runs this same `vago`.
 * Unlike the commands `startDetached` lets go of, the TUI owns this one, so
 * it doesn't outlive the TUI: the caller stops it.
 */
export function startPlanningSession(
	vago: string[],
	root: string,
	item: string,
	screen: {
		cols: number;
		rows: number;
		onOutput: (bytes: Uint8Array) => void;
	},
): PlanningSessionProcess {
	const child = Bun.spawn([...vago, "plan", "session", item], {
		cwd: root,
		terminal: {
			cols: screen.cols,
			rows: screen.rows,
			data: (_terminal, bytes) => screen.onOutput(bytes),
		},
	});
	let stopped = false;
	// Nothing goes to a terminal already closed.
	const open = () => !stopped && child.terminal?.closed === false;
	return {
		write: (bytes) => {
			if (open()) child.terminal?.write(bytes);
		},
		resize: (cols, rows) => {
			if (open()) child.terminal?.resize(cols, rows);
		},
		stop: () => {
			if (stopped) return;
			stopped = true;
			// Its whole group, since it leads the session of its own terminal.
			// A group already gone answers ESRCH, or EPERM on macOS while its
			// last processes wait to be reaped.
			try {
				process.kill(-child.pid, "SIGTERM");
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code !== "ESRCH" && code !== "EPERM") throw error;
			}
			child.terminal?.close();
		},
		exited: child.exited,
	};
}
