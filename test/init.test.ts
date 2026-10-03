import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakeClaude } from "./fake-claude.ts";
import { goalText, makeProject, readTicketFile, runVago } from "./project.ts";

const starter = join(import.meta.dir, "..", "starter");
// A fixed four-Step Workflow (implement, check, review, merge), so the run test
// doesn't change whenever the starter does.
const fixture = join(import.meta.dir, "fixtures", "workflow");

// Every file under `dir`, as sorted paths relative to it.
async function filesIn(dir: string): Promise<string[]> {
	const paths = await Array.fromAsync(new Bun.Glob("**").scan(dir));
	return paths.sort();
}

// The fixture Workflow's files, keyed by their path in a Project.
async function workflowFixture(): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	for (const path of await filesIn(fixture)) {
		files[`.vago/${path}`] = await Bun.file(join(fixture, path)).text();
	}
	return files;
}

// Writes `files`, keyed by path relative to `root`, over whatever is there.
async function writeFiles(
	root: string,
	files: Record<string, string>,
): Promise<void> {
	for (const [path, text] of Object.entries(files)) {
		await Bun.write(join(root, path), text);
	}
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

// Fails unless `.vago/` under `root` holds exactly the starter's files, byte
// for byte.
async function expectStarterIn(root: string): Promise<void> {
	const starterFiles = await filesIn(starter);
	expect(await filesIn(join(root, ".vago"))).toEqual(starterFiles);
	for (const path of starterFiles) {
		expect(await Bun.file(join(root, ".vago", path)).text()).toBe(
			await Bun.file(join(starter, path)).text(),
		);
	}
}

async function excludeLines(root: string): Promise<string[]> {
	const exclude = await Bun.file(join(root, ".git/info/exclude")).text();
	return exclude.split("\n").filter((line) => !line.startsWith("#"));
}

test("init copies the starter into .vago/ verbatim and vago run accepts both Workflows", async () => {
	const root = await makeProject({});

	const init = await runVago(root, ["init"]);

	expect(init.stderr).toBe("");
	expect(init.exitCode).toBe(0);
	await expectStarterIn(root);

	// A Goal with no Tickets, so neither Workflow runs a Step.
	for (const workflow of ["try-hard", "small"]) {
		await Bun.write(
			join(root, ".vago-goals/hello/goal.md"),
			goalText(workflow),
		);
		const run = await runVago(root, ["run", "hello"]);

		expect(run.stderr).toBe("");
		expect(run.exitCode).toBe(0);
	}
});

test("the reinstalled binary's init copies the same starter as the source", async () => {
	const root = await makeProject({});
	const home = await mkdtemp(join(tmpdir(), "vago-home-"));
	// A temp HOME keeps the script away from the human's own installed vago.
	const reinstall = Bun.spawnSync([process.execPath, "run", "reinstall"], {
		cwd: join(import.meta.dir, ".."),
		env: { ...process.env, HOME: home },
	});
	expect(reinstall.exitCode).toBe(0);

	const init = Bun.spawnSync([join(home, ".local/bin/vago"), "init"], {
		cwd: root,
		stdin: new Blob(["y\n"]),
	});
	// The binary is about 60 MB, too big to leave in the temp directory.
	await rm(home, { recursive: true });

	expect(init.stderr.toString()).toBe("");
	expect(init.exitCode).toBe(0);
	await expectStarterIn(root);
});

test("answering commit lets git see the Workflow but never the Goals", async () => {
	const root = await makeProject({ ".gitignore": "node_modules/\n" });

	const init = await runVago(root, ["init"], {}, "y\n");

	expect(init.stderr).toBe("");
	expect(init.exitCode).toBe(0);
	expect(init.stdout).toContain("[y/N]");
	expect(init.stdout).toContain(
		"Goals and Tickets in .vago-goals/ stay out of git",
	);
	await runVago(root, ["goal", "new", "hello", "--workflow", "small"]);
	const starterFiles = await filesIn(starter);
	expect(untrackedFiles(root)).toEqual([
		".gitignore",
		...starterFiles.map((path) => `.vago/${path}`),
	]);
	expect(await excludeLines(root)).toEqual([".vago-goals/", ""]);
	expect(await Bun.file(join(root, ".gitignore")).text()).toBe(
		"node_modules/\n",
	);
});

test("answering don't commit hides all of .vago/ from git", async () => {
	const root = await makeProject({ ".gitignore": "node_modules/\n" });

	const init = await runVago(root, ["init"], {}, "n\n");

	expect(init.exitCode).toBe(0);
	await runVago(root, ["goal", "new", "hello", "--workflow", "small"]);
	expect(untrackedFiles(root)).toEqual([".gitignore"]);
	expect(await excludeLines(root)).toEqual([".vago-goals/", ".vago/", ""]);
	expect(await Bun.file(join(root, ".gitignore")).text()).toBe(
		"node_modules/\n",
	);
});

test("init keeps the Workflow private when the human gives no answer", async () => {
	const root = await makeProject({});

	const init = await runVago(root, ["init"], {}, "\n");

	expect(init.exitCode).toBe(0);
	expect(untrackedFiles(root)).toEqual([]);
});

test("init refuses a Project it already set up and changes nothing", async () => {
	const root = await makeProject({});
	await runVago(root, ["init"], {}, "y\n");
	await Bun.write(
		join(root, ".vago/workflows/try-hard.toml"),
		"# tuned by hand\n",
	);
	await Bun.write(join(root, ".vago/prompts/review.md"), "Review it.\n");
	const exclude = await Bun.file(join(root, ".git/info/exclude")).text();

	const again = await runVago(root, ["init"], {}, "n\n");

	expect(again.exitCode).not.toBe(0);
	expect(again.stderr).toMatch(/\S*\.vago\/\S+ already exists/);
	expect(again.stdout).toBe("");
	expect(
		await Bun.file(join(root, ".vago/workflows/try-hard.toml")).text(),
	).toBe("# tuned by hand\n");
	expect(await Bun.file(join(root, ".vago/prompts/review.md")).text()).toBe(
		"Review it.\n",
	);
	expect(await Bun.file(join(root, ".git/info/exclude")).text()).toBe(exclude);
});

test("init refuses a Project laid out the old way and changes nothing", async () => {
	const root = await makeProject({
		".vago/workflow.toml": "# tuned by hand\n",
		".vago/prompts/review.md": "Review it.\n",
	});
	const exclude = await Bun.file(join(root, ".git/info/exclude")).text();

	const init = await runVago(root, ["init"], {}, "n\n");

	expect(init.exitCode).not.toBe(0);
	expect(init.stderr).toMatch(/\S*\.vago\/prompts\/review\.md already exists/);
	expect(init.stdout).toBe("");
	expect(await Bun.file(join(root, ".vago/prompts/review.md")).text()).toBe(
		"Review it.\n",
	);
	expect(existsSync(join(root, ".vago/workflows"))).toBe(false);
	expect(await Bun.file(join(root, ".git/info/exclude")).text()).toBe(exclude);
});

test("a Goal goes through a four-Step Workflow on the fake claude to done", async () => {
	const root = await makeProject(await workflowFixture());
	const claude = await makeFakeClaude();
	await runVago(root, ["goal", "new", "hello", "--workflow", "four-steps"]);
	await runVago(root, ["ticket", "add", "hello", "greet"]);

	const run = await runVago(root, ["run", "hello"], claude.env);

	expect(run.stderr).toBe("");
	expect(run.exitCode).toBe(0);
	const ticket = await readTicketFile(
		root,
		".vago-goals/hello/tickets/01-greet.md",
	);
	expect(ticket.header.status).toBe("done");
	const codeStyle = await Bun.file(join(fixture, "code-style.md")).text();
	const calls = await claude.calls();
	expect(calls).toHaveLength(3);
	for (const call of calls) {
		expect(call.stdin).toEndWith(`# style\n\n${codeStyle}`);
	}
	// The temp repo has no check script, so the check fails and review reads it.
	expect(calls[1]?.stdin).toMatch(/exit code [1-9]\d*\n/);
});

test("deleting .vago/ and running init again keeps every Goal, and vago run runs it", async () => {
	const root = await makeProject({});
	const claude = await makeFakeClaude();
	await runVago(root, ["init"], {}, "n\n");
	await writeFiles(root, await workflowFixture());
	await runVago(root, ["goal", "new", "hello", "--workflow", "four-steps"]);
	await runVago(root, ["ticket", "add", "hello", "greet"]);
	const goalFiles = await filesIn(join(root, ".vago-goals"));
	const ticketText = await Bun.file(
		join(root, ".vago-goals/hello/tickets/01-greet.md"),
	).text();

	await rm(join(root, ".vago"), { recursive: true });
	const init = await runVago(root, ["init"], {}, "n\n");

	expect(init.exitCode).toBe(0);
	expect(await filesIn(join(root, ".vago-goals"))).toEqual(goalFiles);
	expect(
		await Bun.file(join(root, ".vago-goals/hello/tickets/01-greet.md")).text(),
	).toBe(ticketText);
	expect(await excludeLines(root)).toEqual([".vago-goals/", ".vago/", ""]);

	await writeFiles(root, await workflowFixture());
	const run = await runVago(root, ["run", "hello"], claude.env);

	expect(run.exitCode).toBe(0);
	const ticket = await readTicketFile(
		root,
		".vago-goals/hello/tickets/01-greet.md",
	);
	expect(ticket.header.status).toBe("done");
});

test("init refuses a directory that isn't a git repo and changes nothing", async () => {
	const root = await makeProject({});
	await rm(join(root, ".git"), { recursive: true });

	const init = await runVago(root, ["init"], {}, "n\n");

	expect(init.exitCode).not.toBe(0);
	expect(init.stderr).toMatch(/\S* has no \.git directory/);
	expect(existsSync(join(root, ".git"))).toBe(false);
	expect(existsSync(join(root, ".vago"))).toBe(false);
});
