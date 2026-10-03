import { afterEach, expect, test } from "bun:test";
import { basename } from "node:path";
import { RGBA } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { ProjectView } from "../src/tui/project-view.tsx";
import {
	goalText,
	heldLock,
	makeProject,
	projectWithGoals,
	ticketText,
} from "./project.ts";

let rendered: TestRendererSetup[] = [];

// Each test renderer is destroyed after its test, so none keeps drawing while
// the rest of the suite runs in the same process.
afterEach(() => {
	for (const view of rendered) view.renderer.destroy();
	rendered = [];
});

async function renderView(
	root: string,
	size = { width: 80, height: 24 },
): Promise<TestRendererSetup> {
	const view = await testRender(() => <ProjectView root={root} />, size);
	rendered.push(view);
	return view;
}

// Draws frames until one contains `text`, and returns it. The view reads its
// Goals from disk, so the first frames can come before the read is done.
async function frameWith(
	view: TestRendererSetup,
	text: string,
): Promise<string> {
	for (let tries = 0; ; tries++) {
		await view.renderOnce();
		const frame = view.captureCharFrame();
		if (frame.includes(text)) return frame;
		if (tries === 100) throw new Error(`No frame shows ${text}:\n${frame}`);
		await Bun.sleep(10);
	}
}

test("the Project view lists every Goal by name, in name order", async () => {
	const root = await projectWithGoals(["beta", "alpha", "gamma"]);

	const view = await renderView(root);
	const frame = await frameWith(view, "gamma");

	const lines = frame.split("\n");
	const alpha = lines.findIndex((line) => line.includes("alpha"));
	expect(alpha).toBeGreaterThan(-1);
	expect(lines[alpha + 1]).toContain("beta");
	expect(lines[alpha + 2]).toContain("gamma");
	expect(frame).toContain("1/3");
});

test("↓ and j move the selection down", async () => {
	const root = await projectWithGoals(["alpha", "beta", "gamma"]);
	const view = await renderView(root);
	await frameWith(view, "1/3");

	view.mockInput.pressArrow("down");
	await frameWith(view, "2/3");
	view.mockInput.pressKey("j");
	await frameWith(view, "3/3");
});

test("the selection stops at the first and the last Goal", async () => {
	const root = await projectWithGoals(["alpha", "beta", "gamma"]);
	const view = await renderView(root);
	await frameWith(view, " 1/3 ");

	view.mockInput.pressArrow("up");
	view.mockInput.pressKey("k");
	await frameWith(view, " 1/3 ");

	for (const _ of [1, 2, 3, 4]) view.mockInput.pressArrow("down");
	view.mockInput.pressKey("j");
	await frameWith(view, " 3/3 ");
	view.mockInput.pressArrow("up");
	await frameWith(view, " 2/3 ");
});

const accent = RGBA.fromHex("#ff8a3d");

// Whether the row that shows `name` has the accent colour behind it.
function isAccented(view: TestRendererSetup, name: string): boolean {
	for (const line of view.captureSpans().lines) {
		const span = line.spans.find((span) => span.text.includes(name));
		if (span !== undefined) return span.bg.equals(accent);
	}
	throw new Error(`No row shows ${name}`);
}

test("the selected Goal is drawn in the accent colour", async () => {
	const root = await projectWithGoals(["alpha", "beta"]);
	const view = await renderView(root);
	await frameWith(view, "1/2");

	expect(isAccented(view, "alpha")).toBe(true);
	expect(isAccented(view, "beta")).toBe(false);

	view.mockInput.pressArrow("down");
	await frameWith(view, "2/2");
	expect(isAccented(view, "beta")).toBe(true);
	expect(isAccented(view, "alpha")).toBe(false);
});

for (const [what, files] of [
	["an empty .vago-goals", { ".vago-goals/.keep": "" }],
	["no .vago-goals at all", {}],
] as const) {
	test(`a Project with ${what} shows an empty Goals box`, async () => {
		const root = await makeProject(files);
		const view = await renderView(root);

		const frame = await frameWith(view, " 0/0 ");

		expect(frame).toContain("Goals");
	});
}

const wide = { width: 120, height: 30 };

// The frame's line that shows Goal `goal`'s row.
function rowOf(frame: string, goal: string): string {
	const row = frame.split("\n").find((line) => line.includes(` ${goal} `));
	if (row === undefined) throw new Error(`No row shows ${goal}:\n${frame}`);
	return row;
}

const at = (time: string) => new Date(`2026-10-01T${time}:00Z`);

test("a Goal whose lock a live process holds is running, and shows its Ticket's Step", async () => {
	const root = await makeProject({
		".vago-goals/a/goal.md": goalText("w"),
		".vago-goals/a/tickets/03-before.md": ticketText("done"),
		".vago-goals/a/tickets/04-now.md": ticketText("running", {
			runs: [{ step: "review", started: at("10:00") }],
		}),
	});
	await heldLock(root, "a");

	const view = await renderView(root);
	const row = rowOf(await frameWith(view, "04 review"), "a");

	expect(row).toContain("● running");
	expect(row).toContain("04 review");
});

const warn = RGBA.fromHex("#e0b357");

// The span in the row showing Goal `goal` whose text holds `text`.
function spanIn(view: TestRendererSetup, goal: string, text: string) {
	for (const line of view.captureSpans().lines) {
		if (!line.spans.some((span) => span.text.trim() === goal)) continue;
		const span = line.spans.find((span) => span.text.includes(text));
		if (span !== undefined) return span;
	}
	throw new Error(`No row of ${goal} shows ${text}`);
}

// Goals `a` and `b`, each with Ticket 02 running, no lock, and nothing else
// between them, so `a` is the first row and `b` is drawn unselected.
function lostProject(): Promise<string> {
	const goal = {
		"goal.md": goalText("w"),
		"tickets/01-first.md": ticketText("done"),
		"tickets/02-second.md": ticketText("running", {
			runs: [
				{
					step: "design",
					started: at("09:00"),
					ended: at("09:10"),
					outcome: "ok",
				},
				{ step: "architecture", started: at("09:10") },
			],
		}),
	};
	return makeProject(
		Object.fromEntries(
			["a", "b"].flatMap((name) =>
				Object.entries(goal).map(([path, text]) => [
					`.vago-goals/${name}/${path}`,
					text,
				]),
			),
		),
	);
}

test("a Goal whose Ticket says running with no lock is lost, with ? in warn", async () => {
	const root = await lostProject();

	const view = await renderView(root, wide);
	const row = rowOf(await frameWith(view, "? lost"), "b");

	expect(row).toContain("? lost");
	expect(row).toContain("02 architecture, no vago run process runs it");
	expect(spanIn(view, "b", "?").fg.equals(warn)).toBe(true);
});

test("a Goal whose lock holds a dead process is lost", async () => {
	const root = await lostProject();
	await (await heldLock(root, "a")).release();

	const view = await renderView(root, wide);

	expect(rowOf(await frameWith(view, " a "), "a")).toContain("? lost");
});

// A Project whose one Goal `a` has `tickets`, keyed by file name.
function projectWithTickets(tickets: Record<string, string>): Promise<string> {
	return makeProject({
		".vago-goals/a/goal.md": goalText("w"),
		...Object.fromEntries(
			Object.entries(tickets).map(([name, text]) => [
				`.vago-goals/a/tickets/${name}.md`,
				text,
			]),
		),
	});
}

test("a Goal with a stuck Ticket is stuck after that Ticket's last Step", async () => {
	const root = await projectWithTickets({
		"01-first": ticketText("done"),
		"02-second": ticketText("stuck", {
			runs: [
				{
					step: "merge",
					started: at("09:00"),
					ended: at("09:01"),
					outcome: "exit 1",
				},
			],
		}),
		"03-third": ticketText("ready"),
	});

	const view = await renderView(root, wide);
	const row = rowOf(await frameWith(view, " a "), "a");

	expect(row).toContain("✗ stuck");
	expect(row).toContain("02 stuck after merge exit 1");
});

test("a Goal with Tickets done and the rest ready is paused, ready to go on", async () => {
	const root = await projectWithTickets({
		"01-first": ticketText("done"),
		"02-second": ticketText("ready"),
	});

	const view = await renderView(root, wide);
	const row = rowOf(await frameWith(view, " a "), "a");

	expect(row).toContain("○ ready");
	expect(row).toContain("paused, ready to go on");
});

test("a Goal whose Tickets are all ready is ready to start", async () => {
	const root = await projectWithTickets({
		"01-first": ticketText("ready"),
		"02-second": ticketText("ready"),
		"03-third": ticketText("ready", { blockedBy: [1] }),
	});

	const view = await renderView(root, wide);
	const row = rowOf(await frameWith(view, " a "), "a");

	expect(row).toContain("○ ready");
	expect(row).toContain("ready to start");
});

test("a Goal whose Tickets are all done is done and finished", async () => {
	const root = await projectWithTickets({
		"01-first": ticketText("done"),
		"02-second": ticketText("done"),
	});

	const view = await renderView(root, wide);
	const row = rowOf(await frameWith(view, " a "), "a");

	expect(row).toContain("✓ done");
	expect(row).toContain("finished");
});

test("a Goal with no Tickets is ready to start, with none done of none", async () => {
	const root = await projectWithGoals(["a"]);

	const view = await renderView(root, wide);
	const row = rowOf(await frameWith(view, " a "), "a");

	expect(row).toContain("○ ready");
	expect(row).toContain("ready to start");
	expect(row).toContain("0/0");
});

const ok = RGBA.fromHex("#8fae8b");
const bad = RGBA.fromHex("#e5736b");
const faint = RGBA.fromHex("#4a4a4a");

// Goal `a` with `done`, `stuck` and `ready` Tickets in that order, numbered
// from 1, and before it Goal `0`, stuck like `a` and first by name, so `a`'s
// row is drawn unselected.
function projectWithStatuses(counts: {
	done: number;
	stuck: number;
	ready: number;
}): Promise<string> {
	const statuses = [
		...Array<"done">(counts.done).fill("done"),
		...Array<"stuck">(counts.stuck).fill("stuck"),
		...Array<"ready">(counts.ready).fill("ready"),
	];
	return makeProject({
		".vago-goals/0/goal.md": goalText("w"),
		".vago-goals/0/tickets/01-t.md": ticketText("stuck"),
		".vago-goals/a/goal.md": goalText("w"),
		...Object.fromEntries(
			statuses.map((status, index) => [
				`.vago-goals/a/tickets/${String(index + 1).padStart(2, "0")}-t.md`,
				ticketText(status),
			]),
		),
	});
}

// The colour of each `━` cell in Goal `goal`'s row, left to right.
function barColors(view: TestRendererSetup, goal: string): RGBA[] {
	for (const line of view.captureSpans().lines) {
		if (!line.spans.some((span) => span.text.trim() === goal)) continue;
		return line.spans.flatMap((span) =>
			[...span.text].filter((cell) => cell === "━").map(() => span.fg),
		);
	}
	throw new Error(`No row shows ${goal}`);
}

// `colors` as runs of one colour, like [[ok, 7], [bad, 1]].
function runsOf(colors: RGBA[]): [RGBA, number][] {
	const runs: [RGBA, number][] = [];
	for (const each of colors) {
		const last = runs.at(-1);
		if (last?.[0].equals(each)) last[1]++;
		else runs.push([each, 1]);
	}
	return runs;
}

test("the bar gives each Ticket status its share of ten cells", async () => {
	const root = await projectWithStatuses({ done: 7, stuck: 1, ready: 2 });

	const view = await renderView(root, wide);
	await frameWith(view, " a ");

	expect(runsOf(barColors(view, "a"))).toEqual([
		[ok, 7],
		[bad, 1],
		[faint, 2],
	]);
});

test("the bar keeps a cell for a status too small for its share", async () => {
	const root = await projectWithStatuses({ done: 20, stuck: 1, ready: 0 });

	const view = await renderView(root, wide);
	await frameWith(view, " a ");

	expect(runsOf(barColors(view, "a"))).toEqual([
		[ok, 9],
		[bad, 1],
	]);
});

test("the bar gives statuses with as many Tickets as many cells", async () => {
	const root = await projectWithStatuses({ done: 3, stuck: 3, ready: 2 });

	const view = await renderView(root, wide);
	await frameWith(view, " a ");

	expect(runsOf(barColors(view, "a"))).toEqual([
		[ok, 4],
		[bad, 4],
		[faint, 2],
	]);
});

test("a row shows its Goal's Tickets done of total", async () => {
	const root = await projectWithStatuses({ done: 7, stuck: 1, ready: 2 });

	const view = await renderView(root);

	expect(rowOf(await frameWith(view, " a "), "a")).toContain(" 7/10 ");
});

// One Goal in each standing and two done ones, named so that name order is
// none of the orders the rows are expected in. Runs cost $6.85 in all.
async function projectOfEveryStanding(): Promise<string> {
	const done = (ended: string, costUsd: number) =>
		ticketText("done", {
			runs: [
				{
					step: "merge",
					started: at("08:00"),
					ended: at(ended),
					outcome: "ok",
					costUsd,
				},
			],
		});
	const root = await makeProject({
		".vago-goals/a-old/goal.md": goalText("w"),
		".vago-goals/a-old/tickets/01-t.md": done("09:00", 3.1),
		".vago-goals/b-ready/goal.md": goalText("w"),
		".vago-goals/b-ready/tickets/01-t.md": ticketText("ready"),
		".vago-goals/c-stuck/goal.md": goalText("w"),
		".vago-goals/c-stuck/tickets/01-t.md": ticketText("stuck", {
			runs: [
				{
					step: "check",
					started: at("08:00"),
					ended: at("08:30"),
					outcome: "exit 1",
					costUsd: 0.5,
				},
			],
		}),
		".vago-goals/d-lost/goal.md": goalText("w"),
		".vago-goals/d-lost/tickets/01-t.md": ticketText("running", {
			runs: [{ step: "design", started: at("08:00"), costUsd: 1.25 }],
		}),
		".vago-goals/e-run/goal.md": goalText("w"),
		".vago-goals/e-run/tickets/01-t.md": ticketText("running", {
			runs: [{ step: "review", started: at("08:00") }],
		}),
		".vago-goals/z-new/goal.md": goalText("w"),
		".vago-goals/z-new/tickets/01-t.md": done("10:00", 2),
	});
	await heldLock(root, "e-run");
	return root;
}

test("rows sort running, lost, stuck, ready, done, then latest activity first", async () => {
	const root = await projectOfEveryStanding();

	const view = await renderView(root, wide);
	const frame = await frameWith(view, " z-new ");

	const order = ["e-run", "d-lost", "c-stuck", "b-ready", "z-new", "a-old"];
	const rows = order.map((goal) =>
		frame.split("\n").findIndex((line) => line.includes(` ${goal} `)),
	);
	expect(rows).toEqual([...rows].sort((a, b) => a - b));
	expect(rows[0]).toBeGreaterThan(-1);
});

test("the header line counts the Goals, the running, those that need you, and the spend", async () => {
	const root = await projectOfEveryStanding();

	const view = await renderView(root, wide);
	const frame = await frameWith(view, " 6 Goals");

	const header = frame.split("\n")[0] ?? "";
	expect(header).toContain(`${basename(root)} · 6 Goals`);
	expect(header).toContain("1 running · 2 need you · $6.85 spent");
});

test("at 120 wide a row shows its Goal's elapsed time and cost", async () => {
	const run = (
		step: string,
		started: string,
		ended: string,
		costUsd: number,
	) => ({
		step,
		started: at(started),
		ended: at(ended),
		outcome: "ok",
		costUsd,
	});
	const root = await makeProject({
		".vago-goals/a/goal.md": goalText("w"),
		".vago-goals/a/tickets/01-t.md": ticketText("done", {
			runs: [run("design", "10:00", "10:20", 2)],
		}),
		".vago-goals/a/tickets/02-t.md": ticketText("done", {
			runs: [run("design", "10:30", "11:00", 3)],
		}),
		".vago-goals/b/goal.md": goalText("w"),
	});

	const view = await renderView(root, wide);
	const frame = await frameWith(view, " b ");

	expect(rowOf(frame, "a")).toMatch(/ 1h 0m +\$5\.00 /);
	expect(rowOf(frame, "b")).toMatch(/ 0s +\$0\.00 /);
});

test("titles with CJK and emoji stay aligned, and long ones are cut to their column", async () => {
	const root = await makeProject({
		".vago-goals/a/goal.md": goalText("w", "# 日本語のタイトル 🚀\n"),
		".vago-goals/b/goal.md": goalText("w", `# ${"long ".repeat(40)}\n`),
		".vago-goals/c/goal.md": goalText("w"),
	});

	const view = await renderView(root, wide);
	const frame = await frameWith(view, "日本語");

	const rows = ["a", "b", "c"].map((goal) => rowOf(frame, goal));
	const borderAt = (row: string) => Bun.stringWidth(row.trimEnd()) - 1;
	expect(rows.map(borderAt)).toEqual([119, 119, 119]);
	expect(rows[0]).toContain("日本語のタイトル 🚀");
	expect((rows[1] ?? "").replace(/[ │]+$/, "").at(-1)).toBe("…");
});

const tokens = [
	"#0c0c0c",
	"#d6d6d6",
	"#7a7a7a",
	"#4a4a4a",
	"#2e2e2e",
	"#ff8a3d",
	"#8fae8b",
	"#e5736b",
	"#e0b357",
].map((hex) => RGBA.fromHex(hex));

test("every text is drawn in one of the theme's colours", async () => {
	const root = await projectOfEveryStanding();

	const view = await renderView(root, wide);
	await frameWith(view, " 6 Goals");

	const untokened = view
		.captureSpans()
		.lines.flatMap((line) => line.spans)
		.filter((span) => span.text.trim() !== "")
		.filter((span) => !tokens.some((token) => token.equals(span.fg)))
		.map((span) => span.text);
	expect(untokened).toEqual([]);
});

test("at 80 wide the elapsed, cost and title columns drop out", async () => {
	const root = await projectOfEveryStanding();

	const view = await renderView(root);
	const frame = await frameWith(view, " 6 Goals");

	const headings = frame.split("\n").find((line) => line.includes("STATE"));
	expect(headings).not.toContain("ELAPSED");
	expect(headings).not.toContain("COST");
	expect(headings).not.toContain("TITLE");
	for (const goal of [
		"e-run",
		"d-lost",
		"c-stuck",
		"b-ready",
		"z-new",
		"a-old",
	]) {
		expect(rowOf(frame, goal)).toMatch(/[●?✗○✓] \w+ .+ ━+ \d+\/\d+ /);
	}
});
