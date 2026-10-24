// PROTOTYPE: plays back frames the real Vago TUI drew (see frames.json, made
// by a throwaway script that rendered src/tui headless against a copy of this
// repo's .vago-goals) and lets a visitor drive them with Vago's own keys.
// It's a replay: nothing runs, the keys pick which captured frame shows.

import data from "./frames.json";

type Line = [string, [number, number][]];
type Frames = {
	size: { width: number; height: number };
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

type State = {
	view: "project" | "goal";
	goal: number;
	ticket: number;
	focus: number;
	help: boolean;
};

const PHASE_MS = 1400;
const HOLD_LAST_MS = 3600;
const PANES = 4;

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
		if (b > a) {
			const chunk = chunkHtml(chars.slice(a, b));
			out += `<span class="s${style}">${chunk}</span>`;
		}
		at += len;
	}
	return out;
}

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
	const text = line[0];
	return text
		.split(/( {3,})/)
		.map((part) => {
			if (/^ +$/.test(part) || part === "") return part;
			const lead = part.match(/^ */)?.[0] ?? "";
			const body = part.slice(lead.length);
			// Keys are the leading tokens until the first word of the label.
			const words = body.split(" ");
			let k = 0;
			while (k < words.length - 1 && /^(\S{1,2}|Enter|Esc|Tab|PgUp|PgDn|Space|Ctrl-\S|Ctrl-C)$/.test(words[k] ?? "")) k++;
			if (k === 0) k = 1;
			const keys = words.slice(0, k);
			const label = words.slice(k).join(" ");
			const keyHtml = keys
				.map((key) => {
					const parts = key === "↑↓" || key === "←→" ? [...key] : [key];
					return parts
						.map((p) => `<button type="button" class="fk" data-key="${esc(keyAction[p] ?? p)}">${cellChar(p) === esc(p) ? esc(p) : cellChar(p)}</button>`)
						.join("");
				})
				.join(" ");
			return `${lead}${keyHtml}<span class="fl"> ${esc(label)}</span>`;
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

export function mountTui(root: HTMLElement): void {
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

	const state: State = { view: "project", goal: d.running, ticket: d.defaultTicket[d.running] ?? 0, focus: 0, help: false };
	let phase = reduce ? Math.min(8, d.phases.length - 1) : 0;
	let playing = !reduce;

	const seriesKey = () =>
		state.view === "project" ? `p/${state.goal}` : `g/${state.goal}/${state.ticket}/${state.focus}`;

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
			const label = d.phases[phase] ?? "";
			statusEl.textContent =
				label === "Done" ? "Ticket 06 merged, Ticket 07 starts" : `Ticket 06 · ${label}`;
		}
		if (meter) meter.style.setProperty("--p", String(phase / (d.phases.length - 1)));
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
				const name = key === "ArrowLeft" ? "←" : key === "ArrowRight" ? "→" : key === "PageUp" ? "PgUp" : key === "PageDown" ? "PgDn" : key;
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
	screen.addEventListener("pointerdown", () => screen.focus({ preventScroll: true }));

	const ours = (e: KeyboardEvent) => {
		if (e.metaKey || e.ctrlKey || e.altKey) return false;
		const focused = frameEl.contains(document.activeElement) && document.activeElement === screen;
		if (!focused && !hovered) return false;
		// Over the TUI without focus, leave the page's own keys alone.
		if (!focused && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === " ")) return false;
		return true;
	};
	document.addEventListener("keydown", (e) => {
		if (!ours(e)) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest("input, textarea, [contenteditable]")) return;
		if (press(e.key, e.shiftKey)) {
			stopAutopilot();
			e.preventDefault();
			e.stopPropagation();
		}
	}, true);

	// Footer keys and the key strip are buttons.
	root.addEventListener("click", (e) => {
		const b = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
		if (!b) return;
		stopAutopilot();
		const key = b.dataset.key ?? "";
		if (!press(key)) toast(`${key} works in the real TUI. The replay knows ↑↓ Enter Esc [ ] Tab and ?.`);
		flash(key);
	});

	function flash(key: string) {
		for (const k of root.querySelectorAll<HTMLElement>(`.vd-keys [data-key="${CSS.escape(key)}"]`)) {
			k.classList.remove("is-pressed");
			void k.offsetWidth;
			k.classList.add("is-pressed");
		}
	}

	// The replay clock: one captured moment of Ticket 06 per tick.
	let timer = 0;
	let visible = true;
	function schedule() {
		clearTimeout(timer);
		if (!playing || !visible) return;
		const last = phase === d.phases.length - 1;
		timer = window.setTimeout(() => {
			phase = (phase + 1) % d.phases.length;
			draw();
			schedule();
		}, last ? HOLD_LAST_MS : PHASE_MS);
	}
	function setPlaying(on: boolean) {
		playing = on;
		if (playBtn) {
			playBtn.textContent = on ? "Pause" : "Play";
			playBtn.setAttribute("aria-pressed", String(!on));
		}
		schedule();
	}
	playBtn?.addEventListener("click", () => setPlaying(!playing));

	// A short tour at the start, pressing keys the visitor can see.
	const tour: [string, number][] = [
		["ArrowDown", 2600],
		["ArrowDown", 650],
		["ArrowUp", 650],
		["ArrowUp", 650],
		["Enter", 900],
	];
	let tourTimer = 0;
	let touring = !reduce;
	let toured = false;
	function stopAutopilot() {
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

	draw();
	setPlaying(playing);
}
