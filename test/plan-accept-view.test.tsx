import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import type { TestRendererSetup } from "@opentui/core/testing";
import {
	type FakeInteractiveHarness,
	makeFakeInteractiveClaude,
} from "./fake-harness.ts";
import { goalText, makeProject, oneStep, ticketText } from "./project.ts";
import { frameWith, frameWithout, renderView } from "./view-render.tsx";

const wide = { width: 140, height: 40 };

const item = ".vago-goals/search";

// A chat whose turns sent `messages`, each ended `ok` after a minute and
// costing $0.25, with no logs.
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
			"cost_usd = 0.25",
			`log = "logs/turn-0${index + 1}.jsonl"`,
		);
	}
	return `${lines.join("\n")}\n`;
}

// A `proposal.toml` recommending Workflow `small`, whose second Ticket is
// blocked by `blocker`.
function proposalToml(blocker = 1): string {
	return `turn = 1
workflow = "small"
open_decisions = []
goal = """
# Search ranks by relevance
"""

[[tickets]]
slug = "score"
blocked_by = []
body = """
# Score each result
"""

[[tickets]]
slug = "rank-by-score"
blocked_by = [ ${blocker} ]
body = """
# Rank results by score
"""
`;
}

// A Project with Workflows `small` and `try-hard` and planning item `search`
// holding `files` under its `planning/` folder, a chat of one turn and a
// ready Proposal unless `files` says otherwise. Its root is a real path, as
// the TUI's is, so the paths in a refusal show relative to it.
async function planningProject(
	files: Record<string, string> = {},
): Promise<string> {
	const planning = {
		"chat.toml": chatToml(["Plan search"]),
		"proposal.toml": proposalToml(),
		...files,
	};
	const root = await makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago/workflows/small.toml": oneStep("true"),
		".vago/workflows/try-hard.toml": oneStep("true"),
		...Object.fromEntries(
			Object.entries(planning).map(([path, text]) => [
				`${item}/planning/${path}`,
				text,
			]),
		),
	});
	return realpath(root);
}

// The Project at `root` in a view of `size`, whose planning sessions run
// `fake`, a fake `claude` made here unless given.
async function acceptView(
	root: string,
	size = wide,
	fake?: FakeInteractiveHarness,
): Promise<TestRendererSetup> {
	const harness = fake ?? (await makeFakeInteractiveClaude());
	return renderView(root, size, harness.env);
}

// Opens the only planning item of the Project shown in `view` and focuses
// its Preview once the Proposal shows.
async function openPreview(view: TestRendererSetup): Promise<void> {
	await frameWith(view, " 1/1 ");
	view.mockInput.pressEnter();
	await frameWith(view, "02 Rank results by score");
	view.mockInput.pressKey("]", { ctrl: true });
	await frameWith(view, "w Workflow");
}

function exists(root: string, path: string): boolean {
	return existsSync(join(root, item, path));
}

test("a accepts the Proposal as a ready Goal that s starts", async () => {
	const root = await planningProject();
	const view = await acceptView(root);
	await openPreview(view);
	expect(await frameWith(view, "a Accept")).toContain("a Accept");

	await view.mockInput.typeText("a");
	const question = await frameWith(view, "y accepts");
	expect(question).toContain("small");
	expect(question).toContain("recommended by the agent");
	expect(question).toContain("2 Tickets");
	await view.mockInput.typeText("y");

	await frameWith(
		view,
		"Accepted search as a ready Goal with 2 Tickets; s starts it",
	);
	const goals = await frameWith(view, "1 ready · 0 running");
	expect(goals).toContain("s starts it");
	const row = goals.split("\n").find((line) => line.includes("search"));
	expect(row).toContain("ready");
	expect(exists(root, "goal.md")).toBe(true);
	expect(exists(root, "tickets/01-score.md")).toBe(true);
	expect(exists(root, "tickets/02-rank-by-score.md")).toBe(true);
	await view.mockInput.typeText("j");
	expect(await frameWith(view, "s Start")).toContain("s Start");
});

test("the question counts one Ticket as one", async () => {
	const [oneTicket = ""] = proposalToml().split(
		'\n[[tickets]]\nslug = "rank-by-score"',
	);
	const root = await planningProject({ "proposal.toml": oneTicket });
	const view = await acceptView(root);
	await frameWith(view, " 1/1 ");
	view.mockInput.pressEnter();
	await frameWith(view, "01 Score each result");
	view.mockInput.pressKey("]", { ctrl: true });
	await frameWith(view, "a Accept");

	await view.mockInput.typeText("a");

	expect(await frameWith(view, "y accepts")).toContain(
		"and 1 Ticket? y accepts",
	);
});

test("a on a Proposal that isn't ready says why and accepts nothing", async () => {
	const root = await planningProject({ "proposal.toml": proposalToml(2) });
	const view = await acceptView(root);
	await openPreview(view);

	await view.mockInput.typeText("a");

	const frame = await frameWith(view, "Not ready to accept: ");
	expect(frame).toContain("blocked by 2");
	expect(frame).not.toContain("y accepts");
	await Bun.sleep(300);
	expect(exists(root, "goal.md")).toBe(false);
});

test("a key other than y cancels the question", async () => {
	const root = await planningProject();
	const view = await acceptView(root);
	await openPreview(view);
	await view.mockInput.typeText("a");
	await frameWith(view, "y accepts");

	await view.mockInput.typeText("n");

	await frameWithout(view, "y accepts");
	await Bun.sleep(300);
	expect(exists(root, "goal.md")).toBe(false);
	expect(await frameWith(view, "a Accept")).toContain("Preview");
});

test("a refusal from vago plan accept shows in the open planning view, and the session resumes", async () => {
	const root = await planningProject();
	const view = await acceptView(root);
	await openPreview(view);
	const id = /fake claude fresh (\S+)/.exec(
		await frameWith(view, "fake claude fresh"),
	)?.[1];
	await Bun.write(join(root, ".vago/workflows/small.toml"), "steps = [");

	await view.mockInput.typeText("a");
	await frameWith(view, "y accepts");
	await view.mockInput.typeText("y");

	const frame = await frameWith(view, "small.toml");
	expect(frame).not.toContain(root);
	expect(frame).not.toContain("vago:");
	expect(frame).toContain("02 Rank results by score");
	expect(exists(root, "goal.md")).toBe(false);
	await frameWith(view, `fake claude resumed ${id}`);
});

test("accepting from the view starts nothing", async () => {
	const root = await planningProject();
	const view = await acceptView(root);
	await openPreview(view);
	await view.mockInput.typeText("a");
	await frameWith(view, "y accepts");
	await view.mockInput.typeText("y");
	await frameWith(view, "s starts it");

	// Past the Goals list's next re-read.
	await Bun.sleep(1200);
	const frame = await frameWith(view, "search");
	const row = frame.split("\n").find((line) => line.includes("search"));
	expect(row).toContain("ready");
	expect(row).not.toContain("running");
	expect(frame).toContain("1 ready · 0 running");
	expect(exists(root, "running.lock")).toBe(false);
});

// Wide enough for the Goal view's footer to keep every key.
const wider = { width: 180, height: 40 };

// A Project whose Goal `search` was accepted from its planning item, its
// chat and Proposal kept in `planning/`, unless `planned` is false.
async function acceptedProject(planned = true): Promise<string> {
	const root = await planningProject();
	await Bun.write(join(root, item, "goal.md"), goalText("small"));
	await Bun.write(join(root, item, "tickets/01-score.md"), ticketText("ready"));
	if (!planned) await rm(join(root, item, "planning"), { recursive: true });
	return root;
}

// Opens the only Goal of the Project shown in `view` in the Goal view.
async function openGoal(view: TestRendererSetup): Promise<string> {
	await frameWith(view, " 1/1 ");
	view.mockInput.pressEnter();
	return frameWith(view, "Tab Pane");
}

test("p opens an accepted Goal's planning item, with no session", async () => {
	const root = await acceptedProject();
	const fake = await makeFakeInteractiveClaude();
	const view = await acceptView(root, wider, fake);
	expect(await openGoal(view)).toContain("p Planning");

	await view.mockInput.typeText("p");

	await frameWith(view, "Accepted as a Goal.");
	const preview = await frameWith(view, "02 Rank results by score");
	const titles = preview.split("\n").find((line) => line.includes("Preview"));
	expect(titles).toContain("accepted");
	// The Goal's build spend leaves its planning out.
	expect(preview).toContain("$0.00 spent");
	const chatBefore = await Bun.file(
		join(root, item, "planning/chat.toml"),
	).text();
	const footer = await frameWith(view, "Esc Back");
	expect(footer).not.toContain("Ctrl-] Session");
	expect(footer).not.toContain("a Accept");
	expect(footer).not.toContain("w Workflow");
	await view.mockInput.typeText("a");
	await view.mockInput.typeText("y");
	await Bun.sleep(300);
	expect(await frameWith(view, "Esc Back")).not.toContain("y accepts");
	expect(await Bun.file(join(root, item, "planning/chat.toml")).text()).toBe(
		chatBefore,
	);
	expect(existsSync(join(root, item, "tickets/02-rank-by-score.md"))).toBe(
		false,
	);
	expect(await fake.calls()).toEqual([]);
	view.mockInput.pressEscape();
	await frameWith(view, "p Planning");
});

test("a Goal made without planning offers no planning chat", async () => {
	const view = await acceptView(await acceptedProject(false), wider);

	expect(await openGoal(view)).not.toContain("p Planning");
});

test("in the session a types and asks nothing", async () => {
	const root = await planningProject();
	const view = await acceptView(root);
	await frameWith(view, " 1/1 ");
	view.mockInput.pressEnter();
	await frameWith(view, "fake claude fresh");

	await view.mockInput.typeText("a");

	const frame = await frameWith(view, "key a");
	expect(frame).not.toContain("y accepts");
});
