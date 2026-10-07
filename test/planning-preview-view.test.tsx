import { expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { makeFakeInteractiveClaude } from "./fake-harness.ts";
import { makeProject } from "./project.ts";
import { bgAt, frameWith, frameWithout, renderView } from "./view-render.tsx";

const wide = { width: 120, height: 40 };

// The chat of an item planned on Claude Code.
const chatToml = 'harness = "claude-code"\n';

// A `proposal.toml` recommending Workflow `workflow`, whose second Ticket
// is blocked by `blocker`.
function proposalToml(
	options: { workflow?: string; blocker?: number } = {},
): string {
	return `workflow = "${options.workflow ?? "small"}"
workflow_reason = "One module and its tests."
open_decisions = [ "Should ties break by name?" ]
goal = """
# Search ranks by relevance

Results come back
best first.
"""

[[tickets]]
slug = "score"
blocked_by = [ ${options.blocker === 2 ? 2 : ""} ]
body = """
# Score each result
Give each result a score.
"""

[[tickets]]
slug = "rank-by-score"
blocked_by = [ ${options.blocker === 2 ? "" : (options.blocker ?? 1)} ]
body = """
# Rank results by score
Sort by the score.
"""
`;
}

// A Project with Workflows `small` and `try-hard` and planning item `search`
// holding `files` under its `planning/` folder.
function planningProject(files: Record<string, string>): Promise<string> {
	return makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago/workflows/small.toml": "",
		".vago/workflows/try-hard.toml": "",
		".vago-goals/search/planning/.keep": "",
		...Object.fromEntries(
			Object.entries(files).map(([path, text]) => [
				`.vago-goals/search/planning/${path}`,
				text,
			]),
		),
	});
}

// The Project at `root` in a wide view, whose planning sessions run a fake
// `claude`.
async function previewView(root: string): Promise<TestRendererSetup> {
	const fake = await makeFakeInteractiveClaude();
	return renderView(root, wide, fake.env);
}

// As `previewView`, on a screen too short for a long Preview.
async function shortPreviewView(root: string): Promise<TestRendererSetup> {
	const fake = await makeFakeInteractiveClaude();
	return renderView(root, { width: 120, height: 20 }, fake.env);
}

// Opens the only planning item of the Project shown in `view`.
async function openOnlyItem(view: TestRendererSetup): Promise<void> {
	await frameWith(view, " 1/1 ");
	view.mockInput.pressEnter();
}

// Moves the focus from the session to the Preview.
function focusPreview(view: TestRendererSetup): void {
	view.mockInput.pressKey("]", { ctrl: true });
}

test("the Preview beside the session shows the Goal, its Tickets in order, blockers and the Workflow", async () => {
	const root = await planningProject({
		"chat.toml": chatToml,
		"proposal.toml": proposalToml(),
	});
	const view = await previewView(root);

	await openOnlyItem(view);

	const frame = await frameWith(view, "ready to accept");
	const titles = frame.split("\n").find((line) => line.includes("Preview"));
	expect(titles).toContain("search");
	expect(frame).toContain("Search ranks by relevance");
	expect(frame).toContain("Results come back best first.");
	expect(frame).toContain("small, recommended: One module and its tests.");
	expect(frame).toContain("Should ties break by name?");
	const first = frame.indexOf("01 Score each result");
	const second = frame.indexOf("02 Rank results by score");
	expect(first).toBeGreaterThan(-1);
	expect(second).toBeGreaterThan(first);
	expect(frame).toContain("Give each result a score.");
	expect(frame).toContain("Sort by the score.");
	expect(frame.slice(second)).toContain("blocked by 01");
	expect(frame.slice(first, second)).toContain("no blockers");
});

test("a Proposal with a later blocker or an unknown Workflow is not ready and says why", async () => {
	for (const [proposal, problem] of [
		[proposalToml({ blocker: 2 }), "Ticket 01 score is blocked by 2"],
		[proposalToml({ workflow: "huge" }), 'Workflow "huge" isn\'t one of'],
	] as const) {
		const root = await planningProject({
			"chat.toml": chatToml,
			"proposal.toml": proposal,
		});
		const view = await previewView(root);

		await openOnlyItem(view);

		const frame = await frameWith(view, "not ready");
		expect(frame).not.toContain("ready to accept");
		expect(frame).toContain(problem);
	}
});

test("w in the Preview picks another Workflow, which stays after a fresh render", async () => {
	const root = await planningProject({
		"chat.toml": chatToml,
		"proposal.toml": proposalToml(),
	});
	const view = await previewView(root);
	await openOnlyItem(view);
	await frameWith(view, "small, recommended");

	focusPreview(view);
	await frameWith(view, "w Workflow");
	await view.mockInput.typeText("w");
	await frameWith(view, "try-hard");
	view.mockInput.pressArrow("down");
	view.mockInput.pressEnter();

	const chosen = "try-hard, chosen; small recommended";
	await frameWith(view, chosen);
	view.renderer.destroy();
	const fresh = await previewView(root);
	await openOnlyItem(fresh);
	await frameWith(fresh, chosen);
});

test("a revision recommending another Workflow keeps the human's choice", async () => {
	const root = await planningProject({
		"chat.toml": chatToml,
		"workflow.toml": 'workflow = "try-hard"\n',
		"proposal.toml": proposalToml({ workflow: "small" }),
	});
	const view = await previewView(root);

	await openOnlyItem(view);

	await frameWith(view, "try-hard, chosen; small recommended");
});

test("a revision saved while the view is open replaces the Preview", async () => {
	const root = await planningProject({
		"chat.toml": chatToml,
		"proposal.toml": proposalToml(),
	});
	const view = await previewView(root);
	await openOnlyItem(view);
	await frameWith(view, "02 Rank results by score");

	const planning = `${root}/.vago-goals/search/planning`;
	await Bun.write(`${planning}/chat.toml`, chatToml);
	await Bun.write(
		`${planning}/proposal.toml`,
		proposalToml().replace(
			/\[\[tickets\]\]\nslug = "rank-by-score"[\s\S]*$/,
			"",
		),
	);

	const revised = await frameWithout(view, "02 Rank results by score");
	expect(revised).toContain("01 Score each result");
});

test("a reopened item shows its saved Proposal, and one with none says so", async () => {
	const saved = await planningProject({
		"chat.toml": chatToml,
		"proposal.toml": proposalToml(),
	});
	const first = await previewView(saved);
	await openOnlyItem(first);
	await frameWith(first, "02 Rank results by score");
	first.renderer.destroy();

	const reopened = await previewView(saved);
	await openOnlyItem(reopened);

	await frameWith(reopened, "02 Rank results by score");
	const empty = await previewView(
		await planningProject({ "chat.toml": chatToml }),
	);
	await openOnlyItem(empty);
	await frameWith(empty, "No proposal yet.");
	focusPreview(empty);
	expect(await frameWith(empty, "q Quit")).not.toContain("w Workflow");
});

test("a bad proposal.toml says why", async () => {
	const root = await planningProject({
		"chat.toml": chatToml,
		"proposal.toml": "workflow = ",
	});
	const view = await previewView(root);

	await openOnlyItem(view);
	focusPreview(view);

	await frameWith(view, "proposal.toml isn't valid TOML");
});

// A Proposal whose Goal runs `paragraphs` paragraphs, `para 1` first, so
// the Preview overflows a short screen.
function longProposalToml(paragraphs: number): string {
	const goal = Array.from(
		{ length: paragraphs },
		(_, index) => `para ${index + 1}`,
	).join("\n\n");
	return proposalToml().replace(
		"Results come back\nbest first.",
		`Results come back\nbest first.\n\n${goal}`,
	);
}

// The Preview of a Proposal longer than the screen, clicked and then
// focused, with the picker open on its recommended Workflow.
async function pickerOverLongPreview(): Promise<TestRendererSetup> {
	const root = await planningProject({
		"chat.toml": chatToml,
		"proposal.toml": longProposalToml(30),
	});
	const view = await shortPreviewView(root);
	await openOnlyItem(view);
	const frame = await frameWith(view, "para 1");
	const lines = frame.split("\n");
	const y = lines.findIndex((line) => line.includes("para 1"));
	await view.mockMouse.click(lines[y]?.indexOf("para 1") ?? 0, y);
	focusPreview(view);
	await frameWith(view, "w Workflow");
	await view.mockInput.typeText("w");
	await frameWith(view, "try-hard");
	return view;
}

test("with the picker open, ↑↓ move its choice and the Preview stays still", async () => {
	const view = await pickerOverLongPreview();
	const selected = bgAt(view, "small, recommended");
	const opened = view.captureCharFrame();

	view.mockInput.pressArrow("down");
	await view.renderOnce();

	expect(view.captureCharFrame()).toBe(opened);
	expect(bgAt(view, "try-hard").equals(selected)).toBe(true);
	expect(bgAt(view, "small, recommended").equals(selected)).toBe(false);
	view.mockInput.pressArrow("up");
	await view.renderOnce();
	expect(bgAt(view, "small, recommended").equals(selected)).toBe(true);
});

test("with the picker open, PgDn and the wheel never hide it", async () => {
	const view = await pickerOverLongPreview();
	const frame = view.captureCharFrame();
	const lines = frame.split("\n");
	const y = lines.findIndex((line) => line.includes("para 1"));

	view.mockInput.pressKey("\u001b[6~");
	for (let turn = 0; turn < 10; turn++) {
		await view.mockMouse.scroll(lines[y]?.indexOf("para 1") ?? 0, y, "down");
	}
	view.mockInput.pressKey("\u001b[5~");
	view.mockInput.pressKey("\u001b[6~");
	await view.renderOnce();

	const scrolled = view.captureCharFrame();
	expect(scrolled).toContain("Choose the Workflow:");
	expect(scrolled).toContain("small, recommended");
	expect(scrolled).toContain("try-hard");
	view.mockInput.pressEscape();
	await frameWithout(view, "Choose the Workflow:");
});

test("with the picker closed, ↓ and PgDn scroll the Preview", async () => {
	const root = await planningProject({
		"chat.toml": chatToml,
		"proposal.toml": longProposalToml(30),
	});
	const view = await shortPreviewView(root);
	await openOnlyItem(view);
	await frameWith(view, "para 1");
	focusPreview(view);
	await frameWith(view, "w Workflow");

	view.mockInput.pressArrow("down");
	await frameWithout(view, "small, recommended");
	view.mockInput.pressKey("\u001b[6~");
	// The trailing space tells "para 1" from "para 10" and on.
	await frameWithout(view, "para 1 ");
});
