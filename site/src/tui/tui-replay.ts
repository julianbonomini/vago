// The replay of the example Project as a state the keys move: which screen shows, at which moment of the
// replayed Ticket, and what each of Vago's keys does to it, the way the real TUI's Project and Goal views
// handle them. Keys the captured frames can't follow leave the state and say so. Owns the captured frames;
// nothing here touches the page.

import data from "./tui-frames.json";
import {
	goalPaneCount,
	screenKey,
	type TuiFrames,
	type TuiHelp,
	type TuiPaneName,
} from "./tui-frames.ts";

/** The captured frames, as `bun run capture` wrote them. */
export const tuiFrames = data as TuiFrames;

/** What the replay shows: the Goals list on its `goal`th Goal, or that Goal open on its `ticket`th row with
 *  the focus on the pane `pane` Tabs reach, the help laid over either, at moment `phase` of the replay. */
export type ReplayState = {
	view: "project" | "goal";
	goal: number;
	ticket: number;
	pane: number;
	help: boolean;
	phase: number;
};

/** Where a page sends the replay. Each field left out keeps what shows, except that a new `goal` opens on
 *  the row it opens on. */
export type ReplayPlace = {
	/** "project" for the Goals list, "goal" for the Goal open. */
	view?: "project" | "goal";
	/** A Goal of the example Project by name, such as "order-export". */
	goal?: string;
	/** A row of the open Goal's Tickets pane, from 0. */
	ticket?: number;
	/** The pane the open Goal's focus is on. */
	pane?: TuiPaneName;
	help?: boolean;
	/** How far through the replay, from 0, its first moment, to 1, its last. */
	time?: number;
};

/** What a key did: the state after it, a line saying why it changed nothing, or `taken: false` when the
 *  key isn't one of Vago's and belongs to the page. */
export type ReplayKeyResult = {
	state: ReplayState;
	notice?: string;
	taken: boolean;
};

const lastPhase = tuiFrames.replay.phases.length - 1;
const running = Math.max(
	0,
	tuiFrames.goals.findIndex(({ name }) => name === tuiFrames.replay.goal),
);

/** The Goals list on the running Goal, at the fourth moment of Build, its Run well under way, where the
 *  replay rests when nothing plays. */
export const restingState: ReplayState = {
	view: "project",
	goal: running,
	ticket: 0,
	pane: 0,
	help: false,
	phase: Math.max(0, tuiFrames.replay.phases.indexOf("Build") + 3),
};

/** `state` moved to `place`. */
export function placeReplay(
	state: ReplayState,
	place: ReplayPlace,
): ReplayState {
	let next = { ...state };
	// The moment first: which row a Goal opens on depends on it.
	if (place.time !== undefined)
		next.phase = Math.round(Math.max(0, Math.min(1, place.time)) * lastPhase);
	if (place.goal !== undefined) {
		const goal = tuiFrames.goals.findIndex(({ name }) => name === place.goal);
		if (goal < 0)
			throw new Error(`The example Project has no Goal ${place.goal}`);
		next = openGoal({ ...next, goal }, goal);
	}
	if (place.view === "project") next.view = "project";
	if (place.view === "goal" && next.view === "project")
		next = { ...openGoal(next, next.goal), view: "goal" };
	if (place.ticket !== undefined)
		next.ticket = clamp(place.ticket, ticketCount(next.goal));
	if (place.pane !== undefined) {
		const pane = paneIndex(next, place.pane);
		if (pane === undefined)
			throw new Error(`The Goal view has no pane ${place.pane}`);
		next.pane = pane;
	}
	if (place.help !== undefined) next.help = place.help;
	return next;
}

// The Goal `goal` opened as the Goal view opens it, keeping the view if it's the Goals list's.
function openGoal(state: ReplayState, goal: number): ReplayState {
	return {
		...state,
		goal,
		ticket: openTicket(goal, state.phase),
		pane: 0,
	};
}

/** `state` one moment on, back to the first after the last. */
export function nextPhase(state: ReplayState): ReplayState {
	return { ...state, phase: state.phase === lastPhase ? 0 : state.phase + 1 };
}

/** How far through the replay `state` is, from 0 to 1. */
export function replayTime(state: ReplayState): number {
	return lastPhase === 0 ? 0 : state.phase / lastPhase;
}

/** Whether `state` is at the replay's last moment, which holds longer. */
export function isLastPhase(state: ReplayState): boolean {
	return state.phase === lastPhase;
}

/** What the replayed Ticket is doing at `state`'s moment, such as "Ticket 03 · Build". */
export function replayLabel(state: ReplayState): string {
	const { ticket, next } = tuiFrames.replay;
	const step = replayStep(state);
	return step === undefined
		? `Ticket ${ticket} merged, ${next} starts`
		: `Ticket ${ticket} · ${step}`;
}

/** The Step of its Workflow the replayed Ticket is on at `state`'s moment, by the name the Workflow gives
 *  it, such as "Build"; undefined once the Ticket is merged. */
export function replayStep(state: ReplayState): string | undefined {
	const label = tuiFrames.replay.phases[state.phase];
	return label === "Done" ? undefined : label;
}

/** The frame `state` shows, and the help laid over it when the help is open. */
export function replayFrame(state: ReplayState): {
	frame: number;
	help?: TuiHelp;
} {
	const phases =
		tuiFrames.screens[
			screenKey(
				state.view === "project"
					? { view: "project", goal: state.goal }
					: {
							view: "goal",
							goal: state.goal,
							ticket: state.ticket,
							pane: state.pane,
						},
			)
		] ?? [];
	const frame = phases[Math.min(state.phase, phases.length - 1)] ?? 0;
	return state.help ? { frame, help: tuiFrames.help[state.view] } : { frame };
}

/** The name of the pane `state`'s focus is on. */
export function focusedPane(state: ReplayState): TuiPaneName | undefined {
	const { frame } = replayFrame({ ...state, help: false });
	return tuiFrames.frames[frame]?.panes.find(({ focused }) => focused)?.name;
}

// How many Tabs from the first pane reach the pane named `name` in the Goal view `state` shows.
function paneIndex(state: ReplayState, name: TuiPaneName): number | undefined {
	for (let pane = 0; pane < goalPaneCount; pane++)
		if (focusedPane({ ...state, view: "goal", pane }) === name) return pane;
	return undefined;
}

// Why a key of the real TUI changes nothing in the replay, for the keys each view uses.
const paging = "Paging isn't in the replay.";
const start = "s starts the Goal in vago run. The replay doesn't run anything.";
const quit = "q quits the TUI. Here there's nothing to quit.";
const projectNotices: Record<string, string> = {
	s: start,
	n: "n plans a new Goal with an agent. Not in the replay.",
	q: quit,
	PageUp: paging,
	PageDown: paging,
	" ": paging,
};
const otherRun = "←→ pick another Run of the Ticket. Not in the replay.";
const goalNotices: Record<string, string> = {
	s: start,
	q: quit,
	t: "t shows the Ticket on the whole screen. Not in the replay.",
	r: "r shows the Run on the whole screen. Not in the replay.",
	e: "e picks an edit of the Run. Not in the replay.",
	d: "d shows an edit's diff. Not in the replay.",
	G: "G follows the live Run. The replay always does.",
	ArrowLeft: otherRun,
	ArrowRight: otherRun,
	h: otherRun,
	l: otherRun,
	PageUp: paging,
	PageDown: paging,
	" ": paging,
};

/**
 * `key`, a `KeyboardEvent.key` such as "ArrowDown" or "?", pressed on `state`, as the real TUI's view on
 * screen handles it, Tab going back a pane with `shift`. A key that view doesn't use isn't taken, so Tab
 * on the Goals list is the page's and leaves the replay.
 */
export function pressReplayKey(
	state: ReplayState,
	key: string,
	shift: boolean,
): ReplayKeyResult {
	const done = (next: ReplayState): ReplayKeyResult => ({
		state: next,
		taken: true,
	});
	const notices = state.view === "project" ? projectNotices : goalNotices;
	const notice = notices[key];
	const step = key === "ArrowUp" || key === "k" ? -1 : 1;
	const moves = ["ArrowUp", "ArrowDown", "k", "j"].includes(key);
	if (key === "?") return done({ ...state, help: !state.help });
	if (key === "Escape" && state.help) return done({ ...state, help: false });

	if (state.view === "project") {
		// The Goals list still moves under its help.
		if (moves)
			return done({
				...state,
				goal: clamp(state.goal + step, tuiFrames.goals.length),
			});
		if (key === "g") return done({ ...state, goal: 0 });
		if (key === "G")
			return done({ ...state, goal: tuiFrames.goals.length - 1 });
		if (key === "Escape") return done(state);
		if (key === "Enter" && !state.help)
			return done({ ...openGoal(state, state.goal), view: "goal" });
		if (key === "Enter" || (notice !== undefined && state.help))
			return done(state);
		return notice === undefined
			? { state, taken: false }
			: { state, notice, taken: true };
	}

	if (key === "Escape") return done({ ...state, view: "project" });
	const goalKey =
		["Tab", "[", "]", "Enter", "g"].includes(key) ||
		moves ||
		/^[1-4]$/.test(key);
	// The Goal view's help takes every key it uses and does nothing with it.
	if (state.help) return { state, taken: goalKey || notice !== undefined };
	if (key === "Tab")
		return done({
			...state,
			pane: (state.pane + (shift ? goalPaneCount - 1 : 1)) % goalPaneCount,
		});
	if (/^[1-4]$/.test(key)) return done({ ...state, pane: Number(key) - 1 });
	if (key === "[" || key === "]") {
		const goal = clamp(
			state.goal + (key === "[" ? -1 : 1),
			tuiFrames.goals.length,
		);
		return done(goal === state.goal ? state : openGoal(state, goal));
	}
	if (moves && state.pane !== 0)
		return {
			state,
			notice:
				"In the replay, ↑↓ move only in the Tickets pane. Press 1, or Tab round to it.",
			taken: true,
		};
	if (moves)
		return done({
			...state,
			ticket: clamp(state.ticket + step, ticketCount(state.goal)),
		});
	if (goalKey) return done(state);
	return notice === undefined
		? { state, taken: false }
		: { state, notice, taken: true };
}

// The row the Goal view opens Goal `goal` on at moment `phase`.
function openTicket(goal: number, phase: number): number {
	const rows = tuiFrames.goals[goal]?.openTicket ?? [];
	return rows[Math.min(phase, rows.length - 1)] ?? 0;
}

function ticketCount(goal: number): number {
	return tuiFrames.goals[goal]?.tickets ?? 1;
}

// `value` kept within 0 and `count` - 1.
function clamp(value: number, count: number): number {
	return Math.max(0, Math.min(count - 1, value));
}
