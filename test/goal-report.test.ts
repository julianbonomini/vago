import { expect, test } from "bun:test";
import { goalText, makeProject, runPunt } from "./project.ts";

const goalDir = ".punt/goals/hello";

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

	const result = await runPunt(root, ["goal", "report", "hello"]);

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

test("goal report leaves out blank lines under a hand-edited header", async () => {
	const root = await makeProject({
		[`${goalDir}/goal.md`]: '+++\nworkflow = "small"\n+++\n\n# Hello\n',
	});

	const result = await runPunt(root, ["goal", "report", "hello"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toStartWith("# Hello\n\n## Runs\n");
});

test("goal report refuses a Goal that doesn't exist", async () => {
	const root = await makeProject({});

	const result = await runPunt(root, ["goal", "report", "hello"]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toMatch(/Goal hello not found/);
	expect(result.stdout).toBe("");
});
