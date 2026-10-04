import { expect, test } from "bun:test";
import { join } from "node:path";
import { RGBA, TextAttributes } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import {
	type FixtureRun,
	goalText,
	heldLock,
	makeProject,
	projectWithGoals,
	ticketText,
} from "./project.ts";
import { frameWith, frameWithout, renderView } from "./view-render.tsx";

test("Enter opens the selected Goal and Esc goes back with it still selected", async () => {
	const root = await projectWithGoals(["alpha", "beta", "gamma"]);
	const view = await renderView(root);
	await frameWith(view, " 1/3 ");
	view.mockInput.pressArrow("down");
	await frameWith(view, " 2/3 ");

	view.mockInput.pressEnter();
	const opened = await frameWith(view, "Goal 2/3");
	expect(opened).toContain("beta");
	expect(opened).not.toContain("─ Goals ─");

	view.mockInput.pressEscape();
	const back = await frameWithout(view, "Goal 2/3");
	expect(back).toContain("─ Goals ─");
	expect(back).toContain(" 2/3 ");
});

test("Esc back to a long list shows the selected Goal's row", async () => {
	const root = await projectWithGoals(
		Array.from({ length: 20 }, (_, index) => `goal-${index + 10}`),
	);
	const view = await renderView(root);
	await frameWith(view, " 1/20 ");
	view.mockInput.pressKey("G");
	await frameWith(view, " 20/20 ");

	view.mockInput.pressEnter();
	await frameWith(view, "Goal 20/20");
	view.mockInput.pressEscape();

	// Once in its row and once in the preview's border.
	const back = await frameWith(view, "─ Goals ─");
	expect(back.split(" goal-29 ").length - 1).toBe(2);
});

const at = (time: string) => new Date(`2026-10-01T${time}:00Z`);
const roomy = { width: 120, height: 30 };

// Goal `worktrees`, stuck on Ticket 02 after Ticket 01 is done, with its
// Runs' times, tokens and costs.
function stuckGoal(): Promise<string> {
	return makeProject({
		".vago-goals/worktrees/goal.md": goalText(
			"small",
			"# Each Goal runs in its own worktree\n",
		),
		".vago-goals/worktrees/tickets/01-separate.md": ticketText("done", {
			runs: [
				{
					step: "implement",
					started: at("08:00"),
					ended: at("08:30"),
					outcome: "ok",
					costUsd: 1.25,
					tokens: { input: 1000, output: 200 },
				},
			],
		}),
		".vago-goals/worktrees/tickets/02-run-in-worktree.md": ticketText("stuck", {
			blockedBy: [1],
			runs: [
				{
					step: "check",
					started: at("08:30"),
					ended: at("09:01"),
					outcome: "exit 1",
					costUsd: 0.5,
					tokens: { input: 250, output: 50 },
				},
			],
		}),
	});
}

// The span of the frame whose text is exactly `text`, trimmed.
function spanOf(view: TestRendererSetup, text: string) {
	for (const line of view.captureSpans().lines) {
		const span = line.spans.find((span) => span.text.trim() === text);
		if (span !== undefined) return span;
	}
	throw new Error(`No span is ${text}`);
}

// The first span whose text holds `text`.
function spanWith(view: TestRendererSetup, text: string) {
	for (const line of view.captureSpans().lines) {
		const span = line.spans.find((span) => span.text.includes(text));
		if (span !== undefined) return span;
	}
	throw new Error(`No span holds ${text}`);
}

const isBold = (span: { attributes: number }) =>
	(span.attributes & TextAttributes.BOLD) !== 0;

test("the header names the Goal and shows its progress and numbers, values bold", async () => {
	const root = await stuckGoal();
	const view = await renderView(root, roomy);
	await frameWith(view, " 1/1 ");

	view.mockInput.pressEnter();
	const frame = await frameWith(view, "Goal 1/1");

	const lines = frame.split("\n");
	expect(lines[0]).toContain("Goal 1/1 · ✗ worktrees");
	expect(lines[1]).toMatch(/█+ {2}1\/2 Tickets/);
	expect(lines[2]).toContain(
		"STUCK   1h 1m elapsed   1.5k tokens   $1.75   Workflow small   Each Goal runs in its own worktree",
	);
	for (const value of ["STUCK", "1h 1m", "1.5k", "$1.75", "small", "1"]) {
		expect(isBold(spanOf(view, value))).toBe(true);
	}
	for (const label of ["elapsed", "tokens", "Workflow", "/2 Tickets"]) {
		expect(isBold(spanOf(view, label))).toBe(false);
	}
});

// A Ticket file of status `status` titled `title`.
const titled = (
	status: "ready" | "running" | "done" | "stuck",
	title: string,
	options: { runs?: FixtureRun[]; blockedBy?: number[] } = {},
) => ticketText(status, { ...options, body: `# ${title}\n` });

// Goal `run`, held by a live process, on Ticket 02's review, with Ticket 03
// waiting on it and Ticket 04 ready.
async function runningGoal(): Promise<string> {
	const root = await makeProject({
		".vago/workflows/small.toml": workflowOf("implement", "review"),
		".vago-goals/run/goal.md": goalText("small"),
		".vago-goals/run/tickets/01-first.md": titled("done", "First"),
		".vago-goals/run/tickets/02-second.md": titled("running", "Second", {
			runs: [{ step: "review", started: at("09:00") }],
		}),
		".vago-goals/run/tickets/03-third.md": ticketText("ready", {
			blockedBy: [2],
			body: "# Third\n\nThe first paragraph is\nhard-wrapped here.\n\nA second one.\n",
		}),
		".vago-goals/run/tickets/04-fourth.md": titled("ready", "Fourth"),
	});
	await heldLock(root, "run");
	return root;
}

// The Goal view of the Project at `root`'s first Goal, and its first frame
// with Tickets.
async function openFirstGoal(
	root: string,
	size = roomy,
): Promise<{ view: TestRendererSetup; frame: string }> {
	const view = await renderView(root, size);
	await frameWith(view, "─ 1/");
	view.mockInput.pressEnter();
	return { view, frame: await frameWith(view, "─ Tickets ─") };
}

test("a running Goal's Tickets show the Step, the blockers waited on and nothing for ready", async () => {
	const { frame } = await openFirstGoal(await runningGoal());

	expect(frame).toContain("│ ✓ 01 First ");
	expect(frame).toContain("│ ● 02 review  Second ");
	expect(frame).toContain("│ ◌ 03 after 02  Third ");
	expect(frame).toContain("│ ○ 04 Fourth ");
	expect(frame).toContain(" 2/4 ");
	expect(frame).toContain("Goal 1/1 · ● run");
});

test("a stuck Goal's stuck Ticket says so before its title", async () => {
	const { frame } = await openFirstGoal(await stuckGoal());

	expect(frame).toContain("│ ✓ 01 A Ticket ");
	expect(frame).toContain("│ ✗ 02 stuck  A Ticket ");
	expect(frame).toContain(" 2/2 ");
});

test("a done Goal's Tickets are all done, the last one selected", async () => {
	const root = await makeProject({
		".vago-goals/fin/goal.md": goalText("small"),
		".vago-goals/fin/tickets/01-first.md": titled("done", "First"),
		".vago-goals/fin/tickets/02-second.md": titled("done", "Second"),
	});

	const { frame } = await openFirstGoal(root);

	expect(frame).toContain("│ ✓ 01 First ");
	expect(frame).toContain("│ ✓ 02 Second ");
	expect(frame).toContain(" 2/2 ");
	expect(frame).toContain("Goal 1/1 · ✓ fin");
});

test("↑↓ change the Ticket pane to that Ticket, its text read as paragraphs", async () => {
	const { view, frame } = await openFirstGoal(await runningGoal());
	expect(frame).toContain("─ Ticket 02 ─");
	expect(frame).toContain("│ Second ");

	view.mockInput.pressArrow("down");
	const third = await frameWith(view, "─ Ticket 03 ─");
	const lines = third.split("\n");
	const title = lines.findIndex((line) => line.includes("│ Third "));
	expect(lines[title + 1]).toContain("│ after 02 ");
	expect(lines[title + 3]).toContain("│ · implement  · review ");
	expect(lines[title + 5]).toContain(
		"│ The first paragraph is hard-wrapped here. ",
	);
	expect(lines[title + 6]).toMatch(/│ +│$/);
	expect(lines[title + 7]).toContain("│ A second one. ");
	expect(third).toContain(" 3/4 ");

	view.mockInput.pressKey("k");
	view.mockInput.pressKey("k");
	view.mockInput.pressKey("k");
	expect(await frameWith(view, "─ Ticket 01 ─")).toContain(" 1/4 ");
});

test("the footer names the Goal view's keys, and ? shows them all", async () => {
	const { view, frame } = await openFirstGoal(await runningGoal());
	expect(frame.trimEnd().split("\n").at(-1)).toMatch(
		/^ ↑↓ Ticket {3}←→ Run {3}Esc Goals {3}\? Help {3}q Quit *$/,
	);

	view.mockInput.pressKey("?");
	await frameWith(view, " Keys ");
	view.mockInput.pressArrow("down");
	view.mockInput.pressEscape();
	const closed = await frameWithout(view, " Keys ");
	expect(closed).toContain("─ Ticket 02 ─");
	expect(closed).toContain("─ Tickets ─");
});

test("Enter on a broken Goal keeps the Project view, whose preview says why", async () => {
	const root = await makeProject({
		".vago-goals/bad/goal.md": "no header\n",
	});
	const view = await renderView(root);
	await frameWith(view, "─ 1/1 ─");

	view.mockInput.pressEnter();
	await Bun.sleep(50);

	expect(await frameWith(view, "─ 1/1 ─")).not.toContain("Goal 1/1");
});

test("below 30 rows the header's bar is the Project view's lighter one", async () => {
	const { frame } = await openFirstGoal(await stuckGoal(), {
		width: 80,
		height: 24,
	});

	expect(frame.split("\n")[1]).toMatch(/━+ {2}1\/2 Tickets/);
});

test("under NO_COLOR a blocked Ticket's mark and state word stay dim", async () => {
	process.env.NO_COLOR = "1";
	try {
		const { view } = await openFirstGoal(await runningGoal());

		const spans = view.captureSpans().lines.flatMap((line) => line.spans);
		const after = spans.find((span) => span.text.startsWith("after 02"));
		expect((after?.attributes ?? 0) & TextAttributes.DIM).toBe(
			TextAttributes.DIM,
		);
		const review = spans.find((span) => span.text.startsWith("review"));
		expect((review?.attributes ?? 0) & TextAttributes.DIM).toBe(0);
	} finally {
		delete process.env.NO_COLOR;
	}
});

// A Workflow of shell Steps named `ids`, in that order.
const workflowOf = (...ids: string[]) =>
	ids
		.map((id) => `[[steps]]\nid = "${id}"\ntype = "shell"\nrun = "true"\n`)
		.join("\n");

// A Run of `step` from minute `from` to minute `to` past 10:00, open without
// `to`.
const runOf = (
	step: string,
	from: number,
	to?: number,
	outcome = "ok",
): FixtureRun => ({
	step,
	started: new Date(Date.UTC(2026, 9, 1, 10, from)),
	...(to === undefined
		? {}
		: { ended: new Date(Date.UTC(2026, 9, 1, 10, to)), outcome }),
});

// The Goal view of Goal `marks`, going through Workflow `small`, whose only
// Ticket is `ticket`, held by a live `vago run` when `claimed`.
async function openTicket(
	ticket: string,
	options: {
		claimed?: boolean;
		size?: { width: number; height: number };
		/** More files of the Project, keyed by path relative to its root. */
		files?: Record<string, string>;
	} = {},
): Promise<{ view: TestRendererSetup; frame: string }> {
	const root = await makeProject({
		".vago/workflows/small.toml": workflowOf(
			"branch",
			"implement",
			"check",
			"merge",
		),
		".vago/workflows/design.toml": workflowOf("branch", "design", "review"),
		".vago-goals/marks/goal.md": goalText("small"),
		".vago-goals/marks/tickets/01-only.md": ticket,
		...options.files,
	});
	if (options.claimed === true) await heldLock(root, "marks");
	return openFirstGoal(root, options.size);
}

test("a done Ticket's Steps are all done, and its border has its totals", async () => {
	const { frame } = await openTicket(
		ticketText("done", {
			runs: [
				{ ...runOf("branch", 0, 1), costUsd: 0 },
				{ ...runOf("implement", 1, 21), costUsd: 4.5 },
				runOf("check", 21, 22),
				{ ...runOf("merge", 22, 23), costUsd: 0.09 },
			],
		}),
	);

	expect(frame).toContain("│ ✓ branch  ✓ implement  ✓ check  ✓ merge ");
	expect(frame).toContain(" 4 Runs · 23m 0s · $4.59 ─");
});

test("a running Ticket's open Step is current and the Steps after it pending", async () => {
	const { frame } = await openTicket(
		ticketText("running", {
			runs: [runOf("branch", 0, 1), runOf("implement", 1)],
		}),
		{ claimed: true },
	);

	expect(frame).toContain("│ ✓ branch  ● implement  · check  · merge ");
	expect(frame).toMatch(/ 2 Runs · \d+[dhm] \d+[hms] · \$0\.00 ─/);
});

test("a stuck Ticket's failed Step is marked failed", async () => {
	const { frame } = await openTicket(
		ticketText("stuck", {
			runs: [
				runOf("branch", 0, 1),
				runOf("implement", 1, 5),
				runOf("check", 5, 6, "exit 1"),
			],
		}),
	);

	expect(frame).toContain("│ ✓ branch  ✓ implement  ✗ check  · merge ");
});

test("a lost Goal's open Step is marked lost", async () => {
	const { frame } = await openTicket(
		ticketText("running", {
			runs: [runOf("branch", 0, 1), runOf("implement", 1)],
		}),
	);

	expect(frame).toContain("│ ✓ branch  ? implement  · check  · merge ");
	expect(frame).toContain(" 2 Runs · 1m 0s · $0.00 ─");
});

test("a Ticket that started over is marked from its last pass only", async () => {
	const { frame } = await openTicket(
		ticketText("running", {
			runs: [
				runOf("branch", 0, 1),
				runOf("implement", 1, 5),
				runOf("check", 5, 6, "permission-denied"),
				runOf("branch", 7, 8),
				runOf("implement", 8),
			],
		}),
		{ claimed: true },
	);

	expect(frame).toContain("│ ✓ branch  ● implement  · check  · merge ");
	expect(frame).toContain(" 5 Runs ");
});

test("a Ticket with its own Workflow shows that Workflow's Steps", async () => {
	const { frame } = await openTicket(
		ticketText("ready", { workflow: "design" }),
	);

	expect(frame).toContain("│ · branch  · design  · review ");
	expect(frame).toContain(" 0 Runs · 0s · $0.00 ─");
});

test("the Steps line wraps when the Ticket pane is narrow", async () => {
	const { frame } = await openTicket(ticketText("ready"), {
		size: { width: 50, height: 24 },
	});

	const lines = frame.split("\n");
	const first = lines.findIndex((line) =>
		line.includes("· branch  · implement"),
	);
	expect(lines[first]).not.toContain("check");
	expect(lines[first + 1]).toContain("│ · check  · merge ");
});

test("a Ticket whose Workflow can't be read says why in place of its Steps", async () => {
	const { frame } = await openTicket(
		ticketText("ready", { workflow: "gone" }),
		{ size: { width: 160, height: 30 } },
	);

	expect(frame).toContain('No Workflow "gone" in .vago/workflows/');
});

test("the Runs pane lists the selected Ticket's Runs and follows ↑↓", async () => {
	const { view, frame } = await openFirstGoal(await stuckGoal());
	expect(frame).toContain("─ Runs of Ticket 02 ─");
	expect(frame).toMatch(/│ 1 {2}check +✗ exit 1 +31m 0s +\$0\.50 +│/);

	view.mockInput.pressArrow("up");
	const first = await frameWith(view, "─ Runs of Ticket 01 ─");
	expect(first).toMatch(/│ 1 {2}implement +✓ ok +30m 0s +\$1\.25 +│/);
	expect(first).not.toContain("exit 1");
});

// Goal `many` whose only Ticket, done, ran its Step `step-N` N times over,
// N from 1 to `count`, each a minute long.
function manyRunsGoal(count: number): Promise<string> {
	return makeProject({
		".vago-goals/many/goal.md": goalText("small"),
		".vago-goals/many/tickets/01-only.md": ticketText("done", {
			runs: Array.from({ length: count }, (_, index) =>
				runOf(`step-${index + 1}`, index, index + 1),
			),
		}),
	});
}

test("←→ pick the Run, the Runs pane scrolls to it and the Run pane shows it", async () => {
	const { view } = await openFirstGoal(await manyRunsGoal(12));
	const frame = await frameWith(view, "│ 12 step-12 ");
	expect(frame).toContain("─ Run 12 · 01 step-12 ─");
	expect(frame).not.toMatch(/│ 1 {2}step-1 /);
	expect(isBold(spanOf(view, "step-12"))).toBe(true);
	expect(isBold(spanOf(view, "step-11"))).toBe(false);

	for (let press = 0; press < 11; press++) view.mockInput.pressArrow("left");
	const first = await frameWith(view, "─ Run 1 · 01 step-1 ─");
	expect(first).toMatch(/│ 1 {2}step-1 /);
	expect(first).not.toMatch(/│ 12 step-12 /);

	view.mockInput.pressArrow("left");
	view.mockInput.pressArrow("right");
	expect(await frameWith(view, "─ Run 2 · 01 step-2 ─")).toMatch(
		/│ 2 {2}step-2 /,
	);
});

test("a failed shell Run shows its log, and its border its outcome and time", async () => {
	const { view } = await openTicket(
		ticketText("stuck", { runs: [runOf("check", 5, 6, "exit 1")] }),
		{
			files: {
				".vago-goals/marks/logs/check-1.log":
					"$ bun run check\n\u001b[31merror\u001b[0m TS2322: Type 'string' is not assignable.\n  src/tickets.ts:88:3\nFound 1 error.\n",
			},
		},
	);

	const frame = await frameWith(view, "│ $ bun run check ");
	expect(frame).toContain("─ Run 1 · 01 check ─");
	expect(frame).toContain("│ error TS2322: Type 'string' is not assignable. ");
	expect(frame).toContain("│   src/tickets.ts:88:3 ");
	expect(frame).toContain("│ Found 1 error. ");
	expect(frame).toMatch(/─ ✗ exit 1 · 1m 0s ─+┘/);
});

test("a shell log longer than the Run pane scrolls with the wheel", async () => {
	const root = await manyRunsGoal(1);
	const lines = Array.from({ length: 60 }, (_, index) => `line ${index + 1}`);
	await Bun.write(
		`${root}/.vago-goals/many/logs/step-1-1.log`,
		`${lines.join("\n")}\n`,
	);
	const { view } = await openFirstGoal(root);
	const frame = await frameWith(view, "│ line 1 ");
	expect(frame).not.toContain("│ line 60 ");

	const bottom = frame.split("\n").length - 4;
	for (let turn = 0; turn < 60; turn++) {
		await view.mockMouse.scroll(10, bottom, "down");
	}
	expect(await frameWith(view, "│ line 60 ")).not.toContain("│ line 1 ");
});

test("an agent Run's border has its cost", async () => {
	const root = await makeProject({
		".vago-goals/agent/goal.md": goalText("small"),
		".vago-goals/agent/tickets/01-only.md": ticketText("done", {
			runs: [{ ...runOf("review", 0, 9), costUsd: 0.83, model: "opus" }],
		}),
	});

	const { frame } = await openFirstGoal(root);

	expect(frame).toContain("─ Run 1 · 01 review ─");
	expect(frame).toMatch(/─ ✓ ok · 9m 0s · \$0\.83 ─+┘/);
});

// The Goal view of Goal `agent`, `size`, whose only Ticket's one implement
// Run ended `outcome` and logged the recorded Claude Code stream `fixture`,
// rewritten by `edit` with the Project's root.
async function openAgentRun(
	fixture: string,
	options: {
		outcome?: string;
		size?: { width: number; height: number };
		edit?: (log: string, root: string) => string;
	} = {},
): Promise<{ view: TestRendererSetup; frame: string }> {
	const root = await makeProject({
		".vago-goals/agent/goal.md": goalText("small"),
		".vago-goals/agent/tickets/01-only.md": ticketText("done", {
			runs: [
				{
					...runOf("implement", 0, 9, options.outcome),
					costUsd: 0.09,
					model: "opus",
				},
			],
		}),
	});
	const log = await Bun.file(join(import.meta.dir, "fixtures", fixture)).text();
	await Bun.write(
		`${root}/.vago-goals/agent/logs/implement-1.jsonl`,
		options.edit?.(log, root) ?? log,
	);
	return openFirstGoal(root, options.size);
}

test("a finished agent Run shows its start, its tool lines under its prose and its end", async () => {
	const { view } = await openAgentRun("claude-code-parallel-calls.jsonl", {
		size: { width: 120, height: 60 },
	});

	const frame = await frameWith(view, "Run finished");
	const lines = frame.split("\n");
	const row = (text: string) => lines.findIndex((line) => line.includes(text));
	expect(frame).toContain("│ ── Session started · claude-sonnet-5-5 ── ");
	expect(frame).toContain("│     Read 3 files greet.ts, notes.md, bye.ts ");
	expect(frame).toContain("│     Execute ×4 Force-push main ");
	expect(frame).toContain("│       ✗ Exit code 128 ");
	expect(frame).toContain("│  ⁘ Read and line counts all succeeded ");
	expect(frame).toContain(
		"│  ✓ Run finished   14s   8 turns   104.2k tokens   $0.09 ",
	);
	// A blank line around the divider and the prose.
	expect(lines[row("Session started") + 1]).toMatch(/^│ +│/);
	expect(lines[row("⁘ Read and line") - 1]).toMatch(/^│ +│/);
	expect(isBold(spanOf(view, "Execute ×4"))).toBe(true);
	expect(isBold(spanOf(view, "✓ Run finished"))).toBe(true);
	// The prose and the end stand out on a lighter background.
	const raised = RGBA.fromHex("#1b1b1b");
	expect(spanWith(view, "Read and line counts").bg.equals(raised)).toBe(true);
	expect(spanOf(view, "✓ Run finished").bg.equals(raised)).toBe(true);
	expect(spanWith(view, "Session started").bg.equals(raised)).toBe(false);
});

test("one tool call shows its size, with paths in the main checkout relative to the Project", async () => {
	const { view } = await openAgentRun("claude-code-tool-calls.jsonl", {
		size: { width: 120, height: 160 },
		edit: (log, root) =>
			log.replaceAll(
				"/home/user/.vago/worktrees/project-1a2b3c4d/hello/greet.ts",
				`${root}/greet.ts`,
			),
	});

	const frame = await frameWith(view, "Edit greet.ts");
	expect(frame).toContain("│     Read greet.ts (3 lines) ");
	expect(frame).toContain("│     Edit greet.ts (+1 −1) ");
	expect(frame).toContain("│     Write bye.ts (3 lines) ");
	expect(frame).toContain("│     Execute cat missing.txt ");
	expect(frame).not.toContain("/greet.ts");
});

test("a failed agent Run's end says how it ended", async () => {
	const { view } = await openAgentRun("claude-code-max-turns.jsonl", {
		outcome: "error_max_turns",
	});

	expect(await frameWith(view, "Run ended")).toContain(
		"│  ✗ Run ended: error_max_turns   3s   2 turns   22.9k tokens   $0.01 ",
	);
});

test("a refused tool call shows the tool and why", async () => {
	const { view } = await openAgentRun("claude-code-safety-check.jsonl", {
		outcome: "permission-denied",
	});

	expect(await frameWith(view, "Denied")).toContain(
		"│       ✗ Denied Bash: This shell -c script runs rm and could not be checked ",
	);
});

test("a prose message past 40 lines is cut, its headings bold", async () => {
	const { view } = await openAgentRun("claude-code-long-prose.jsonl", {
		size: { width: 160, height: 240 },
	});

	const frame = await frameWith(view, "more lines");
	expect(frame).toContain("│  ⁘ 1. Concerns ");
	expect(frame).toContain(
		"│    Design A: the spelling and the total as functions on their owners ",
	);
	expect(frame).toContain("│    … 102 more lines ");
	expect(
		isBold(
			spanOf(
				view,
				"Design A: the spelling and the total as functions on their owners",
			),
		),
	).toBe(true);
	expect(isBold(spanOf(view, "1. Concerns"))).toBe(false);
});

test("a Ticket with no Runs says so in both Run panes", async () => {
	const { frame } = await openTicket(ticketText("ready"));

	expect(frame).toContain("─ Runs of Ticket 01 ─");
	expect(frame.split("No Run yet.").length - 1).toBe(2);
});
