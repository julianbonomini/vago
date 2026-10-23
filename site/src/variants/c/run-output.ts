// PROTOTYPE: an example of what `vago run` prints when an agent Step keeps
// failing, laid out with the same columns as src/progress.ts (stepLine,
// printStepRetry, printStuck). The Goal and Ticket are the test fixtures'.

type Line = { html: string };

const ts = (iso: string) => `${iso}Z`;
const pad = (s: string, n: number) => s.padStart(n);

function stepLine(at: string, step: string, outcome: string, took = "", cost = "", cls = "") {
	const cells = [ts(at), pad(took, 6), pad(cost, 6)];
	const word = cls ? `<span class="${cls}">${outcome}</span>` : outcome;
	return `  ${cells.join("  ")}  ${step} ${word}`;
}

const dim = (s: string) => `<span class="c-d">${s}</span>`;

export const failingRun: Line[] = [
	{ html: "01-greet" },
	{ html: dim(stepLine("2026-10-02T10:00:00", "branch", "started")) },
	{ html: stepLine("2026-10-02T10:00:00", "branch", "ok", "0.1s", "", "c-o") },
	{ html: dim(stepLine("2026-10-02T10:00:00", "implement", "started")) },
	{ html: stepLine("2026-10-02T10:06:12", "implement", "exit 1", "6m12s", "$0.71", "c-r") },
	{ html: dim(stepLine("2026-10-02T10:06:12", "implement", "retries in 1m00s")) },
	{ html: dim(stepLine("2026-10-02T10:07:12", "implement", "started")) },
	{ html: stepLine("2026-10-02T10:09:40", "implement", "exit 1", "2m28s", "$0.33", "c-r") },
	{ html: dim(stepLine("2026-10-02T10:09:40", "implement", "retries in 1m00s")) },
	{ html: dim(stepLine("2026-10-02T10:10:40", "implement", "started")) },
	{ html: stepLine("2026-10-02T10:12:05", "implement", "exit 1", "1m25s", "$0.21", "c-r") },
	{ html: dim(stepLine("2026-10-02T10:12:05", "implement", "retries in 5m00s")) },
	{ html: dim(stepLine("2026-10-02T10:17:05", "implement", "started")) },
	{ html: stepLine("2026-10-02T10:18:51", "implement", "exit 1", "1m46s", "$0.24", "c-r") },
	{ html: '<span class="c-r">01-greet is stuck after implement: exit 1</span>' },
	{ html: "  log:    .vago-goals/hello/logs/01-implement-5.jsonl" },
	{ html: "  resume: claude --resume f679b9c4-e75a-4f73-affd-0dedfe161e0d" },
	{ html: "  again:  vago run hello" },
	{ html: "  reset:  vago ticket reset hello 01" },
];

// Ticket 01 of the real Goal plan-goals-in-vago, from its Ticket header.
export const realSteps = [
	{ id: "branch", type: "shell", took: "0.0s", cost: "" },
	{ id: "implement", type: "agent", took: "7m08s", cost: "$0.96" },
	{ id: "check", type: "shell", took: "3m30s", cost: "" },
	{ id: "review", type: "agent", took: "5m04s", cost: "$0.84" },
	{ id: "merge", type: "shell", took: "4.5s", cost: "" },
];
