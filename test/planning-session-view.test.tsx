import { expect, setDefaultTimeout, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import {
	type FakeInteractiveHarness,
	makeFakeInteractiveClaude,
} from "./fake-harness.ts";
import { makeProject, oneStep } from "./project.ts";
import { frameWith, frameWithout, renderView } from "./view-render.tsx";

// Each test runs a vago plan session and its fake Harness.
setDefaultTimeout(20_000);

// A ready Proposal of one Ticket, from turn 1, on Workflow `small`.
const proposalToml = `turn = 1
workflow = "small"
goal = """
# Search ranks by relevance
"""

[[tickets]]
slug = "score"
blocked_by = []
body = """
# Score each result
"""
`;

// A Project with a planning prompt, Workflow `small` and planning item
// `search` on Claude Code, with a ready Proposal.
function planningProject(): Promise<string> {
	return makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago/workflows/small.toml": oneStep("true"),
		".vago-goals/search/planning/chat.toml": 'harness = "claude-code"\n',
		".vago-goals/search/planning/proposal.toml": proposalToml,
	});
}

// The footer, the frame's last line.
function footer(frame: string): string {
	return frame.trimEnd().split("\n").at(-1) ?? "";
}

// The Project at `root` in a 120×30 view, with `fake` on the `PATH` of the
// sessions it starts, and keys sent as the kitty keyboard protocol does.
async function sessionView(
	root: string,
	fake: FakeInteractiveHarness,
): Promise<TestRendererSetup> {
	return renderView(root, { width: 120, height: 30 }, fake.env, undefined, {
		kittyKeyboard: true,
	});
}

// Opens the only planning item of the Project shown in `view`, and waits
// for its session to start.
async function openSession(view: TestRendererSetup): Promise<string> {
	await frameWith(view, " 1/1 ");
	view.mockInput.pressEnter();
	return frameWith(view, "fake claude ");
}

test("Enter on a planning item shows its session beside the Preview", async () => {
	const fake = await makeFakeInteractiveClaude();
	const view = await sessionView(await planningProject(), fake);

	const frame = await openSession(view);

	const line = frame.split("\n").find((row) => row.includes("fake claude"));
	expect(line).toMatch(/fake claude fresh [0-9a-f-]{36}/);
	// The Preview's title, on the same row as the session's.
	expect(frame.split("\n").find((row) => row.includes(" search "))).toContain(
		"Preview",
	);
});

test("q, Esc, Ctrl-C and Shift+Enter all reach the session, and the view stays", async () => {
	const fake = await makeFakeInteractiveClaude();
	const view = await sessionView(await planningProject(), fake);
	await openSession(view);

	view.mockInput.pressKey("q");
	await frameWith(view, "key q");
	view.mockInput.pressEscape();
	await frameWith(view, "key escape");
	view.mockInput.pressCtrlC();
	await frameWith(view, "key ctrl+c");
	view.mockInput.pressEnter({ shift: true });
	const frame = await frameWith(view, "key shift+enter");

	expect(frame).toContain("fake claude fresh");
	expect(frame).toContain("Preview");
	const [call] = await fake.calls();
	expect(call?.ended).toBe(false);
});

test("Ctrl-] moves the focus to the Preview and back, and the footer follows", async () => {
	const fake = await makeFakeInteractiveClaude();
	const view = await sessionView(await planningProject(), fake);
	await openSession(view);

	view.mockInput.pressKey("]", { ctrl: true });
	const preview = await frameWith(view, "a Accept");

	expect(footer(preview)).toMatch(
		/Ctrl-\] Session +a Accept +w Workflow +Esc Back +\? Help +q Quit/,
	);
	view.mockInput.pressKey("]", { ctrl: true });
	const session = await frameWith(view, "Ctrl-] Preview");
	expect(session).not.toContain("a Accept");
	view.mockInput.pressKey("x");
	await frameWith(view, "key x");
	// Ctrl-] never reached the session.
	expect(await frameWith(view, "key x")).not.toContain("csi 93");
});

test("Esc from the Preview ends the session, and opening the item again resumes it", async () => {
	const fake = await makeFakeInteractiveClaude();
	const view = await sessionView(await planningProject(), fake);
	const first = await openSession(view);
	const id = /fake claude fresh (\S+)/.exec(first)?.[1];

	view.mockInput.pressKey("]", { ctrl: true });
	await frameWith(view, "a Accept");
	view.mockInput.pressEscape();
	await frameWith(view, " 1/1 ");
	await fake.allEnded();
	view.mockInput.pressEnter();

	await frameWith(view, `fake claude resumed ${id}`);
});

test("accepting ends the session first, then makes the ready Goal", async () => {
	const fake = await makeFakeInteractiveClaude();
	const root = await planningProject();
	const view = await sessionView(root, fake);
	await openSession(view);
	view.mockInput.pressKey("]", { ctrl: true });
	await frameWith(view, "a Accept");

	view.mockInput.pressKey("a");
	await frameWith(view, "y accepts");
	view.mockInput.pressKey("y");

	await frameWith(view, "Accepted search as a ready Goal with 1 Ticket");
	expect(await Bun.file(`${root}/.vago-goals/search/goal.md`).exists()).toBe(
		true,
	);
	const [call] = await fake.calls();
	expect(call?.ended).toBe(true);
});

test("with the session focused the footer names only Ctrl-] Preview, and nothing says still answering", async () => {
	const fake = await makeFakeInteractiveClaude();
	const view = await sessionView(await planningProject(), fake);

	const frame = await openSession(view);

	expect(footer(frame).trim()).toBe("Ctrl-] Preview");
	expect(frame).not.toContain("still answering");
});

test("a session that ends on its own says how it ended", async () => {
	const fake = await makeFakeInteractiveClaude();
	const view = await sessionView(await planningProject(), fake);
	await openSession(view);

	await view.mockInput.typeText("exit");

	await frameWith(view, "The session ended (exit 3).");
});

test("? in the Preview shows the planning keys, and Esc hides them", async () => {
	const fake = await makeFakeInteractiveClaude();
	const view = await sessionView(await planningProject(), fake);
	await openSession(view);
	view.mockInput.pressKey("]", { ctrl: true });
	await frameWith(view, "? Help");

	view.mockInput.pressKey("?");

	const help = await frameWith(view, " Keys ");
	for (const meaning of [
		"move between the session and the Preview",
		"accept the Proposal as a ready Goal",
		"choose the Goal's Workflow",
		"back to the Goals, from the Preview",
	]) {
		expect(help).toContain(meaning);
	}
	expect(help).not.toContain("retry");
	view.mockInput.pressEscape();
	const back = await frameWithout(view, " Keys ");
	expect(back).toContain("fake claude fresh");
});
