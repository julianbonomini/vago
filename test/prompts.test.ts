import { expect, test } from "bun:test";
import { join } from "node:path";
import { makeFakeClaude } from "./fake-claude.ts";
import { goalText, makeProject, runVago } from "./project.ts";

const goalDir = ".vago-goals/hello";
const ticketPath = `${goalDir}/tickets/01-say-hello.md`;

// A Project with one ready Ticket and `files` on top, the Workflow
// `.vago/workflows/test.toml` and prompts among them.
function promptProject(files: Record<string, string>): Promise<string> {
	return makeProject({
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: `+++\nstatus = "ready"\n+++\n\n# Say hello\n`,
		...files,
	});
}

test("the prompt has each include file under its slot heading", async () => {
	const root = await promptProject({
		".vago/workflows/test.toml": `
harness = "claude-code"
model   = "opus"

[include]
style   = "docs/code-style.md"
testing = "docs/testing.md"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`,
		".vago/prompts/implement.md": "Implement it.\n",
		"docs/code-style.md": "Plain functions.\n",
		"docs/testing.md": "Test through the CLI.\n",
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.stderr).toBe("");
	const [call] = await claude.calls();
	expect(call?.stdin).toBe(`Implement it.

# style

Plain functions.

# testing

Test through the CLI.
`);
});

test("a Step's include adds to the Workflow's slots and replaces one with the same name", async () => {
	const root = await promptProject({
		".vago/workflows/test.toml": `
harness = "claude-code"
model   = "opus"

[include]
style   = "docs/code-style.md"
testing = "docs/testing.md"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"

[[steps]]
id                   = "review"
type                 = "agent"
prompt               = "prompts/review.md"
include.style        = "docs/review-style.md"
include.architecture = "docs/architecture.md"
`,
		".vago/prompts/implement.md": "Implement it.\n",
		".vago/prompts/review.md": "Review it.\n",
		"docs/code-style.md": "Plain functions.\n",
		"docs/testing.md": "Test through the CLI.\n",
		"docs/review-style.md": "Flag every red flag.\n",
		"docs/architecture.md": "One owner per decision.\n",
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.stderr).toBe("");
	const [implement, review] = await claude.calls();
	expect(implement?.stdin).toBe(`Implement it.

# style

Plain functions.

# testing

Test through the CLI.
`);
	expect(review?.stdin).toBe(`Review it.

# style

Flag every red flag.

# testing

Test through the CLI.

# architecture

One owner per decision.
`);
});

test("a shell check's stdout, stderr and exit code reach a later prompt", async () => {
	const root = await promptProject({
		".vago/workflows/test.toml": `
harness = "claude-code"
model   = "opus"

[[steps]]
id   = "check"
type = "shell"
run  = "echo 3 tests passed; echo 1 lint warning >&2; echo 0 skipped"

[[steps]]
id     = "review"
type   = "agent"
prompt = "prompts/review.md"
`,
		".vago/prompts/review.md":
			"The check said:\n\n{{steps.check.output}}\nFix what it found.\n",
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.stderr).toBe("");
	const [review] = await claude.calls();
	expect(review?.stdin).toBe(`The check said:

exit code 0
3 tests passed
1 lint warning
0 skipped

Fix what it found.
`);
});

test("an agent Step's result text reaches a later prompt", async () => {
	const root = await promptProject({
		".vago/workflows/test.toml": `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"

[[steps]]
id     = "review"
type   = "agent"
prompt = "prompts/review.md"
`,
		".vago/prompts/implement.md": "Implement it.\n",
		".vago/prompts/review.md":
			"The implementer said: {{steps.implement.output}}\n",
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.stderr).toBe("");
	const [, review] = await claude.calls();
	// "done" is the `result` of the fixture's final event.
	expect(review?.stdin).toBe("The implementer said: done\n");
});

// The `vago-` skills each agent Step of a starter Workflow names, in Step
// order: the skills the Steps run instead of reading the rules in the prompt.
const starterStepSkills: Record<string, string[][]> = {
	"try-hard": [
		["vago-design-module"],
		[],
		["vago-check-red-flags", "vago-design-module"],
		[],
		["vago-check-red-flags", "vago-write-code"],
		["vago-check-red-flags"],
		["vago-check-red-flags"],
	],
	small: [
		["vago-check-red-flags", "vago-write-code"],
		["vago-check-red-flags"],
		["vago-check-red-flags"],
	],
};

test("starter prompts name their skills and carry none of the rules", async () => {
	// The skills hold what the old rule docs said, so any of their longer
	// lines in a prompt means the rules are still pasted in.
	const skills = join(import.meta.dir, "..", "starter", "skills");
	const ruleLines = new Set<string>();
	for await (const path of new Bun.Glob("**/*.md").scan(skills)) {
		const text = await Bun.file(join(skills, path)).text();
		for (const line of text.split("\n")) {
			if (line.length > 40) ruleLines.add(line);
		}
	}

	for (const [workflow, stepSkills] of Object.entries(starterStepSkills)) {
		const root = await makeProject({});
		await runVago(root, ["init"], {}, "n\n");
		await runVago(root, ["goal", "new", "hello", "--workflow", workflow]);
		await runVago(root, ["ticket", "add", "hello", "greet"]);
		const claude = await makeFakeClaude();

		await runVago(root, ["run", "hello"], claude.env);

		const prompts = (await claude.calls()).map((call) => call.stdin);
		const named = prompts.map((prompt) =>
			[
				...new Set(
					[...prompt.matchAll(/`(vago-[a-z-]+)`/g)].map(([, skill]) => skill),
				),
			].sort(),
		);
		expect(named).toEqual(stepSkills);
		for (const prompt of prompts) {
			const pasted = prompt.split("\n").filter((line) => ruleLines.has(line));
			expect(pasted).toEqual([]);
		}
	}
});
