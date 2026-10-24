// PROTOTYPE: plays back frames the real Vago TUI drew (tui-frames.json, made
// by a throwaway script that rendered src/tui headless against an invented
// Project, acme-shop) and lets a visitor drive them with Vago's own keys, or
// a page drive them with events. It's a replay: nothing runs, the keys pick
// which captured frame shows. LiveTui.astro documents the events.

import data from "./tui-frames.json";

type Line = [string, [number, number][]];
type Frames = {
	size: { width: number; height: number };
	project: string;
	replay: { goal: string; ticket: string; next: string };
	goals: string[];
	ticketCounts: number[];
	running: number;
	defaultTicket: number[];
	phases: string[];
	styles: string[];
	lines: Line[];
	frames: number[][];
	series: Record<string, number[]>;
};
const d = data as unknown as Frames;

/** Named places a page can send the TUI to with `vago-tui:goto`. */
export type LiveTuiMoment =
	| "project"
	| "goal-running"
	| "ticket-steps"
	| "runs"
	| "run-activity"
	| "help"
	| "stuck"
	| "ready"
	| "done";

export type LiveTuiGoto = {
	moment?: LiveTuiMoment;
	/** Replay time, 0 to 1: Ticket 03 from its new branch to its merge. */
	time?: number;
	/** A Goal by name or by its row in the list. */
	goal?: string | number;
	ticket?: number;
	/** 0 Tickets, 1 Ticket, 2 Runs, 3 Run activity. */
	pane?: number;
	help?: boolean;
	/** Whether the replay clock runs after the jump. A jump with `time` pauses it unless this is true. */
	play?: boolean;
};

export type LiveTuiState = {
	view: "project" | "goal";
	goal: string;
	ticket: number;
	pane: number;
	help: boolean;
	time: number;
	phase: number;
	label: string;
	playing: boolean;
};

export type LiveTuiOptions = {
	autoplay: boolean;
	tour: boolean;
	moment: LiveTuiMoment;
	time: number | undefined;
};

const PHASE_MS = 1500;
const HOLD_LAST_MS = 3600;
const PANES = 4;
const LAST_PHASE = d.phases.length - 1;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Box drawing is drawn with CSS, not glyphs: a system font's lines don't
// always fill their cell, so the panes wouldn't join. Any other symbol may
// fall back to a font of another width, so it gets a cell one column wide.
const boxSides: Record<string, string> = {
	"│": "u d",
	"┌": "r d",
	"┐": "l d",
	"└": "r u",
	"┘": "l u",
	"┬": "l r d",
	"┴": "l r u",
	"├": "r u d",
	"┤": "l u d",
	"┼": "l r u d",
};
const cellChar = (c: string) => {
	const code = c.codePointAt(0) ?? 0;
	if (code < 0x80 || c === "·" || c === "…") return esc(c);
	const sides = boxSides[c];
	if (sides) return `<i class="b ${sides}"></i>`;
	if (c === "█") return `<i class="b full"></i>`;
	if (c === "▀") return `<i class="b top"></i>`;
	return `<i class="g">${esc(c)}</i>`;
};
// Runs of ─ and ━ become one drawn line each.
const chunkHtml = (chars: string[]) =>
	chars
		.join("")
		.split(/([─━]+)/)
		.map((part) => {
			if (part === "") return "";
			const ch = part[0];
			if (ch === "─" || ch === "━") {
				return `<i class="h${ch === "━" ? " heavy" : ""}" style="width:${[...part].length}ch"></i>`;
			}
			return [...part].map(cellChar).join("");
		})
		.join("");

function lineHtml(line: Line, from = 0, to = Number.POSITIVE_INFINITY): string {
	const [text, runs] = line;
	const total = runs.reduce((n, r) => n + r[0], 0);
	const chars = [...text.padEnd(total)];
	let at = 0;
	let out = "";
	for (const [len, style] of runs) {
		const a = Math.max(at, from);
		const b = Math.min(at + len, to);
		if (b > a) out += `<span class="s${style}">${chunkHtml(chars.slice(a, b))}</span>`;
		at += len;
	}
	return out;
}

/** The TUI's own colours, one class per style the capture found, under `scope`. */
export function tuiStyleCss(scope: string): string {
	return d.styles
		.map((s, i) => {
			const [fg, bg, bold] = s.split("|");
			return `${scope} .s${i}{color:${fg};${bg ? `background:${bg};` : ""}${bold === "1" ? "font-weight:700;" : ""}}`;
		})
		.join("");
}
export const tuiSize = d.size;
export const tuiProject = d.project;

// The footer's keys, each pressable. `keys` as the TUI prints them.
const keyAction: Record<string, string> = {
	"↑": "ArrowUp",
	"↓": "ArrowDown",
	Enter: "Enter",
	Esc: "Escape",
	Tab: "Tab",
	"?": "?",
	"[": "[",
	"]": "]",
	"1": "1",
	"2": "2",
	"3": "3",
	"4": "4",
};
function footerHtml(line: Line): string {
	return line[0]
		.split(/( {3,})/)
		.map((part) => {
			if (/^ +$/.test(part) || part === "") return part;
			const lead = part.match(/^ */)?.[0] ?? "";
			const words = part.slice(lead.length).split(" ");
			// Keys are the leading tokens until the first word of the label.
			let k = 0;
			while (k < words.length - 1 && /^(\S{1,2}|Enter|Esc|Tab|PgUp|PgDn|Space|Ctrl-\S|Ctrl-C)$/.test(words[k] ?? "")) k++;
			if (k === 0) k = 1;
			const keyHtml = words
				.slice(0, k)
				.map((key) => {
					const parts = key === "↑↓" || key === "←→" ? [...key] : [key];
					return parts
						.map((p) => `<button type="button" class="fk" data-key="${esc(keyAction[p] ?? p)}" tabindex="-1">${cellChar(p)}</button>`)
						.join("");
				})
				.join(" ");
			return `${lead}${keyHtml}<span class="fl"> ${esc(words.slice(k).join(" "))}</span>`;
		})
		.join("");
}

const notInReplay: Record<string, string> = {
	s: "s starts the Goal in vago run. The replay doesn't run anything.",
	n: "n plans a new Goal with an agent. Not in the replay.",
	q: "q quits the TUI. Here there's nothing to quit.",
	t: "t shows the Ticket full screen in the real TUI. Not in the replay.",
	r: "r shows the Run full screen in the real TUI. Not in the replay.",
	G: "G follows the live Run. The replay always does.",
	e: "e picks an edit in the Run. Not in the replay.",
	d: "d shows an edit's diff. Not in the replay.",
	"←": "←→ pick another Run of the Ticket. Not in the replay.",
	"→": "←→ pick another Run of the Ticket. Not in the replay.",
	PgUp: "Paging isn't in the replay.",
	PgDn: "Paging isn't in the replay.",
};

// A Goal by the state its row shows, for the named moments.
function goalInState(state: string): number {
	const key = d.goals.findIndex((_, i) => {
		const f = d.frames[d.series[`p/${i}`]?.[0] ?? 0] ?? [];
		const row = (d.lines[f[4 + i] ?? 0] as Line | undefined)?.[0] ?? "";
		return row.includes(` ${state} `);
	});
	return key < 0 ? d.running : key;
}

/** Mounts the replay in a LiveTui root. Returns nothing; the root takes the events. */
export function mountLiveTui(root: HTMLElement, options: LiveTuiOptions): void {
	const screen = root.querySelector<HTMLElement>("[data-screen]");
	const statusEl = root.querySelector<HTMLElement>("[data-status]");
	const toastEl = root.querySelector<HTMLElement>("[data-toast]");
	const playBtn = root.querySelector<HTMLButtonElement>("[data-play]");
	const meter = root.querySelector<HTMLElement>("[data-meter]");
	if (!screen) return;
	const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

	const H = d.size.height;
	const rows: HTMLDivElement[] = [];
	const shown: number[] = [];
	for (let i = 0; i < H; i++) {
		const r = document.createElement("div");
		r.className = "row";
		screen.append(r);
		rows.push(r);
		shown.push(-1);
	}
	const overlay = document.createElement("div");
	overlay.className = "overlay";
	overlay.hidden = true;
	screen.append(overlay);
	const htmlCache = new Map<number, string>();
	const html = (i: number) => {
		let h = htmlCache.get(i);
		if (h === undefined) {
			h = lineHtml(d.lines[i] as Line);
			htmlCache.set(i, h);
		}
		return h;
	};

	// The help boxes, cut out of their captures to lay over any frame.
	const helpBox = (key: string) => {
		const f = d.frames[d.series[key]?.[0] ?? 0] ?? [];
		const texts = f.map((i) => (d.lines[i] as Line)[0]);
		const r0 = texts.findIndex((t) => t.includes("┌─ Keys"));
		if (r0 < 0) return null;
		const top = [...(texts[r0] ?? "")];
		const c0 = top.indexOf("┌");
		const c1 = top.indexOf("┐", c0) + 1;
		let r1 = r0 + 1;
		while (r1 < texts.length && [...(texts[r1] ?? "")][c0] !== "└") r1++;
		const body = f.slice(r0, r1 + 1).map((i) => lineHtml(d.lines[i] as Line, c0, c1));
		return { r0, c0, html: body.map((b) => `<div class="row">${b}</div>`).join("") };
	};
	const help = { project: helpBox("p/help"), goal: helpBox("g/help") };

	const midPhase = Math.max(0, d.phases.indexOf("Build") + 4);
	const state = {
		view: "project" as "project" | "goal",
		goal: d.running,
		ticket: d.defaultTicket[d.running] ?? 0,
		focus: 0,
		help: false,
	};
	let phase = 0;
	let playing = false;

	const seriesKey = () => (state.view === "project" ? `p/${state.goal}` : `g/${state.goal}/${state.ticket}/${state.focus}`);
	const label = () => d.phases[phase] ?? "";

	function snapshot(): LiveTuiState {
		return {
			view: state.view,
			goal: d.goals[state.goal] ?? "",
			ticket: state.ticket,
			pane: state.focus,
			help: state.help,
			time: LAST_PHASE > 0 ? phase / LAST_PHASE : 0,
			phase,
			label: label(),
			playing,
		};
	}

	function draw() {
		const s = d.series[seriesKey()] ?? d.series[`g/${state.goal}/${state.ticket}/0`] ?? [0];
		const fi = s.length > 1 ? (s[Math.min(phase, s.length - 1)] ?? 0) : (s[0] ?? 0);
		const frame = d.frames[fi] ?? [];
		for (let r = 0; r < H; r++) {
			const li = frame[r] ?? 0;
			if (shown[r] === li) continue;
			shown[r] = li;
			const row = rows[r] as HTMLDivElement;
			row.innerHTML = r === H - 1 ? footerHtml(d.lines[li] as Line) : html(li);
		}
		const box = state.help ? help[state.view] : null;
		overlay.hidden = !box;
		if (box) {
			overlay.style.setProperty("--r", String(box.r0));
			overlay.style.setProperty("--c", String(box.c0));
			overlay.innerHTML = box.html;
		}
		if (statusEl) {
			const { ticket, next } = d.replay;
			statusEl.textContent = label() === "Done" ? `Ticket ${ticket} merged, ${next} starts` : `Ticket ${ticket} · ${label()}`;
		}
		if (meter) meter.style.setProperty("--p", String(LAST_PHASE > 0 ? phase / LAST_PHASE : 0));
		root.dispatchEvent(new CustomEvent<LiveTuiState>("vago-tui:change", { detail: snapshot(), bubbles: true }));
	}

	let toastTimer = 0;
	function toast(msg: string) {
		if (!toastEl) return;
		toastEl.textContent = msg;
		toastEl.classList.add("is-on");
		clearTimeout(toastTimer);
		toastTimer = window.setTimeout(() => toastEl.classList.remove("is-on"), 3200);
	}

	const clamp = (n: number, len: number) => Math.max(0, Math.min(len - 1, n));
	const ticketsOf = (g: number) => d.ticketCounts[g] ?? 1;
	function openGoal(g: number) {
		state.view = "goal";
		state.goal = g;
		state.ticket = d.defaultTicket[g] ?? 0;
		state.focus = 0;
	}

	/** Handles `key` as the TUI would; false when it isn't Vago's. */
	function press(key: string, shift = false): boolean {
		if (state.help) {
			if (key === "?" || key === "Escape") state.help = false;
			draw();
			return true;
		}
		const goal = state.view === "goal";
		switch (key) {
			case "ArrowUp":
			case "k":
			case "ArrowDown":
			case "j": {
				const step = key === "ArrowUp" || key === "k" ? -1 : 1;
				if (!goal) state.goal = clamp(state.goal + step, d.goals.length);
				else if (state.focus === 0) state.ticket = clamp(state.ticket + step, ticketsOf(state.goal));
				else toast("In the replay, ↑↓ move in the Tickets pane. Tab back to it, or press 1.");
				break;
			}
			case "g":
				if (!goal) state.goal = 0;
				else toast(notInReplay.G ?? "");
				break;
			case "G":
				if (!goal) state.goal = d.goals.length - 1;
				else toast(notInReplay.G ?? "");
				break;
			case "Enter":
				if (!goal) openGoal(state.goal);
				break;
			case "Escape":
				if (goal) state.view = "project";
				break;
			case "[":
			case "]":
				if (goal) openGoal(clamp(state.goal + (key === "[" ? -1 : 1), d.goals.length));
				break;
			case "Tab":
				if (goal) state.focus = (state.focus + (shift ? PANES - 1 : 1)) % PANES;
				break;
			case "1":
			case "2":
			case "3":
			case "4":
				if (goal) state.focus = Number(key) - 1;
				break;
			case "?":
				state.help = true;
				break;
			default: {
				const name =
					key === "ArrowLeft" ? "←" : key === "ArrowRight" ? "→" : key === "PageUp" ? "PgUp" : key === "PageDown" ? "PgDn" : key;
				const msg = notInReplay[name];
				if (!msg) return false;
				toast(msg);
			}
		}
		draw();
		return true;
	}

	// Keys reach the TUI only while it has the focus or the pointer.
	let hovered = false;
	const frameEl = root.querySelector<HTMLElement>("[data-frame]") ?? root;
	frameEl.addEventListener("pointerenter", () => {
		hovered = true;
		root.classList.add("is-hot");
	});
	frameEl.addEventListener("pointerleave", () => {
		hovered = false;
		root.classList.toggle("is-hot", frameEl.contains(document.activeElement));
	});
	frameEl.addEventListener("focusin", () => root.classList.add("is-hot"));
	frameEl.addEventListener("focusout", () => root.classList.toggle("is-hot", hovered));
	// Tells the page a visitor, not the page or the tour, moved the TUI.
	const visitor = () => root.dispatchEvent(new CustomEvent("vago-tui:visitor", { bubbles: true }));
	screen.addEventListener("pointerdown", () => {
		screen.focus({ preventScroll: true });
		visitor();
	});

	const ours = (e: KeyboardEvent) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return false;
		const focused = document.activeElement === screen;
		if (!focused && !hovered) return false;
		// Over the TUI without focus, leave the page's own keys alone.
		if (!focused && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === " ")) return false;
		return true;
	};
	document.addEventListener(
		"keydown",
		(e) => {
			if (!ours(e)) return;
			const target = e.target as HTMLElement | null;
			if (target?.closest("input, textarea, select, [contenteditable]")) return;
			if (press(e.key, e.shiftKey)) {
				stopTour();
				visitor();
				e.preventDefault();
				e.stopPropagation();
			}
		},
		true,
	);

	// Footer keys and the key row are buttons.
	root.addEventListener("click", (e) => {
		const b = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
		if (!b) return;
		stopTour();
		visitor();
		const key = b.dataset.key ?? "";
		if (!press(key)) toast(`${key} works in the real TUI. The replay knows ↑↓ Enter Esc [ ] Tab and ?.`);
		flash(key);
	});

	function flash(key: string) {
		for (const k of root.querySelectorAll<HTMLElement>(`[data-keys] [data-key="${CSS.escape(key)}"]`)) {
			k.classList.remove("is-pressed");
			void k.offsetWidth;
			k.classList.add("is-pressed");
		}
	}

	// The replay clock: one captured moment of the running Ticket per tick.
	let timer = 0;
	let visible = false;
	function schedule() {
		clearTimeout(timer);
		if (!playing || !visible) return;
		timer = window.setTimeout(
			() => {
				phase = (phase + 1) % d.phases.length;
				draw();
				schedule();
			},
			phase === LAST_PHASE ? HOLD_LAST_MS : PHASE_MS,
		);
	}
	function setPlaying(on: boolean) {
		playing = on;
		if (playBtn) {
			playBtn.textContent = on ? "Pause" : "Play";
			playBtn.setAttribute("aria-pressed", String(!on));
		}
		schedule();
	}
	playBtn?.addEventListener("click", () => {
		setPlaying(!playing);
		draw();
	});

	// A short tour the first time it's seen, pressing keys the visitor can see.
	const tour: [string, number][] = [
		["ArrowDown", 2600],
		["ArrowDown", 650],
		["ArrowUp", 650],
		["ArrowUp", 650],
		["Enter", 900],
	];
	let tourTimer = 0;
	let touring = options.tour && !reduce;
	let toured = false;
	function stopTour() {
		touring = false;
		clearTimeout(tourTimer);
	}
	function runTour(i: number) {
		const step = tour[i];
		if (!touring || !step) return;
		tourTimer = window.setTimeout(() => {
			if (!touring || !visible) return;
			press(step[0]);
			flash(step[0]);
			runTour(i + 1);
		}, step[1]);
	}

	// The page's own controls.
	function moment(m: LiveTuiMoment) {
		state.help = false;
		const running = () => openGoal(d.running);
		switch (m) {
			case "project":
				state.view = "project";
				state.goal = d.running;
				break;
			case "goal-running":
				running();
				break;
			case "ticket-steps":
				running();
				state.focus = 1;
				break;
			case "runs":
				running();
				state.focus = 2;
				break;
			case "run-activity":
				running();
				state.focus = 3;
				break;
			case "help":
				state.help = true;
				break;
			case "stuck":
				openGoal(goalInState("stuck"));
				break;
			case "ready":
				openGoal(goalInState("ready"));
				break;
			case "done":
				openGoal(goalInState("done"));
				break;
		}
	}
	function goto(g: LiveTuiGoto) {
		stopTour();
		if (g.moment) moment(g.moment);
		if (g.goal !== undefined) {
			const i = typeof g.goal === "number" ? g.goal : d.goals.indexOf(g.goal);
			if (i >= 0 && i < d.goals.length) {
				if (state.view === "goal") openGoal(i);
				else state.goal = i;
			}
		}
		if (g.ticket !== undefined && state.view === "goal") state.ticket = clamp(g.ticket, ticketsOf(state.goal));
		if (g.pane !== undefined && state.view === "goal") state.focus = clamp(g.pane, PANES);
		if (g.help !== undefined) state.help = g.help;
		if (g.time !== undefined) phase = Math.round(Math.max(0, Math.min(1, g.time)) * LAST_PHASE);
		if (g.play !== undefined) setPlaying(g.play && !reduce);
		else if (g.time !== undefined) setPlaying(false);
		draw();
	}
	root.addEventListener("vago-tui:goto", (e) => goto((e as CustomEvent<LiveTuiGoto>).detail ?? {}));
	root.addEventListener("vago-tui:pause", () => {
		stopTour();
		setPlaying(false);
		draw();
	});
	root.addEventListener("vago-tui:play", () => {
		setPlaying(!reduce);
		draw();
	});
	root.addEventListener("vago-tui:key", (e) => {
		const key = (e as CustomEvent<{ key: string }>).detail?.key;
		if (!key) return;
		stopTour();
		press(key);
		flash(key);
	});

	new IntersectionObserver(
		(entries) => {
			visible = entries.some((e) => e.isIntersecting);
			schedule();
			if (visible && touring && !toured) {
				toured = true;
				runTour(0);
			}
		},
		{ threshold: 0.25 },
	).observe(screen);

	moment(options.moment);
	phase = options.time !== undefined ? Math.round(options.time * LAST_PHASE) : options.autoplay && !reduce ? 0 : Math.min(midPhase, LAST_PHASE);
	setPlaying(options.autoplay && !reduce);
	draw();
	root.dataset.ready = "";
}
