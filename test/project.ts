// Test helper: a throwaway Project in a temp git repo, and `vago` run against
// it as a child process, the one seam the CLI tests go through.

import { mkdtempSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "smol-toml";

const cli = join(import.meta.dir, "..", "src", "cli.ts");

/**
 * The `VAGO_HOME` every `vago` child gets unless a test names its own, so
 * Goal worktrees land in a temp directory and never in the real home folder.
 */
export const vagoHome = mkdtempSync(join(tmpdir(), "vago-home-"));

/**
 * Flags that let a test's `git commit` run whatever the human's git config
 * says: a name and email, and no signing.
 */
export const gitIdentity = [
	"-c",
	"user.name=t",
	"-c",
	"user.email=t@t",
	"-c",
	"commit.gpgsign=false",
];

/**
 * Makes a git repo in a fresh temp directory, with one empty commit on
 * `main`, holding `files` untracked, keyed by path relative to the repo root,
 * and returns the repo root.
 */
export async function makeProject(
	files: Record<string, string>,
): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vago-test-"));
	Bun.spawnSync(["git", "init", "--quiet", "-b", "main"], { cwd: root });
	// A Goal's worktree is cut from a commit, and the test must not depend on
	// the human's git config.
	Bun.spawnSync(
		[
			"git",
			...gitIdentity,
			"commit",
			"--quiet",
			"--allow-empty",
			"-m",
			"start",
		],
		{ cwd: root },
	);
	for (const [path, text] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await Bun.write(join(root, path), text);
	}
	return root;
}

/** A `goal.md` whose `+++` header names `workflow`, followed by `body`. */
export function goalText(workflow: string, body = "# Hello\n"): string {
	return `+++\nworkflow = "${workflow}"\n+++\n${body}`;
}

/** What a finished `vago` child left behind. */
export type VagoExit = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

/** A `vago` child started by `startVago` and not yet waited for. */
export type RunningVago = {
	/** Sends `signal` to the `vago` process alone, as `kill` would. */
	kill(signal: NodeJS.Signals): void;
	/** Resolves once `vago` has exited. */
	exited: Promise<VagoExit>;
};

/**
 * Starts `vago <args>` with `root` as the working directory without waiting
 * for it. `env` is added to this process's environment, overriding what it
 * names. `vago` reads `stdin` as what the human typed, then end of input.
 */
export function startVago(
	root: string,
	args: string[],
	env: Record<string, string> = {},
	stdin = "",
): RunningVago {
	const child = Bun.spawn([process.execPath, cli, ...args], {
		cwd: root,
		env: { ...process.env, VAGO_HOME: vagoHome, ...env },
		stdin: new Blob([stdin]),
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

/** Starts `vago <args>` as `startVago` does and waits for it to exit. */
export function runVago(
	root: string,
	args: string[],
	env: Record<string, string> = {},
	stdin = "",
): Promise<VagoExit> {
	return startVago(root, args, env, stdin).exited;
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

/**
 * Runs `vago <args>` as `runVago` does, but with a terminal for stdout, and
 * resolves to everything it printed there once the terminal closes. The
 * terminal writes each newline as `\r\n`.
 */
export function runVagoInTerminal(
	root: string,
	args: string[],
	env: Record<string, string> = {},
): Promise<string> {
	const decoder = new TextDecoder();
	let printed = "";
	return new Promise((resolve) => {
		Bun.spawn([process.execPath, cli, ...args], {
			cwd: root,
			env: { ...process.env, VAGO_HOME: vagoHome, ...env },
			terminal: {
				cols: 200,
				data: (_terminal, chunk) => {
					printed += decoder.decode(chunk, { stream: true });
				},
				exit: () => resolve(printed),
			},
		});
	});
}

/**
 * Waits until Goal `goal` of the Project at `root` has a worktree, and
 * returns its real path.
 */
export async function goalWorktree(
	root: string,
	goal: string,
): Promise<string> {
	// Found through git's own list, by branch, so the test knows nothing of
	// where Vago lays worktrees out.
	for (;;) {
		const list = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], {
			cwd: root,
		}).stdout.toString();
		for (const entry of list.split("\n\n")) {
			const lines = entry.split("\n");
			if (!lines.includes(`branch refs/heads/vago/${goal}`)) continue;
			const path = lines.find((line) => line.startsWith("worktree "));
			if (path !== undefined) return realpath(path.slice("worktree ".length));
		}
		await Bun.sleep(20);
	}
}

/**
 * Makes a folder holding a `vago` that runs this checkout's CLI, and returns
 * it, for a test to put first on `PATH` so a Step can call `vago`.
 */
export async function vagoOnPath(): Promise<string> {
	const bin = await mkdtemp(join(tmpdir(), "vago-bin-"));
	await Bun.write(
		join(bin, "vago"),
		`#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`,
	);
	await chmod(join(bin, "vago"), 0o755);
	return bin;
}
