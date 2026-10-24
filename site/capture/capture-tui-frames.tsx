// Captures the site's TUI frames: renders Vago's real Project view headless over the invented example
// Project, plays its running Goal's replayed Ticket through its Steps, and writes every screen a visitor can
// reach, per replay moment, with per-cell colours and where its panes are, to the path it is given. Runs
// with the product's dependencies from the repo root: `cd site && bun run capture`. Hides the fake clock,
// the views and keys it drives, and how a frame is packed.

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	BoxRenderable,
	type CapturedLine,
	parseColor,
	type Renderable,
} from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { readGoalRows } from "../../src/tui/goal-rows.ts";
import { ProjectView } from "../../src/tui/project-view.tsx";
import { theme } from "../../src/tui/theme.ts";
import type {
	TuiBox,
	TuiFrame,
	TuiFrames,
	TuiGoal,
	TuiLine,
	TuiPaneName,
	TuiRun,
	TuiScreen,
	TuiStyle,
} from "../src/tui/tui-frames.ts";
import { goalPaneCount, screenKey } from "../src/tui/tui-frames.ts";
import { exampleProject } from "./acme-shop.ts";
import { writeExampleProject } from "./example-project.ts";
import { installFakeClock, setFakeTime, tickIntervals } from "./fake-clock.ts";

const size = { width: 120, height: 34 };
// The replay's first moment, fixed so every capture draws the same clocks and dates.
const start = new Date("2026-10-21T14:20:00Z");
// The colour of an unfocused pane's title; the focused one's differs.
const unfocused = hex(...parseColor(theme().color.bright).toInts().slice(0, 3));

const out = process.argv[2];
if (out === undefined)
	throw new Error("Usage: capture-tui-frames.tsx <frames.json>");
installFakeClock(start);
// The site shows the TUI in colour, with its own symbols.
delete process.env.NO_COLOR;
delete process.env.VAGO_ASCII;

const temp = await mkdtemp(join(tmpdir(), "vago-capture-"));
const root = join(temp, exampleProject);
const replay = await writeExampleProject(
	root,
	start,
	join(import.meta.dir, "..", "..", "starter"),
);
try {
	const frames = await capture();
	await mkdir(dirname(out), { recursive: true });
	await Bun.write(out, `${JSON.stringify(frames)}\n`);
} finally {
	replay.stop();
	await rm(temp, { recursive: true, force: true });
}
// The views' renderers keep the process alive.
process.exit(0);

async function capture(): Promise<TuiFrames> {
	setFakeTime(await replay.showPhase(0));
	const rows = await readGoalRows(root, new Date());
	const table = frameTable();
	const screens: Record<string, number[]> = {};
	const shot = (screen: TuiScreen, view: TestRendererSetup, goal: string) => {
		const key = screenKey(screen);
		screens[key] = [...(screens[key] ?? []), table.add(view, goal)];
	};

	// One view at a time, so each moment the files change is read once: the Goals list walked down, then
	// each Goal open, walked through its Tickets and panes, at every moment of the replay.
	const list = await openView();
	for (const [phase] of replay.phases.entries()) {
		await showPhase(phase, list);
		for (const [goal, row] of rows.entries()) {
			if (goal > 0) await press(list, () => list.mockInput.pressArrow("down"));
			shot({ view: "project", goal }, list, row.goal);
		}
		await press(list, () => list.mockInput.pressKey("g"));
	}
	list.renderer.destroy();

	const goals: TuiGoal[] = [];
	for (const [goal, row] of rows.entries()) {
		const view = await openView();
		for (let i = 0; i < goal; i++) view.mockInput.pressArrow("down");
		await press(view, () => view.mockInput.pressEnter());
		const tickets = ticketsPane(view, row.goal);
		const openTicket: number[] = [];
		for (const [phase] of replay.phases.entries()) {
			await showPhase(phase, view);
			// A fresh view, since the Goal view opened again keeps its selection.
			const opened = await openView();
			for (let i = 0; i < goal; i++) opened.mockInput.pressArrow("down");
			await press(opened, () => opened.mockInput.pressEnter());
			openTicket.push(ticketsPane(opened, row.goal).selected);
			opened.renderer.destroy();
			for (let i = 0; i < tickets.count; i++) view.mockInput.pressArrow("up");
			for (let ticket = 0; ticket < tickets.count; ticket++) {
				if (ticket > 0) view.mockInput.pressArrow("down");
				for (let pane = 0; pane < goalPaneCount; pane++) {
					if (pane > 0) view.mockInput.pressTab();
					await settle(view);
					shot({ view: "goal", goal, ticket, pane }, view, row.goal);
				}
				view.mockInput.pressTab();
			}
		}
		goals.push({
			name: row.goal,
			tickets: tickets.count,
			openTicket: openTicket.every((each) => each === openTicket[0])
				? openTicket.slice(0, 1)
				: openTicket,
			standing: row.standing,
		});
		view.renderer.destroy();
	}
	// A screen the replay never changes keeps one frame.
	for (const [key, phases] of Object.entries(screens))
		if (phases.every((frame) => frame === phases[0]))
			screens[key] = phases.slice(0, 1);

	const running = rows.findIndex((row) => row.standing === "running");
	const helpView = await openView();
	for (let i = 0; i < running; i++) helpView.mockInput.pressArrow("down");
	await press(helpView, () => helpView.mockInput.pressKey("?"));
	const projectHelp = table.addHelp(helpView);
	await press(helpView, () => helpView.mockInput.pressKey("?"));
	await press(helpView, () => helpView.mockInput.pressEnter());
	await press(helpView, () => helpView.mockInput.pressKey("?"));
	const goalHelp = table.addHelp(helpView);
	helpView.renderer.destroy();

	return {
		size,
		project: exampleProject,
		replay: {
			goal: replay.goal,
			ticket: replay.ticket,
			next: replay.next,
			phases: replay.phases,
		},
		goals,
		styles: table.styles,
		lines: table.lines,
		frames: table.frames,
		screens,
		help: { project: projectHelp, goal: goalHelp },
	};
}

// The Project view of the example Project, its first Goal selected.
async function openView(): Promise<TestRendererSetup> {
	const view = await testRender(
		() => (
			<ProjectView root={root} vago={["false"]} harnesses={["claude-code"]} />
		),
		{ ...size, exitOnCtrlC: false },
	);
	await settle(view);
	return view;
}

// Writes the files as they stand at the replay's moment `phase`, sets the clock to it, and lets `view`
// read them.
async function showPhase(
	phase: number,
	view: TestRendererSetup,
): Promise<void> {
	setFakeTime(await replay.showPhase(phase));
	await settle(view);
}

async function press(view: TestRendererSetup, key: () => void): Promise<void> {
	key();
	await settle(view);
}

// How many rows the open Goal's Tickets pane has, and which it opened on, from its title's `n/m`.
function ticketsPane(
	view: TestRendererSetup,
	goal: string,
): { count: number; selected: number } {
	const title = /Tickets\s+(\d+)\/(\d+)/.exec(view.captureCharFrame());
	if (title === null) throw new Error(`${goal} opened no Tickets pane`);
	return { count: Number(title[2]), selected: Number(title[1]) - 1 };
}

// Lets `view` read what changed on disk or what a key asked for, and draw it, until two rounds draw the
// same. The TUI's reads run on its intervals, which the fake clock runs each round; a read a key starts
// gets a moment of its own.
async function settle(view: TestRendererSetup): Promise<void> {
	let last = "";
	for (let round = 0; round < 20; round++) {
		await tickIntervals();
		await Bun.sleep(2);
		await view.renderOnce();
		const drawn = view.captureCharFrame();
		if (drawn === last) return;
		last = drawn;
	}
	throw new Error("The TUI kept changing after 20 rounds");
}

// The tables a frame is packed into: every style, line and frame once, referred to by index.
function frameTable() {
	const styles: TuiStyle[] = [];
	const lines: TuiLine[] = [];
	const frames: TuiFrame[] = [];
	const indexes = new Map<string, number>();
	const intern = <T,>(list: T[], kind: string, item: T): number => {
		const key = `${kind}${JSON.stringify(item)}`;
		let index = indexes.get(key);
		if (index === undefined) {
			index = list.push(item) - 1;
			indexes.set(key, index);
		}
		return index;
	};
	const rowsOf = (spans: CapturedLine[]): number[] =>
		spans.map((line) => {
			const runs: TuiRun[] = [];
			for (const span of line.spans) {
				const [r = 0, g = 0, b = 0] = span.fg.toInts();
				const [br = 0, bg = 0, bb = 0, ba = 0] = span.bg.toInts();
				// The terminal's own colours are the page's terminal colours.
				const ownFg = span.fg.intent === "default";
				const ownBg = span.bg.intent === "default" || ba === 0;
				// The TUI's bold, not its dim: the page keeps every text it draws legible.
				const style = intern(styles, "s", {
					...(ownFg ? {} : { fg: hex(r, g, b) }),
					...(ownBg ? {} : { bg: hex(br, bg, bb) }),
					bold: (span.attributes & 1) === 1,
				});
				const last = runs.at(-1);
				if (last !== undefined && last.style === style)
					last.cells += span.width;
				else runs.push({ cells: span.width, style });
			}
			const chars = line.spans.map((span) => span.text).join("");
			return intern(lines, "l", { text: chars.trimEnd(), runs });
		});
	// The screen `view` shows, which shows Goal `goal`.
	const add = (view: TestRendererSetup, goal: string): number => {
		const text = view.captureCharFrame().split("\n");
		const spans = view.captureSpans().lines;
		const panes = boxes(view)
			.filter((box) => !box.help)
			.map(({ box }) => ({
				name: paneName(text, box, goal),
				box,
				// An unfocused pane's title is bright; the focused one's isn't.
				focused: letterColour(spans, box.row + 1, box.column + 1) !== unfocused,
			}));
		return intern(frames, "f", { rows: rowsOf(spans), panes });
	};
	const addHelp = (view: TestRendererSetup) => {
		const box = boxes(view).find((each) => each.help)?.box;
		if (box === undefined) throw new Error("? drew no help box");
		// Its panes lie under the box, so the frame names none.
		return {
			frame: intern(frames, "f", {
				rows: rowsOf(view.captureSpans().lines),
				panes: [],
			}),
			box,
		};
	};
	return { styles, lines, frames, add, addHelp };
}

// The foreground of the first letter at or after `column` of `row`, past the pane's own line.
function letterColour(
	spans: CapturedLine[],
	row: number,
	column: number,
): string {
	let at = 0;
	for (const span of spans[row]?.spans ?? []) {
		at += span.width;
		if (at > column && span.text.trim() !== "")
			return hex(...span.fg.toInts().slice(0, 3));
	}
	return "";
}

function hex(...channels: number[]): string {
	return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

// Every bordered box on screen, which is a pane of the grid, or the help box, the one with a title.
function boxes(view: TestRendererSetup): { box: TuiBox; help: boolean }[] {
	const found: { box: TuiBox; help: boolean }[] = [];
	const walk = (renderable: Renderable) => {
		if (!renderable.visible) return;
		if (renderable instanceof BoxRenderable && renderable.border !== false)
			found.push({
				box: {
					row: renderable.y,
					column: renderable.x,
					rows: renderable.height,
					columns: renderable.width,
				},
				help: Boolean(renderable.title),
			});
		for (const child of renderable.getChildren()) walk(child as Renderable);
	};
	walk(view.renderer.root);
	return found;
}

// A pane's name from its title, the first words of the row inside its top line. The Project view's
// preview is titled with its Goal's name. A title it doesn't know fails the capture, so a pane the TUI
// adds or renames gets a name here.
function paneName(text: string[], box: TuiBox, goal: string): TuiPaneName {
	const title =
		text[box.row + 1]
			?.slice(box.column + 1, box.column + box.columns)
			.trim()
			.split(/\s{2,}/)[0] ?? "";
	if (title === "Goals") return "Goals";
	if (title === goal) return "Goal";
	if (title === "Tickets") return "Tickets";
	// Goal Steps show in the Ticket pane, as a Ticket of their own.
	if (/^(Ticket|before_all|after_all)\b/.test(title)) return "Ticket";
	if (title.startsWith("Runs")) return "Runs";
	if (/^Run\b/.test(title)) return "Run activity";
	throw new Error(`A pane titled "${title}" has no name on the site`);
}
