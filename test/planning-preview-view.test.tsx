import { expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { makeFakeInteractiveClaude } from "./fake-harness.ts";
import { makeProject } from "./project.ts";
import { frameWith, frameWithout, renderView } from "./view-render.tsx";

const wide = { width: 120, height: 40 };

// A chat whose turns sent `messages`, each ended `ok`, with no logs.
function chatToml(messages: string[]): string {
	const lines = ['harness = "claude-code"'];
	for (const [index, message] of messages.entries()) {
		lines.push(
			"",
			"[[turns]]",
			`message = ${JSON.stringify(message)}`,
			"started = 2026-10-06T10:00:00.000Z",
			"ended = 2026-10-06T10:01:00.000Z",
			'outcome = "ok"',
			`log = "logs/turn-0${index + 1}.jsonl"`,
		);
	}
	return `${lines.join("\n")}\n`;
}

// A `proposal.toml` from turn `turn`, recommending Workflow `workflow`,
// whose second Ticket is blocked by `blocker`.
function proposalToml(
	options: { turn?: number; workflow?: string; blocker?: number } = {},
): string {
	return `turn = ${options.turn ?? 1}
workflow = "${options.workflow ?? "small"}"
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
		"chat.toml": chatToml(["Plan search"]),
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
			"chat.toml": chatToml(["Plan search"]),
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
		"chat.toml": chatToml(["Plan search"]),
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
		"chat.toml": chatToml(["Plan search", "Revise it"]),
		"workflow.toml": 'workflow = "try-hard"\n',
		"proposal.toml": proposalToml({ turn: 2, workflow: "small" }),
	});
	const view = await previewView(root);

	await openOnlyItem(view);

	await frameWith(view, "try-hard, chosen; small recommended");
});

test("a revision saved while the view is open replaces the Preview", async () => {
	const root = await planningProject({
		"chat.toml": chatToml(["Plan search"]),
		"proposal.toml": proposalToml(),
	});
	const view = await previewView(root);
	await openOnlyItem(view);
	await frameWith(view, "02 Rank results by score");

	const planning = `${root}/.vago-goals/search/planning`;
	await Bun.write(
		`${planning}/chat.toml`,
		chatToml(["Plan search", "Merge them"]),
	);
	await Bun.write(
		`${planning}/proposal.toml`,
		proposalToml({ turn: 2 }).replace(
			/\[\[tickets\]\]\nslug = "rank-by-score"[\s\S]*$/,
			"",
		),
	);

	const revised = await frameWithout(view, "02 Rank results by score");
	expect(revised).toContain("01 Score each result");
});

test("a reopened item shows its saved Proposal, and one with none says so", async () => {
	const saved = await planningProject({
		"chat.toml": chatToml(["Plan search"]),
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
		await planningProject({ "chat.toml": chatToml(["Plan search"]) }),
	);
	await openOnlyItem(empty);
	await frameWith(empty, "No proposal yet.");
	focusPreview(empty);
	expect(await frameWith(empty, "q Quit")).not.toContain("w Workflow");
});

test("a bad proposal.toml says why", async () => {
	const root = await planningProject({
		"chat.toml": chatToml(["Plan search"]),
		"proposal.toml": "turn = ",
	});
	const view = await previewView(root);

	await openOnlyItem(view);
	focusPreview(view);

	await frameWith(view, "proposal.toml isn't valid TOML");
});
