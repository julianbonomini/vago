import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	gitIdentity,
	goalText,
	goalWorktree,
	makeProject,
	readTicketFile,
	runVago,
	type VagoExit,
	vagoHome,
	vagoOnPath,
} from "./project.ts";

const goalDir = ".vago-goals/hello";
const ticketPath = `${goalDir}/tickets/01-say-hello.md`;
const ticket = `+++\nstatus = "ready"\n+++\n# Say hello\n`;

// A Workflow of one shell Step running `run`.
function oneStep(run: string): string {
	return `
[[steps]]
id   = "work"
type = "shell"
run  = '${run}'
`;
}

test("a shell Step runs in a worktree on vago/<goal>, outside the repo", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": oneStep(
			"pwd -P > where.txt; git branch --show-current > branch.txt",
		),
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});

	const result = await runVago(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	const worktree = await goalWorktree(root, "hello");
	const read = (name: string) => Bun.file(join(worktree, name)).text();
	expect((await read("where.txt")).trim()).toBe(worktree);
	expect(worktree.startsWith(await realpath(vagoHome))).toBe(true);
	expect(worktree.startsWith(await realpath(root))).toBe(false);
	expect((await read("branch.txt")).trim()).toBe("vago/hello");
});

test("the worktree is cut from the default branch, whatever it's called", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": oneStep("git rev-parse HEAD > head.txt"),
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});
	const origin = await mkdtemp(join(tmpdir(), "vago-origin-"));
	const git = (cwd: string, ...args: string[]) =>
		Bun.spawnSync(["git", ...gitIdentity, ...args], { cwd }).stdout.toString();
	git(origin, "init", "--quiet", "--bare", "-b", "trunk");
	git(root, "branch", "-m", "main", "trunk");
	git(root, "commit", "--quiet", "--allow-empty", "-m", "on trunk");
	git(root, "remote", "add", "origin", origin);
	git(root, "push", "--quiet", "origin", "trunk");
	git(root, "remote", "set-head", "origin", "trunk");
	git(root, "switch", "--quiet", "-c", "feature");
	git(root, "commit", "--quiet", "--allow-empty", "-m", "on feature");

	const result = await runVago(root, ["run", "hello"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	const worktree = await goalWorktree(root, "hello");
	const head = (await Bun.file(join(worktree, "head.txt")).text()).trim();
	expect(head).toBe(git(root, "rev-parse", "trunk").trim());
	expect(head).not.toBe(git(root, "rev-parse", "feature").trim());
});

test("the main checkout's branch, files and git status are as they were", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": oneStep(
			`echo made > made.txt && git add made.txt && git ${gitIdentity.join(" ")} commit -qm made`,
		),
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});
	const snapshot = async () => {
		const git = (...args: string[]) =>
			Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString();
		const files: string[] = [];
		for await (const path of new Bun.Glob("**").scan({
			cwd: root,
			dot: true,
		})) {
			// `.git/` holds the store every worktree shares.
			if (!/^\.(git|vago-goals)\//.test(path)) files.push(path);
		}
		return {
			branch: git("branch", "--show-current"),
			status: git("status", "--porcelain"),
			files: files.sort(),
		};
	};
	const before = await snapshot();

	const result = await runVago(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	expect(await snapshot()).toEqual(before);
});

test("the worktree holds the main checkout's untracked and ignored files, but not .vago-goals/", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": oneStep(
			"cat .env notes.txt > seen.txt && test ! -e .vago-goals",
		),
		".gitignore": ".env\n",
		".env": "secret\n",
		"notes.txt": "note\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});

	const result = await runVago(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	expect((await readTicketFile(root, ticketPath)).header.status).toBe("done");
	const worktree = await goalWorktree(root, "hello");
	expect(await Bun.file(join(worktree, "seen.txt")).text()).toBe(
		"secret\nnote\n",
	);
});

test("an untracked .vago/ runs its shell scripts from inside the worktree", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": oneStep("sh .vago/scripts/hello.sh"),
		".vago/scripts/hello.sh": "pwd -P > ran-in.txt\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});

	const result = await runVago(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	expect((await readTicketFile(root, ticketPath)).header.status).toBe("done");
	const worktree = await goalWorktree(root, "hello");
	expect((await Bun.file(join(worktree, "ran-in.txt")).text()).trim()).toBe(
		worktree,
	);
});

test("[[runs]] and logs land in the main checkout's .vago-goals/, and the report shows them", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": `${oneStep("echo first")}
[[steps]]
id   = "again"
type = "shell"
run  = "echo second"
`,
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});

	await runVago(root, ["run", "hello"]);

	const { header } = await readTicketFile(root, ticketPath);
	const runs = header.runs as Record<string, unknown>[];
	expect(runs.map((run) => run.step)).toEqual(["work", "again"]);
	for (const run of runs) {
		expect(await Bun.file(join(root, goalDir, String(run.log))).exists()).toBe(
			true,
		);
	}
	const report = await runVago(root, ["goal", "report", "hello"]);
	expect(report.stdout).toContain("| 01-say-hello | work | ok |");
	expect(report.stdout).toContain("| 01-say-hello | again | ok |");
	const worktree = await goalWorktree(root, "hello");
	expect(await Bun.file(join(worktree, goalDir, "goal.md")).exists()).toBe(
		false,
	);
});

test("vago goal report works from a Step", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": oneStep("vago goal report hello > report.md"),
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});

	const result = await runVago(root, ["run", "hello"], {
		PATH: `${await vagoOnPath()}:${process.env.PATH}`,
	});

	expect(result.exitCode).toBe(0);
	expect((await readTicketFile(root, ticketPath)).header.status).toBe("done");
	const worktree = await goalWorktree(root, "hello");
	expect(await Bun.file(join(worktree, "report.md")).text()).toContain(
		"01-say-hello",
	);
});

test("vago run prints the worktree's path", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": oneStep("true"),
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});

	const result = await runVago(root, ["run", "hello"]);

	expect(result.stdout.split("\n")[0]).toBe(
		`Worktree ${await goalWorktree(root, "hello")}`,
	);
});

// Goal hello's Project: Ticket 01 commits one.txt on vago/hello, and Ticket
// 02 runs `check`.
function makeTwoTicketProject(
	files: Record<string, string>,
	check: string,
): Promise<string> {
	return makeProject({
		...files,
		".vago/workflows/test.toml": oneStep(
			`if [ "$VAGO_TICKET" = 01-one ]; then echo one > one.txt && git add one.txt && git ${gitIdentity.join(" ")} commit -qm one; else ${check}; fi`,
		),
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-one.md`]: ticket,
		[`${goalDir}/tickets/02-two.md`]: ticket,
	});
}

const checkScript = 'test -e one.txt && test -n "$PASS"\n';

// Goal hello's Project whose Ticket 02 runs `.vago/scripts/check.sh`, which
// fails until PASS is set.
function makeCheckScriptProject(): Promise<string> {
	return makeTwoTicketProject(
		{ ".vago/scripts/check.sh": checkScript },
		"sh .vago/scripts/check.sh",
	);
}

// Runs Goal hello until Ticket 02 fails, resets 02, edits `check.sh` in
// `root` to also write version.txt holding v2, and runs again with PASS=1.
async function rerunWithEditedCheckScript(
	root: string,
): Promise<{ first: VagoExit; again: VagoExit }> {
	const first = await runVago(root, ["run", "hello"]);
	expect(first.exitCode).not.toBe(0);
	await runVago(root, ["ticket", "reset", "hello", "2"]);
	await Bun.write(
		join(root, ".vago/scripts/check.sh"),
		`echo v2 > version.txt\n${checkScript}`,
	);
	const again = await runVago(root, ["run", "hello"], { PASS: "1" });
	return { first, again };
}

test("re-running a Goal reuses its worktree, with its work and the main checkout's .vago/ as it is now", async () => {
	const root = await makeCheckScriptProject();

	const { first, again } = await rerunWithEditedCheckScript(root);

	const worktreeLine = (stdout: string) => stdout.split("\n")[0];
	expect(worktreeLine(again.stdout)).toBe(worktreeLine(first.stdout));
	expect(again.exitCode).toBe(0);
	const { header } = await readTicketFile(root, `${goalDir}/tickets/02-two.md`);
	expect(header.status).toBe("done");
	const worktree = await goalWorktree(root, "hello");
	expect(await Bun.file(join(worktree, "version.txt")).text()).toBe("v2\n");
});

// Runs Goal hello, whose Ticket 01 commits one.txt on vago/hello and whose
// Ticket 02 runs `check`, failing until PASS is set. Then it deletes the
// worktree the way `remove` says, resets 02 and runs the Goal again with
// PASS=1.
async function rerunWithDeletedWorktree(
	files: Record<string, string>,
	check: string,
	remove: "rm -rf" | "git worktree remove",
): Promise<{ root: string; first: VagoExit; again: VagoExit }> {
	const root = await makeTwoTicketProject(files, check);
	const first = await runVago(root, ["run", "hello"]);
	expect(first.exitCode).not.toBe(0);
	const worktree = await goalWorktree(root, "hello");
	if (remove === "rm -rf") {
		await rm(worktree, { recursive: true, force: true });
	} else {
		// The copied untracked files leave the worktree dirty.
		const removed = Bun.spawnSync(
			["git", "worktree", "remove", "--force", worktree],
			{ cwd: root },
		);
		expect(removed.exitCode).toBe(0);
	}
	await runVago(root, ["ticket", "reset", "hello", "2"]);
	const again = await runVago(root, ["run", "hello"], { PASS: "1" });
	return { root, first, again };
}

test("a worktree deleted by hand is recreated from vago/<goal> with its commits, and the remaining Tickets finish", async () => {
	const { root, first, again } = await rerunWithDeletedWorktree(
		{},
		'test -e one.txt && test -n "$PASS"',
		"rm -rf",
	);

	expect(again.stderr).toBe("");
	expect(again.exitCode).toBe(0);
	const { header } = await readTicketFile(root, `${goalDir}/tickets/02-two.md`);
	expect(header.status).toBe("done");
	const worktreeLine = (stdout: string) => stdout.split("\n")[0];
	expect(worktreeLine(again.stdout)).toBe(worktreeLine(first.stdout));
	const worktree = await goalWorktree(root, "hello");
	const git = (...args: string[]) =>
		Bun.spawnSync(["git", ...args], { cwd: worktree }).stdout.toString();
	expect(git("branch", "--show-current").trim()).toBe("vago/hello");
	expect(git("log", "--format=%s").split("\n")).toContain("one");
});

test("a recreated worktree holds the main checkout's untracked and ignored files, but not .vago-goals/", async () => {
	const { root, again } = await rerunWithDeletedWorktree(
		{ ".gitignore": ".env\n", ".env": "secret\n", "notes.txt": "note\n" },
		'test -e one.txt && cat .env notes.txt > seen.txt && test ! -e .vago-goals && test -n "$PASS"',
		"rm -rf",
	);

	expect(again.stderr).toBe("");
	expect(again.exitCode).toBe(0);
	const { header } = await readTicketFile(root, `${goalDir}/tickets/02-two.md`);
	expect(header.status).toBe("done");
	const worktree = await goalWorktree(root, "hello");
	expect(await Bun.file(join(worktree, "seen.txt")).text()).toBe(
		"secret\nnote\n",
	);
});

test("a worktree removed with git worktree remove is recreated too", async () => {
	const { root, again } = await rerunWithDeletedWorktree(
		{},
		'test -e one.txt && test -n "$PASS"',
		"git worktree remove",
	);

	expect(again.stderr).toBe("");
	expect(again.exitCode).toBe(0);
	const { header } = await readTicketFile(root, `${goalDir}/tickets/02-two.md`);
	expect(header.status).toBe("done");
	const worktree = await goalWorktree(root, "hello");
	const log = Bun.spawnSync(["git", "log", "--format=%s"], { cwd: worktree });
	expect(log.stdout.toString().split("\n")).toContain("one");
});

// Commits `root`'s `.vago/` on main, even where `.git/info/exclude` lists it.
function commitVago(root: string): void {
	for (const args of [
		["add", "-f", ".vago"],
		[...gitIdentity, "commit", "-qm", "vago"],
	]) {
		Bun.spawnSync(["git", ...args], { cwd: root });
	}
}

// A Project whose `.vago/` is committed on main and then edited without
// committing: `say.sh` changed and `new.sh` added.
async function makeProjectWithEditedVago(run: string): Promise<string> {
	const root = await makeProject({
		".vago/workflows/test.toml": oneStep(run),
		".vago/scripts/say.sh": "echo committed > said.txt\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});
	commitVago(root);
	await Bun.write(
		join(root, ".vago/scripts/say.sh"),
		"echo edited > said.txt\n",
	);
	await Bun.write(join(root, ".vago/scripts/new.sh"), "true\n");
	return root;
}

// The files Goal hello's branch changed against main.
function goalBranchChanges(root: string): string {
	return Bun.spawnSync(["git", "diff", "--name-only", "main", "vago/hello"], {
		cwd: root,
	}).stdout.toString();
}

function gitStatus(cwd: string): string {
	return Bun.spawnSync(["git", "status", "--porcelain"], {
		cwd,
	}).stdout.toString();
}

test("with .vago/ tracked, a Step runs the main checkout's uncommitted edit to its script", async () => {
	const root = await makeProjectWithEditedVago("sh .vago/scripts/say.sh");

	const result = await runVago(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	const worktree = await goalWorktree(root, "hello");
	expect(await Bun.file(join(worktree, "said.txt")).text()).toBe("edited\n");
});

test("with .vago/ tracked and edited, the worktree is clean and the main checkout keeps the edit", async () => {
	const root = await makeProjectWithEditedVago("true");

	const result = await runVago(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	const worktree = await goalWorktree(root, "hello");
	expect(gitStatus(worktree)).toBe("");
	expect(await Bun.file(join(worktree, ".vago/scripts/new.sh")).exists()).toBe(
		true,
	);
	const rootStatus = gitStatus(root);
	expect(rootStatus).toContain(" M .vago/scripts/say.sh");
	expect(rootStatus).toContain("?? .vago/scripts/new.sh");
});

test("with .vago/ tracked and edited, a Step that commits everything commits no .vago/ change", async () => {
	const root = await makeProjectWithEditedVago(
		`echo work > work.txt && git add . && git ${gitIdentity.join(" ")} commit -qm work`,
	);

	const result = await runVago(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	expect(goalBranchChanges(root)).toBe("work.txt\n");
});

test("with .vago/ tracked, re-running a Goal picks up a later edit and keeps the worktree clean", async () => {
	const root = await makeCheckScriptProject();
	commitVago(root);

	const { first, again } = await rerunWithEditedCheckScript(root);

	expect(again.exitCode).toBe(0);
	const worktreeLine = (stdout: string) => stdout.split("\n")[0];
	expect(worktreeLine(again.stdout)).toBe(worktreeLine(first.stdout));
	const worktree = await goalWorktree(root, "hello");
	expect(await Bun.file(join(worktree, "version.txt")).text()).toBe("v2\n");
	// version.txt is the Step's own output, left uncommitted.
	expect(gitStatus(worktree)).toBe("?? version.txt\n");
	expect(goalBranchChanges(root)).toBe("one.txt\n");
});
