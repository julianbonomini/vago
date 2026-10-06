import { expect, test } from "bun:test";
import { makeFakeClaude } from "./fake-harness.ts";
import { goalText, makeProject, runVago } from "./project.ts";

const goalDir = ".vago-goals/hello";

const greet = `+++
status = "done"

[[runs]]
step = "branch"
started = 2026-10-02T10:00:00.000Z
ended = 2026-10-02T10:00:01.500Z
outcome = "ok"
log = "logs/01-branch-1.log"

[[runs]]
step = "implement"
started = 2026-10-02T10:00:01.500Z
ended = 2026-10-02T10:05:31.500Z
outcome = "ok"
log = "logs/01-implement-2.jsonl"
harness = "claude-code"
model = "claude-opus-5-5"
cost_usd = 1.254
+++

# Greet
`;

const wave = `+++
status = "running"

[[runs]]
step = "implement"
started = 2026-10-02T11:00:00.000Z
ended = 2026-10-02T11:02:00.000Z
outcome = "exit 1"
log = "logs/02-implement-1.jsonl"
harness = "claude-code"
model = "claude-opus-5-5"
cost_usd = 0.5

[[runs]]
step = "merge"
started = 2026-10-02T11:02:00.000Z
log = "logs/02-merge-2.log"
+++

# Wave
`;

test("goal report prints goal.md and what every Run took and cost", async () => {
	const root = await makeProject({
		[`${goalDir}/goal.md`]: goalText(
			"small",
			"# Hello\n\nSay hello to everyone.\n",
		),
		[`${goalDir}/tickets/01-greet.md`]: greet,
		[`${goalDir}/tickets/02-wave.md`]: wave,
	});

	const result = await runVago(root, ["goal", "report", "hello"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toBe(`# Hello

Say hello to everyone.

## Runs

Workflow: small

| Ticket | Runs | Took | Cost |
|---|---:|---:|---:|
| 01-greet | 2 | 5m31s | $1.25 |
| 02-wave | 2 | 2m00s | $0.50 |
| **Total** | **4** | **7m31s** | **$1.75** |

<details>
<summary>Every Run</summary>

| Ticket | Step | Outcome | Took | Cost |
|---|---|---|---:|---:|
| 01-greet | branch | ok | 1.5s |  |
| 01-greet | implement | ok | 5m30s | $1.25 |
| 02-wave | implement | exit 1 | 2m00s | $0.50 |
| 02-wave | merge | running |  |  |

</details>
`);
});

test("goal report shows, collapsed by Ticket, the output of the Steps whose Workflow puts it in the report", async () => {
	const agentStep = (id: string, inReport: boolean) => `
[[steps]]
id     = "${id}"
type   = "agent"
prompt = "prompts/p.md"
${inReport ? "goal_report = true" : ""}
`;
	const root = await makeProject({
		".vago/workflows/chosen.toml": `harness = "claude-code"\nmodel = "opus"\n${agentStep("choices", true)}${agentStep("implement", false)}`,
		".vago/workflows/plain.toml": `harness = "claude-code"\nmodel = "opus"\n${agentStep("implement", false)}`,
		".vago/prompts/p.md": "{{ticket}}\n",
		[`${goalDir}/goal.md`]: goalText("chosen"),
		[`${goalDir}/tickets/01-greet.md`]:
			'+++\nstatus = "ready"\n+++\n\n# Greet\n',
		[`${goalDir}/tickets/02-wave.md`]:
			'+++\nstatus = "ready"\nworkflow = "plain"\n+++\n\n# Wave\n',
	});
	// The fixture's session answers "done" every time.
	const claude = await makeFakeClaude();
	expect((await runVago(root, ["run", "hello"], claude.env)).exitCode).toBe(0);

	const result = await runVago(root, ["goal", "report", "hello"]);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toStartWith(`# Hello

## Tickets

<details>
<summary>01-greet</summary>

done

</details>

## Runs
`);
});

test("goal report leaves every cost blank when no Run reported one", async () => {
	const root = await makeProject({
		[`${goalDir}/goal.md`]: goalText("small"),
		[`${goalDir}/tickets/01-greet.md`]: `+++
status = "done"

[[runs]]
step = "branch"
started = 2026-10-02T10:00:00.000Z
ended = 2026-10-02T10:00:01.500Z
outcome = "ok"
log = "logs/01-branch-1.log"

[[runs]]
step = "check"
started = 2026-10-02T10:00:01.500Z
ended = 2026-10-02T10:00:04.000Z
outcome = "ok"
log = "logs/01-check-2.log"
+++

# Greet
`,
	});

	const result = await runVago(root, ["goal", "report", "hello"]);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain(`| Ticket | Runs | Took | Cost |
|---|---:|---:|---:|
| 01-greet | 2 | 4.0s |  |
| **Total** | **2** | **4.0s** | **** |
`);
});

test("goal report counts a Ticket with no Runs as nothing", async () => {
	const root = await makeProject({
		[`${goalDir}/goal.md`]: goalText("small"),
		[`${goalDir}/tickets/01-greet.md`]: greet,
		[`${goalDir}/tickets/02-x.md`]: '+++\nstatus = "ready"\n+++\n\n# X\n',
	});

	const result = await runVago(root, ["goal", "report", "hello"]);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain(`| Ticket | Runs | Took | Cost |
|---|---:|---:|---:|
| 01-greet | 2 | 5m31s | $1.25 |
| 02-x | 0 | 0.0s |  |
| **Total** | **2** | **5m31s** | **$1.25** |
`);
});

test("goal report joins each hard-wrapped paragraph of goal.md into one line", async () => {
	const body = [
		"# Hello",
		"",
		"Say hello to",
		"everyone in",
		"the room.",
		"",
		"- a list item",
		"  wrapped under it",
		"- another",
		"1. first",
		"2. second",
		"",
		"## Steps",
		"",
		"> a quote",
		"> on two lines",
		"",
		"```ts",
		"const a = 1;",
		"const b = 2;",
		"```",
		"",
		"    indented code",
		"    more code",
		"",
		"| a | b |",
		"|---|---|",
		"| 1 | 2 |",
		"",
		"Two spaces break  ",
		"this line, and a backslash\\",
		"this one.",
		"",
		"Last words\r",
		"here.",
		"",
	].join("\n");
	const root = await makeProject({
		[`${goalDir}/goal.md`]: goalText("small", body),
	});

	const result = await runVago(root, ["goal", "report", "hello"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toStartWith(
		body
			.replace(
				"Say hello to\neveryone in\nthe room.",
				"Say hello to everyone in the room.",
			)
			.replace("Last words\r\nhere.", "Last words here."),
	);
});

test("goal report leaves out blank lines under a hand-edited header", async () => {
	const root = await makeProject({
		[`${goalDir}/goal.md`]: '+++\nworkflow = "small"\n+++\n\n# Hello\n',
	});

	const result = await runVago(root, ["goal", "report", "hello"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toStartWith("# Hello\n\n## Runs\n");
});

test("goal report refuses a Goal that doesn't exist", async () => {
	const root = await makeProject({});

	const result = await runVago(root, ["goal", "report", "hello"]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/Goal hello not found/);
	expect(result.stdout).toBe("");
});
