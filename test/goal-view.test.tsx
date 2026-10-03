import { expect, test } from "bun:test";
import { TextAttributes } from "@opentui/core";
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
	expect(lines[title + 3]).toContain(
		"│ The first paragraph is hard-wrapped here. ",
	);
	expect(lines[title + 4]).toMatch(/│ +│$/);
	expect(lines[title + 5]).toContain("│ A second one. ");
	expect(third).toContain(" 3/4 ");

	view.mockInput.pressKey("k");
	view.mockInput.pressKey("k");
	view.mockInput.pressKey("k");
	expect(await frameWith(view, "─ Ticket 01 ─")).toContain(" 1/4 ");
});

test("the footer names the Goal view's keys, and ? shows them all", async () => {
	const { view, frame } = await openFirstGoal(await runningGoal());
	expect(frame.trimEnd().split("\n").at(-1)).toMatch(
		/^ ↑↓ Ticket {3}Esc Goals {3}\? Help {3}q Quit *$/,
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
