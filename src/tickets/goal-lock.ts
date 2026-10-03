// The `running.lock` that marks a Goal as taken by a `vago run`: taking it
// with this process's pid, taking over one a dead run left, releasing it, and
// telling whether another live process holds it.
// Hides the lock's format and how a holder is found alive or dead.

import { link, rm } from "node:fs/promises";

/**
 * Takes the lock at `lock` for this process, taking over one whose holder
 * has died. Throws an Error naming Goal `goal`, the holder's pid and the lock
 * to delete when another live process holds it.
 */
export async function claimLock(lock: string, goal: string): Promise<void> {
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
	throw new Error(
		`Goal ${goal} is already being run by vago (pid ${holder ?? "unknown"}). If no vago run is running it, delete ${lock}`,
	);
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

// Creates the lock holding this process's pid, and returns false when it
// already exists. The pid is written to a file of its own and then linked:
// a link fails when its target exists, and a reader never sees the lock half
// written.
async function createLock(lock: string): Promise<boolean> {
	const temp = `${lock}.${process.pid}`;
	await Bun.write(temp, `${process.pid}\n`);
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
