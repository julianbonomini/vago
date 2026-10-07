// Stopping a process, and every process it starts, from writing under a
// folder, on macOS and on Linux. Hides `sandbox-exec` and `bwrap` and how
// each is told what to deny.

import { realpath } from "node:fs/promises";

/**
 * `command` wrapped so it, and every process it starts, can read anything
 * but write nothing under `folder`. Throws naming `sandbox-exec` (macOS) or
 * `bwrap` (Linux) when the platform has neither.
 */
export async function withoutWritesUnder(
	folder: string,
	command: string[],
): Promise<string[]> {
	// The sandbox matches the path the kernel sees, and a macOS temp folder
	// sits behind the `/private` symlink.
	const real = await realpath(folder);
	if (process.platform === "darwin") {
		const program = Bun.which("sandbox-exec");
		if (program === null) throw new Error(noSandbox("sandbox-exec", real));
		const profile = `(version 1)(allow default)(deny file-write* (subpath ${JSON.stringify(real)}))`;
		return [program, "-p", profile, ...command];
	}
	const program = Bun.which("bwrap");
	if (program === null) throw new Error(noSandbox("bwrap", real));
	return [
		program,
		"--dev-bind",
		"/",
		"/",
		"--ro-bind",
		real,
		real,
		"--",
		...command,
	];
}

function noSandbox(program: string, folder: string): string {
	return `${program} isn't on PATH, so nothing can stop a process writing under ${folder}; install ${program}`;
}
