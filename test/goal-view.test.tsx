import { expect, test } from "bun:test";
import { utimes } from "node:fs/promises";
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
import {
	frameWith,
	frameWithout,
	onlyAscii,
	renderView,
	setEnv,
} from "./view-render.tsx";

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
// Runs' times, tokens and costs. Ticket 02's Run is two days after Ticket
// 01's, a pause the run time leaves out.
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
					started: new Date("2026-10-03T08:30:00Z"),
					ended: new Date("2026-10-03T09:01:00Z"),
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
	expect(lines[1]).toMatch(/^┌─ Goal 1\/1 · ✗ worktrees ─+┐$/);
	expect(lines[2]).toMatch(/█+ {2}1\/2 Tickets/);
	expect(lines[3]).toContain(
		"STUCK   1h 1m run time   1.5k tokens   $1.75   Workflow small   Each Goal runs in its own worktree",
	);
	for (const value of ["STUCK", "1h 1m", "1.5k", "$1.75", "small", "1"]) {
		expect(isBold(spanOf(view, value))).toBe(true);
	}
	for (const label of ["run time", "tokens", "Workflow", "/2 Tickets"]) {
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
	// The Runs pane's title.
	return { view, frame: await frameWith(view, " Runs ") };
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
		/^ ↑↓ Move {3}←→ Run {3}Tab Pane {3}\[ \] Goal {3}s Start {3}t r Full screen {3}G Follow {3}e d Diff {3}Esc Goals {3}\? Help {3}q Quit *$/,
	);

	view.mockInput.pressKey("?");
	const help = await frameWith(view, " Keys ");
	for (const keys of [
		"↑↓ j k",
		"←→ h l",
		"Tab",
		"1 2 3 4",
		"Space PgDn",
		"PgUp",
		"t r",
		"G",
		"e E",
		"d",
		"[ ]",
		"s",
		"click",
		"wheel",
		"Esc",
		"? Esc",
		"q Ctrl-C",
	]) {
		expect(help).toMatch(new RegExp(`│ ${RegExp.escape(keys)} +\\S`));
	}
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

test("under NO_COLOR a blocked Ticket's mark and state word stay dim", async () => {
	setEnv({ NO_COLOR: "1" });
	const { view } = await openFirstGoal(await runningGoal());

	const spans = view.captureSpans().lines.flatMap((line) => line.spans);
	const after = spans.find((span) => span.text.startsWith("after 02"));
	expect((after?.attributes ?? 0) & TextAttributes.DIM).toBe(
		TextAttributes.DIM,
	);
	const review = spans.find((span) => span.text.startsWith("review"));
	expect((review?.attributes ?? 0) & TextAttributes.DIM).toBe(0);
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
): Promise<{ view: TestRendererSetup; frame: string; root: string }> {
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
	return { ...(await openFirstGoal(root, options.size)), root };
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

test("named Steps show their names in the Steps line, the Runs and the Run's title", async () => {
	const { view } = await openTicket(
		ticketText("running", {
			runs: [runOf("branch", 0, 1), runOf("implement", 1)],
		}),
		{
			claimed: true,
			files: {
				".vago/workflows/small.toml": `
[[steps]]
id = "branch"
type = "shell"
run = "true"

[[steps]]
id = "implement"
name = "Build it"
type = "shell"
run = "true"
`,
			},
		},
	);

	const frame = await frameWith(view, "│ 2  Build it ");
	expect(frame).toContain("│ ✓ branch  ● Build it ");
	expect(frame).toContain("│ ● 01 Build it  ");
	expect(frame).toContain("─ Run 2 · 01 Build it ─");
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

test("a Run's edits, background task and Skill load show in its stream", async () => {
	const { view } = await openAgentRun("claude-code-edits-and-tasks.jsonl", {
		size: { width: 120, height: 60 },
	});

	const frame = await frameWith(view, "Run finished");
	expect(frame).toContain("│     Edit 2 files notes.md, greet.ts ");
	expect(frame).toContain("│     Write bye.ts (3 lines) ");
	expect(frame).toContain("│     Background Wait a little (done) ");
	expect(frame).toContain("│     Skill say-hi loaded ");
	expect(isBold(spanOf(view, "Background"))).toBe(true);
});

test("e selects the latest edit, E and e move between edits, and d opens its diff and closes it again", async () => {
	const { view } = await openAgentRun("claude-code-edits-and-tasks.jsonl", {
		size: { width: 120, height: 60 },
	});
	await frameWith(view, "Run finished");
	// The selection's background, the accent.
	const selected = RGBA.fromHex("#ff8a3d");

	view.mockInput.pressKey("e");
	await view.renderOnce();
	expect(spanOf(view, "Write").bg.equals(selected)).toBe(true);
	view.mockInput.pressKey("e");
	await view.renderOnce();
	expect(spanOf(view, "Edit 2 files").bg.equals(selected)).toBe(true);
	expect(spanOf(view, "Write").bg.equals(selected)).toBe(false);

	view.mockInput.pressKey("d");
	const diff = await frameWith(view, "notes.md (+1 −1)");
	expect(diff).toContain("│ greet.ts (+1 −1) ");
	expect(diff).toContain("│ @@ -1,3 +1,3 @@ ");
	expect(diff).toContain("│ -two ");
	expect(diff).toContain("│ +TWO ");
	expect(diff).toContain("│  three ");
	expect(diff).not.toContain("Run finished");

	view.mockInput.pressKey("d");
	const stream = await frameWith(view, "Run finished");
	expect(stream).not.toContain("@@ -1,3 +1,3 @@");

	view.mockInput.pressKey("E");
	view.mockInput.pressKey("d");
	expect(await frameWith(view, "│ bye.ts (3 lines) ")).toContain(
		"│ @@ -0,0 +1,3 @@ ",
	);
	view.mockInput.pressEscape();
	await frameWith(view, "Run finished");

	// Moving to another edit with the diff closed keeps it closed.
	view.mockInput.pressKey("e");
	await view.renderOnce();
	expect(view.captureCharFrame()).not.toContain("@@ -");
});

test("an open agent Run shows a running command's clock, and its tokens and cost so far on its border", async () => {
	const { view, root } = await openTicket(
		ticketText("running", {
			runs: [{ ...runOf("branch", 0), model: "opus" }],
		}),
		{ claimed: true },
	);
	const started = new Date(Date.now() - 95_000).toISOString();
	const lines = (
		await Bun.file(
			join(import.meta.dir, "fixtures", "claude-code-edits-and-tasks.jsonl"),
		).text()
	)
		.replaceAll("2026-10-05T18:44:59.306Z", started)
		.split("\n");

	// Cut while the long command runs.
	await Bun.write(
		`${root}/.vago-goals/marks/logs/branch-1.jsonl`,
		`${lines.slice(0, 32).join("\n")}\n`,
	);

	const frame = await frameWith(view, "Execute Count to thirty-five · 1m 3");
	expect(frame).toMatch(/─ ● live [^·]+ · \d+\.\dk tokens · \$0\.\d\d ─+┘/);
	expect(frame).toContain("│     Background Wait a little (done) ");
});

test("a Ticket with no Runs says so in both Run panes", async () => {
	const { frame } = await openTicket(ticketText("ready"));

	expect(frame).toContain("─ Runs of Ticket 01 ─");
	expect(frame.split("No Run yet.").length - 1).toBe(2);
});

// Lines `line <from>` to `line <to>`, each ended.
const numberedLines = (from: number, to: number) =>
	Array.from(
		{ length: to - from + 1 },
		(_, index) => `line ${from + index}\n`,
	).join("");

// The Goal view of Goal `marks`, held by a live `vago run`, whose only
// Ticket is on its `check` Step, an open shell Run that has logged `line 1`
// to `line 60`, and the path of that log.
async function openLiveShellRun(): Promise<{
	view: TestRendererSetup;
	frame: string;
	log: string;
}> {
	const { view, root } = await openTicket(
		ticketText("running", { runs: [runOf("branch", 0, 1), runOf("check", 1)] }),
		{
			claimed: true,
			files: { ".vago-goals/marks/logs/check-2.log": numberedLines(1, 60) },
		},
	);
	const frame = await frameWith(view, "│ line 60 ");
	return { view, frame, log: `${root}/.vago-goals/marks/logs/check-2.log` };
}

// Appends `text` to the file at `path`.
async function append(path: string, text: string): Promise<void> {
	await Bun.write(path, (await Bun.file(path).text()) + text);
}

test("a live Run's log shows what it adds without a key, staying at the bottom", async () => {
	const { view, frame, log } = await openLiveShellRun();
	expect(frame).not.toContain("│ line 1 ");
	expect(frame).toMatch(/─ ● live \d[^·]*─+┘/);

	await append(log, numberedLines(61, 62));

	const grown = await frameWith(view, "│ line 62 ");
	expect(grown).not.toContain("│ line 2 ");
});

test("scrolling a live Run up holds it while lines arrive, and G follows again", async () => {
	const { view, frame, log } = await openLiveShellRun();
	const bottom = frame.split("\n").length - 4;
	for (let turn = 0; turn < 10; turn++) {
		await view.mockMouse.scroll(10, bottom, "up");
	}
	const held = await frameWithout(view, "│ line 60 ");

	await append(log, numberedLines(61, 61));
	await Bun.sleep(1500);
	await view.renderOnce();
	expect(view.captureCharFrame()).toBe(held);

	view.mockInput.pressKey("G");
	await frameWith(view, "│ line 61 ");
});

test("a Run starting and ending changes the Tickets, the Runs and the Steps", async () => {
	const { view, root } = await openTicket(
		ticketText("running", { runs: [runOf("branch", 0, 1)] }),
		{ claimed: true },
	);
	const ticket = `${root}/.vago-goals/marks/tickets/01-only.md`;

	await Bun.write(
		ticket,
		ticketText("running", {
			runs: [runOf("branch", 0, 1), runOf("implement", 1)],
		}),
	);
	const started = await frameWith(view, "│ ✓ branch  ● implement  · check ");
	expect(started).toContain("● 01 implement");
	expect(started).toContain("─ Run 2 · 01 implement ─");

	await Bun.write(
		ticket,
		ticketText("running", {
			runs: [runOf("branch", 0, 1), runOf("implement", 1, 4)],
		}),
	);
	const ended = await frameWith(view, "│ ✓ branch  ✓ implement  · check ");
	expect(ended).toMatch(/─ ✓ ok · 3m 0s ─+┘/);
});

test("an open agent Run shows working while the agent has the turn", async () => {
	const { view, root } = await openTicket(
		ticketText("running", {
			runs: [{ ...runOf("branch", 0), model: "opus" }],
		}),
		{ claimed: true },
	);
	const lines = (
		await Bun.file(
			join(import.meta.dir, "fixtures", "claude-code-parallel-calls.jsonl"),
		).text()
	).split("\n");
	const log = `${root}/.vago-goals/marks/logs/branch-1.jsonl`;

	// After the three Bash calls, before their results: a tool runs.
	await Bun.write(log, `${lines.slice(0, 17).join("\n")}\n`);
	const running = await frameWith(view, "Execute ×3");
	expect(running).not.toContain("working");

	// After their results: the agent's turn.
	await Bun.write(log, `${lines.slice(0, 20).join("\n")}\n`);
	await frameWith(view, "│  ⁘ working ");
});

test("a lost Goal marks its Ticket, Step and open Run lost and says what to do", async () => {
	const root = await makeProject({
		".vago/workflows/small.toml": workflowOf("branch", "check", "merge"),
		".vago-goals/lost/goal.md": goalText("small"),
		".vago-goals/lost/tickets/01-only.md": ticketText("running", {
			runs: [runOf("branch", 0, 1), runOf("check", 1)],
		}),
		".vago-goals/lost/logs/check-2.log": numberedLines(1, 3),
	});
	// The Run was last heard from 12 seconds after it started.
	const heard = new Date(Date.UTC(2026, 9, 1, 10, 1, 12));
	await utimes(`${root}/.vago-goals/lost/logs/check-2.log`, heard, heard);

	const { view } = await openFirstGoal(root);

	const frame = await frameWith(view, "│ line 3 ");
	const lines = frame.split("\n");
	expect(lines[1]).toContain("Goal 1/1 · ? lost");
	expect(lines[4]).toContain(
		" ? No vago run process runs this Goal; the next records its open Run as lost.",
	);
	expect(frame).toContain("│ ? 01 lost  A Ticket ");
	expect(frame).toContain("│ ✓ branch  ? check  · merge ");
	expect(frame).toMatch(/─ \? lost after 12s ─+┘/);
	expect(frame).not.toContain("working");
});

test("a lost Run's time in the Runs pane runs to its log's last write, as on its border", async () => {
	const root = await makeProject({
		".vago-goals/lost/goal.md": goalText("small"),
		".vago-goals/lost/tickets/01-only.md": ticketText("running", {
			runs: [runOf("check", 1)],
		}),
		".vago-goals/lost/logs/check-1.log": numberedLines(1, 3),
	});
	const heard = new Date(Date.UTC(2026, 9, 1, 10, 1, 12));
	await utimes(`${root}/.vago-goals/lost/logs/check-1.log`, heard, heard);

	const { view } = await openFirstGoal(root);

	const frame = await frameWith(view, "│ line 3 ");
	expect(frame).toMatch(/│ 1 {2}check +\? lost +12s +│/);
	expect(frame).toMatch(/─ \? lost after 12s ─+┘/);
});

test("at 80 columns the lost hint shows whole", async () => {
	const root = await makeProject({
		".vago-goals/lost/goal.md": goalText("small"),
		".vago-goals/lost/tickets/01-only.md": ticketText("running", {
			runs: [runOf("check", 1)],
		}),
	});

	const { frame } = await openFirstGoal(root, { width: 80, height: 24 });

	expect(frame).toContain("the next records its open Run as lost.");
});

// The Goal view of Goal `long`, whose stuck Ticket 01 has 40 paragraphs of
// text and two Runs, the latest a 60-line `check` log, before a ready
// Ticket 02.
async function openLongTicket(): Promise<TestRendererSetup> {
	const paragraphs = Array.from(
		{ length: 40 },
		(_, index) => `para ${index + 1}`,
	);
	const root = await makeProject({
		".vago/workflows/small.toml": workflowOf("branch", "check"),
		".vago-goals/long/goal.md": goalText("small"),
		".vago-goals/long/tickets/01-long.md": ticketText("stuck", {
			runs: [runOf("branch", 0, 1), runOf("check", 1, 2, "exit 1")],
			body: `# Long\n\n${paragraphs.join("\n\n")}\n`,
		}),
		".vago-goals/long/tickets/02-short.md": titled("ready", "Short"),
		".vago-goals/long/logs/check-2.log": numberedLines(1, 60),
	});
	const { view } = await openFirstGoal(root);
	await frameWith(view, "│ line 1 ");
	return view;
}

const panes = ["Tickets", "Runs of Ticket 01", "Ticket 01", "Run 2 · 01 check"];

// The panes whose title is in the accent with the border around it, which
// share one span only when they share a colour.
function accented(view: TestRendererSetup): string[] {
	const accent = RGBA.fromHex("#ff8a3d");
	const spans = view.captureSpans().lines.flatMap((line) => line.spans);
	return panes.filter((title) =>
		spans.some(
			(span) => span.text.includes(`─ ${title} ─`) && span.fg.equals(accent),
		),
	);
}

// Renders frames until `check` passes on the view, and fails with the last
// frame after about three seconds.
async function until(
	view: TestRendererSetup,
	check: () => boolean,
): Promise<void> {
	for (let tries = 0; ; tries++) {
		await view.renderOnce();
		if (check()) return;
		if (tries === 300)
			throw new Error(`No frame passes:\n${view.captureCharFrame()}`);
		await Bun.sleep(10);
	}
}

test("Tab, Shift+Tab and 1-4 move focus, and only the focused pane is in the accent", async () => {
	const view = await openLongTicket();
	const focusIs = (title: string) =>
		until(view, () => accented(view).join() === title);
	await focusIs("Tickets");

	view.mockInput.pressTab();
	await focusIs("Runs of Ticket 01");
	view.mockInput.pressTab();
	view.mockInput.pressTab();
	await focusIs("Run 2 · 01 check");
	view.mockInput.pressTab();
	await focusIs("Tickets");
	view.mockInput.pressTab({ shift: true });
	await focusIs("Run 2 · 01 check");

	view.mockInput.pressKey("3");
	await focusIs("Ticket 01");
	view.mockInput.pressKey("2");
	await focusIs("Runs of Ticket 01");
	view.mockInput.pressKey("4");
	await focusIs("Run 2 · 01 check");
	view.mockInput.pressKey("1");
	await focusIs("Tickets");
});

test("↑↓ in the Runs pane move the Run", async () => {
	const view = await openLongTicket();

	view.mockInput.pressKey("2");
	view.mockInput.pressArrow("up");
	await frameWith(view, "─ Run 1 · 01 branch ─");
	view.mockInput.pressArrow("down");
	await frameWith(view, "─ Run 2 · 01 check ─");
});

test("↑↓ scroll the Ticket's text when the Ticket pane has focus", async () => {
	const view = await openLongTicket();

	view.mockInput.pressKey("3");
	for (let press = 0; press < 3; press++) view.mockInput.pressArrow("down");
	const scrolled = await frameWithout(view, "│ para 1 ");
	expect(scrolled).toContain("│ para 3 ");
	expect(scrolled).toContain(" 1/2 ");

	view.mockInput.pressArrow("up");
	await frameWith(view, "│ para 2 ");
});

test("↑↓ scroll the Run when the Run pane has focus", async () => {
	const view = await openLongTicket();

	view.mockInput.pressKey("4");
	for (let press = 0; press < 3; press++) view.mockInput.pressArrow("down");
	const scrolled = await frameWithout(view, "│ line 1 ");
	expect(scrolled).toContain("│ line 4 ");
	expect(scrolled).toContain(" 1/2 ");
	expect(scrolled).toContain("─ Run 2 · 01 check ─");

	view.mockInput.pressArrow("up");
	await frameWith(view, "│ line 3 ");
});

test("Space, PgDn and PgUp page the Run from the Tickets and Runs panes", async () => {
	const view = await openLongTicket();

	view.mockInput.pressKey(" ");
	const paged = await frameWithout(view, "│ line 1 ");
	expect(paged).toContain("│ para 1 ");

	view.mockInput.pressKey("2");
	view.mockInput.pressKey("\u001b[5~");
	await frameWith(view, "│ line 1 ");
	view.mockInput.pressKey("\u001b[6~");
	await frameWithout(view, "│ line 1 ");
});

test("t gives the Ticket the whole screen, which scrolls and keeps the focus, and Esc closes it", async () => {
	const view = await openLongTicket();

	view.mockInput.pressKey("t");
	const full = await frameWithout(view, "─ Tickets ─");
	expect(full).not.toContain("─ Run 2 · 01 check ─");
	expect(full).toContain("─ Ticket 01 ─");
	expect(full).toContain("│ para 10 ");

	view.mockInput.pressTab();
	view.mockInput.pressKey("1");
	view.mockInput.pressArrow("down");
	const scrolled = await frameWithout(view, "│ para 1 ");
	expect(scrolled).toContain("─ Ticket 01 ─");

	view.mockInput.pressEscape();
	const closed = await frameWith(view, "─ Tickets ─");
	expect(closed).toContain("─ Run 2 · 01 check ─");
	view.mockInput.pressEscape();
	await frameWith(view, "─ Goals ─");
});

test("r gives the Run the whole screen, which scrolls, and Esc closes it", async () => {
	const view = await openLongTicket();

	view.mockInput.pressKey("r");
	const full = await frameWithout(view, "─ Tickets ─");
	expect(full).not.toContain("─ Ticket 01 ─");
	expect(full).toContain("│ line 20 ");

	view.mockInput.pressArrow("down");
	await frameWithout(view, "│ line 1 ");

	view.mockInput.pressEscape();
	await frameWith(view, "─ Tickets ─");
});

test("[ and ] open the Goal before and after, stop at the ends, and Esc goes back to the one open", async () => {
	const root = await makeProject({
		".vago-goals/alpha/goal.md": goalText("w"),
		".vago-goals/beta/goal.md": goalText("w"),
		".vago-goals/gamma/goal.md": goalText("w"),
	});
	const view = await renderView(root);
	await frameWith(view, " 1/3 ");
	view.mockInput.pressEnter();
	await frameWith(view, "Goal 1/3 · ○ alpha");

	view.mockInput.pressKey("]");
	await frameWith(view, "Goal 2/3 · ○ beta");
	view.mockInput.pressKey("]");
	view.mockInput.pressKey("]");
	await frameWith(view, "Goal 3/3 · ○ gamma");
	view.mockInput.pressKey("[");
	await frameWith(view, "Goal 2/3 · ○ beta");

	view.mockInput.pressEscape();
	const back = await frameWith(view, "─ Goals ─");
	expect(back).toContain(" 2/3 ");
});

test("[ and ] pass over a broken Goal, which can't open", async () => {
	const root = await makeProject({
		".vago-goals/alpha/goal.md": goalText("w"),
		".vago-goals/bad/goal.md": "no header\n",
		".vago-goals/gamma/goal.md": goalText("w"),
	});
	const view = await renderView(root);
	await frameWith(view, " 1/3 ");
	view.mockInput.pressArrow("down");
	view.mockInput.pressEnter();
	await frameWith(view, "Goal 2/3 · ○ alpha");

	view.mockInput.pressKey("[");
	await Bun.sleep(50);
	await frameWith(view, "Goal 2/3 · ○ alpha");
	view.mockInput.pressKey("]");
	await frameWith(view, "Goal 3/3 · ○ gamma");
});

// The row and column of the frame where `text` first shows.
function placeOf(frame: string, text: string): { x: number; y: number } {
	const lines = frame.split("\n");
	const y = lines.findIndex((line) => line.includes(text));
	if (y === -1) throw new Error(`No line shows ${text}:\n${frame}`);
	return { x: lines[y]?.indexOf(text) ?? 0, y };
}

test("a click on a Ticket or a Run picks it and focuses its pane", async () => {
	const view = await openLongTicket();
	const frame = await frameWith(view, "02 Short");

	const ticket = placeOf(frame, "02 Short");
	await view.mockMouse.click(ticket.x, ticket.y);
	await frameWith(view, "─ Ticket 02 ─");
	await until(view, () => accented(view).join() === "Tickets");

	view.mockInput.pressArrow("up");
	const back = await frameWith(view, "─ Ticket 01 ─");
	const run = placeOf(back, "1  branch");
	await view.mockMouse.click(run.x, run.y);
	await frameWith(view, "─ Run 1 · 01 branch ─");
	await until(view, () => accented(view).join() === "Runs of Ticket 01");
});

test("a click in the Ticket or the Run pane focuses it", async () => {
	const view = await openLongTicket();
	const frame = view.captureCharFrame();

	const text = placeOf(frame, "para 2");
	await view.mockMouse.click(text.x, text.y);
	await until(view, () => accented(view).join() === "Ticket 01");
	const log = placeOf(frame, "line 2");
	await view.mockMouse.click(log.x, log.y);
	await until(view, () => accented(view).join() === "Run 2 · 01 check");
});

test("the wheel over the Ticket's text scrolls it, whatever has the focus", async () => {
	const view = await openLongTicket();
	const text = placeOf(view.captureCharFrame(), "para 2");

	for (let turn = 0; turn < 3; turn++)
		await view.mockMouse.scroll(text.x, text.y, "down");
	const scrolled = await frameWithout(view, "│ para 1 ");
	expect(scrolled).toContain("│ line 1 ");
	expect(accented(view)).toEqual(["Tickets"]);
});

test("while the keys show, a click beside them picks and focuses nothing", async () => {
	const view = await openLongTicket();
	view.mockInput.pressKey("?");
	const frame = await frameWith(view, " Keys ");

	const ticket = placeOf(frame, "02 Short");
	await view.mockMouse.click(ticket.x, ticket.y);
	await Bun.sleep(50);
	view.mockInput.pressEscape();
	await frameWithout(view, " Keys ");
	expect(await frameWith(view, "─ Ticket 01 ─")).toContain(" 1/2 ");
	expect(accented(view)).toEqual(["Tickets"]);
});

// Goal `small`, lost on its running Ticket 01, whose long title wraps, with
// a 60-line `check` log, before a blocked Ticket 02.
function lostGoalWithLongTitles(): Promise<string> {
	return makeProject({
		".vago/workflows/small.toml": workflowOf(
			"branch",
			"implement",
			"check",
			"review",
			"merge",
		),
		".vago-goals/small/goal.md": goalText(
			"small",
			"# A Goal with a long title that runs on and on\n",
		),
		".vago-goals/small/tickets/01-long.md": ticketText("running", {
			runs: [runOf("branch", 0, 1), runOf("check", 1)],
			body: "# A long Ticket title that wraps in a narrow pane\n\nSome text.\n",
		}),
		".vago-goals/small/tickets/02-short.md": titled("ready", "Short", {
			blockedBy: [1],
		}),
		".vago-goals/small/logs/check-2.log": numberedLines(1, 60),
	});
}

for (const size of [
	{ width: 60, height: 24 },
	{ width: 80, height: 24 },
]) {
	test(`at ${size.width}×${size.height} the Goal box keeps its border and nothing overlaps`, async () => {
		const { view } = await openFirstGoal(await lostGoalWithLongTitles(), size);
		const frame = await frameWith(view, "│ line 60 ");

		const lines = frame.split("\n");
		expect(lines[1]).toMatch(/^┌─ Goal 1\/1 · \? small ─+┐$/);
		expect(lines[2]).toMatch(/^│ █+ {2}0\/2 Tickets │$/);
		expect(lines[3]).toMatch(/^│ LOST {3}/);
		expect(lines[4]).toContain("No vago run process runs this Goal");
		expect(lines[5]).toMatch(/^├─ Tickets ─+┬─ Ticket 01 ─+┤$/);
		expect(frame).toContain("02 after 01");
		expect(frame).toContain("· merge");
		expect(frame).toContain("─ Runs of Ticket 01 ─");
		expect(frame).toContain("─ Run 2 · 01 check ─");
		for (const line of lines.slice(1, -2)) {
			expect(Bun.stringWidth(line)).toBe(size.width);
			expect(line).toMatch(/^[│┌└├].*[│┐┘┤]$/);
		}
		expect(lines.at(-2)).toContain("? Help");
	});
}

// The Goal view of the only Goal of the Project at `root`, under VAGO_ASCII,
// once a frame shows `text`.
async function openAsciiGoal(
	root: string,
	size: { width: number; height: number },
	text: string,
): Promise<{ view: TestRendererSetup; frame: string }> {
	const view = await renderView(root, size);
	await frameWith(view, "- 1/1 -");
	view.mockInput.pressEnter();
	return { view, frame: await frameWith(view, text) };
}

test("under VAGO_ASCII=1 every symbol, bar, border and activity line is ASCII", async () => {
	setEnv({ VAGO_ASCII: "1" });
	const agent = await makeProject({
		".vago-goals/agent/goal.md": goalText("small"),
		".vago-goals/agent/tickets/01-only.md": ticketText("done", {
			runs: [{ ...runOf("implement", 0, 9), costUsd: 0.09, model: "opus" }],
		}),
		".vago-goals/agent/logs/implement-1.jsonl": await Bun.file(
			join(import.meta.dir, "fixtures", "claude-code-parallel-calls.jsonl"),
		).text(),
	});
	const { view, frame } = await openAsciiGoal(
		agent,
		{ width: 120, height: 60 },
		"Run finished",
	);
	expect(frame).toMatch(onlyAscii);
	expect(frame).toContain("Goal 1/1 | + agent");
	view.mockInput.pressKey("?");
	expect(await frameWith(view, " Keys ")).toMatch(onlyAscii);

	const small = await openAsciiGoal(
		await lostGoalWithLongTitles(),
		{ width: 80, height: 24 },
		"| line 60 ",
	);
	expect(small.frame).toMatch(onlyAscii);
	expect(small.frame).toContain(" Goal 1/1 | ? small");
});

test("under NO_COLOR every text takes the terminal's own colours, and the selected Ticket is inverse", async () => {
	setEnv({ NO_COLOR: "1" });
	const { view } = await openAgentRun("claude-code-parallel-calls.jsonl", {
		size: { width: 120, height: 60 },
	});
	await frameWith(view, "Run finished");

	const spans = view
		.captureSpans()
		.lines.flatMap((line) => line.spans)
		.filter((span) => span.text.trim() !== "");
	expect(
		spans.filter((span) => span.fg.intent !== "default").map((s) => s.text),
	).toEqual([]);
	expect(
		spanWith(view, "✓ 01 A Ticket").attributes & TextAttributes.INVERSE,
	).toBe(TextAttributes.INVERSE);
});

test("under NO_COLOR the focused pane's border is heavy, its only mark", async () => {
	setEnv({ NO_COLOR: "1" });
	const view = await openLongTicket();
	expect(view.captureCharFrame()).toContain("┣━ Tickets ━");
	view.mockInput.pressKey("4");
	const frame = await frameWith(view, "┣━ Run 2 · 01 check ━");
	expect(frame).toContain("├─ Tickets ─");

	setEnv({ VAGO_ASCII: "1" });
	const ascii = await renderView(await stuckGoal(), roomy);
	await frameWith(ascii, "- 1/1 -");
	ascii.mockInput.pressEnter();
	const asciiFrame = await frameWith(ascii, "#= Tickets =");
	expect(asciiFrame).toContain("- Ticket 02 -");
});

test("a Runs pane too narrow for its Ticket's number is titled Runs", async () => {
	const { frame } = await openTicket(ticketText("ready"), {
		size: { width: 50, height: 24 },
	});

	expect(frame).toMatch(/├─ Runs ─+ 1\/1 ─┤/);
});

test("s on a running Goal says it is running and starts nothing", async () => {
	const root = await makeProject({
		".vago-goals/a/goal.md": goalText("w"),
		".vago-goals/a/tickets/01-t.md": ticketText("running", {
			runs: [{ step: "work", started: at("10:00") }],
		}),
	});
	await heldLock(root, "a");
	const ticket = await Bun.file(
		join(root, ".vago-goals/a/tickets/01-t.md"),
	).text();
	const view = await renderView(root);
	await frameWith(view, " 1/1 ");
	view.mockInput.pressEnter();
	await frameWith(view, "Goal 1/1");

	view.mockInput.pressKey("s");

	expect(
		await frameWith(view, "a is running; only a ready Goal starts"),
	).toBeDefined();
	await Bun.sleep(1000);
	expect(
		await Bun.file(join(root, ".vago-goals/a/tickets/01-t.md")).text(),
	).toBe(ticket);
});
