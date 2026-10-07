// The `running.lock` that marks a Goal as taken by a `vago run`, or a
// planning item as being accepted, answered, renamed or discarded: taking it
// with this process's pid, taking over one a dead holder left, releasing it,
// telling who holds it, and stopping a live holder.
// Hides the lock's format, how a holder is found alive or dead, and how one
// is stopped.

import { link, rm } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Takes the lock at `lock` for this process, taking over one whose holder
 * has died. Throws `refusal` of the holder's pid, or of `unknown` when the
 * lock holds none, when another live process holds it. Never creates the
 * lock's folder: throws an Error naming the folder when it is gone.
 */
export async function claimLock(
	lock: string,
	refusal: (pid: string) => string,
): Promise<void> {
	if (await createLock(lock)) return;
	let holder = await lockHolder(lock);
	if (holder === undefined || !isRunning(holder)) {
		// Two runs taking over the same dead lock at once can both win, when
		// one removes the lock the other has just created. That takes a
		// crashed run and then two starts within milliseconds, and closing it
		// would take a second lock.
		await rm(lock, { force: true });
		if (await createLock(lock)) return;
		holder = await lockHolder(lock);
	}
	throw new Error(refusal(String(holder ?? "unknown")));
}

/** Removes the lock at `lock` when this process holds it. */
export async function releaseLock(lock: string): Promise<void> {
	// A lock holding another pid was taken over from this run, so it's not
	// this run's to remove.
	if ((await lockHolder(lock)) === process.pid) await rm(lock, { force: true });
}

/**
 * Whether a live process other than this one holds the lock at `lock`.
 * False when there is no lock or it holds no pid.
 */
export async function isLockHeld(lock: string): Promise<boolean> {
	const holder = await lockHolder(lock);
	return holder !== undefined && isRunning(holder);
}

/** Whether this process holds the lock at `lock`. */
export async function isLockMine(lock: string): Promise<boolean> {
	return (await lockHolder(lock)) === process.pid;
}

// How long a holder asked to stop gets before it is killed.
const stopTimeoutMs = 10_000;

/**
 * Asks the live process holding the lock at `lock` to stop, and resolves
 * once no live process holds it, released or dead. A holder still alive
 * after 10 seconds is killed. Resolves at once when no live process holds
 * it.
 */
export async function stopLockHolder(lock: string): Promise<void> {
	const holder = await lockHolder(lock);
	if (holder === undefined || !isRunning(holder)) return;
	signal(holder, "SIGTERM");
	const killAt = Date.now() + stopTimeoutMs;
	let killed = false;
	while (await isLockHeld(lock)) {
		if (!killed && Date.now() >= killAt) {
			signal(holder, "SIGKILL");
			killed = true;
		}
		await Bun.sleep(50);
	}
}

// Sends `name` to `pid`, which may have died since it was found alive.
function signal(pid: number, name: NodeJS.Signals): void {
	try {
		process.kill(pid, name);
	} catch (error) {
		if (errorCode(error) !== "ESRCH") throw error;
	}
}

// Creates the lock holding this process's pid, and returns false when it
// already exists. The pid is written to a file of its own and then linked:
// a link fails when its target exists, and a reader never sees the lock half
// written.
async function createLock(lock: string): Promise<boolean> {
	const temp = `${lock}.${process.pid}`;
	try {
		// Not creating the folder, so a claim racing a discard doesn't bring a
		// removed item back as an empty folder.
		await Bun.write(temp, `${process.pid}\n`, { createPath: false });
	} catch (error) {
		if (errorCode(error) === "ENOENT") {
			throw new Error(
				`${dirname(lock)} is gone, so nothing can be locked there`,
			);
		}
		throw error;
	}
	try {
		await link(temp, lock);
		return true;
	} catch (error) {
		if (errorCode(error) === "EEXIST") return false;
		throw error;
	} finally {
		await rm(temp, { force: true });
	}
}

// The pid in the lock, or undefined when there's no lock or it holds no pid.
async function lockHolder(lock: string): Promise<number | undefined> {
	const text = await Bun.file(lock)
		.text()
		.catch(() => "");
	return /^\d+\n$/.test(text) ? Number(text) : undefined;
}

// This process's own pid in the lock can only be stale: a crashed run's pid
// that the system has since given to this one.
function isRunning(pid: number): boolean {
	if (pid === process.pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM is a live process owned by someone else.
		return errorCode(error) !== "ESRCH";
	}
}

function errorCode(error: unknown): unknown {
	return error instanceof Error && "code" in error ? error.code : undefined;
}
