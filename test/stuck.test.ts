import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	codexRefusedFixture,
	makeFakeClaude,
	makeFakeCodex,
	permissionDeniedFixture,
	permissionModeFallbackFixture,
	sessionFixture,
} from "./fake-harness.ts";
import {
	goalText,
	makeProject,
	oneStep,
	readTicketFile,
	runsOf,
	runVago,
} from "./project.ts";

const goalDir = ".vago-goals/hello";

function ticket(header: string, title: string): string {
	return `+++\n${header}\n+++\n\n# ${title}\n`;
}

// Two Tickets, the second blocked by the first, so a stuck first Ticket
// leaves the second one ready and unrun.
function stuckProject(workflow: string): Promise<string> {
	return makeProject({
		".vago/workflows/test.toml": workflow,
		".vago/prompts/implement.md": "Implement it.\n",
		".vago/prompts/review.md": "The check said:\n\n{{steps.check.output}}\n",
		[`${goalDir}/goal.md`]: goalText("test"),
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

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	const greet = await headerOf(root, "01-greet");
	expect(greet.status).toBe("stuck");
	// The Run and its three retries.
	expect(runsOf(greet).map((run) => run.outcome)).toEqual(
		Array(4).fill("exit 3"),
	);
	const wave = await headerOf(root, "02-wave");
	expect(wave.status).toBe("ready");
	expect(runsOf(wave)).toEqual([]);
});

test("claude going silent past idle_timeout is killed and the Ticket goes stuck", async () => {
	const root = await stuckProject(`idle_timeout = "200ms"\n${agentWorkflow}`);
	// Far past the test's own timeout, so only a kill of the fake's whole
	// process group, `sleep` included, lets `vago run` end in time.
	const claude = await makeFakeClaude("sleep 60");

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	const greet = await headerOf(root, "01-greet");
	expect(greet.status).toBe("stuck");
	// The Run and its three retries.
	expect(runsOf(greet).map((run) => run.outcome)).toEqual(
		Array(4).fill("idle-timeout"),
	);
});

test("a Step's idle_timeout replaces the Workflow's", async () => {
	const root = await stuckProject(
		`idle_timeout = "1h"\n${agentWorkflow}idle_timeout = "200ms"\n`,
	);
	const claude = await makeFakeClaude("sleep 60");

	await runVago(root, ["run", "hello"], claude.env);

	const greet = await headerOf(root, "01-greet");
	// The Run and its three retries.
	expect(runsOf(greet).map((run) => run.outcome)).toEqual(
		Array(4).fill("idle-timeout"),
	);
});

const acceptEditsArgs = `args = ["--permission-mode", "acceptEdits"]\n`;

for (const { session, workflow, fixture, outcome } of [
	{
		session: "a session Claude Code ran outside auto mode",
		workflow: agentWorkflow,
		fixture: permissionModeFallbackFixture,
		outcome: "permission-mode default",
	},
	{
		session: "a session in auto mode when args asked for acceptEdits",
		workflow: acceptEditsArgs + agentWorkflow,
		fixture: sessionFixture,
		outcome: "permission-mode auto",
	},
	{
		session: "a session with a denied tool call",
		workflow: agentWorkflow,
		fixture: permissionDeniedFixture,
		outcome: "permission-denied",
	},
]) {
	test(`${session} leaves the Ticket stuck though claude exits 0`, async () => {
		const root = await stuckProject(workflow);
		const claude = await makeFakeClaude("exit 0", fixture);

		const result = await runVago(root, ["run", "hello"], claude.env);

		expect(result.exitCode).not.toBe(0);
		const greet = await headerOf(root, "01-greet");
		expect(greet.status).toBe("stuck");
		// The Run and its three retries.
		expect(runsOf(greet).map((run) => run.outcome)).toEqual(
			Array(4).fill(outcome),
		);
		expect(result.stdout).toContain(
			`01-greet is stuck after implement: ${outcome}\n`,
		);
		const wave = await headerOf(root, "02-wave");
		expect(wave.status).toBe("ready");
		expect(runsOf(wave)).toEqual([]);
	});
}

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

	const result = await runVago(root, ["run", "hello"], claude.env);

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

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	const greet = await headerOf(root, "01-greet");
	expect(greet.status).toBe("stuck");
	expect(runsOf(greet).map((run) => [run.step, run.outcome])).toEqual([
		["check", "exit 4"],
	]);
	expect(await claude.calls()).toEqual([]);
});

test("the stuck message shows the outcome, the log, the resume command, the command that goes on and the reset command", async () => {
	const root = await stuckProject(agentWorkflow);
	const claude = await makeFakeClaude("exit 3");

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.stdout).toContain(`01-greet is stuck after implement: exit 3
  log:    .vago-goals/hello/logs/01-implement-4.jsonl
  resume: claude --resume f679b9c4-e75a-4f73-affd-0dedfe161e0d
  again:  vago run hello
  reset:  vago ticket reset hello 01
`);
});

test("a Codex session with a refused call is stuck, and its resume command resumes the Codex session", async () => {
	const root = await stuckProject(
		agentWorkflow.replace(`harness = "claude-code"`, `harness = "codex"`),
	);
	const codex = await makeFakeCodex("exit 0", codexRefusedFixture);

	const result = await runVago(root, ["run", "hello"], codex.env);

	expect(result.exitCode).not.toBe(0);
	expect(
		result.stdout,
	).toContain(`01-greet is stuck after implement: permission-denied
  log:    .vago-goals/hello/logs/01-implement-4.jsonl
  resume: codex resume 01a10e2e-cf08-7251-946c-b9850a710ad9
`);
});

test("a stuck shell Step's message has no resume command", async () => {
	const root = await stuckProject(checkWorkflow(""));

	const result = await runVago(root, ["run", "hello"]);

	expect(result.stdout).toContain(`01-greet is stuck after check: exit 4
  log:    .vago-goals/hello/logs/01-check-1.log
  again:  vago run hello
  reset:  vago ticket reset hello 01
`);
});

test("vago run doesn't refuse a Goal with a stuck Ticket, and runs it and the next", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": oneStep("true"),
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: ticket(`status = "stuck"`, "Greet"),
		[`${goalDir}/tickets/02-wave.md`]: ticket(`status = "ready"`, "Wave"),
	});

	const result = await runVago(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	for (const name of ["01-greet", "02-wave"]) {
		const header = await headerOf(root, name);
		expect(header.status).toBe("done");
		expect(runsOf(header).map((run) => run.outcome)).toEqual(["ok"]);
	}
});

test("a reset Ticket is ready again, keeps its runs and logs, and runs with new logs", async () => {
	const root = await stuckProject(checkWorkflow(""));
	await Bun.write(join(root, ".vago/workflows/strict.toml"), checkWorkflow(""));
	await Bun.write(
		join(root, ".vago/workflows/lenient.toml"),
		checkWorkflow(`on_fail = "continue"`),
	);
	await Bun.write(join(root, goalDir, "goal.md"), goalText("strict"));
	await runVago(root, ["run", "hello"]);

	const reset = await runVago(root, ["ticket", "reset", "hello", "01"]);

	expect(reset.stderr).toBe("");
	expect(reset.exitCode).toBe(0);
	const greet = await headerOf(root, "01-greet");
	expect(greet.status).toBe("ready");
	expect(runsOf(greet).map((run) => [run.outcome, run.log])).toEqual([
		["exit 4", "logs/01-check-1.log"],
	]);

	// Story 61: the human switches the Goal to another Workflow by hand.
	await Bun.write(join(root, goalDir, "goal.md"), goalText("lenient"));
	const claude = await makeFakeClaude();
	const rerun = await runVago(root, ["run", "hello"], claude.env);

	expect(rerun.exitCode).toBe(0);
	const runs = runsOf(await headerOf(root, "01-greet"));
	expect(runs.map((run) => [run.outcome, run.log])).toEqual([
		["exit 4", "logs/01-check-1.log"],
		["exit 4", "logs/01-check-2.log"],
		["ok", "logs/01-review-3.jsonl"],
	]);
	const log = (name: string) =>
		Bun.file(join(root, goalDir, "logs", name)).text();
	expect(await log("01-check-1.log")).toBe("2 tests failed\n");
	expect(await log("01-check-2.log")).toBe("2 tests failed\n");
});

test("a reset Ticket stuck at a later Step starts over from its first Step", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": `${agentWorkflow}
[[steps]]
id   = "check"
type = "shell"
run  = "exit 4"
`,
		".vago/prompts/implement.md": "Implement it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: ticket(`status = "ready"`, "Greet"),
	});
	const claude = await makeFakeClaude();
	await runVago(root, ["run", "hello"], claude.env);
	await runVago(root, ["ticket", "reset", "hello", "01"]);

	const rerun = await runVago(root, ["run", "hello"], claude.env);

	expect(rerun.stdout).toContain("\n01-greet\n");
	expect(await claude.calls()).toHaveLength(2);
	const runs = runsOf(await headerOf(root, "01-greet"));
	expect(runs.map((run) => [run.step, run.outcome, run.log])).toEqual([
		["implement", "ok", "logs/01-implement-1.jsonl"],
		["check", "exit 4", "logs/01-check-2.log"],
		["implement", "ok", "logs/01-implement-3.jsonl"],
		["check", "exit 4", "logs/01-check-4.log"],
	]);
});

test("resetting a Ticket that isn't stuck fails and leaves it as it was", async () => {
	const root = await stuckProject(agentWorkflow);

	const reset = await runVago(root, ["ticket", "reset", "hello", "01"]);

	expect(reset.exitCode).not.toBe(0);
	expect(reset.stderr).toContain("01-greet is ready, not stuck");
	expect((await headerOf(root, "01-greet")).status).toBe("ready");
});
