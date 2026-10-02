import { expect, test } from "bun:test";
import { join } from "node:path";
import { parse } from "smol-toml";
import { makeFakeClaude } from "./fake-claude.ts";
import { makeProject, runPunt } from "./project.ts";

const goalDir = ".punt/goals/hello";
const ticketPath = `${goalDir}/tickets/01-say-hello.md`;
const ticket = `+++\nstatus = "ready"\n+++\n\n# Say hello\n`;

// A Project with one ready Ticket and `files` on top, `workflow.toml` and
// prompts among them.
function workflowProject(files: Record<string, string>): Promise<string> {
	return makeProject({
		[`${goalDir}/goal.md`]: "# Hello\n",
		[ticketPath]: ticket,
		...files,
	});
}

async function readTicketHeader(
	root: string,
): Promise<Record<string, unknown>> {
	const text = await Bun.file(join(root, ticketPath)).text();
	return parse(text.slice("+++\n".length, text.indexOf("\n+++\n") + 1));
}

// The value after `flag` in a fake `claude` call's argv.
function flagValue(argv: string[], flag: string): string | undefined {
	const at = argv.indexOf(flag);
	return at === -1 ? undefined : argv[at + 1];
}

test("a Step's model override reaches claude and other Steps keep the Workflow's", async () => {
	const root = await workflowProject({
		".punt/workflow.toml": `
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
model  = "sonnet"
`,
		".punt/prompts/implement.md": "Implement it.\n",
		".punt/prompts/review.md": "Review it.\n",
	});
	const claude = await makeFakeClaude();

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.stderr).toBe("");
	const calls = await claude.calls();
	expect(calls.map((call) => flagValue(call.argv, "--model"))).toEqual([
		"opus",
		"sonnet",
	]);
	const runs = (await readTicketHeader(root)).runs as Record<string, unknown>[];
	expect(runs.map((run) => run.model)).toEqual(["opus", "sonnet"]);
});

test("the Workflow's args are appended to the command and a Step's own args replace them", async () => {
	const root = await workflowProject({
		".punt/workflow.toml": `
harness = "claude-code"
model   = "opus"
args    = ["--max-turns", "5"]

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"

[[steps]]
id     = "review"
type   = "agent"
prompt = "prompts/review.md"
args   = ["--add-dir", "../docs"]
`,
		".punt/prompts/implement.md": "Implement it.\n",
		".punt/prompts/review.md": "Review it.\n",
	});
	const claude = await makeFakeClaude();

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.stderr).toBe("");
	const [implement, review] = await claude.calls();
	expect(implement?.argv.slice(-4)).toEqual([
		"--model",
		"opus",
		"--max-turns",
		"5",
	]);
	expect(review?.argv.slice(-4)).toEqual([
		"--model",
		"opus",
		"--add-dir",
		"../docs",
	]);
});

const shellStep = (id: string) => `
[[steps]]
id   = "${id}"
type = "shell"
run  = "true"
`;

const agentWorkflow = (stepLines: string) => `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
${stepLines}
`;

test.each([
	{
		problem: "a duplicate Step id",
		workflow: shellStep("check") + shellStep("check"),
		message: 'two steps have id "check"',
	},
	{
		problem: "unparsable TOML",
		workflow: `${shellStep("check")}\nrun = "twice"\n`,
		message: "is not valid TOML",
	},
	{
		problem: "an unknown Step type",
		workflow: shellStep("check").replace('"shell"', '"gate"'),
		message: 'type must be "agent" or "shell"\n  → at steps[0].type',
	},
	{
		problem: "an unknown Workflow harness",
		workflow: agentWorkflow("").replace('"claude-code"', '"claude-kode"'),
		message: 'unknown harness "claude-kode"\n  → at harness',
	},
	{
		problem: "an unknown Step harness",
		workflow: agentWorkflow('harness = "codex"'),
		message: 'unknown harness "codex"\n  → at steps[0].harness',
	},
	{
		problem: "a missing prompt file",
		workflow: agentWorkflow(""),
		message: 'prompts/implement.md of step "implement" not found',
	},
	{
		problem: "an invalid on_fail",
		workflow: `${shellStep("check")}on_fail = "retry"\n`,
		message: 'expected one of "stop"|"continue"\n  → at steps[0].on_fail',
	},
	{
		problem: "an invalid Workflow idle_timeout",
		workflow: `idle_timeout = "soon"\n${shellStep("check")}`,
		message: 'idle_timeout must be a duration like "30m"\n  → at idle_timeout',
	},
	{
		problem: "an invalid Step idle_timeout",
		workflow: agentWorkflow('idle_timeout = "90"'),
		message:
			'idle_timeout must be a duration like "30m"\n  → at steps[0].idle_timeout',
	},
])(
	"$problem fails before any Ticket changes, naming the problem",
	async ({ workflow, message }) => {
		const root = await workflowProject({ ".punt/workflow.toml": workflow });

		const result = await runPunt(root, ["run", "hello"]);

		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain(join(root, ".punt", "workflow.toml"));
		expect(result.stderr).toContain(message);
		expect(await Bun.file(join(root, ticketPath)).text()).toBe(ticket);
	},
);

test("a Step that edits .punt/ mid-Goal changes no later Step or Ticket", async () => {
	const edited = `
harness = "claude-code"
model   = "sonnet"

[[steps]]
id   = "extra"
type = "shell"
run  = "true"
`;
	const root = await workflowProject({
		".punt/workflow.toml": `
harness = "claude-code"
model   = "opus"

[[steps]]
id   = "edit"
type = "shell"
run  = "cp .punt/edited.toml .punt/workflow.toml && echo Edited. > .punt/prompts/implement.md"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`,
		".punt/edited.toml": edited,
		".punt/prompts/implement.md": "Implement it.\n",
		[`${goalDir}/tickets/02-wave.md`]: `+++\nstatus = "ready"\n+++\n\n# Wave\n`,
	});
	const claude = await makeFakeClaude();

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect(await Bun.file(join(root, ".punt", "workflow.toml")).text()).toBe(
		edited,
	);
	const calls = await claude.calls();
	expect(calls.map((call) => flagValue(call.argv, "--model"))).toEqual([
		"opus",
		"opus",
	]);
	expect(calls.map((call) => call.stdin)).toEqual([
		"Implement it.\n",
		"Implement it.\n",
	]);
	const started = result.stdout
		.split("\n")
		.filter((line) => line.endsWith(" started"))
		.map((line) => line.split(" ").slice(1, 3).join(" "));
	expect(started).toEqual([
		"01-say-hello edit",
		"01-say-hello implement",
		"02-wave edit",
		"02-wave implement",
	]);
});
