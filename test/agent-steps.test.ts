import { expect, test } from "bun:test";
import { join } from "node:path";
import { parse } from "smol-toml";
import { makeFakeClaude, sessionFixture } from "./fake-claude.ts";
import { makeProject, runPunt } from "./project.ts";

const workflow = `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`;

const prompt = `Do this Ticket:

{{ticket}}

It serves this Goal:

{{goal}}
`;

const ticketBody = `
# Say hello

Print hello when the CLI starts.
`;

const goalDir = ".punt/goals/hello";
const ticketPath = `${goalDir}/tickets/01-say-hello.md`;

async function agentProject(): Promise<string> {
	return makeProject({
		".punt/workflow.toml": workflow,
		".punt/prompts/implement.md": prompt,
		[`${goalDir}/goal.md`]: "# Hello\n\nThe CLI greets its user.\n",
		[ticketPath]: `+++\nstatus = "ready"\n+++\n${ticketBody}`,
	});
}

async function readHeader(root: string): Promise<Record<string, unknown>> {
	const text = await Bun.file(join(root, ticketPath)).text();
	return parse(text.slice("+++\n".length, text.indexOf("\n+++\n") + 1));
}

test("a Ticket goes through an agent Step on the fake claude and ends done", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude();

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect((await readHeader(root)).status).toBe("done");
});

test("claude runs headless in guarded mode on the Workflow's model", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude();

	await runPunt(root, ["run", "hello"], claude.env);

	const { argv } = await claude.received();
	expect(argv).toEqual([
		"-p",
		"--output-format",
		"stream-json",
		"--verbose",
		"--permission-mode",
		"auto",
		"--model",
		"opus",
	]);
	expect(argv).not.toContain("--dangerously-skip-permissions");
});

test("the prompt has {{ticket}} and {{goal}} substituted and no Ticket header", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude();

	await runPunt(root, ["run", "hello"], claude.env);

	const { stdin } = await claude.received();
	expect(stdin).toBe(`Do this Ticket:

${ticketBody}

It serves this Goal:

# Hello

The CLI greets its user.

`);
	expect(stdin).not.toContain("+++");
	expect(stdin).not.toContain("status");
});

test("[[runs]] records the Harness, model, session, tokens and cost", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude();

	await runPunt(root, ["run", "hello"], claude.env);

	const runs = (await readHeader(root)).runs as Record<string, unknown>[];
	expect(runs).toHaveLength(1);
	expect(runs[0]).toMatchObject({
		step: "implement",
		harness: "claude-code",
		model: "opus",
		outcome: "ok",
		session_id: "e6a2f4b4-6e31-4a33-90b1-ef815ed07b42",
		// The fixture's fresh, cache-written and cache-read input tokens.
		tokens: { input: 9 + 8397 + 14160, output: 41 },
		cost_usd: 0.018424,
		log: "logs/01-implement-1.jsonl",
	});
});

test("the .jsonl log holds the whole stream", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude();

	await runPunt(root, ["run", "hello"], claude.env);

	const log = join(root, goalDir, "logs", "01-implement-1.jsonl");
	expect(await Bun.file(log).text()).toBe(
		await Bun.file(sessionFixture).text(),
	);
});

test("the end line shows the Run's cost", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude();

	const result = await runPunt(root, ["run", "hello"], claude.env);

	const lines = result.stdout.trimEnd().split("\n");
	expect(lines[1]).toMatch(/^\S+ 01-say-hello implement ok \d+\.\ds \$0\.02$/);
});
