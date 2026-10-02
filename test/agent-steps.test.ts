import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	acceptEditsFixture,
	makeFakeClaude,
	sessionFixture,
} from "./fake-claude.ts";
import { goalText, makeProject, readTicketFile, runPunt } from "./project.ts";

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

const goalDir = ".punt-goals/hello";
const ticketPath = `${goalDir}/tickets/01-say-hello.md`;

async function agentProject(): Promise<string> {
	return makeProject({
		".punt/workflows/test.toml": workflow,
		".punt/prompts/implement.md": prompt,
		[`${goalDir}/goal.md`]: goalText(
			"test",
			"# Hello\n\nThe CLI greets its user.\n",
		),
		[ticketPath]: `+++\nstatus = "ready"\n+++\n${ticketBody}`,
	});
}

test("a session in auto mode with no denied calls ends ok and the Ticket done", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude();

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect((await readTicketFile(root, ticketPath)).header.status).toBe("done");
});

test("a session in the permission mode args asked for ends ok", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": `args = ["--permission-mode", "acceptEdits"]\n${workflow}`,
		".punt/prompts/implement.md": prompt,
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: `+++\nstatus = "ready"\n+++\n${ticketBody}`,
	});
	const claude = await makeFakeClaude("exit 0", acceptEditsFixture);

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(0);
	expect((await readTicketFile(root, ticketPath)).header.status).toBe("done");
});

test("claude runs headless in guarded mode on the Workflow's model", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude();

	await runPunt(root, ["run", "hello"], claude.env);

	const [call] = await claude.calls();
	expect(call?.argv).toEqual([
		"-p",
		"--output-format",
		"stream-json",
		"--verbose",
		"--permission-mode",
		"auto",
		"--model",
		"opus",
	]);
	expect(call?.argv).not.toContain("--dangerously-skip-permissions");
});

test("the prompt has {{ticket}} and {{goal}} substituted and no Ticket or Goal header", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude();

	await runPunt(root, ["run", "hello"], claude.env);

	const [call] = await claude.calls();
	expect(call?.stdin).toBe(`Do this Ticket:

${ticketBody}

It serves this Goal:

# Hello

The CLI greets its user.

`);
	expect(call?.stdin).not.toContain("+++");
	expect(call?.stdin).not.toContain("status");
	expect(call?.stdin).not.toContain("workflow =");
});

test("[[runs]] records the Harness, model, session, tokens and cost", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude();

	await runPunt(root, ["run", "hello"], claude.env);

	const runs = (await readTicketFile(root, ticketPath)).header.runs as Record<
		string,
		unknown
	>[];
	expect(runs).toHaveLength(1);
	expect(runs[0]).toMatchObject({
		step: "implement",
		harness: "claude-code",
		model: "opus",
		outcome: "ok",
		session_id: "f679b9c4-e75a-4f73-affd-0dedfe161e0d",
		// The fixture's fresh, cache-written and cache-read input tokens.
		tokens: { input: 2 + 2326 + 4773, output: 3 },
		cost_usd: 0.010292599999999999,
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
	expect(lines[1]).toMatch(/^\S+ 01-say-hello implement ok \d+\.\ds \$0\.01$/);
});
