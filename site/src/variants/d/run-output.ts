// PROTOTYPE: example `vago run` output for a Ticket whose agent Step keeps
// failing, then the `vago run` that picks it up, in the columns of
// src/progress.ts (stepLine, printStepRetry, printStuck, printPassStarted).
// Grouped by the moment of the failure timeline each block belongs to. The
// Goal and Ticket are the test fixtures' (hello, 01-greet).

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function stepLine(at: string, step: string, outcome: string, took = "", cost = "", cls = "") {
	const cells = [`2026-10-02T${at}Z`, took.padStart(6), cost.padStart(6)];
	const word = cls ? `<span class="${cls}">${esc(outcome)}</span>` : esc(outcome);
	return `  ${cells.join("  ")}  ${step} ${word}`;
}
const dim = (s: string) => `<span class="o-d">${s}</span>`;

/** One moment of the failure timeline and the lines it adds. */
export type FailMoment = {
	mark: string;
	tone: "bad" | "wait" | "ok";
	label: string;
	text: string;
	lines: string[];
};

export const failMoments: FailMoment[] = [
	{
		mark: "✗",
		tone: "bad",
		label: "exit 1",
		text: "The Build Step's agent exits with an error.",
		lines: [
			`<span class="o-p">$</span> vago run hello`,
			"01-greet",
			dim(stepLine("10:00:00", "branch", "started")),
			stepLine("10:00:00", "branch", "ok", "0.1s", "", "o-ok"),
			dim(stepLine("10:00:00", "implement", "started")),
			stepLine("10:06:12", "implement", "exit 1", "6m12s", "$0.71", "o-bad"),
		],
	},
	{
		mark: "↻",
		tone: "wait",
		label: "1m",
		text: "Vago waits a minute, then resumes the same session with a plain “continue”.",
		lines: [
			dim(stepLine("10:06:12", "implement", "retries in 1m00s")),
			dim(stepLine("10:07:12", "implement", "started")),
			stepLine("10:09:40", "implement", "exit 1", "2m28s", "$0.33", "o-bad"),
		],
	},
	{
		mark: "↻",
		tone: "wait",
		label: "1m",
		text: "Another minute, another resume. Most failures stop here: a dropped network, an API error.",
		lines: [
			dim(stepLine("10:09:40", "implement", "retries in 1m00s")),
			dim(stepLine("10:10:40", "implement", "started")),
			stepLine("10:12:05", "implement", "exit 1", "1m25s", "$0.21", "o-bad"),
		],
	},
	{
		mark: "↻",
		tone: "wait",
		label: "5m",
		text: "The last retry waits five minutes.",
		lines: [
			dim(stepLine("10:12:05", "implement", "retries in 5m00s")),
			dim(stepLine("10:17:05", "implement", "started")),
			stepLine("10:18:51", "implement", "exit 1", "1m46s", "$0.24", "o-bad"),
		],
	},
	{
		mark: "✗",
		tone: "bad",
		label: "stuck",
		text: "Three retries failed, so the Ticket stops and waits for you. Vago prints where to look.",
		lines: [
			`<span class="o-bad">01-greet is stuck after implement: exit 1</span>`,
			"  log:    .vago-goals/hello/logs/01-implement-5.jsonl",
			"  resume: claude --resume f679b9c4-e75a-4f73-affd-0dedfe161e0d",
			"  again:  vago run hello",
			"  reset:  vago ticket reset hello 01",
		],
	},
	{
		mark: "✓",
		tone: "ok",
		label: "vago run",
		text: "Fix what you need and run it again. The Ticket picks up at the Step that failed, on the same branch.",
		lines: [
			"",
			`<span class="o-p">$</span> vago run hello`,
			"01-greet, picked up at implement",
			dim(stepLine("11:02:30", "implement", "started")),
			stepLine("11:06:41", "implement", "ok", "4m11s", "$0.52", "o-ok"),
			dim(stepLine("11:06:41", "check", "started")),
			stepLine("11:07:19", "check", "ok", "38.4s", "", "o-ok"),
			dim(stepLine("11:07:19", "review", "started")),
			stepLine("11:12:02", "review", "ok", "4m43s", "$0.61", "o-ok"),
			dim(stepLine("11:12:02", "merge", "started")),
			stepLine("11:12:09", "merge", "ok", "6.8s", "", "o-ok"),
		],
	},
];

// Ticket 01 of the real Goal plan-goals-in-vago, from its Ticket header.
export const realSteps = [
	{ id: "New branch", type: "shell", took: "0.0s", cost: "" },
	{ id: "Build", type: "agent", took: "7m08s", cost: "$0.96" },
	{ id: "Checks", type: "shell", took: "3m30s", cost: "" },
	{ id: "Review", type: "agent", took: "5m04s", cost: "$0.84" },
	{ id: "Squash merge", type: "shell", took: "4.5s", cost: "" },
];
