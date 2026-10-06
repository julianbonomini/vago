// Test helper: a throwaway Project in a temp git repo, and `vago` run against
// it as a child process, the one seam the CLI tests go through.

import { afterEach } from "bun:test";
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

// What every `vago` child gets unless a test names its own: `vagoHome`, and
// retry waits of no time, so a failing agent Step's retries don't slow a test.
const testEnv = { VAGO_HOME: vagoHome, VAGO_RETRY_MINUTE_MS: "0" };

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

/**
 * A `goal.md` whose `+++` header names `workflow` and holds the Runs of its
 * Goal Steps, `beforeAll`'s then `afterAll`'s, followed by `body`. Run N of
 * step `s` of `before_all` logs to `logs/before_all-s-N.log`, or `.jsonl`
 * for an agent Step's, in the Goal's folder.
 */
export function goalText(
	workflow: string,
	body = "# Hello\n",
	runs: { beforeAll?: FixtureRun[]; afterAll?: FixtureRun[] } = {},
): string {
	const before = (runs.beforeAll ?? []).map((run) => ({
		run,
		prefix: "before_all-",
	}));
	const after = (runs.afterAll ?? []).map((run) => ({
		run,
		prefix: "after_all-",
	}));
	const lines = [
		`workflow = "${workflow}"`,
		...runTables([...before, ...after]),
	];
	return `+++\n${lines.join("\n")}\n+++\n${body}`;
}

/**
 * Makes a Project as `makeProject` does whose Goals are `names`, each with a
 * `goal.md` naming Workflow `w`, and returns its root.
 */
export function projectWithGoals(names: string[]): Promise<string> {
	return makeProject(
		Object.fromEntries(
			names.map((name) => [`.vago-goals/${name}/goal.md`, goalText("w")]),
		),
	);
}

/** One `[[runs]]` entry for `ticketText`, open while `ended` is absent. */
export type FixtureRun = {
	step: string;
	started: Date;
	ended?: Date;
	outcome?: string;
	costUsd?: number;
	tokens?: { input: number; output: number };
	/** Makes the Run an agent Step's, logging `.jsonl`. */
	model?: string;
	/** An agent Run's Harness, Claude Code unless given. */
	harness?: string;
	/** How an agent Run set out, when not in a fresh session as usual. */
	resume?: "resumed" | "fell-back";
	/** When a `vago run` retries the Run, which it waits for meanwhile. */
	retryAt?: Date;
};

/**
 * A Ticket file with status `status` in a `+++` header, then `body`, a short
 * one by default, going through `workflow` when given and the Goal's
 * otherwise. Run N of step `s` logs to `logs/s-N.log`, or `.jsonl` for an
 * agent Step's, in the Goal's folder.
 */
export function ticketText(
	status: "ready" | "running" | "done" | "stuck",
	options: {
		runs?: FixtureRun[];
		blockedBy?: number[];
		workflow?: string;
		body?: string;
	} = {},
): string {
	const lines = [`status = "${status}"`];
	if (options.workflow !== undefined) {
		lines.push(`workflow = "${options.workflow}"`);
	}
	if (options.blockedBy !== undefined) {
		lines.push(`blocked_by = [${options.blockedBy.join(", ")}]`);
	}
	lines.push(
		...runTables((options.runs ?? []).map((run) => ({ run, prefix: "" }))),
	);
	return `+++\n${lines.join("\n")}\n+++\n\n${options.body ?? "# A Ticket\n"}`;
}

// The `[[runs]]` tables of `runs`, each Run's log named after `prefix`, its
// Step and its position.
function runTables(runs: { run: FixtureRun; prefix: string }[]): string[] {
	const lines: string[] = [];
	for (const [index, { run, prefix }] of runs.entries()) {
		lines.push("", "[[runs]]", `step = "${run.step}"`);
		lines.push(`started = ${run.started.toISOString()}`);
		if (run.ended !== undefined)
			lines.push(`ended = ${run.ended.toISOString()}`);
		if (run.outcome !== undefined) lines.push(`outcome = "${run.outcome}"`);
		if (run.costUsd !== undefined) lines.push(`cost_usd = ${run.costUsd}`);
		if (run.tokens !== undefined) {
			lines.push(
				`tokens = { input = ${run.tokens.input}, output = ${run.tokens.output} }`,
			);
		}
		if (run.model !== undefined) {
			lines.push(
				`harness = "${run.harness ?? "claude-code"}"`,
				`model = "${run.model}"`,
			);
		}
		if (run.resume !== undefined) lines.push(`resume = "${run.resume}"`);
		if (run.retryAt !== undefined) {
			lines.push(`retry_at = ${run.retryAt.toISOString()}`);
		}
		const extension = run.model === undefined ? "log" : "jsonl";
		lines.push(`log = "logs/${prefix}${run.step}-${index + 1}.${extension}"`);
	}
	return lines;
}

/** A `running.lock` held by a live process, until `release` is called. */
export type HeldLock = {
	/** Kills the process holding the lock and waits for it to exit. */
	release(): Promise<void>;
};

const heldLocks = new Set<HeldLock>();

// A lock left held would leave a `sleep` running after the suite.
afterEach(async () => {
	for (const lock of heldLocks) await lock.release();
});

/**
 * Writes Goal `goal`'s `running.lock` in the Project at `root` with the pid
 * of a process this spawns, so the Goal looks taken by a live `vago run`. The
 * test's own pid won't do: Vago treats its own pid in a lock as stale.
 */
export async function heldLock(root: string, goal: string): Promise<HeldLock> {
	const holder = Bun.spawn(["sleep", "60"]);
	await Bun.write(
		join(root, ".vago-goals", goal, "running.lock"),
		`${holder.pid}\n`,
	);
	const lock = {
		release: async () => {
			heldLocks.delete(lock);
			holder.kill();
			await holder.exited;
		},
	};
	heldLocks.add(lock);
	return lock;
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
		env: { ...process.env, ...testEnv, ...env },
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

/**
 * Reads the Ticket file at `path`, relative to the repo root `root`, or any
 * other file opening with a `+++` header, like `goal.md`.
 */
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

/** The `[[runs]]` of a Ticket header, empty when it has none. */
export function runsOf(
	header: Record<string, unknown>,
): Record<string, unknown>[] {
	return (header.runs ?? []) as Record<string, unknown>[];
}

/** A Workflow of one shell Step, `work`, running `run`. */
export function oneStep(run: string): string {
	return `
[[steps]]
id   = "work"
type = "shell"
run  = '''${run}'''
`;
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
			env: { ...process.env, ...testEnv, ...env },
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

/** What the main checkout looks like: its branch, git status and files. */
export type CheckoutSnapshot = {
	branch: string;
	status: string;
	files: string[];
};

/**
 * Takes a snapshot of the main checkout at `root`, leaving out `.git/`, which
 * holds the store every worktree shares, and `.vago-goals/`, which Vago
 * writes during a run.
 */
export async function checkoutSnapshot(
	root: string,
): Promise<CheckoutSnapshot> {
	const git = (...args: string[]) =>
		Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString();
	const files: string[] = [];
	for await (const path of new Bun.Glob("**").scan({ cwd: root, dot: true })) {
		if (!/^\.(git|vago-goals)\//.test(path)) files.push(path);
	}
	return {
		branch: git("branch", "--show-current"),
		status: git("status", "--porcelain"),
		files: files.sort(),
	};
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
