import { expect, test } from "bun:test";
import { makeFakeClaude } from "./fake-claude.ts";
import { makeProject, readTicketFile, runPunt } from "./project.ts";

const goalDir = ".punt/goals/hello";

function ticket(header: string, title: string): string {
	return `+++\n${header}\n+++\n\n# ${title}\n`;
}

// Two Tickets, the second blocked by the first, so a stuck first Ticket
// leaves the second one ready and unrun.
function stuckProject(workflow: string): Promise<string> {
	return makeProject({
		".punt/workflow.toml": workflow,
		".punt/prompts/implement.md": "Implement it.\n",
		".punt/prompts/review.md": "The check said:\n\n{{steps.check.output}}\n",
		[`${goalDir}/goal.md`]: "# Hello\n",
		[`${goalDir}/tickets/01-greet.md`]: ticket(`status = "ready"`, "Greet"),
		[`${goalDir}/tickets/02-wave.md`]: ticket(
			`status = "ready"\nblocked_by = [1]`,
			"Wave",
		),
	});
}

async function headerOf(
	root: string,
	name: string,
): Promise<Record<string, unknown>> {
	return (await readTicketFile(root, `${goalDir}/tickets/${name}.md`)).header;
}

function runsOf(header: Record<string, unknown>): Record<string, unknown>[] {
	return (header.runs ?? []) as Record<string, unknown>[];
}

const agentWorkflow = `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`;

test("claude exiting non-zero leaves the Ticket stuck and later Tickets ready", async () => {
	const root = await stuckProject(agentWorkflow);
	const claude = await makeFakeClaude("exit 3");

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	const greet = await headerOf(root, "01-greet");
	expect(greet.status).toBe("stuck");
	expect(runsOf(greet).map((run) => run.outcome)).toEqual(["exit 3"]);
	const wave = await headerOf(root, "02-wave");
	expect(wave.status).toBe("ready");
	expect(runsOf(wave)).toEqual([]);
});

test("claude going silent past idle_timeout is killed and the Ticket goes stuck", async () => {
	const root = await stuckProject(`idle_timeout = "200ms"\n${agentWorkflow}`);
	// Far past the test's own timeout, so only a kill of the fake's whole
	// process group, `sleep` included, lets `punt run` end in time.
	const claude = await makeFakeClaude("sleep 60");

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	const greet = await headerOf(root, "01-greet");
	expect(greet.status).toBe("stuck");
	expect(runsOf(greet).map((run) => run.outcome)).toEqual(["idle-timeout"]);
});

test("a Step's idle_timeout replaces the Workflow's", async () => {
	const root = await stuckProject(
		`idle_timeout = "1h"\n${agentWorkflow}idle_timeout = "200ms"\n`,
	);
	const claude = await makeFakeClaude("sleep 60");

	await runPunt(root, ["run", "hello"], claude.env);

	const greet = await headerOf(root, "01-greet");
	expect(runsOf(greet).map((run) => run.outcome)).toEqual(["idle-timeout"]);
});

const checkWorkflow = (onFail: string) => `
harness = "claude-code"
model   = "opus"

[[steps]]
id   = "check"
type = "shell"
run  = "echo 2 tests failed; exit 4"
${onFail}

[[steps]]
id     = "review"
type   = "agent"
prompt = "prompts/review.md"
`;

test("a failing shell Step with on_fail = continue lets the Ticket go on", async () => {
	const root = await stuckProject(checkWorkflow(`on_fail = "continue"`));
	const claude = await makeFakeClaude();

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(0);
	const greet = await headerOf(root, "01-greet");
	expect(greet.status).toBe("done");
	expect(runsOf(greet).map((run) => [run.step, run.outcome])).toEqual([
		["check", "exit 4"],
		["review", "ok"],
	]);
	const [review] = await claude.calls();
	expect(review?.stdin).toBe(
		"The check said:\n\nexit code 4\n2 tests failed\n\n",
	);
});

test("a failing shell Step stops the Ticket by default", async () => {
	const root = await stuckProject(checkWorkflow(""));
	const claude = await makeFakeClaude();

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	const greet = await headerOf(root, "01-greet");
	expect(greet.status).toBe("stuck");
	expect(runsOf(greet).map((run) => [run.step, run.outcome])).toEqual([
		["check", "exit 4"],
	]);
	expect(await claude.calls()).toEqual([]);
});

test("the stuck message shows the log, the resume command and the reset command", async () => {
	const root = await stuckProject(agentWorkflow);
	const claude = await makeFakeClaude("exit 3");

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.stdout).toContain(`01-greet is stuck after implement
  log:    .punt/goals/hello/logs/01-implement-1.jsonl
  resume: claude --resume e6a2f4b4-6e31-4a33-90b1-ef815ed07b42
  reset:  punt ticket reset hello 01
`);
});

test("a stuck shell Step's message has no resume command", async () => {
	const root = await stuckProject(checkWorkflow(""));

	const result = await runPunt(root, ["run", "hello"]);

	expect(result.stdout).toContain(`01-greet is stuck after check
  log:    .punt/goals/hello/logs/01-check-1.log
  reset:  punt ticket reset hello 01
`);
});
