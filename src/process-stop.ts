// Stopping a process, or the process group it leads. Hides the signals, the
// grace period and how a process already gone answers on each platform.

// Long enough for a process to stop the processes it started.
const stopGraceMs = 5_000;

/**
 * Stops the process `pid`, or with `"group"` every process of the group it
 * leads: SIGTERM at once, then SIGKILL to what is left after a grace
 * period. Resolves once they are gone or have been sent SIGKILL. A process
 * or group already gone counts as stopped.
 */
export async function stopProcesses(
	pid: number,
	scope: "group" | "process",
): Promise<void> {
	// `process.kill` reaches a whole group through its leader's pid negated.
	// SIGTERM first, because a process can start others in process groups of
	// their own, which no signal to this group reaches, and only it can stop
	// them. SIGKILL after the grace period, because a process that ignores
	// SIGTERM must still end.
	const target = scope === "group" ? -pid : pid;
	const deadline = Date.now() + stopGraceMs;
	signalTarget(target, "SIGTERM");
	while (signalTarget(target, 0)) {
		if (Date.now() >= deadline) {
			signalTarget(target, "SIGKILL");
			return;
		}
		await Bun.sleep(50);
	}
}

// False when the target is gone, as it is already when the signal comes just
// after it ended. Signal 0 only asks whether it is alive. macOS answers
// EPERM, not ESRCH, while every process left in a group is a zombie waiting
// to be reaped, and no signal can reach such a group either.
function signalTarget(target: number, signal: NodeJS.Signals | 0): boolean {
	try {
		process.kill(target, signal);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ESRCH" && code !== "EPERM") throw error;
		return false;
	}
}
