// The replay of the example Project as a state the keys move: which screen shows, at which moment of the
// replayed Ticket, and what each of Vago's keys does to it, the way the real TUI's Project, Goal and
// planning views handle them. Keys the captured frames can't follow leave the state and say so. Owns the
// captured frames; nothing here touches the page.

import data from "./tui-frames.json";
import {
	goalPaneCount,
	screenKey,
	type TuiFrames,
	type TuiHelp,
	type TuiPaneName,
	type TuiPlanningScreen,
	type TuiScreen,
	type TuiView,
} from "./tui-frames.ts";

/** The captured frames, as `bun run capture` wrote them. */
export const tuiFrames = data as TuiFrames;

/** What the replay shows: the Goals list on its `goal`th Goal, or that Goal open on its `ticket`th row with
 *  the focus on the pane `pane` Tabs reach, or that planning item open at its `planning` screen, the help
 *  laid over any of them, at moment `phase` of the replay. */
export type ReplayState = {
	view: TuiView;
	goal: number;
	ticket: number;
	pane: number;
	planning: TuiPlanningScreen;
	help: boolean;
	phase: number;
};

/** Where a page sends the replay. Each field left out keeps what shows, except that a new `goal` opens on
 *  the row it opens on. */
export type ReplayPlace = {
	/** "project" for the Goals list, "goal" for the Goal open, "planning" for the planning item open. */
	view?: TuiView;
	/** A Goal or planning item of the example Project by name, such as "order-export". */
	goal?: string;
	/** A row of the open Goal's Tickets pane, from 0. */
	ticket?: number;
	/** The pane the open Goal's focus is on. */
	pane?: TuiPaneName;
	/** What the open planning item shows. */
	planning?: TuiPlanningScreen;
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
	planning: "session",
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
	if (place.view !== undefined && place.view !== "project") {
		const name = tuiFrames.goals[next.goal]?.name;
		if (isPlanningItem(next.goal) !== (place.view === "planning"))
			throw new Error(
				`${name} opens in the ${isPlanningItem(next.goal) ? "planning" : "Goal"} view`,
			);
		if (next.view === "project") next = openGoal(next, next.goal);
		next.view = place.view;
	}
	if (place.planning !== undefined) next.planning = place.planning;
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
		planning: "session",
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
	const phases = tuiFrames.screens[screenKey(screenOf(state))] ?? [];
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
	r: "r renames a planning item. Not in the replay.",
	d: "d discards a planning item. Not in the replay.",
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

const sessionKeys =
	"In the session every key is the agent's. Ctrl-] moves the focus to the Preview.";
const planningNotices: Record<string, string> = {
	q: quit,
	ArrowUp: "↑↓ scroll the Preview. Not in the replay.",
	ArrowDown: "↑↓ scroll the Preview. Not in the replay.",
	PageUp: paging,
	PageDown: paging,
	" ": paging,
};

/**
 * `key`, a `KeyboardEvent.key` such as "ArrowDown" or "?", or "Ctrl-]", pressed on `state`, as the real
 * TUI's view on screen handles it, Tab going back a pane with `shift`. A key that view doesn't use isn't
 * taken, so Tab on the Goals list is the page's and leaves the replay.
 */
export function pressReplayKey(
	state: ReplayState,
	key: string,
	shift: boolean,
): ReplayKeyResult {
	if (state.view === "planning") return pressPlanningKey(state, key);
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
			return done({
				...openGoal(state, state.goal),
				view: isPlanningItem(state.goal) ? "planning" : "goal",
			});
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
		// The Goal view passes over planning items; past either end the open Goal stays.
		const step = key === "[" ? -1 : 1;
		let goal = state.goal + step;
		while (isPlanningItem(goal)) goal += step;
		return done(
			tuiFrames.goals[goal] === undefined ? state : openGoal(state, goal),
		);
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

// `key` on the planning view `state` shows. While the session has the focus every key is the session's, so
// the replay says so; Tab moves to the Preview too, so the key row reaches it.
function pressPlanningKey(state: ReplayState, key: string): ReplayKeyResult {
	const done = (next: ReplayState, notice?: string): ReplayKeyResult => ({
		state: next,
		notice,
		taken: true,
	});
	const preview = { ...state, planning: "preview" as const };
	if (state.planning === "session") {
		if (key === "Ctrl-]") return done(preview);
		if (key === "Tab")
			return done(
				preview,
				"In the session Tab is the agent's. Ctrl-] moves the focus to the Preview.",
			);
		return key.length === 1 || /^(Arrow|Escape|Enter|Backspace)/.test(key)
			? done(state, sessionKeys)
			: { state, taken: false };
	}
	// The help takes every key, and `?` or Esc closes it.
	if (state.help)
		return done(
			key === "?" || key === "Escape" ? { ...state, help: false } : state,
		);
	if (state.planning === "accept")
		return key === "y"
			? done(
					preview,
					"y accepts the Proposal as a ready Goal. The replay doesn't accept anything.",
				)
			: done(preview);
	if (state.planning === "workflow") {
		if (key === "Escape") return done(preview);
		return done(
			state,
			"↑↓ and Enter pick the Goal's Workflow. Not in the replay; Esc closes the list.",
		);
	}
	if (key === "Ctrl-]" || key === "Tab")
		return done({ ...state, planning: "session" });
	if (key === "Escape") return done({ ...state, view: "project" });
	if (key === "?") return done({ ...state, help: true });
	if (key === "a") return done({ ...state, planning: "accept" });
	if (key === "w") return done({ ...state, planning: "workflow" });
	const notice = planningNotices[key];
	return notice === undefined ? { state, taken: false } : done(state, notice);
}

// The captured screen `state` shows, help aside.
function screenOf(state: ReplayState): TuiScreen {
	if (state.view === "goal")
		return {
			view: "goal",
			goal: state.goal,
			ticket: state.ticket,
			pane: state.pane,
		};
	if (state.view === "planning")
		return { view: "planning", goal: state.goal, planning: state.planning };
	return { view: "project", goal: state.goal };
}

// Whether the example Project's `goal`th row is a planning item, which opens in the planning view.
function isPlanningItem(goal: number): boolean {
	return tuiFrames.goals[goal]?.standing === "planning";
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
