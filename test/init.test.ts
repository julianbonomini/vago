import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { makeFakeClaude } from "./fake-claude.ts";
import { makeProject, readTicketFile, runPunt } from "./project.ts";

const starter = join(import.meta.dir, "..", "starter");

// Every file under `dir`, as sorted paths relative to it.
async function filesIn(dir: string): Promise<string[]> {
	const paths = await Array.fromAsync(new Bun.Glob("**").scan(dir));
	return paths.sort();
}

// The files under `root` that git would offer to commit.
function untrackedFiles(root: string): string[] {
	const status = Bun.spawnSync(
		["git", "status", "--porcelain", "--untracked-files=all"],
		{ cwd: root },
	);
	return status.stdout
		.toString()
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => line.replace(/^\?\? /, ""));
}

async function excludeLines(root: string): Promise<string[]> {
	const exclude = await Bun.file(join(root, ".git/info/exclude")).text();
	return exclude.split("\n").filter((line) => !line.startsWith("#"));
}

test("init copies the starter into .punt/ verbatim and punt run accepts it", async () => {
	const root = await makeProject({});

	const init = await runPunt(root, ["init"]);

	expect(init.stderr).toBe("");
	expect(init.exitCode).toBe(0);
	const starterFiles = await filesIn(starter);
	expect(await filesIn(join(root, ".punt"))).toEqual(starterFiles);
	for (const path of starterFiles) {
		expect(await Bun.file(join(root, ".punt", path)).text()).toBe(
			await Bun.file(join(starter, path)).text(),
		);
	}

	await runPunt(root, ["goal", "new", "hello"]);
	const run = await runPunt(root, ["run", "hello"]);

	expect(run.stderr).toBe("");
	expect(run.exitCode).toBe(0);
});

test("answering commit lets git see the Workflow but never the Goals", async () => {
	const root = await makeProject({ ".gitignore": "node_modules/\n" });

	const init = await runPunt(root, ["init"], {}, "y\n");

	expect(init.stderr).toBe("");
	expect(init.exitCode).toBe(0);
	expect(init.stdout).toContain("[y/N]");
	await runPunt(root, ["goal", "new", "hello"]);
	expect(untrackedFiles(root)).toEqual([
		".gitignore",
		".punt/code-style.md",
		".punt/prompts/implement.md",
		".punt/prompts/merge.md",
		".punt/prompts/review.md",
		".punt/workflow.toml",
	]);
	expect(await excludeLines(root)).toEqual([".punt/goals/", ""]);
	expect(await Bun.file(join(root, ".gitignore")).text()).toBe(
		"node_modules/\n",
	);
});

test("answering don't commit hides all of .punt/ from git", async () => {
	const root = await makeProject({ ".gitignore": "node_modules/\n" });

	const init = await runPunt(root, ["init"], {}, "n\n");

	expect(init.exitCode).toBe(0);
	await runPunt(root, ["goal", "new", "hello"]);
	expect(untrackedFiles(root)).toEqual([".gitignore"]);
	expect(await excludeLines(root)).toEqual([".punt/goals/", ".punt/", ""]);
	expect(await Bun.file(join(root, ".gitignore")).text()).toBe(
		"node_modules/\n",
	);
});

test("init keeps the Workflow private when the human gives no answer", async () => {
	const root = await makeProject({});

	const init = await runPunt(root, ["init"], {}, "\n");

	expect(init.exitCode).toBe(0);
	expect(untrackedFiles(root)).toEqual([]);
});

test("init refuses a Project that has a Workflow and changes nothing", async () => {
	const root = await makeProject({});
	await runPunt(root, ["init"], {}, "y\n");
	await Bun.write(join(root, ".punt/workflow.toml"), "# tuned by hand\n");
	await Bun.write(join(root, ".punt/prompts/review.md"), "Review it.\n");
	const exclude = await Bun.file(join(root, ".git/info/exclude")).text();

	const again = await runPunt(root, ["init"], {}, "n\n");

	expect(again.exitCode).not.toBe(0);
	expect(again.stderr).toMatch(/\S*\.punt\/workflow\.toml already exists/);
	expect(again.stdout).toBe("");
	expect(await Bun.file(join(root, ".punt/workflow.toml")).text()).toBe(
		"# tuned by hand\n",
	);
	expect(await Bun.file(join(root, ".punt/prompts/review.md")).text()).toBe(
		"Review it.\n",
	);
	expect(await Bun.file(join(root, ".git/info/exclude")).text()).toBe(exclude);
});

test("a Goal goes through the starter Workflow on the fake claude to done", async () => {
	const root = await makeProject({});
	const claude = await makeFakeClaude();
	await runPunt(root, ["init"]);
	await runPunt(root, ["goal", "new", "hello"]);
	await runPunt(root, ["ticket", "add", "hello", "greet"]);

	const run = await runPunt(root, ["run", "hello"], claude.env);

	expect(run.stderr).toBe("");
	expect(run.exitCode).toBe(0);
	const ticket = await readTicketFile(
		root,
		".punt/goals/hello/tickets/01-greet.md",
	);
	expect(ticket.header.status).toBe("done");
	const codeStyle = await Bun.file(join(starter, "code-style.md")).text();
	const calls = await claude.calls();
	expect(calls).toHaveLength(3);
	for (const call of calls) {
		expect(call.stdin).toEndWith(`# style\n\n${codeStyle}`);
	}
});

test("init refuses a directory that isn't a git repo and changes nothing", async () => {
	const root = await makeProject({});
	await rm(join(root, ".git"), { recursive: true });

	const init = await runPunt(root, ["init"], {}, "n\n");

	expect(init.exitCode).not.toBe(0);
	expect(init.stderr).toMatch(/\S* has no \.git directory/);
	expect(existsSync(join(root, ".git"))).toBe(false);
	expect(existsSync(join(root, ".punt"))).toBe(false);
});
