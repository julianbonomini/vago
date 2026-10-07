import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { TestRendererSetup } from "@opentui/core/testing";
import {
	goalText,
	heldLock,
	makeProject,
	oneStep,
	ticketText,
} from "./project.ts";
import { frameWith, frameWithout, renderView } from "./view-render.tsx";

// The files of planning item `name`, as `vago plan new` makes it.
const planningItem = (name: string) => ({
	[`.vago-goals/${name}/planning/.keep`]: "",
});

const readyGoal = {
	".vago-goals/ready/goal.md": goalText("w"),
	".vago-goals/ready/tickets/01-t.md": ticketText("ready"),
};

// The frame's line that shows the row of `name` in the Goals table, the
// only lines with the name and a Ticket bar.
function rowOf(frame: string, name: string): string {
	const row = frame
		.split("\n")
		.find((line) => line.includes(` ${name} `) && line.includes("━"));
	if (row === undefined) throw new Error(`No row shows ${name}:\n${frame}`);
	return row;
}

// Presses ↓ until the row of `name` is the selected one, whose name then
// starts the preview's title row.
async function selectRow(view: TestRendererSetup, name: string) {
	const previewTitle = new RegExp(`^  ${name} .*Workflow`, "m");
	view.mockInput.pressKey("g");
	for (let tries = 0; tries < 10; tries++) {
		await view.renderOnce();
		if (previewTitle.test(view.captureCharFrame())) return;
		view.mockInput.pressArrow("down");
	}
	throw new Error(`Can't select ${name}:\n${view.captureCharFrame()}`);
}

test("a planning item is a planning row in the Goals list, beside the Goals", async () => {
	const root = await makeProject({ ...planningItem("search"), ...readyGoal });
	const view = await renderView(root);

	const frame = await frameWith(view, " 1/2 ");

	expect(rowOf(frame, "search")).toMatch(/planning +search /);
	expect(rowOf(frame, "ready")).toMatch(/ready +ready /);
});

// The `chat.toml` of a planning item whose one turn ended with `outcome`, or
// is still open without one.
function oneTurnChat(outcome?: string): string {
	const ended =
		outcome === undefined
			? ""
			: `ended = 2026-10-06T10:01:00.000Z\noutcome = "${outcome}"\n`;
	return `harness = "claude-code"

[[turns]]
message = "Plan search"
started = 2026-10-06T10:00:00.000Z
log = "logs/turn-01.jsonl"
${ended}`;
}

// A `proposal.toml` of one Ticket recommending Workflow `small`.
const readyProposal = `turn = 1
workflow = "small"
goal = """
# Search
"""

[[tickets]]
slug = "score"
body = """
# Score each result
"""
`;

test("each planning row says what its chat is doing or waiting for", async () => {
	const chat = (name: string, files: Record<string, string>) =>
		Object.fromEntries(
			Object.entries(files).map(([path, text]) => [
				`.vago-goals/${name}/planning/${path}`,
				text,
			]),
		);
	const root = await makeProject({
		".vago/workflows/small.toml": oneStep("true"),
		...planningItem("fresh"),
		...chat("working", { "chat.toml": oneTurnChat() }),
		...chat("cut-off", { "chat.toml": oneTurnChat() }),
		...chat("asked", { "chat.toml": oneTurnChat("ok") }),
		...chat("failed", { "chat.toml": oneTurnChat("exit 1") }),
		...chat("proposed", {
			"chat.toml": oneTurnChat("ok"),
			"proposal.toml": readyProposal,
		}),
	});
	await heldLock(root, "working");
	const view = await renderView(root, { width: 120, height: 40 });

	const frame = await frameWith(view, "proposal ready");

	expect(rowOf(frame, "fresh")).toContain("no chat yet");
	expect(rowOf(frame, "working")).toContain("agent working");
	expect(rowOf(frame, "cut-off")).toContain("response interrupted");
	expect(rowOf(frame, "asked")).toContain("waiting for your reply");
	expect(rowOf(frame, "failed")).toContain("response failed");
	expect(rowOf(frame, "proposed")).toContain("proposal ready");
	// The build Runs' columns: a planning item has none.
	expect(rowOf(frame, "asked")).not.toContain("$0.00");
});

test("n asks for a name and opens a new planning item, which Esc leaves in the list", async () => {
	const root = await makeProject(readyGoal);
	const view = await renderView(root);
	await frameWith(view, " 1/1 ");

	view.mockInput.pressKey("n");
	await frameWith(view, "New Goal name:");
	await view.mockInput.typeText("search");
	view.mockInput.pressEnter();

	const opened = await frameWith(view, "No messages yet.");
	expect(opened).toContain(" search ");
	expect(await readdir(join(root, ".vago-goals"))).toContain("search");
	view.mockInput.pressEscape();
	const list = await frameWithout(view, "No messages yet.");
	expect(rowOf(list, "search")).toContain("planning");
	expect(list).toContain(" 1/2 ");
	expect(existsSync(join(root, ".vago-goals/search/goal.md"))).toBe(false);
});

test("the name takes the keys the Goals list uses, and Esc makes nothing", async () => {
	const root = await makeProject(readyGoal);
	const view = await renderView(root);
	await frameWith(view, " 1/1 ");

	view.mockInput.pressKey("n");
	await frameWith(view, "New Goal name:");
	await view.mockInput.typeText("sjkgdn");
	const typed = await frameWith(view, "sjkgdn");
	expect(typed).not.toContain("Started vago run");
	view.mockInput.pressEscape();

	await frameWithout(view, "New Goal name:");
	expect(await readdir(join(root, ".vago-goals"))).toEqual(["ready"]);
});

test("a name already taken is refused with the reason, and the prompt stays", async () => {
	const root = await makeProject(readyGoal);
	const view = await renderView(root);
	await frameWith(view, " 1/1 ");

	view.mockInput.pressKey("n");
	await frameWith(view, "New Goal name:");
	await view.mockInput.typeText("ready");
	view.mockInput.pressEnter();

	const refused = await frameWith(view, "ready already exists");
	expect(refused).toContain("New Goal name:");
	expect(existsSync(join(root, ".vago-goals/ready/planning"))).toBe(false);
});

// The `chat.toml` of planning item `name` of the Project at `root`.
function chatOf(root: string, name: string): Promise<string> {
	return Bun.file(join(root, `.vago-goals/${name}/planning/chat.toml`)).text();
}

test("New Goal picks Claude Code or Codex with Tab, Claude Code by default", async () => {
	const root = await makeProject(readyGoal);
	const view = await renderView(root, undefined, {}, ["claude-code", "codex"]);
	await frameWith(view, " 1/1 ");

	view.mockInput.pressKey("n");
	const asked = await frameWith(view, "New Goal name:");
	expect(asked).toContain("[Claude Code] Codex");
	expect(asked).toContain("Tab Harness");
	await view.mockInput.typeText("search");
	view.mockInput.pressEnter();
	await frameWith(view, "No messages yet.");
	view.mockInput.pressEscape();
	await frameWithout(view, "No messages yet.");
	view.mockInput.pressKey("n");
	await frameWith(view, "New Goal name:");
	view.mockInput.pressTab();
	await frameWith(view, "Claude Code [Codex]");
	await view.mockInput.typeText("ideas");
	view.mockInput.pressEnter();

	await frameWith(view, "No messages yet.");
	expect(await chatOf(root, "search")).toContain('harness = "claude-code"');
	expect(await chatOf(root, "ideas")).toContain('harness = "codex"');
});

test("New Goal offers no choice when one Harness can plan", async () => {
	const root = await makeProject(readyGoal);
	const view = await renderView(root, undefined, {}, ["codex"]);
	await frameWith(view, " 1/1 ");

	view.mockInput.pressKey("n");
	const asked = await frameWith(view, "New Goal name:");
	await view.mockInput.typeText("search");
	view.mockInput.pressEnter();

	await frameWith(view, "No messages yet.");
	expect(asked).not.toContain("Codex");
	expect(asked).not.toContain("Tab");
	expect(await chatOf(root, "search")).toContain('harness = "codex"');
});

test("a Project with no Goals offers the New Goal action", async () => {
	const root = await makeProject({});
	const view = await renderView(root);

	const frame = await frameWith(view, " 0/0 ");

	expect(frame).toContain("No Goals yet. Press n for a New Goal.");
	expect(frame).toContain("n New Goal");
	view.mockInput.pressKey("n");
	await frameWith(view, "New Goal name:");
});

test("a planning item opens again after the TUI closes and opens", async () => {
	const root = await makeProject({ ...readyGoal, ...planningItem("search") });
	const first = await renderView(root);
	await frameWith(first, " 1/2 ");
	first.renderer.destroy();

	const view = await renderView(root);
	await frameWith(view, " 1/2 ");
	await selectRow(view, "search");
	view.mockInput.pressEnter();

	expect(await frameWith(view, "No messages yet.")).toContain(" search ");
});

test("r renames the selected planning item, and the other one stays as it was", async () => {
	const root = await makeProject({
		...planningItem("search"),
		...planningItem("ideas"),
	});
	const view = await renderView(root);
	await frameWith(view, " 1/2 ");
	await selectRow(view, "search");

	view.mockInput.pressKey("r");
	await frameWith(view, "Rename search to:");
	for (const _ of "search") view.mockInput.pressBackspace();
	await view.mockInput.typeText("ranked-search");
	view.mockInput.pressEnter();

	await frameWithout(view, "Rename search to:");
	const renamed = await frameWith(view, " ranked-search ");
	expect(rowOf(renamed, "ranked-search")).toContain("planning");
	expect(rowOf(renamed, "ideas")).toContain("planning");
	expect(renamed).not.toContain(" search ");
	expect((await readdir(join(root, ".vago-goals"))).sort()).toEqual([
		"ideas",
		"ranked-search",
	]);
});

test("d then y discards the selected planning item, leaving another and a Goal", async () => {
	const root = await makeProject({
		...readyGoal,
		...planningItem("search"),
		...planningItem("ideas"),
	});
	const view = await renderView(root);
	await frameWith(view, " 1/3 ");
	await selectRow(view, "search");

	view.mockInput.pressKey("d");
	await frameWith(view, "Discard search and everything saved with it? y/n");
	view.mockInput.pressKey("y");

	const after = await frameWith(view, " 2/2 ");
	expect(after).not.toContain(" search ");
	expect((await readdir(join(root, ".vago-goals"))).sort()).toEqual([
		"ideas",
		"ready",
	]);
});

test("d then any other key keeps the planning item", async () => {
	const root = await makeProject(planningItem("search"));
	const view = await renderView(root);
	await frameWith(view, " 1/1 ");

	view.mockInput.pressKey("d");
	await frameWith(view, "Discard search");
	view.mockInput.pressKey("n");

	await frameWithout(view, "Discard search");
	expect(existsSync(join(root, ".vago-goals/search/planning"))).toBe(true);
});

test("a planning item is offered no Start, and s starts nothing", async () => {
	const root = await makeProject(planningItem("search"));
	const view = await renderView(root, { width: 120, height: 30 });
	const frame = await frameWith(view, " 1/1 ");

	expect(frame).not.toContain("s Start");
	expect(frame).toContain("r Rename");
	view.mockInput.pressKey("s");

	expect(
		await frameWith(view, "only a ready, stuck or lost Goal starts"),
	).toBeDefined();
	expect(existsSync(join(root, ".vago-goals/search/goal.md"))).toBe(false);
});

test("a Goal is offered Start and neither Rename nor Discard", async () => {
	const root = await makeProject(readyGoal);
	const view = await renderView(root, { width: 120, height: 30 });

	const frame = await frameWith(view, " 1/1 ");

	expect(frame).toContain("s Start");
	expect(frame).not.toContain("r Rename");
	view.mockInput.pressKey("d");
	await view.renderOnce();
	expect(view.captureCharFrame()).not.toContain("Discard");
});

test("discarding an item whose response is being written stops it, and the row stays gone", async () => {
	const root = await makeProject({
		...readyGoal,
		".vago-goals/search/planning/chat.toml": `harness = "claude-code"

[[turns]]
message = "What should search rank by?"
started = 2026-10-06T10:00:00.000Z
log = "logs/turn-01.jsonl"
`,
	});
	await heldLock(root, "search");
	const view = await renderView(root);
	await frameWith(view, " 1/2 ");
	await selectRow(view, "search");

	view.mockInput.pressKey("d");
	await frameWith(view, "Discard search and everything saved with it? y/n");
	view.mockInput.pressKey("y");

	await frameWith(view, "Discarding search…");
	const after = await frameWith(view, " 1/1 ");
	expect(after).not.toContain(" search ");
	await Bun.sleep(1200);
	await view.renderOnce();
	expect(view.captureCharFrame()).not.toContain(" search ");
	expect(existsSync(join(root, ".vago-goals/search"))).toBe(false);
});
