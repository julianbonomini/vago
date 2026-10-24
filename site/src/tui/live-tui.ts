// The live TUI in the page: a LiveTui.astro on screen, played and driven. Takes Vago's keys while the TUI
// has the focus or the pointer, and taps on its key rows; runs the replay's clock while it is on screen;
// draws what changed; and gives the page the handle below. Hides the DOM it draws in, the clock, and
// which keys are the page's.

import type { TuiPaneName } from "./tui-frames.ts";
import {
	focusedPane,
	isLastPhase,
	nextPhase,
	placeReplay,
	pressReplayKey,
	type ReplayPlace,
	replayFrame,
	replayLabel,
	replayTime,
	restingState,
	tuiFrames,
} from "./tui-replay.ts";
import { screenRows } from "./tui-screen.ts";

/** What the live TUI shows. */
export type LiveTuiState = {
	view: "project" | "goal";
	/** The selected or open Goal's name. */
	goal: string;
	/** The open Goal's selected row of its Tickets pane, from 0. */
	ticket: number;
	/** The pane with the focus. */
	pane?: TuiPaneName;
	help: boolean;
	/** How far through the replay, from 0 to 1. */
	time: number;
	/** What the replayed Ticket is doing then, such as "Ticket 03 · Build". */
	label: string;
	playing: boolean;
};

/** A page's handle on one live TUI. */
export type LiveTui = {
	/** Shows `place`, the replay's clock left as it was. */
	goto(place: ReplayPlace): void;
	/** Runs the replay's clock, which moves only while the TUI is on screen. */
	play(): void;
	pause(): void;
	state(): LiveTuiState;
	/** Where the pane named `name` is drawn now, in viewport pixels, or undefined when the screen shows no
	 *  such pane. Follows any transform on the TUI. */
	paneRect(name: TuiPaneName): DOMRect | undefined;
	/** Calls `listener` after every change of what shows, the clock's included. */
	onChange(listener: (state: LiveTuiState) => void): void;
	/** Calls `listener` when the visitor takes the TUI over: presses one of its keys, taps a key of a key
	 *  row, or clicks the screen. Never for the page's own `goto`, nor the clock. */
	onTakeover(listener: () => void): void;
};

const handles = new WeakMap<HTMLElement, LiveTui>();

/** The handle on the live TUI whose root, the element with `data-live-tui`, is `root`; mounted on the
 *  first call. */
export function liveTui(root: HTMLElement): LiveTui {
	const mounted = handles.get(root);
	if (mounted !== undefined) return mounted;
	const handle = mount(root);
	handles.set(root, handle);
	return handle;
}

// How long each moment of the replay shows, and the last, the Ticket merged, a while longer.
const phaseMs = 1500;
const lastPhaseMs = 3600;
const noticeMs = 3200;

function mount(root: HTMLElement): LiveTui {
	const screen = root.querySelector<HTMLElement>("[data-screen]");
	const terminal = root.querySelector<HTMLElement>("[data-window]");
	if (screen === null || terminal === null)
		throw new Error("A live TUI needs its [data-screen] and [data-window]");
	const toast = root.querySelector<HTMLElement>("[data-toast]");
	const status = root.querySelector<HTMLElement>("[data-status]");
	const meter = root.querySelector<HTMLElement>("[data-meter]");
	const playButton = root.querySelector<HTMLButtonElement>("[data-play]");
	const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const rows = [...screen.querySelectorAll<HTMLElement>("[data-row]")];
	const shown = rows.map((row) => row.innerHTML);

	let state = placeReplay(restingState, JSON.parse(root.dataset.place ?? "{}"));
	let playing = false;
	let visible = false;
	const changeListeners: ((state: LiveTuiState) => void)[] = [];
	const takeoverListeners: (() => void)[] = [];

	const snapshot = (): LiveTuiState => ({
		view: state.view,
		goal: tuiFrames.goals[state.goal]?.name ?? "",
		ticket: state.ticket,
		pane: focusedPane(state),
		help: state.help,
		time: replayTime(state),
		label: replayLabel(state),
		playing,
	});

	const draw = () => {
		const { frame, help } = replayFrame(state);
		for (const [index, html] of screenRows(frame, help).entries()) {
			if (shown[index] === html) continue;
			shown[index] = html;
			const row = rows[index];
			if (row !== undefined) row.innerHTML = html;
		}
		if (status !== null) status.textContent = replayLabel(state);
		meter?.style.setProperty("--time", String(replayTime(state)));
		if (playButton !== null) {
			playButton.textContent = playing ? "Pause" : "Play";
			playButton.setAttribute("aria-pressed", String(playing));
		}
		const now = snapshot();
		for (const listener of changeListeners) listener(now);
	};

	let noticeTimer = 0;
	const notice = (text: string) => {
		if (toast === null) return;
		toast.textContent = text;
		toast.classList.add("is-on");
		clearTimeout(noticeTimer);
		noticeTimer = window.setTimeout(
			() => toast.classList.remove("is-on"),
			noticeMs,
		);
	};

	const takeover = () => {
		for (const listener of takeoverListeners) listener();
	};

	// The clock ticks only while it plays and the TUI is on screen.
	let clock = 0;
	const schedule = () => {
		clearTimeout(clock);
		if (!playing || !visible) return;
		clock = window.setTimeout(
			() => {
				state = nextPhase(state);
				draw();
				schedule();
			},
			isLastPhase(state) ? lastPhaseMs : phaseMs,
		);
	};
	const setPlaying = (on: boolean) => {
		playing = on;
		schedule();
		draw();
	};
	new IntersectionObserver((entries) => {
		visible = entries.some((entry) => entry.isIntersecting);
		schedule();
	}).observe(screen);
	playButton?.addEventListener("click", () => setPlaying(!playing));

	const press = (key: string, shift: boolean): boolean => {
		const result = pressReplayKey(state, key, shift);
		if (!result.taken) return false;
		state = result.state;
		if (result.notice !== undefined) notice(result.notice);
		draw();
		return true;
	};

	// Vago's keys go to the TUI only while it has the focus or the pointer. With only the pointer, the page
	// keeps the keys it scrolls sideways and pages with.
	let hovered = false;
	terminal.addEventListener("pointerenter", () => {
		hovered = true;
	});
	terminal.addEventListener("pointerleave", () => {
		hovered = false;
	});
	screen.addEventListener("pointerdown", () => {
		screen.focus({ preventScroll: true });
		takeover();
	});
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			const focused = document.activeElement === screen;
			if (!focused && !hovered) return;
			if (!focused && ["ArrowLeft", "ArrowRight", " "].includes(event.key))
				return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				target !== screen &&
				target.closest("input, textarea, select, button, a, [contenteditable]")
			)
				return;
			if (!press(event.key, event.shiftKey)) return;
			event.preventDefault();
			event.stopPropagation();
			takeover();
		},
		true,
	);

	// Key rows, the TUI's own and any the page places apart with LiveTuiKeys for this TUI's id.
	const keyRows = [
		...root.querySelectorAll<HTMLElement>("[data-tui-keys]"),
		...(root.id === ""
			? []
			: document.querySelectorAll<HTMLElement>(
					`[data-tui-keys][data-for="${CSS.escape(root.id)}"]`,
				)),
	];
	for (const keyRow of keyRows)
		keyRow.addEventListener("click", (event) => {
			const button =
				event.target instanceof Element
					? event.target.closest<HTMLElement>("[data-key]")
					: null;
			const key = button?.dataset.key;
			if (button === null || button === undefined || key === undefined) return;
			if (!press(key, false))
				notice(`${button.textContent ?? key} does nothing on the Goals list.`);
			takeover();
			button.classList.remove("is-pressed");
			// Read the layout, so the press shows again on a second tap.
			void button.offsetWidth;
			button.classList.add("is-pressed");
		});

	setPlaying(root.dataset.autoplay === "true" && !reduced);
	root.dataset.mounted = "";
	return {
		goto: (place) => {
			state = placeReplay(state, place);
			draw();
		},
		play: () => setPlaying(true),
		pause: () => setPlaying(false),
		state: snapshot,
		paneRect: (name) => {
			const { frame } = replayFrame(state);
			const pane = tuiFrames.frames[frame]?.panes.find(
				(each) => each.name === name,
			);
			if (pane === undefined) return undefined;
			const area = screen.getBoundingClientRect();
			const cellWidth = area.width / tuiFrames.size.width;
			const cellHeight = area.height / tuiFrames.size.height;
			return new DOMRect(
				area.left + pane.box.column * cellWidth,
				area.top + pane.box.row * cellHeight,
				pane.box.columns * cellWidth,
				pane.box.rows * cellHeight,
			);
		},
		onChange: (listener) => {
			changeListeners.push(listener);
		},
		onTakeover: (listener) => {
			takeoverListeners.push(listener);
		},
	};
}
