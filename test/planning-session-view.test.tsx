import { expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { TestRendererSetup } from "@opentui/core/testing";
import {
	type FakeInteractiveHarness,
	makeFakeInteractiveClaude,
	makeFakeInteractiveCodex,
} from "./fake-harness.ts";
import { makeProject, oneStep } from "./project.ts";
import { frameWith, frameWithout, renderView } from "./view-render.tsx";

// Each test runs a vago plan session and its fake Harness.
setDefaultTimeout(20_000);

// A ready Proposal of one Ticket on Workflow `small`.
const proposalToml = `
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

// A Project as `planningProject`'s, whose agent hasn't proposed yet.
function projectWithoutProposal(): Promise<string> {
	return makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago/workflows/small.toml": oneStep("true"),
		".vago-goals/search/planning/chat.toml": 'harness = "claude-code"\n',
	});
}

// An answer ending in a proposal block of Goal `title` on Workflow `small`,
// with a Ticket per slug in `slugs`, each blocked by the one before it.
function proposing(title: string, slugs: string[]): string {
	const tickets = slugs.map(
		(slug, index) => `
[[tickets]]
slug = "${slug}"
blocked_by = [${index === 0 ? "" : index}]
body = """
# ${slug} ticket
"""
`,
	);
	return `Here is the plan.

<vago-plan>
workflow = "small"
goal = """
# ${title}
"""
${tickets.join("")}</vago-plan>`;
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

test("a Codex item shows Codex's session beside the Preview", async () => {
	const fake = await makeFakeInteractiveCodex();
	const root = await makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago/workflows/small.toml": oneStep("true"),
		".vago-goals/search/planning/chat.toml": 'harness = "codex"\n',
		".vago-goals/search/planning/proposal.toml": proposalToml,
	});
	const view = await sessionView(root, fake);
	await frameWith(view, " 1/1 ");

	view.mockInput.pressEnter();

	const frame = await frameWith(view, "fake codex fresh ");
	expect(frame.split("\n").find((row) => row.includes(" search "))).toContain(
		"Preview",
	);
	expect(frame).toContain("Score each result");
});

// The row of `frame` with the planning pane titles: the item's name and
// the Preview's.
function titleRow(frame: string): string {
	return frame.split("\n").find((row) => row.includes(" search ")) ?? "";
}

test("the session's title gives the planning's time and cost on Claude Code and Codex", async () => {
	for (const [harness, cost] of [
		["claude-code", "$0.80"],
		["codex", "$0.40"],
	] as const) {
		const fake =
			harness === "codex"
				? await makeFakeInteractiveCodex({ answers: ["A question?"] })
				: await makeFakeInteractiveClaude({ answers: ["A question?"] });
		const root = await makeProject({
			".vago/prompts/planning.md": "You help plan a Goal.\n",
			".vago/workflows/small.toml": oneStep("true"),
			".vago-goals/search/planning/chat.toml": `harness = "${harness}"\n`,
		});
		const view = await sessionView(root, fake);
		await frameWith(view, " 1/1 ");
		view.mockInput.pressEnter();
		const opened = await frameWith(view, "fresh ");
		expect(titleRow(opened)).toMatch(/planning · \d+s · \$0\.00/);

		view.mockInput.pressEnter();

		const answered = await frameWith(view, `· ${cost}`);
		expect(titleRow(answered)).toContain(`· ${cost}`);
		view.renderer.destroy();
		await fake.allEnded();
	}
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

test("while the agent only asks questions, the Preview says no proposal yet", async () => {
	const fake = await makeFakeInteractiveClaude({
		answers: ["Should results rank by relevance or by date?"],
	});
	const view = await sessionView(await projectWithoutProposal(), fake);
	await openSession(view);

	view.mockInput.pressEnter();
	await frameWith(view, "answered 1");
	await Bun.sleep(2000);

	const frame = await frameWith(view, "No proposal yet.");
	expect(frame).toContain("questions are settled");
});

test("a proposal the agent writes shows in the Preview with its order, blockers and Workflow", async () => {
	const fake = await makeFakeInteractiveClaude({
		answers: [proposing("Search ranks by relevance", ["score", "sort"])],
	});
	const view = await sessionView(await projectWithoutProposal(), fake);
	await openSession(view);

	view.mockInput.pressEnter();

	const frame = await frameWith(view, "Search ranks by relevance");
	expect(frame).toContain("small, recommended");
	expect(frame).toMatch(
		/01 score ticket[\s\S]*no blockers[\s\S]*02 sort ticket[\s\S]*blocked by 01/,
	);
});

test("a revised proposal replaces the earlier one in the Preview", async () => {
	const fake = await makeFakeInteractiveClaude({
		answers: [
			proposing("Search ranks by relevance", ["score", "sort"]),
			"Should stale results drop out?",
			proposing("Search ranks fresh results first", ["age", "score", "sort"]),
		],
	});
	const view = await sessionView(await projectWithoutProposal(), fake);
	await openSession(view);
	view.mockInput.pressEnter();
	await frameWith(view, "Search ranks by relevance");

	view.mockInput.pressEnter();
	view.mockInput.pressEnter();

	const frame = await frameWith(view, "Search ranks fresh results first");
	expect(frame).not.toContain("Search ranks by relevance");
	expect(frame).toMatch(/01 age ticket[\s\S]*02 score ticket[\s\S]*03 sort/);
});

test("an unclosed block before a good one, or a bad block after it, leaves the good proposal in the Preview", async () => {
	const fake = await makeFakeInteractiveClaude({
		answers: [
			'Draft:\n\n<vago-plan>\nworkflow = "small"\ngoal = "# Search ranks by date"',
			proposing("Search ranks by relevance", ["score", "sort"]),
			"Revised:\n\n<vago-plan>\ngoal = [unclosed\n</vago-plan>",
		],
	});
	const view = await sessionView(await projectWithoutProposal(), fake);
	await openSession(view);
	view.mockInput.pressEnter();
	await frameWith(view, "answered 1");
	view.mockInput.pressEnter();
	await frameWith(view, "Search ranks by relevance");

	view.mockInput.pressEnter();
	await frameWith(view, "answered 3");
	await Bun.sleep(2000);

	const frame = await frameWith(view, "Search ranks by relevance");
	expect(frame).toContain("02 sort ticket");
	expect(frame).not.toContain("Search ranks by date");
});

test("a resumed session's earlier proposal is read again", async () => {
	const fake = await makeFakeInteractiveClaude({
		answers: [proposing("Search ranks by relevance", ["score", "sort"])],
	});
	const root = await projectWithoutProposal();
	const view = await sessionView(root, fake);
	await openSession(view);
	view.mockInput.pressEnter();
	await frameWith(view, "Search ranks by relevance");
	view.mockInput.pressKey("]", { ctrl: true });
	await frameWith(view, "a Accept");
	view.mockInput.pressEscape();
	await frameWith(view, " 1/1 ");
	await fake.allEnded();
	// The ended session's last read saves the proposal before its lock goes.
	while (await Bun.file(join(root, ".vago-goals/search/running.lock")).exists())
		await Bun.sleep(50);
	await rm(join(root, ".vago-goals/search/planning/proposal.toml"));

	view.mockInput.pressEnter();

	await frameWith(view, "fake claude resumed");
	await frameWith(view, "Search ranks by relevance");
});
