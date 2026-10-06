import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { RGBA, TextAttributes } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import {
	goalText,
	type HeldLock,
	heldLock,
	makeProject,
	oneStep,
	projectWithGoals,
	ticketText,
	vagoHome,
} from "./project.ts";
import {
	frameWith,
	frameWithout,
	onlyAscii,
	renderView,
	setEnv,
} from "./view-render.tsx";

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

test("g and G move the selection to the first and the last Goal", async () => {
	const root = await projectWithGoals(["alpha", "beta", "gamma"]);
	const view = await renderView(root);
	await frameWith(view, " 1/3 ");

	view.mockInput.pressKey("G");
	await frameWith(view, " 3/3 ");
	view.mockInput.pressKey("g");
	await frameWith(view, " 1/3 ");
});

test("? shows every key, and Esc or ? hides them", async () => {
	const root = await projectWithGoals(["alpha", "beta"]);
	const view = await renderView(root);
	await frameWith(view, " 1/2 ");

	view.mockInput.pressKey("?");
	const help = await frameWith(view, " Keys ");
	for (const key of [
		"↑↓ j k",
		"Enter",
		"g G",
		"click",
		"wheel",
		"Esc",
		"q Ctrl-C",
	]) {
		expect(help).toContain(key);
	}
	view.mockInput.pressEscape();
	await frameWithout(view, " Keys ");
	view.mockInput.pressKey("?");
	await frameWith(view, " Keys ");
	view.mockInput.pressKey("?");
	await frameWithout(view, " Keys ");
});

test("while the keys show, the selection keys move nothing", async () => {
	const root = await projectWithGoals(["alpha", "beta"]);
	const view = await renderView(root);
	await frameWith(view, " 1/2 ");

	view.mockInput.pressKey("?");
	await frameWith(view, " Keys ");
	view.mockInput.pressArrow("down");
	view.mockInput.pressKey("G");
	view.mockInput.pressEscape();

	expect(await frameWithout(view, " Keys ")).toContain(" 1/2 ");
});

test("while the keys show, a click on a Goal beside them selects nothing", async () => {
	const root = await projectWithGoals(["alpha", "beta", "gamma"]);
	const view = await renderView(root);
	const frame = await frameWith(view, " 1/3 ");

	view.mockInput.pressKey("?");
	await frameWith(view, " Keys ");
	await view.mockMouse.click(4, lineOf(frame, " gamma "));
	view.mockInput.pressEscape();

	expect(await frameWithout(view, " Keys ")).toContain(" 1/3 ");
});

test("the footer names the keys of the Project view", async () => {
	const root = await projectWithGoals(["alpha"]);
	const view = await renderView(root);

	const frame = await frameWith(view, " 1/1 ");

	expect(frame.trimEnd().split("\n").at(-1)).toMatch(
		/^ ↑↓ Goal {3}Enter Open {3}s Start {3}g G First, last {3}\? Help {3}q Quit *$/,
	);
});

test("on a narrow terminal the footer drops its least used keys first", async () => {
	const root = await projectWithGoals(["alpha"]);
	const view = await renderView(root, { width: 34, height: 24 });

	const frame = await frameWith(view, " 1/1 ");

	expect(frame.trimEnd().split("\n").at(-1)).toMatch(
		/^ ↑↓ Goal {3}Enter Open {3}\? Help *$/,
	);
});

test("clicking a Goal's row selects it", async () => {
	const root = await projectWithGoals(["alpha", "beta", "gamma"]);
	const view = await renderView(root);
	const frame = await frameWith(view, " 1/3 ");

	await view.mockMouse.click(20, lineOf(frame, " gamma "));

	await frameWith(view, " 3/3 ");
});

// Twenty Goals, `goal-00` to `goal-19`: more than the Goals box shows at 24
// rows.
const manyGoals = Array.from(
	{ length: 20 },
	(_, index) => `goal-${String(index).padStart(2, "0")}`,
);

test("a list longer than the Goals box keeps the preview and footer on screen", async () => {
	const root = await projectWithGoals(manyGoals);
	const view = await renderView(root);

	const frame = await frameWith(view, " 1/20 ");

	expect(lineOf(frame, "ready   goal-00 ")).toBeGreaterThan(-1);
	expect(lineOf(frame, "ready   goal-19 ")).toBe(-1);
	expect(frame).toContain("Workflow w");
	expect(frame).toContain("q Quit");
});

test("the wheel scrolls the Goals and leaves the selection where it was", async () => {
	const root = await projectWithGoals(manyGoals);
	const view = await renderView(root);
	const frame = await frameWith(view, " 1/20 ");
	const row = lineOf(frame, " goal-01 ");

	for (const _ of manyGoals) await view.mockMouse.scroll(20, row, "down");

	const scrolled = await frameWith(view, " goal-19 ");
	expect(lineOf(scrolled, "ready   goal-00 ")).toBe(-1);
	expect(scrolled).toContain(" 1/20 ");
});

test("moving the selection past the Goals box's last row scrolls to it", async () => {
	const root = await projectWithGoals(manyGoals);
	const view = await renderView(root);
	await frameWith(view, " 1/20 ");

	view.mockInput.pressKey("G");

	const last = await frameWith(view, " 20/20 ");
	expect(lineOf(last, "ready   goal-19 ")).toBeGreaterThan(-1);
	view.mockInput.pressKey("g");
	const first = await frameWith(view, " 1/20 ");
	expect(lineOf(first, "ready   goal-00 ")).toBeGreaterThan(-1);
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
	test(`a Project with ${what} says it has none and names vago goal new`, async () => {
		const root = await makeProject(files);
		const view = await renderView(root);

		const frame = await frameWith(view, " 0/0 ");

		expect(frame).toContain(
			"No Goals yet. Start one with vago goal new <goal>.",
		);
	});
}

const wide = { width: 120, height: 30 };

// The frame's line that shows Goal `goal`'s row.
function rowOf(frame: string, goal: string): string {
	const row = frame.split("\n").find((line) => line.includes(` ${goal} `));
	if (row === undefined) throw new Error(`No row shows ${goal}:\n${frame}`);
	return row;
}

// The number of the frame's first line that holds `text`, -1 with none.
const lineOf = (frame: string, text: string) =>
	frame.split("\n").findIndex((line) => line.includes(text));

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

test("a running Goal whose Ticket waits to retry its failed Step says so and the time left", async () => {
	const ended = new Date(Date.now() - 1000);
	const root = await makeProject({
		".vago-goals/a/goal.md": goalText("w"),
		".vago-goals/a/tickets/04-now.md": ticketText("running", {
			runs: [
				{
					step: "review",
					model: "opus",
					started: new Date(ended.getTime() - 60_000),
					ended,
					outcome: "exit 1",
					retryAt: new Date(ended.getTime() + 60_000),
				},
			],
		}),
	});
	await heldLock(root, "a");

	const view = await renderView(root);
	const row = rowOf(await frameWith(view, "04 review"), "a");

	expect(row).toContain("● running");
	expect(row).toMatch(/04 review retries in \d+s/);
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
	const rows = order.map((goal) => lineOf(frame, ` ${goal} `));
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

test("at 120 wide a row shows its Goal's run time, its Runs' sum across a pause, and cost", async () => {
	const run = (started: Date, ended: Date, costUsd: number) => ({
		step: "design",
		started,
		ended,
		outcome: "ok",
		costUsd,
	});
	const root = await makeProject({
		".vago-goals/a/goal.md": goalText("w"),
		".vago-goals/a/tickets/01-t.md": ticketText("done", {
			runs: [run(at("10:00"), at("10:20"), 2)],
		}),
		".vago-goals/a/tickets/02-t.md": ticketText("done", {
			runs: [
				run(
					new Date("2026-10-03T10:30:00Z"),
					new Date("2026-10-03T11:00:00Z"),
					3,
				),
			],
		}),
		".vago-goals/b/goal.md": goalText("w"),
	});

	const view = await renderView(root, wide);
	const frame = await frameWith(view, " b ");

	expect(lineWith(frame, "STATE")).toContain("RUN TIME");
	expect(rowOf(frame, "a")).toMatch(/ 50m 0s +\$5\.00 /);
	expect(rowOf(frame, "b")).toMatch(/ 0s +\$0\.00 /);
});

test("a running Goal's run time counts its open Run so far and keeps counting", async () => {
	const ago = (ms: number) => new Date(Date.now() - ms);
	const root = await makeProject({
		".vago-goals/a/goal.md": goalText("w"),
		".vago-goals/a/tickets/01-t.md": ticketText("done", {
			runs: [
				{
					step: "design",
					started: ago(3 * 3600_000),
					ended: ago(3 * 3600_000 - 600_000),
					outcome: "ok",
				},
			],
		}),
		".vago-goals/a/tickets/02-t.md": ticketText("running", {
			runs: [{ step: "design", started: ago(2000) }],
		}),
	});
	await heldLock(root, "a");

	const view = await renderView(root, wide);
	const first = rowOf(await frameWith(view, "● running"), "a");
	const seconds = (row: string) => Number(row.match(/ 10m (\d+)s /)?.[1]);
	expect(seconds(first)).toBeGreaterThanOrEqual(2);

	for (let tries = 0; ; tries++) {
		const row = rowOf(await frameWith(view, " a "), "a");
		if (seconds(row) > seconds(first)) break;
		if (tries === 300) throw new Error(`The run time stays put:\n${row}`);
		await Bun.sleep(10);
	}
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
	expect(rows.map((row) => Bun.stringWidth(row))).toEqual([120, 120, 120]);
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
	"#f0f0f0",
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

test("at 80 wide the run time, cost and title columns drop out", async () => {
	const root = await projectOfEveryStanding();

	const view = await renderView(root, { width: 80, height: 30 });
	const frame = await frameWith(view, " 6 Goals");

	const headings = frame.split("\n").find((line) => line.includes("STATE"));
	expect(headings).not.toContain("RUN TIME");
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

// The frame's line that holds `text`, or a failure naming it.
function lineWith(frame: string, text: string): string {
	const line = frame.split("\n").find((each) => each.includes(text));
	if (line === undefined) throw new Error(`No line shows ${text}:\n${frame}`);
	return line;
}

// The hour and minute `time` shows in the preview, in the local time zone.
const clock = (time: Date) => time.toTimeString().slice(0, 5);

test("the preview shows the selected Goal, and moving the selection changes it", async () => {
	const root = await makeProject({
		".vago-goals/a/goal.md": goalText("one", "# First title\n\nAbout a.\n"),
		".vago-goals/b/goal.md": goalText("two", "# Second title\n\nAbout b.\n"),
	});
	const view = await renderView(root, wide);

	const first = await frameWith(view, "First title");
	expect(first).toContain("About a.");
	expect(first).toContain("Workflow one");

	view.mockInput.pressArrow("down");
	const second = await frameWith(view, "Second title");
	expect(second).toContain("About b.");
	expect(second).toContain("Workflow two");
	expect(second).not.toContain("About a.");
});

test("the preview shows when a Goal was created and its number of Tickets", async () => {
	// Midday, so the date is the same in every time zone the tests run in.
	const created = new Date("2026-09-30T12:00:00Z");
	const root = await makeProject({
		".vago-goals/a/goal.md": `+++\nworkflow = "w"\ncreated = ${created.toISOString()}\n+++\n# A\n`,
		".vago-goals/a/tickets/01-one.md": ticketText("done"),
		".vago-goals/a/tickets/02-two.md": ticketText("ready"),
		".vago-goals/b/goal.md": goalText("w"),
	});
	const view = await renderView(root, wide);

	const frame = await frameWith(view, "LATEST RUNS");
	expect(lineWith(frame, "Workflow w")).toContain("created 2026-09-30");
	expect(frame).toContain("1/2 Tickets");

	view.mockInput.pressArrow("down");
	const old = await frameWith(view, "0/0 Tickets");
	expect(lineWith(old, "Workflow w")).not.toContain("created");
});

test("a running Goal's preview shows its latest eight Runs, newest first", async () => {
	const runs = Array.from({ length: 9 }, (_, index) => ({
		step: `step${index + 1}`,
		started: at(`0${index}:00`),
		ended: at(`0${index}:05`),
		outcome: "ok",
		costUsd: index % 2 === 0 ? 1.25 : undefined,
	}));
	const root = await makeProject({
		".vago-goals/a/goal.md": goalText("w"),
		".vago-goals/a/tickets/01-first.md": ticketText("done", { runs }),
		".vago-goals/a/tickets/02-second.md": ticketText("running", {
			runs: [{ step: "review", started: at("10:00") }],
		}),
	});
	await heldLock(root, "a");

	const view = await renderView(root, wide);
	const frame = await frameWith(view, "LATEST RUNS");

	const shown = frame
		.split("\n")
		.filter((line) => /\d\d:\d\d \d\d /.test(line))
		.map((line) => /\d\d:\d\d \d\d (\w+)/.exec(line)?.[1]);
	expect(shown).toEqual([
		"review",
		"step9",
		"step8",
		"step7",
		"step6",
		"step5",
		"step4",
		"step3",
	]);
	expect(lineWith(frame, `${clock(at("10:00"))} 02 review`)).toContain(
		"● live",
	);
	expect(lineWith(frame, "step9")).toMatch(/✓ ok +5m 0s +\$1\.25/);
	expect(lineWith(frame, "step8")).toMatch(/✓ ok +5m 0s +$/);
	expect(lineWith(frame, "Workflow w")).toMatch(/last activity .+ ago/);
	expect(frame).toContain("1/2 Tickets");
});

test("a stuck Goal's preview shows the failed Run's outcome", async () => {
	const root = await projectWithTickets({
		"01-first": ticketText("stuck", {
			runs: [
				{
					step: "check",
					started: at("09:00"),
					ended: at("09:02"),
					outcome: "exit 1",
				},
			],
		}),
	});

	const view = await renderView(root, wide);
	const frame = await frameWith(view, "LATEST RUNS");

	expect(lineWith(frame, "01 check")).toMatch(/✗ exit 1 +2m 0s/);
	expect(frame).toContain("0/1 Tickets");
});

test("a done Goal's preview shows every Ticket done and how long ago it ended", async () => {
	const root = await projectWithTickets({
		"01-first": ticketText("done", {
			runs: [
				{
					step: "merge",
					started: at("09:00"),
					ended: at("09:01"),
					outcome: "ok",
					costUsd: 0.5,
				},
			],
		}),
	});

	const view = await renderView(root, wide);
	const frame = await frameWith(view, "LATEST RUNS");

	expect(lineWith(frame, "01 merge")).toMatch(/✓ ok +1m 0s +\$0\.50/);
	expect(frame).toContain("1/1 Tickets");
	expect(lineWith(frame, "Workflow w")).toMatch(/last activity \d+d \d+h ago/);
});

test("the description reads as paragraphs and is cut to the space it has", async () => {
	const wrapped = Array.from(
		{ length: 40 },
		(_, index) => `line${index} of a paragraph hard-wrapped at 75 columns`,
	).join("\n");
	const root = await makeProject({
		".vago-goals/a/goal.md": goalText(
			"w",
			`# Title\n\nShort first paragraph\nends here.\n\n${wrapped}\n`,
		),
	});

	const view = await renderView(root, wide);
	const frame = await frameWith(view, "LATEST RUNS");

	expect(frame).toContain("Short first paragraph ends here.");
	expect(frame).toMatch(/columns line\d+ of/);
	expect(frame).not.toContain("line39");
	const lines = frame.trimEnd().split("\n");
	expect(lines.at(-2)).toMatch(/^ *$/);
});

test("moving the cursor shifts no row of the table or the preview", async () => {
	const root = await makeProject({
		".vago-goals/a/goal.md": goalText("w", `# A\n\n${"word ".repeat(400)}\n`),
		".vago-goals/a/tickets/01-t.md": ticketText("done", {
			runs: Array.from({ length: 9 }, (_, index) => ({
				step: "merge",
				started: at(`0${index}:00`),
				ended: at(`0${index}:01`),
				outcome: "ok",
			})),
		}),
		".vago-goals/b/goal.md": goalText("w", "# B\n"),
	});
	const view = await renderView(root);
	const slots = (frame: string) =>
		[" a ", " b ", "LATEST RUNS", "Workflow w", "Tickets"].map((text) =>
			lineOf(frame, text),
		);

	const first = slots(await frameWith(view, " 1/2 "));
	view.mockInput.pressArrow("down");
	const second = slots(await frameWith(view, " 2/2 "));

	expect(first).not.toContain(-1);
	expect(second).toEqual(first);
});

// Writes `text` to the file at `path` under the Project at `root`.
const rewrite = (root: string, path: string, text: string) =>
	Bun.write(join(root, path), text);

test("a Ticket's status changing on disk shows with no key pressed", async () => {
	const root = await projectWithTickets({ "01-first": ticketText("ready") });
	const view = await renderView(root, wide);
	await frameWith(view, "0/1");

	await rewrite(root, ".vago-goals/a/tickets/01-first.md", ticketText("done"));

	expect(rowOf(await frameWith(view, "finished"), "a")).toContain(" 1/1 ");
});

test("a Run starting and then ending shows with no key pressed", async () => {
	const design = {
		step: "design",
		started: at("09:00"),
		ended: at("09:10"),
		outcome: "ok",
	};
	const root = await projectWithTickets({
		"01-first": ticketText("done"),
		"02-second": ticketText("running", { runs: [design] }),
	});
	await heldLock(root, "a");
	const view = await renderView(root, wide);
	await frameWith(view, `${clock(at("09:00"))} 02 design`);
	const architecture = `${clock(at("09:10"))} 02 architecture`;
	const second = ".vago-goals/a/tickets/02-second.md";

	await rewrite(
		root,
		second,
		ticketText("running", {
			runs: [design, { step: "architecture", started: at("09:10") }],
		}),
	);
	expect(lineWith(await frameWith(view, architecture), architecture)).toContain(
		"● live",
	);

	await rewrite(
		root,
		second,
		ticketText("running", {
			runs: [
				design,
				{
					step: "architecture",
					started: at("09:10"),
					ended: at("09:25"),
					outcome: "ok",
				},
			],
		}),
	);
	expect(lineWith(await frameWith(view, "15m 0s"), architecture)).toMatch(
		/✓ ok +15m 0s/,
	);
});

for (const [how, drop] of [
	["holder dies", (lock: HeldLock) => lock.release()],
	[
		"file is deleted",
		(_lock: HeldLock, root: string) =>
			rm(join(root, ".vago-goals/a/running.lock")),
	],
] as const) {
	test(`a Goal turns lost with no key pressed when its lock's ${how}`, async () => {
		const root = await lostProject();
		const lock = await heldLock(root, "a");
		const view = await renderView(root, wide);
		await frameWith(view, "● running");

		await drop(lock, root);

		expect(rowOf(await frameWith(view, " 0 running"), "a")).toContain("? lost");
	});
}

test("a Goal added on disk shows with no key pressed", async () => {
	const root = await projectWithGoals(["a", "b"]);
	const view = await renderView(root);
	await frameWith(view, " 1/2 ");

	await rewrite(root, ".vago-goals/c/goal.md", goalText("w"));

	expect(rowOf(await frameWith(view, " 1/3 "), "c")).toContain("○ ready");
});

// Makes Goal `gamma` of the Project at `root` run: a held lock and a running
// Ticket, so its row moves to the top.
async function startGamma(root: string): Promise<void> {
	await rewrite(
		root,
		".vago-goals/gamma/tickets/01-first.md",
		ticketText("running", { runs: [{ step: "design", started: at("09:00") }] }),
	);
	await heldLock(root, "gamma");
}

test("a lock taken shows with no key pressed, and the selection stays on its Goal", async () => {
	const root = await projectWithGoals(["alpha", "beta", "gamma"]);
	const view = await renderView(root);
	await frameWith(view, " 1/3 ");
	view.mockInput.pressArrow("down");
	await frameWith(view, " 2/3 ");
	expect(isAccented(view, "beta")).toBe(true);

	await startGamma(root);

	const frame = await frameWith(view, "● running");
	expect(lineOf(frame, " gamma ")).toBeLessThan(lineOf(frame, " alpha "));
	expect(isAccented(view, "beta")).toBe(true);
	expect(frame).toContain(" 3/3 ");
});

test("before any key the selection stays on the first Goal read when rows reorder", async () => {
	const root = await projectWithGoals(["alpha", "beta", "gamma"]);
	const view = await renderView(root);
	await frameWith(view, " 1/3 ");
	expect(isAccented(view, "alpha")).toBe(true);

	await startGamma(root);

	const frame = await frameWith(view, "● running");
	expect(lineOf(frame, " gamma ")).toBeLessThan(lineOf(frame, " alpha "));
	expect(isAccented(view, "alpha")).toBe(true);
	expect(frame).toContain(" 2/3 ");
});

test("a Ticket broken on disk turns its Goal broken, and fixing it brings the Goal back", async () => {
	const root = await projectWithTickets({ "01-first": ticketText("ready") });
	const view = await renderView(root, wide);
	await frameWith(view, "0/1");
	const first = ".vago-goals/a/tickets/01-first.md";

	await rewrite(root, first, "+++\nstatus = \n");
	expect(rowOf(await frameWith(view, "broken"), "a")).toMatch(
		/! broken +a +━+ 0\/0 +0s +\$0\.00 +\.vago-goals\/a\/tickets\/01-first\.md /,
	);

	await rewrite(root, first, ticketText("done"));
	expect(rowOf(await frameWith(view, "finished"), "a")).toContain(" 1/1 ");
});

for (const [what, tickets, error] of [
	[
		"a bad Ticket header",
		{ "01-a": '+++\nstatus = "nope"\n+++\n' },
		".vago-goals/bad/tickets/01-a.md: ",
	],
	[
		"a blocker cycle",
		{
			"01-a": ticketText("ready", { blockedBy: [2] }),
			"02-b": ticketText("ready", { blockedBy: [1] }),
		},
		"Goal bad has a blocker cycle in .vago-goals/bad/tickets: 01-a -> 02-b",
	],
] as const) {
	test(`a Goal with ${what} shows as one broken row with its error, and the others as normal`, async () => {
		const root = await makeProject({
			".vago-goals/bad/goal.md": goalText("w"),
			...Object.fromEntries(
				Object.entries(tickets).map(([name, text]) => [
					`.vago-goals/bad/tickets/${name}.md`,
					text,
				]),
			),
			".vago-goals/good/goal.md": goalText("w"),
		});

		const view = await renderView(root, wide);
		const frame = await frameWith(view, " good ");

		expect(rowOf(frame, "bad")).toMatch(/! broken +bad +━+ 0\/0 /);
		expect(rowOf(frame, "bad")).toContain(error.slice(0, 30));
		expect(rowOf(frame, "good")).toMatch(/○ ready +good .+ ready to start/);
		expect(frame).toContain("1 need you");
		expect(frame.match(/ broken /g)).toHaveLength(1);
		// The preview, on the broken Goal, shows the whole error.
		expect(frame.replace(/[│\s]+/g, " ")).toContain(error);
	});
}

// Every Goal standing, and more Goals than the Goals box shows at 20 rows,
// so its scrollbar draws too.
async function projectThatScrolls(): Promise<string> {
	const root = await projectOfEveryStanding();
	for (const goal of ["f-more", "g-more"]) {
		await rewrite(
			root,
			`.vago-goals/${goal}/goal.md`,
			goalText("w", `# ${"A long title ".repeat(12)}\n\nSome words.\n`),
		);
	}
	return root;
}

const short = { width: 120, height: 20 };

test("under NO_COLOR every text takes the terminal's own colours, dim and inverse keep their meaning", async () => {
	setEnv({ NO_COLOR: "1" });
	const root = await projectThatScrolls();

	const view = await renderView(root, short);
	await frameWith(view, " 8 Goals");

	const spans = view
		.captureSpans()
		.lines.flatMap((line) => line.spans)
		.filter((span) => span.text.trim() !== "");
	const coloured = spans
		.filter((span) => span.fg.intent !== "default")
		.map((span) => span.text);
	expect(coloured).toEqual([]);
	// A whole word, so the Project's random temp name, which may hold a `q`,
	// never matches.
	const spanWith = (word: string) =>
		spans.find((span) => span.text.split(/\s+/).includes(word));
	expect((spanWith("e-run")?.attributes ?? 0) & TextAttributes.INVERSE).toBe(
		TextAttributes.INVERSE,
	);
	expect((spanWith("b-ready")?.attributes ?? 0) & TextAttributes.INVERSE).toBe(
		0,
	);
	expect((spanWith("STATE")?.attributes ?? 0) & TextAttributes.DIM).toBe(
		TextAttributes.DIM,
	);
	// In the footer the keys stay bright and only their labels are dim.
	expect((spanWith("q")?.attributes ?? 0) & TextAttributes.DIM).toBe(0);
	expect((spanWith("Quit")?.attributes ?? 0) & TextAttributes.DIM).toBe(
		TextAttributes.DIM,
	);
});

test("under VAGO_ASCII=1 every symbol, bar and border is ASCII", async () => {
	setEnv({ VAGO_ASCII: "1" });
	const root = await projectThatScrolls();

	const view = await renderView(root, short);
	const frame = await frameWith(view, " 8 Goals");

	expect(frame).toMatch(onlyAscii);
	expect(rowOf(frame, "e-run")).toMatch(/^ {2}\* running +e-run +=+ 0\/1 /);
	expect(rowOf(frame, "d-lost")).toContain("? lost");
	expect(rowOf(frame, "c-stuck")).toContain("x stuck");
	expect(rowOf(frame, "b-ready")).toContain("o ready");
	view.mockInput.pressKey("G");
	const last = await frameWith(view, " 8/8 ");
	expect(last).toMatch(onlyAscii);
	expect(rowOf(last, "a-old")).toContain("+ done");
	view.mockInput.pressKey("?");
	expect(await frameWith(view, " Keys ")).toMatch(onlyAscii);
});

// Whether no text of `frame` spills: every line inside a box ends on its
// right border, and no row of the Goals box is drawn over.
function holdsTogether(frame: string, width: number): void {
	const lines = frame.split("\n").slice(1, -2);
	expect(lines.length).toBeGreaterThan(0);
	for (const line of lines) {
		expect(Bun.stringWidth(line)).toBe(width);
		expect(line).toMatch(/^([─┬┴┼├┤]+| {2}.*[ █▀▄] )$/);
	}
}

for (const size of [
	{ width: 60, height: 24 },
	{ width: 80, height: 24 },
]) {
	test(`at ${size.width}×${size.height} nothing overlaps or spills`, async () => {
		const root = await projectThatScrolls();

		const view = await renderView(root, size);
		const frame = await frameWith(view, " 8 Goals");

		holdsTogether(frame, size.width);
		const lines = frame.split("\n");
		expect(lines[0]).toMatch(
			/^ \S+ · 8 Goals +1 running · 2 need you · \$\d+\.\d\d spent *$/,
		);
		for (const goal of ["e-run", "d-lost", "c-stuck", "b-ready"]) {
			expect(rowOf(frame, goal)).toMatch(
				/^ {2}[●?✗○✓] \w+ +[\w-]+ +━+ \d+\/\d+ /,
			);
		}
		expect(frame).toContain("Workflow w");
		expect(lines.at(-2)).toContain("q Quit");
	});
}

test("a resize redraws the view to the new size", async () => {
	const root = await projectOfEveryStanding();
	const view = await renderView(root);
	await frameWith(view, " 6 Goals");

	view.resize(60, 24);
	const narrow = await frameWith(view, `\n${"─".repeat(60)}\n`);
	holdsTogether(narrow, 60);

	view.resize(120, 30);
	const wider = await frameWith(view, "RUN TIME");
	holdsTogether(wider, 120);
	expect(wider.split("\n")).toHaveLength(31);
});

test("s starts the selected ready Goal in its own vago run, which shows as running", async () => {
	setEnv({ VAGO_HOME: vagoHome });
	const root = await makeProject({
		".vago/workflows/w.toml": oneStep("sleep 1"),
		".vago-goals/a/goal.md": goalText("w"),
		".vago-goals/a/tickets/01-t.md": ticketText("ready"),
	});
	const view = await renderView(root);
	expect(rowOf(await frameWith(view, " 1/1 "), "a")).toContain("ready");

	view.mockInput.pressKey("s");

	expect(await frameWith(view, "Started vago run a")).toBeDefined();
	expect(rowOf(await frameWith(view, "01 work"), "a")).toContain("running");
	expect(rowOf(await frameWith(view, "finished"), "a")).toContain("done");
});
