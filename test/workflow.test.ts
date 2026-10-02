import { expect, test } from "bun:test";
import { join } from "node:path";
import { makeFakeClaude } from "./fake-claude.ts";
import { goalText, makeProject, readTicketFile, runPunt } from "./project.ts";

const goalDir = ".punt/goals/hello";
const ticketPath = `${goalDir}/tickets/01-say-hello.md`;
const ticket = `+++\nstatus = "ready"\n+++\n\n# Say hello\n`;

// A Project with one ready Ticket and `files` on top, the Workflow
// `.punt/workflows/test.toml` and prompts among them.
function workflowProject(files: Record<string, string>): Promise<string> {
	return makeProject({
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
		...files,
	});
}

// The value after `flag` in a fake `claude` call's argv.
function flagValue(argv: string[], flag: string): string | undefined {
	const at = argv.indexOf(flag);
	return at === -1 ? undefined : argv[at + 1];
}

// A Workflow of one shell Step `id` that echoes its id.
function echoWorkflow(id: string): string {
	return `[[steps]]\nid   = "${id}"\ntype = "shell"\nrun  = "echo ${id}"\n`;
}

test("punt run runs the Workflow the goal.md header names", async () => {
	const root = await workflowProject({
		".punt/workflows/a.toml": echoWorkflow("a"),
		".punt/workflows/b.toml": echoWorkflow("b"),
		[`${goalDir}/goal.md`]: goalText("b"),
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	const runs = (await readTicketFile(root, ticketPath)).header.runs as Record<
		string,
		unknown
	>[];
	expect(runs.map((run) => run.step)).toEqual(["b"]);
	expect(await Bun.file(join(root, goalDir, "logs", "01-b-1.log")).text()).toBe(
		"b\n",
	);
});

test("punt run refuses a Workflow name that isn't in .punt/workflows/, listing what is", async () => {
	const agentWorkflow = `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`;
	const root = await workflowProject({
		".punt/workflows/small.toml": agentWorkflow,
		".punt/workflows/try-hard.toml": agentWorkflow,
		".punt/prompts/implement.md": "Implement it.\n",
		[`${goalDir}/goal.md`]: goalText("big"),
	});
	const claude = await makeFakeClaude();

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toMatch(
		/No Workflow "big" in \S*\.punt\/workflows\/: it holds small, try-hard\n/,
	);
	expect(await Bun.file(join(root, ticketPath)).text()).toBe(ticket);
	expect(await claude.calls()).toEqual([]);
});

test("punt run no longer reads .punt/workflow.toml", async () => {
	const root = await workflowProject({
		".punt/workflow.toml": echoWorkflow("a"),
		[`${goalDir}/goal.md`]: goalText("workflow"),
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain("holds no Workflows");
	expect(await Bun.file(join(root, ticketPath)).text()).toBe(ticket);
});

test("a Step's model override reaches claude and other Steps keep the Workflow's", async () => {
	const root = await workflowProject({
		".punt/workflows/test.toml": `
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
	const runs = (await readTicketFile(root, ticketPath)).header.runs as Record<
		string,
		unknown
	>[];
	expect(runs.map((run) => run.model)).toEqual(["opus", "sonnet"]);
});

test("the Workflow's args are appended to the command and a Step's own args replace them", async () => {
	const root = await workflowProject({
		".punt/workflows/test.toml": `
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

// A Workflow with one agent Step, `implement`, that also holds `stepLines`.
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
		problem: "a missing Workflow include file",
		workflow: `[include]\nstyle = "docs/code-style.md"\n${shellStep("check")}`,
		message: "docs/code-style.md of the Workflow not found",
	},
	{
		problem: "a missing Step include file",
		workflow: agentWorkflow('include.style = "docs/code-style.md"'),
		files: { ".punt/prompts/implement.md": "Implement it.\n" },
		message: 'docs/code-style.md of step "implement" not found',
	},
	{
		problem: "a reference to an unknown Step's output",
		workflow: agentWorkflow(""),
		files: { ".punt/prompts/implement.md": "{{steps.chek.output}}\n" },
		message:
			'step "implement" reads {{steps.chek.output}}, but no step "chek" runs before it',
	},
	{
		problem: "a reference to a later Step's output",
		workflow: agentWorkflow("") + shellStep("check"),
		files: { ".punt/prompts/implement.md": "{{steps.check.output}}\n" },
		message:
			'step "implement" reads {{steps.check.output}}, but no step "check" runs before it',
	},
	{
		problem: "an invalid on_fail",
		workflow: `${shellStep("check")}on_fail = "retry"\n`,
		message: 'expected one of "stop"|"continue"\n  → at steps[0].on_fail',
	},
	{
		problem: "a key the Step type doesn't take",
		workflow: agentWorkflow('on_fail = "continue"'),
		message: 'Unrecognized key: "on_fail"\n  → at steps[0]',
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
	async ({ workflow, files, message }) => {
		const root = await workflowProject({
			".punt/workflows/test.toml": workflow,
			...files,
		});

		const result = await runPunt(root, ["run", "hello"]);

		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain(
			join(root, ".punt", "workflows", "test.toml"),
		);
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
		".punt/workflows/test.toml": `
harness = "claude-code"
model   = "opus"

[[steps]]
id   = "edit"
type = "shell"
run  = "cp .punt/edited.toml .punt/workflows/test.toml && echo Edited. > .punt/prompts/implement.md"

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
	expect(
		await Bun.file(join(root, ".punt", "workflows", "test.toml")).text(),
	).toBe(edited);
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
