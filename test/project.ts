// Test helper: a throwaway Project in a temp git repo, and `punt` run against
// it as a child process, the one seam the CLI tests go through.

import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "smol-toml";

const cli = join(import.meta.dir, "..", "src", "cli.ts");

/**
 * Makes a git repo in a fresh temp directory holding `files`, keyed by path
 * relative to the repo root, and returns the repo root.
 */
export async function makeProject(
	files: Record<string, string>,
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "punt-test-"));
	Bun.spawnSync(["git", "init", "--quiet"], { cwd: root });
	for (const [path, text] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await Bun.write(join(root, path), text);
	}
	return root;
}

/** What a finished `punt` child left behind. */
export type PuntExit = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

/** A `punt` child started by `startPunt` and not yet waited for. */
export type RunningPunt = {
	/** Sends `signal` to the `punt` process alone, as `kill` would. */
	kill(signal: NodeJS.Signals): void;
	/** Resolves once `punt` has exited. */
	exited: Promise<PuntExit>;
};

/**
 * Starts `punt <args>` with `root` as the working directory without waiting
 * for it. `env` is added to this process's environment, overriding what it
 * names.
 */
export function startPunt(
	root: string,
	args: string[],
	env: Record<string, string> = {},
): RunningPunt {
	const child = Bun.spawn([process.execPath, cli, ...args], {
		cwd: root,
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		kill: (signal) => child.kill(signal),
		exited: Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]).then(([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr })),
	};
}

/**
 * Runs `punt <args>` with `root` as the working directory and waits for it.
 * `env` is added to this process's environment, overriding what it names.
 */
export function runPunt(
	root: string,
	args: string[],
	env: Record<string, string> = {},
): Promise<PuntExit> {
	return startPunt(root, args, env).exited;
}

/** A Ticket file as the tests read it: its `+++` header parsed, and its body. */
export type TicketFile = { header: Record<string, unknown>; body: string };

/** Reads the Ticket file at `path`, relative to the repo root `root`. */
export async function readTicketFile(
	root: string,
	path: string,
): Promise<TicketFile> {
	const text = await Bun.file(join(root, path)).text();
	const end = text.indexOf("\n+++\n");
	return {
		header: parse(text.slice("+++\n".length, end + 1)),
		body: text.slice(end + "\n+++\n".length),
	};
}
