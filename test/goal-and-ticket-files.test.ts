import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { makeFakeClaude } from "./fake-claude.ts";
import { goalText, makeProject, readTicketFile, runPunt } from "./project.ts";

const workflow = `
[[steps]]
id   = "build"
type = "shell"
run  = "true"
`;

const agentWorkflow = `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`;

const goalDir = ".punt-goals/hello";

test("goal new creates a Goal with no Tickets that punt run accepts", async () => {
	const root = await makeProject({ ".punt/workflows/test.toml": workflow });

	const created = await runPunt(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
	]);

	expect(created.stderr).toBe("");
	expect(created.exitCode).toBe(0);
	expect(created.stdout).toEndWith(`${goalDir}/goal.md\n`);
	expect(await Bun.file(join(root, goalDir, "goal.md")).text()).toBe(
		goalText("test", "# hello\n"),
	);
	expect(await readdir(join(root, goalDir, "tickets"))).toEqual([]);

	const run = await runPunt(root, ["run", "hello"]);

	expect(run.stderr).toBe("");
	expect(run.exitCode).toBe(0);
	expect(run.stdout).toStartWith("hello: 0 of 0 Tickets done\n");
});

test("goal new without --workflow prints the usage and creates no Goal", async () => {
	const root = await makeProject({ ".punt/workflows/test.toml": workflow });

	const result = await runPunt(root, ["goal", "new", "hello"]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain(
		"punt goal new <goal> --workflow <name> [--body-file <path>]",
	);
	expect(existsSync(join(root, goalDir))).toBe(false);
});

for (const name of ["nope", "../a"]) {
	test(`goal new refuses the Workflow "${name}", listing the ones there are`, async () => {
		const root = await makeProject({
			".punt/workflows/a.toml": workflow,
			".punt/workflows/b.toml": workflow,
		});

		const result = await runPunt(root, [
			"goal",
			"new",
			"hello",
			"--workflow",
			name,
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(name);
		expect(result.stderr).toContain("a, b");
		expect(existsSync(join(root, goalDir))).toBe(false);
	});
}

test("goal new refuses a Workflow punt run would refuse and creates no Goal", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": agentWorkflow.replace(
			"prompts/implement.md",
			"prompts/gone.md",
		),
	});

	const result = await runPunt(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
	]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain("prompts/gone.md");
	expect(existsSync(join(root, goalDir))).toBe(false);
});

test("goal new refuses a Goal that exists and leaves it as it was", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText(
			"test",
			"# Hello\n\nSay hello to everyone.\n",
		),
	});

	const result = await runPunt(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
	]);

	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toMatch(
		/Goal hello already exists: \S*\.punt-goals\/hello/,
	);
	expect(result.stdout).toBe("");
	expect(await Bun.file(join(root, goalDir, "goal.md")).text()).toBe(
		goalText("test", "# Hello\n\nSay hello to everyone.\n"),
	);
});

test("ticket add numbers Tickets in order with a ready header punt run takes", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
	});

	const greet = await runPunt(root, ["ticket", "add", "hello", "greet"]);
	const wave = await runPunt(root, ["ticket", "add", "hello", "wave"]);

	expect(greet.stderr).toBe("");
	expect(greet.exitCode).toBe(0);
	expect(greet.stdout).toEndWith(`${goalDir}/tickets/01-greet.md\n`);
	expect(wave.stdout).toEndWith(`${goalDir}/tickets/02-wave.md\n`);
	expect(await readTicketFile(root, `${goalDir}/tickets/01-greet.md`)).toEqual({
		header: { status: "ready" },
		body: "\n# greet\n",
	});
	expect(await readTicketFile(root, `${goalDir}/tickets/02-wave.md`)).toEqual({
		header: { status: "ready" },
		body: "\n# wave\n",
	});

	const run = await runPunt(root, ["run", "hello"]);

	expect(run.exitCode).toBe(0);
	expect(run.stdout).toContain("hello: 2 of 2 Tickets done\n");
});

test("ticket add numbers past the highest Ticket and writes each blocker once", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: `+++\nstatus = "ready"\n+++\n`,
		[`${goalDir}/tickets/03-wave.md`]: `+++\nstatus = "ready"\n+++\n`,
	});

	const result = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"bow",
		"--blocked-by",
		"3",
		"--blocked-by",
		"1",
		"--blocked-by",
		"3",
	]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	const bow = await readTicketFile(root, `${goalDir}/tickets/04-bow.md`);
	expect(bow.header).toEqual({ status: "ready", blocked_by: [3, 1] });
});

test("ticket add refuses an unknown blocker and writes no Ticket", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: `+++\nstatus = "ready"\n+++\n`,
	});

	const result = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"wave",
		"--blocked-by",
		"7",
	]);

	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toMatch(
		/wave can.t be blocked by Ticket 7, which isn.t in Goal hello/,
	);
	expect(result.stdout).toBe("");
	expect(await readdir(join(root, goalDir, "tickets"))).toEqual([
		"01-greet.md",
	]);
});

for (const name of ["../escape", "a/b", ""]) {
	test(`goal new and ticket add refuse the name "${name}"`, async () => {
		const root = await makeProject({
			".punt/workflows/test.toml": workflow,
			[`${goalDir}/goal.md`]: goalText("test"),
		});

		const goal = await runPunt(root, [
			"goal",
			"new",
			name,
			"--workflow",
			"test",
		]);
		const ticket = await runPunt(root, ["ticket", "add", "hello", name]);
		const ticketOfGoal = await runPunt(root, ["ticket", "add", name, "wave"]);

		expect(goal.exitCode).not.toBe(0);
		expect(goal.stderr).toMatch(/may hold only letters, digits, - and _/);
		expect(ticket.exitCode).not.toBe(0);
		expect(ticket.stderr).toMatch(/may hold only letters, digits, - and _/);
		expect(ticketOfGoal.exitCode).not.toBe(0);
		expect(ticketOfGoal.stderr).toMatch(/Goal name .* may hold only/);
		const files = await readdir(join(root, ".punt-goals"), {
			recursive: true,
		});
		expect(files.sort()).toEqual(["hello", "hello/goal.md"]);
	});
}

test("ticket add takes no status and prints the usage when given one", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
	});

	const result = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"wave",
		"--status",
		"done",
	]);

	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toMatch(/^usage: punt /);
	expect(existsSync(join(root, goalDir, "tickets"))).toBe(false);
});

// No trailing newline, and a bare `+++` line that isn't a header.
const body = "# Greet\r\n\nSay “hi” 👋\n+++\n+++ not a header";

// A Project whose Goal `hello` was made by `goal new`, so `tickets/` exists.
async function bodyProject(
	files: Record<string, string> = {},
): Promise<string> {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		...files,
	});
	await runPunt(root, ["goal", "new", "hello", "--workflow", "test"]);
	return root;
}

test("ticket add --body-file writes the file's text after the header", async () => {
	const root = await bodyProject({ "body.md": body });

	const result = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"greet",
		"--body-file",
		"body.md",
	]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toEndWith(`${goalDir}/tickets/01-greet.md\n`);
	expect(await readTicketFile(root, `${goalDir}/tickets/01-greet.md`)).toEqual({
		header: { status: "ready" },
		body,
	});
});

test("ticket add --body-file - reads the body from stdin", async () => {
	const root = await bodyProject();
	const stdin = "# Greet\n\nFrom stdin.\n";

	const result = await runPunt(
		root,
		["ticket", "add", "hello", "greet", "--body-file", "-"],
		{},
		stdin,
	);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	const greet = await readTicketFile(root, `${goalDir}/tickets/01-greet.md`);
	expect(greet.body).toBe(stdin);
});

test("ticket add takes --body-file and --blocked-by in any order", async () => {
	const root = await bodyProject({ "body.md": body });
	await runPunt(root, ["ticket", "add", "hello", "greet"]);
	await runPunt(root, ["ticket", "add", "hello", "smile"]);

	const bow = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"bow",
		"--blocked-by",
		"1",
		"--body-file",
		"body.md",
		"--blocked-by",
		"2",
	]);
	const wave = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"wave",
		"--body-file",
		"body.md",
		"--blocked-by",
		"1",
	]);

	expect(bow.stderr).toBe("");
	expect(bow.exitCode).toBe(0);
	expect(wave.stderr).toBe("");
	expect(wave.exitCode).toBe(0);
	expect(await readTicketFile(root, `${goalDir}/tickets/03-bow.md`)).toEqual({
		header: { status: "ready", blocked_by: [1, 2] },
		body,
	});
	expect(await readTicketFile(root, `${goalDir}/tickets/04-wave.md`)).toEqual({
		header: { status: "ready", blocked_by: [1] },
		body,
	});
});

test("ticket add refuses a --body-file that doesn't exist and writes no Ticket", async () => {
	const root = await bodyProject();

	const result = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"greet",
		"--body-file",
		"nope.md",
	]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/--body-file nope\.md can.t be read/);
	expect(result.stdout).toBe("");
	expect(await readdir(join(root, goalDir, "tickets"))).toEqual([]);
});

test("ticket add refuses a --body-file that is a folder and writes no Ticket", async () => {
	const root = await bodyProject();
	await mkdir(join(root, "somedir"));

	const result = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"greet",
		"--body-file",
		"somedir",
	]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/--body-file somedir can.t be read/);
	expect(await readdir(join(root, goalDir, "tickets"))).toEqual([]);
});

test("ticket add refuses an empty --body-file and writes no Ticket", async () => {
	const root = await bodyProject({ "body.md": "" });

	const result = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"greet",
		"--body-file",
		"body.md",
	]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/body for Ticket greet is empty/);
	expect(await readdir(join(root, goalDir, "tickets"))).toEqual([]);
});

test("ticket add refuses a body of only whitespace and writes no Ticket", async () => {
	const root = await bodyProject();

	const result = await runPunt(
		root,
		["ticket", "add", "hello", "greet", "--body-file", "-"],
		{},
		" \n\t\n",
	);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/body for Ticket greet is empty/);
	expect(await readdir(join(root, goalDir, "tickets"))).toEqual([]);
});

test("ticket add refuses a body with its own +++ header and writes no Ticket", async () => {
	const root = await bodyProject({
		"body.md": `+++\nstatus = "done"\n+++\n# Greet\n`,
	});

	const result = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"greet",
		"--body-file",
		"body.md",
	]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/starts with a \+\+\+ header/);
	expect(await readdir(join(root, goalDir, "tickets"))).toEqual([]);
});

test("punt run hands the agent a --body-file body as {{ticket}}, unchanged", async () => {
	// The prompt is only {{ticket}} and nothing is included, so the agent's
	// stdin is the body alone.
	const root = await makeProject({
		".punt/workflows/test.toml": agentWorkflow,
		".punt/prompts/implement.md": "{{ticket}}",
		"body.md": body,
	});
	await runPunt(root, ["goal", "new", "hello", "--workflow", "test"]);
	await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"greet",
		"--body-file",
		"body.md",
	]);
	const claude = await makeFakeClaude();

	const run = await runPunt(root, ["run", "hello"], claude.env);

	expect(run.stderr).toBe("");
	expect(run.exitCode).toBe(0);
	expect((await claude.calls())[0]?.stdin).toBe(body);
	const greet = await readTicketFile(root, `${goalDir}/tickets/01-greet.md`);
	expect(greet.header.status).toBe("done");
	expect(greet.body).toBe(body);
});

for (const flags of [
	["--body-file"],
	["--body-file", "a.md", "--body-file", "b.md"],
]) {
	test(`ticket add prints the usage with the flag for ${flags.join(" ")}`, async () => {
		const root = await bodyProject();

		const result = await runPunt(root, [
			"ticket",
			"add",
			"hello",
			"greet",
			...flags,
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"punt ticket add <goal> <slug> [--blocked-by <NN>]... [--body-file <path>]",
		);
		expect(await readdir(join(root, goalDir, "tickets"))).toEqual([]);
	});
}

for (const flags of [
	["--workflow", "test", "--body-file", "body.md"],
	["--body-file", "body.md", "--workflow", "test"],
]) {
	test(`goal new ${flags.join(" ")} writes the file's text after the header`, async () => {
		const root = await makeProject({
			".punt/workflows/test.toml": workflow,
			"body.md": body,
		});

		const result = await runPunt(root, ["goal", "new", "hello", ...flags]);

		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toEndWith(`${goalDir}/goal.md\n`);
		expect(await Bun.file(join(root, goalDir, "goal.md")).text()).toBe(
			goalText("test", body),
		);
		expect(await readdir(join(root, goalDir, "tickets"))).toEqual([]);
	});
}

test("goal new --body-file - reads the body from stdin", async () => {
	const root = await makeProject({ ".punt/workflows/test.toml": workflow });

	const result = await runPunt(
		root,
		["goal", "new", "hello", "--workflow", "test", "--body-file", "-"],
		{},
		body,
	);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect(await Bun.file(join(root, goalDir, "goal.md")).text()).toBe(
		goalText("test", body),
	);
});

test("goal report shows a goal new body without the header", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		"body.md": body,
	});
	await runPunt(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
		"--body-file",
		"body.md",
	]);

	const report = await runPunt(root, ["goal", "report", "hello"]);

	expect(report.stderr).toBe("");
	expect(report.exitCode).toBe(0);
	expect(report.stdout).toStartWith(body);
	expect(report.stdout).toContain("Workflow: test\n");
	expect(report.stdout).not.toContain('workflow = "test"');
});

test("goal new refuses a --body-file that doesn't exist and creates no Goal", async () => {
	const root = await makeProject({ ".punt/workflows/test.toml": workflow });

	const result = await runPunt(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
		"--body-file",
		"nope.md",
	]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/--body-file nope\.md can.t be read/);
	expect(result.stdout).toBe("");
	expect(existsSync(join(root, goalDir))).toBe(false);
});

test("goal new refuses a --body-file that is a folder and creates no Goal", async () => {
	const root = await makeProject({ ".punt/workflows/test.toml": workflow });
	await mkdir(join(root, "somedir"));

	const result = await runPunt(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
		"--body-file",
		"somedir",
	]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/--body-file somedir can.t be read/);
	expect(existsSync(join(root, goalDir))).toBe(false);
});

test("goal new refuses an empty --body-file and creates no Goal", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		"body.md": "",
	});

	const result = await runPunt(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
		"--body-file",
		"body.md",
	]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/body for Goal hello is empty/);
	expect(existsSync(join(root, goalDir))).toBe(false);
});

test("goal new refuses a body of only whitespace and creates no Goal", async () => {
	const root = await makeProject({ ".punt/workflows/test.toml": workflow });

	const result = await runPunt(
		root,
		["goal", "new", "hello", "--workflow", "test", "--body-file", "-"],
		{},
		" \n\t\n",
	);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/body for Goal hello is empty/);
	expect(existsSync(join(root, goalDir))).toBe(false);
});

// Two agent Workflows told apart by their prompts: `test` hands the agent
// only {{goal}} and `other` only the word other.
const twoWorkflows = {
	".punt/workflows/test.toml": agentWorkflow,
	".punt/workflows/other.toml": agentWorkflow.replace(
		"prompts/implement.md",
		"prompts/other.md",
	),
	".punt/prompts/implement.md": "{{goal}}",
	".punt/prompts/other.md": "other",
	"body.md": body,
};

test("punt run hands the agent a goal new --body-file body as {{goal}}, unchanged", async () => {
	const root = await makeProject(twoWorkflows);
	await runPunt(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
		"--body-file",
		"body.md",
	]);
	await runPunt(root, ["ticket", "add", "hello", "greet"]);
	const claude = await makeFakeClaude();

	const run = await runPunt(root, ["run", "hello"], claude.env);

	expect(run.stderr).toBe("");
	expect(run.exitCode).toBe(0);
	expect((await claude.calls())[0]?.stdin).toBe(body);
	const greet = await readTicketFile(root, `${goalDir}/tickets/01-greet.md`);
	expect(greet.header.status).toBe("done");
});

test("punt run runs the Workflow goal new named", async () => {
	const root = await makeProject(twoWorkflows);
	await runPunt(root, ["goal", "new", "hello", "--workflow", "other"]);
	await runPunt(root, ["ticket", "add", "hello", "greet"]);
	const claude = await makeFakeClaude();

	const run = await runPunt(root, ["run", "hello"], claude.env);

	expect(run.stderr).toBe("");
	expect(run.exitCode).toBe(0);
	expect((await claude.calls())[0]?.stdin).toBe("other");
});

for (const flags of [
	["--workflow"],
	["--workflow", "a", "--workflow", "b"],
	["--workflow", "test", "--body-file"],
	["--workflow", "test", "--body-file", "a.md", "--body-file", "b.md"],
	["--workflow", "test", "--blocked-by", "1"],
	["--body-file", "body.md"],
]) {
	test(`goal new prints the usage with the flag for ${flags.join(" ")}`, async () => {
		const root = await makeProject({
			".punt/workflows/test.toml": workflow,
			"body.md": body,
		});

		const result = await runPunt(root, ["goal", "new", "hello", ...flags]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain(
			"punt goal new <goal> --workflow <name> [--body-file <path>]",
		);
		expect(existsSync(join(root, goalDir))).toBe(false);
	});
}

test("goal new --body-file refuses a Goal that exists and leaves it as it was", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText(
			"test",
			"# Hello\n\nSay hello to everyone.\n",
		),
		"body.md": body,
	});

	const result = await runPunt(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
		"--body-file",
		"body.md",
	]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/Goal hello already exists/);
	expect(await Bun.file(join(root, goalDir, "goal.md")).text()).toBe(
		goalText("test", "# Hello\n\nSay hello to everyone.\n"),
	);
});

test("goal new writes a body that starts with +++ as given", async () => {
	// Punt's header comes first, so the body's own +++ block is body and
	// can't change the Workflow.
	const plusBody = `+++\nstatus = "done"\n+++\n# Hello\n`;
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		"body.md": plusBody,
	});

	const result = await runPunt(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
		"--body-file",
		"body.md",
	]);

	expect(result.exitCode).toBe(0);
	expect(await Bun.file(join(root, goalDir, "goal.md")).text()).toBe(
		goalText("test", plusBody),
	);
});
