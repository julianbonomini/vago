// A Goal's worktree, where its Steps run: creating it, recreating it from its
// branch, reusing it, and the way back from it to the main checkout. Hides the
// `VAGO_HOME` layout, the branch name, the default-branch rule, the git
// commands, and what gets copied.

import { existsSync } from "node:fs";
import { cp, mkdir, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { goalsFolderName } from "./tickets.ts";

/**
 * Gives Goal `goal` of the Project at `root` its worktree and returns the
 * worktree's absolute path. A worktree that exists is reused with its work.
 * Otherwise one is made in a folder under `$VAGO_HOME/worktrees/`
 * (`~/.vago` by default), checking out `vago/<goal>` with the Goal's work
 * when that branch exists, or else a new `vago/<goal>` cut from the
 * Project's default branch, and it gets every untracked and ignored file of
 * `root` except `.vago-goals/`. Either way, when `.vago/` is untracked the
 * worktree's `.vago/` is `root`'s as it is now. Throws an Error naming the
 * problem when a new branch is needed and `root`'s default branch can't be
 * told, or when git fails.
 */
export async function openWorktree(
	root: string,
	goal: string,
): Promise<string> {
	const path = await worktreePath(root, goal);
	const untracked = await untrackedEntries(root);
	if (!existsSync(path)) {
		await mkdir(dirname(path), { recursive: true });
		const branch = `vago/${goal}`;
		if (await hasBranch(root, `refs/heads/${branch}`)) {
			// A worktree deleted by hand can leave git's record of it behind,
			// which keeps the branch checked out there.
			await git(root, ["worktree", "prune"]);
			await git(root, ["worktree", "add", "--quiet", path, branch]);
		} else {
			await git(root, [
				"worktree",
				"add",
				"--quiet",
				"--no-track",
				"-b",
				branch,
				path,
				await defaultBranch(root),
			]);
		}
		await copyUntracked(root, path, untracked);
	}
	// The Workflow is read from `root` on every run, so the scripts and
	// prompts beside it must come from there too, not from an earlier copy.
	if (untracked.includes(".vago/")) {
		await rm(join(path, ".vago"), { recursive: true, force: true });
		await copyUntracked(root, path, [".vago/"]);
	}
	return realpath(path);
}

/**
 * The Project root for a `vago` command started in `cwd`: the main checkout
 * when `cwd` is inside a Goal's worktree, so a Step's `vago goal report` reads
 * the Goal's state, and `cwd` otherwise.
 */
export async function projectRoot(cwd: string): Promise<string> {
	const folder = worktreesFolder();
	// A machine that never ran a Goal has no folder, and no worktree to be in.
	if (!existsSync(folder)) return cwd;
	const inside = relative(await realpath(folder), await realpath(cwd));
	if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`)) {
		return cwd;
	}
	// Every worktree shares the main checkout's `.git`, from any subfolder. A
	// folder under `worktrees/` that isn't in a git repo is no worktree.
	const common = await runGit(cwd, [
		"rev-parse",
		"--path-format=absolute",
		"--git-common-dir",
	]);
	return common.code === 0 ? dirname(common.stdout.trim()) : cwd;
}

function worktreesFolder(): string {
	return join(process.env.VAGO_HOME ?? join(homedir(), ".vago"), "worktrees");
}

// One folder per Project, named so a human can tell which, and hashed so two
// Projects with the same folder name don't share it.
async function worktreePath(root: string, goal: string): Promise<string> {
	const real = await realpath(root);
	const hash = new Bun.CryptoHasher("sha256").update(real).digest("hex");
	return join(worktreesFolder(), `${basename(real)}-${hash.slice(0, 8)}`, goal);
}

// The start point of a Goal's branch. No fetch: a Goal starts from what the
// human last pulled.
async function defaultBranch(root: string): Promise<string> {
	const remote = await runGit(root, [
		"symbolic-ref",
		"--quiet",
		"--short",
		"refs/remotes/origin/HEAD",
	]);
	if (remote.code === 0) {
		const originHead = remote.stdout.trim();
		const name = originHead.slice("origin/".length);
		return (await hasBranch(root, `refs/heads/${name}`)) ? name : originHead;
	}
	for (const name of ["main", "master"]) {
		if (await hasBranch(root, `refs/heads/${name}`)) return name;
	}
	throw new Error(
		`Can't tell ${root}'s default branch: origin/HEAD isn't set and there is no main or master branch. Run git remote set-head origin --auto.`,
	);
}

// What git doesn't carry to a new worktree: untracked and ignored entries,
// with a folder that holds nothing tracked listed once, like `node_modules/`.
// The Goals stay behind, since their state lives in the main checkout alone.
async function untrackedEntries(root: string): Promise<string[]> {
	const listed = await git(root, ["ls-files", "-z", "--others", "--directory"]);
	return listed
		.split("\0")
		.filter(
			(entry) => entry !== "" && !entry.startsWith(`${goalsFolderName}/`),
		);
}

// Bun has no recursive copy. Symlinks are copied as they are, so one that
// points into the main checkout still does.
async function copyUntracked(
	root: string,
	path: string,
	entries: string[],
): Promise<void> {
	for (const entry of entries) {
		await cp(join(root, entry), join(path, entry), {
			recursive: true,
			force: true,
			verbatimSymlinks: true,
		});
	}
}

async function hasBranch(root: string, ref: string): Promise<boolean> {
	const { code } = await runGit(root, [
		"rev-parse",
		"--verify",
		"--quiet",
		ref,
	]);
	return code === 0;
}

// Git's stdout, for a command that must succeed.
async function git(cwd: string, args: string[]): Promise<string> {
	const { code, stdout, stderr } = await runGit(cwd, args);
	if (code !== 0) {
		throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${stderr.trim()}`);
	}
	return stdout;
}

// For a command whose failure is an answer, like a branch that isn't there.
async function runGit(
	cwd: string,
	args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
	const child = Bun.spawn(["git", "-C", cwd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { code, stdout, stderr };
}
