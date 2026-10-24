import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakeClaude } from "./fake-harness.ts";
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

// The folders a Project's skills go in after init: where Claude Code finds
// them, and where Codex does.
const skillFolders = [".claude/skills", ".agents/skills"];

// Each starter file's installed path in a Project after init, with the starter
// path it copies: every skill goes into each skill folder, everything else
// into `.vago/`.
async function starterProjectFiles(): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	for (const path of await filesIn(starter)) {
		if (path.startsWith("skills/")) {
			const skillPath = path.slice("skills/".length);
			for (const folder of skillFolders) {
				files.set(`${folder}/${skillPath}`, path);
			}
		} else {
			files.set(`.vago/${path}`, path);
		}
	}
	return files;
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

// Fails unless `.vago/` and both skill folders under `root` hold exactly the
// starter's files, byte for byte.
async function expectStarterIn(root: string): Promise<void> {
	const starterFiles = await starterProjectFiles();
	const installed: string[] = [];
	for (const folder of [".vago", ...skillFolders]) {
		for (const path of await filesIn(join(root, folder))) {
			installed.push(`${folder}/${path}`);
		}
	}
	expect(installed.sort()).toEqual([...starterFiles.keys()].sort());
	for (const [installedPath, path] of starterFiles) {
		expect(await Bun.file(join(root, installedPath)).text()).toBe(
			await Bun.file(join(starter, path)).text(),
		);
	}
}

// `.git/info/exclude` after init in a fresh repo, answering don't commit.
const privateExcludeLines = [
	".vago-goals/",
	".vago/",
	".claude/skills/vago-check-red-flags/",
	".claude/skills/vago-design-module/",
	".claude/skills/vago-grilling/",
	".claude/skills/vago-pr/",
	".claude/skills/vago-to-goal/",
	".claude/skills/vago-to-tickets/",
	".claude/skills/vago-write-code/",
	".agents/skills/vago-check-red-flags/",
	".agents/skills/vago-design-module/",
	".agents/skills/vago-grilling/",
	".agents/skills/vago-pr/",
	".agents/skills/vago-to-goal/",
	".agents/skills/vago-to-tickets/",
	".agents/skills/vago-write-code/",
	"",
];

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

test("init writes the planning prompt a planning item's agent starts from", async () => {
	const root = await makeProject({});

	await runVago(root, ["init"]);

	expect(await Bun.file(join(root, ".vago/prompts/planning.md")).text()).toBe(
		await Bun.file(join(starter, "prompts/planning.md")).text(),
	);
});

test("a new Project gets the planning skills its agent loads, and update adds them", async () => {
	const root = await makeProject({});

	await runVago(root, ["init"], {}, "n\n");

	const prompt = await Bun.file(join(root, ".vago/prompts/planning.md")).text();
	for (const skill of ["vago-grilling", "vago-to-goal", "vago-to-tickets"]) {
		expect(prompt).toContain(skill);
		for (const folder of skillFolders) {
			const text = await Bun.file(join(root, folder, skill, "SKILL.md")).text();
			expect(text).toStartWith(`---\nname: ${skill}\n`);
			expect(text).not.toContain("disable-model-invocation");
		}
	}
	for (const [skill, command] of [
		["vago-to-goal", "vago goal new"],
		["vago-to-tickets", "vago ticket add"],
	] as const) {
		for (const folder of skillFolders) {
			const text = await Bun.file(join(root, folder, skill, "SKILL.md")).text();
			expect(text).toContain(command);
			expect(text).toContain("## In a Vago planning chat");
		}
	}
	for (const folder of skillFolders) {
		await rm(join(root, folder, "vago-grilling"), { recursive: true });
	}

	const update = await runVago(root, ["update"]);

	expect(update.exitCode).toBe(0);
	for (const folder of skillFolders) {
		for (const file of ["SKILL.md", "CREDITS.md"]) {
			expect(existsSync(join(root, folder, "vago-grilling", file))).toBe(true);
		}
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

test("answering commit lets git see the Workflow and skills but never the Goals", async () => {
	const root = await makeProject({
		".gitignore": "node_modules/\n",
		".claude/settings.json": "{}\n",
	});

	const init = await runVago(root, ["init"], {}, "y\n");

	expect(init.stderr).toBe("");
	expect(init.exitCode).toBe(0);
	expect(init.stdout).toContain("[y/N]");
	expect(init.stdout).toContain(
		"Goals and Tickets in .vago-goals/ stay out of git",
	);
	await runVago(root, ["goal", "new", "hello", "--workflow", "small"]);
	const starterFiles = await starterProjectFiles();
	expect(untrackedFiles(root)).toEqual(
		[".claude/settings.json", ".gitignore", ...starterFiles.keys()].sort(),
	);
	expect(await excludeLines(root)).toEqual([".vago-goals/", ""]);
	expect(await Bun.file(join(root, ".gitignore")).text()).toBe(
		"node_modules/\n",
	);
});

test("answering don't commit hides all of .vago/ and the skills from git", async () => {
	const root = await makeProject({
		".gitignore": "node_modules/\n",
		".claude/settings.json": "{}\n",
	});

	const init = await runVago(root, ["init"], {}, "n\n");

	expect(init.exitCode).toBe(0);
	await runVago(root, ["goal", "new", "hello", "--workflow", "small"]);
	expect(untrackedFiles(root)).toEqual([".claude/settings.json", ".gitignore"]);
	expect(await excludeLines(root)).toEqual(privateExcludeLines);
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

for (const folder of skillFolders) {
	test(`init refuses a Project that already has a vago- skill in ${folder}/ and changes nothing`, async () => {
		const root = await makeProject({
			[`${folder}/vago-write-code/SKILL.md`]: "# My own\n",
		});
		const exclude = await Bun.file(join(root, ".git/info/exclude")).text();

		const init = await runVago(root, ["init"], {}, "n\n");

		expect(init.exitCode).not.toBe(0);
		expect(init.stderr).toMatch(
			new RegExp(`${folder}/vago-write-code/SKILL\\.md already exists`),
		);
		expect(init.stdout).toBe("");
		expect(
			await Bun.file(join(root, folder, "vago-write-code/SKILL.md")).text(),
		).toBe("# My own\n");
		expect(existsSync(join(root, ".vago"))).toBe(false);
		expect(await Bun.file(join(root, ".git/info/exclude")).text()).toBe(
			exclude,
		);
	});
}

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

test("deleting .vago/ and the skills and running init again keeps every Goal, and vago run runs it", async () => {
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
	for (const folder of skillFolders) {
		await rm(join(root, folder), { recursive: true });
	}
	const init = await runVago(root, ["init"], {}, "n\n");

	expect(init.exitCode).toBe(0);
	expect(await filesIn(join(root, ".vago-goals"))).toEqual(goalFiles);
	expect(
		await Bun.file(join(root, ".vago-goals/hello/tickets/01-greet.md")).text(),
	).toBe(ticketText);
	expect(await excludeLines(root)).toEqual(privateExcludeLines);

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
	const root = await mkdtemp(join(tmpdir(), "vago-test-"));

	const init = await runVago(root, ["init"], {}, "n\n");

	expect(init.exitCode).not.toBe(0);
	expect(init.stderr).toMatch(/\S* has no \.git directory/);
	expect(existsSync(join(root, ".git"))).toBe(false);
	expect(existsSync(join(root, ".vago"))).toBe(false);
});

test("update brings a set-up Project to the starter, keeps what the human added, and prints what it changed", async () => {
	const root = await makeProject({});
	await runVago(root, ["init"], {}, "n\n");
	await runVago(root, ["goal", "new", "hello", "--workflow", "small"]);
	await runVago(root, ["ticket", "add", "hello", "greet"]);
	const goalFiles = await filesIn(join(root, ".vago-goals"));
	const ticketText = await Bun.file(
		join(root, ".vago-goals/hello/tickets/01-greet.md"),
	).text();
	await writeFiles(root, {
		".vago/prompts/review.md": "Review it.\n",
		".claude/skills/vago-write-code/SKILL.md": "# Old rules\n",
		".agents/skills/vago-write-code/SKILL.md": "# Old rules\n",
		".vago/workflows/mine.toml": "# my own\n",
		".vago/prompts/mine.md": "My prompt.\n",
		".claude/skills/mine/SKILL.md": "# My skill\n",
		".agents/skills/mine/SKILL.md": "# My skill\n",
	});
	await rm(join(root, ".vago/scripts/merge.sh"));
	// A starter from before the skill existed left it out of the exclude.
	const exclude = join(root, ".git/info/exclude");
	await Bun.write(
		exclude,
		(await Bun.file(exclude).text()).replace(
			".claude/skills/vago-design-module/\n",
			"",
		),
	);

	const update = await runVago(root, ["update"]);

	expect(update.stderr).toBe("");
	expect(update.exitCode).toBe(0);
	expect(update.stdout.split("\n").sort()).toEqual(
		[
			"",
			".agents/skills/vago-write-code/SKILL.md",
			".claude/skills/vago-write-code/SKILL.md",
			".git/info/exclude",
			".vago/prompts/review.md",
			".vago/scripts/merge.sh",
		].sort(),
	);
	for (const folder of skillFolders) {
		expect(await Bun.file(join(root, folder, "mine/SKILL.md")).text()).toBe(
			"# My skill\n",
		);
		await rm(join(root, folder, "mine"), { recursive: true });
	}
	await rm(join(root, ".vago/workflows/mine.toml"));
	await rm(join(root, ".vago/prompts/mine.md"));
	await expectStarterIn(root);
	expect((await excludeLines(root)).sort()).toEqual(
		[...privateExcludeLines].sort(),
	);
	expect(await filesIn(join(root, ".vago-goals"))).toEqual(goalFiles);
	expect(
		await Bun.file(join(root, ".vago-goals/hello/tickets/01-greet.md")).text(),
	).toBe(ticketText);

	const again = await runVago(root, ["update"]);

	expect(again.exitCode).toBe(0);
	expect(again.stdout).toBe("");
});

test("update keeps a committed Workflow committed without asking", async () => {
	const root = await makeProject({});
	await runVago(root, ["init"], {}, "y\n");
	await Bun.write(join(root, ".vago/prompts/review.md"), "Review it.\n");

	const update = await runVago(root, ["update"], {}, "n\n");

	expect(update.exitCode).toBe(0);
	expect(update.stdout).toBe(".vago/prompts/review.md\n");
	expect(await excludeLines(root)).toEqual([".vago-goals/", ""]);
});

test("update asks whether to commit the Workflow when the exclude doesn't say", async () => {
	const root = await makeProject({});
	await runVago(root, ["init"], {}, "n\n");
	await Bun.write(join(root, ".git/info/exclude"), "");

	const update = await runVago(root, ["update"], {}, "n\n");

	expect(update.exitCode).toBe(0);
	expect(update.stdout).toContain("[y/N]");
	expect(update.stdout).toEndWith(".git/info/exclude\n");
	expect(await excludeLines(root)).toEqual(privateExcludeLines);
});

test("update refuses a Project with no .vago/ and changes nothing", async () => {
	const root = await makeProject({});

	const update = await runVago(root, ["update"], {}, "n\n");

	expect(update.exitCode).not.toBe(0);
	expect(update.stderr).toMatch(/\S* has no \.vago\/, so run vago init/);
	expect(existsSync(join(root, ".vago"))).toBe(false);
	expect(existsSync(join(root, ".claude"))).toBe(false);
});
