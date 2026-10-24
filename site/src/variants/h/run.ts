// PROTOTYPE, variant H: one LiveTui carried from the hero to the story.
//
// The TUI lives in the story's sticky dock and is laid out once, at its
// docked size. Everything before the dock is a transform on it, in screen
// terms, so nothing reflows and there's only ever one TUI:
//
//   hero      it fills the first screen under the headline (E's hero),
//   pull      the camera pulls back and it settles on the right, while the
//             column on the left names each pane under a spotlight,
//   hand-off  the stage lets go, the copy scrolls away and the TUI glides,
//             a little smaller, into the dock,
//   story     the beats beside the dock drive it (F's story).
//
// Under 1000px there's no flight: the dock is a strip stuck to the top of
// the story, and the panes come first as beats of their own. With reduced
// motion, or a short window, the hero is static and the TUI moves to the
// dock in one step once the hero is behind you.

type Rect = { r: number; c: number; h: number; w: number };
type Part = { moment: "project" | "goal-running"; pane?: number; rect: Rect };
type Target = { right: number; top: number; width: number };
type Mode = "narrow" | "static" | "pinned";

// Where each pane sits in the TUI's 120 x 34 grid.
const parts: Part[] = [
	{ moment: "project", rect: { r: 2, c: 0, h: 9, w: 120 } },
	{ moment: "goal-running", pane: 0, rect: { r: 6, c: 0, h: 10, w: 47 } },
	{ moment: "goal-running", pane: 1, rect: { r: 6, c: 48, h: 15, w: 72 } },
	{ moment: "goal-running", pane: 2, rect: { r: 17, c: 0, h: 4, w: 47 } },
	{ moment: "goal-running", pane: 3, rect: { r: 22, c: 0, h: 10, w: 120 } },
];

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const ease = (t: number) => 1 - (1 - t) ** 3;
const smooth = (t: number) => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const stillText = "Scrolling drives it. Click it to take over.";
const drivingText = "You're driving. Scroll on and the story takes it back.";

export function mountRun(root: HTMLElement): void {
	const tui = root.querySelector<HTMLElement>("#vh-tui");
	const stage = root.querySelector<HTMLElement>("[data-stage]");
	const slot = root.querySelector<HTMLElement>("[data-slot]");
	const side = root.querySelector<HTMLElement>("[data-side]");
	const anchor = root.querySelector<HTMLElement>("[data-anchor]");
	const fly = root.querySelector<HTMLElement>("[data-fly]");
	const dock = root.querySelector<HTMLElement>("[data-dock]");
	const dockCol = root.querySelector<HTMLElement>("[data-dock-col]");
	const status = root.querySelector<HTMLElement>("[data-drive]");
	const items = [...root.querySelectorAll<HTMLButtonElement>("[data-part]")];
	const beats = [...root.querySelectorAll<HTMLElement>("[data-beat]")];
	const chapters = [...root.querySelectorAll<HTMLElement>("[data-chapter]")];
	if (!tui || !stage || !slot || !side || !anchor || !fly || !dock || !dockCol) return;

	const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const wideQ = matchMedia("(min-width: 1000px)");
	const tallQ = matchMedia("(min-height: 640px)");
	let mode: Mode = "narrow";

	const send = (detail: Record<string, unknown>) => tui.dispatchEvent(new CustomEvent("vago-tui:goto", { detail }));

	// The spotlight, laid in the TUI's own grid.
	let spot: HTMLElement | null = null;
	let spotAt = -1;
	function place(i: number) {
		spotAt = i;
		if (!spot) return;
		const part = parts[i];
		spot.classList.toggle("is-on", !!part);
		if (!part) return;
		const { r, c, h, w } = part.rect;
		spot.style.setProperty("--r", String(r));
		spot.style.setProperty("--c", String(c));
		spot.style.setProperty("--h", String(h));
		spot.style.setProperty("--w", String(w));
	}
	function markParts(i: number) {
		items.forEach((b, k) => {
			b.classList.toggle("is-on", k === i);
			b.setAttribute("aria-pressed", String(k === i));
		});
	}
	function showPart(i: number) {
		const part = parts[i];
		if (!part) return;
		send({ moment: part.moment, ...(part.pane === undefined ? {} : { pane: part.pane }), play: true });
		place(i);
		markParts(i);
	}

	// The visitor takes over with a click or a key; the next beat hands it back.
	let driving = false;
	function setDriving(on: boolean) {
		if (driving === on) return;
		driving = on;
		root.classList.toggle("is-driving", on);
		if (status) status.textContent = on ? drivingText : stillText;
	}
	function visitor() {
		if (at.startsWith("beat")) setDriving(true);
		if (spotAt >= 0) {
			place(-1);
			markParts(-1);
		}
	}
	tui.addEventListener("vago-tui:visitor", visitor);
	for (const b of root.querySelectorAll<HTMLButtonElement>("[data-tui-key]")) {
		b.addEventListener("click", () => {
			tui.dispatchEvent(new CustomEvent("vago-tui:key", { detail: { key: b.dataset.tuiKey } }));
			visitor();
			b.classList.remove("is-pressed");
			void b.offsetWidth;
			b.classList.add("is-pressed");
		});
	}

	// Geometry of the pinned stage, from E: the pull-back, then the walk.
	let geo = { pull: 1, run: 1, s: 0.66, dy: 0, slotTop: 0 };
	let slotSized = false;

	function sizeSlot() {
		const a = anchor?.getBoundingClientRect();
		const w = slot?.offsetWidth ?? 0;
		if (!a || !slot || a.width === 0 || w === 0) return;
		slot.style.height = `${(a.height * w) / a.width}px`;
		slotSized = true;
	}

	function measure() {
		if (!stage || !slot || !side) return;
		mode = !wideQ.matches ? "narrow" : reduce || !tallQ.matches ? "static" : "pinned";
		root.dataset.mode = mode;
		stage.classList.toggle("is-pinned", mode === "pinned");
		sizeSlot();
		if (mode !== "pinned") {
			stage.style.removeProperty("--vh-stage-h");
			side.style.removeProperty("--e");
			frame();
			return;
		}
		const vh = innerHeight;
		const top = slot.offsetTop;
		const w = slot.offsetWidth;
		const h = slot.offsetHeight;
		// The settled TUI leaves a column on its left and fits under the copy.
		const s = Math.min(0.66, (vh - top - 40) / h, (w - 400) / w);
		const settledH = h * s;
		const dy = Math.max(0, (vh - top - 40 - settledH) / 2);
		const pull = vh * 0.7;
		const run = vh * 0.5 * parts.length;
		geo = { pull, run, s, dy, slotTop: top };
		stage.style.setProperty("--vh-stage-h", `${vh + pull + run}px`);
		side.style.setProperty("--side-w", `${w * (1 - s) - 56}px`);
		side.style.setProperty("--side-top", `${top + dy}px`);
		side.style.setProperty("--side-h", `${settledH}px`);
		frame();
	}

	// Moves the TUI so its top right corner and width match `t`, on screen.
	function put(t: Target | null, a: DOMRect) {
		if (!fly) return;
		if (!t) {
			fly.style.transform = "";
			return;
		}
		const k = t.width / a.width;
		fly.style.transform = `translate3d(${t.right - a.right}px, ${t.top - a.top}px, 0) scale(${k})`;
	}

	function fit() {
		if (!fly || !anchor || !dock || !dockCol || !stage || !slot || !side) return;
		if (mode === "narrow") {
			fly.style.transform = "";
			dock.style.setProperty("--dock-in", "1");
			return;
		}
		if (!slotSized) sizeSlot();
		const a = anchor.getBoundingClientRect();
		if (a.width === 0) return;
		const s = slot.getBoundingClientRect();
		const dockTop = Number.parseFloat(getComputedStyle(dock).top) || 0;
		const engage = dockCol.getBoundingClientRect().top + scrollY - dockTop;
		const docked: Target = { right: a.right, top: dockTop + (a.top - dock.getBoundingClientRect().top), width: a.width };

		if (mode === "static") {
			// One step, once the hero is mostly behind you.
			const home = scrollY >= engage || (s.bottom + a.top) / 2 < innerHeight / 2;
			put(home ? null : { right: s.right, top: s.top, width: s.width }, a);
			dock.style.setProperty("--dock-in", home ? "1" : "0");
			return;
		}

		const stageTop = stage.getBoundingClientRect().top + scrollY;
		const local = scrollY - stageTop;
		const held = geo.pull + geo.run;
		if (scrollY >= engage) {
			put(null, a);
			dock.style.setProperty("--dock-in", "1");
			side.style.setProperty("--e", "1");
			return;
		}
		if (local <= held) {
			const e = ease(clamp01(local / geo.pull));
			put({ right: s.right, top: s.top + geo.dy * e, width: s.width * (1 - (1 - geo.s) * e) }, a);
			dock.style.setProperty("--dock-in", "0");
			side.style.setProperty("--e", String(e));
			return;
		}
		// The hand-off: the stage scrolls away under the TUI, which glides
		// from where it settled into the dock.
		const p = clamp01((local - held) / Math.max(1, engage - stageTop - held));
		const e = smooth(p);
		const settled: Target = { right: s.right, top: geo.slotTop + geo.dy, width: s.width * geo.s };
		put(
			{
				right: mix(settled.right, docked.right, e),
				top: mix(settled.top, docked.top, e),
				width: mix(settled.width, docked.width, e),
			},
			a,
		);
		dock.style.setProperty("--dock-in", String(clamp01((p - 0.75) / 0.25)));
		side.style.setProperty("--e", "1");
	}

	// Where the page stands. "hero", "spot:i" (a pane in the walk), "handoff",
	// or "beat:i" (a beat of the story, or on a phone a pane's own beat).
	let at = "";
	let lastTime = -1;
	const seen = new Set<number>();

	function readLine(): number {
		if (mode !== "narrow") return innerHeight * 0.5;
		const bottom = dockCol?.getBoundingClientRect().bottom ?? 0;
		return bottom + (innerHeight - bottom) * 0.35;
	}

	function where(): { key: string; beat: number; progress: number } {
		const line = readLine();
		let beat = -1;
		let progress = 0;
		beats.forEach((b, i) => {
			if (b.offsetParent === null) return;
			const r = b.getBoundingClientRect();
			if (r.top <= line) {
				beat = i;
				progress = clamp01((line - r.top) / Math.max(1, r.height));
			}
		});
		if (beat >= 0) return { key: `beat:${beat}`, beat, progress };
		if (mode !== "pinned" || !stage) return { key: "hero", beat, progress };
		const into = -stage.getBoundingClientRect().top - geo.pull;
		if (into < -geo.pull * 0.05) return { key: "hero", beat, progress };
		if (into > geo.run) return { key: "handoff", beat, progress };
		const i = Math.min(parts.length - 1, Math.floor(clamp01(into / geo.run) * parts.length));
		return { key: `spot:${i}`, beat, progress };
	}

	function enter(key: string, beat: number) {
		const from = at;
		at = key;
		lastTime = -1;
		setDriving(false);
		beats.forEach((b, i) => {
			b.classList.toggle("is-active", i === beat);
		});
		const el = beats[beat];
		if (el && !seen.has(beat)) {
			seen.add(beat);
			el.classList.add("is-seen");
		}
		const chapter = el ? Number(el.dataset.chapterOf ?? -1) : -1;
		chapters.forEach((c, i) => {
			c.classList.toggle("is-on", i === chapter);
			c.classList.toggle("is-past", i < chapter);
		});

		if (key.startsWith("spot:")) return showPart(Number(key.slice(5)));
		place(-1);
		markParts(-1);
		if (el) {
			const pane = el.dataset.spot;
			if (pane !== undefined) return showPart(Number(pane));
			return send(JSON.parse(el.dataset.goto ?? "{}") as Record<string, unknown>);
		}
		// Back above the story it plays on its own again. On load it's already
		// playing, with its tour.
		if (key === "handoff" && from.startsWith("beat")) send({ moment: "run-activity", play: true });
		if (key === "hero" && from.startsWith("beat")) send({ moment: "goal-running", pane: 0, play: true });
	}

	function readBeats() {
		const { key, beat, progress } = where();
		// A pane picked from the list stays lit until the story takes over.
		const picked = at.startsWith("pick") && key === "hero";
		if (key !== at && !picked) enter(key, beat);
		const scrub = beats[beat]?.dataset.scrub;
		if (!scrub) return;
		const [a = 0, b = 1] = scrub.split(",").map(Number);
		// The replay has 15 frames; send only when the frame changes.
		const t = Math.round((a + (b - a) * smooth(progress)) * 14) / 14;
		if (t !== lastTime) {
			lastTime = t;
			send({ time: t });
		}
	}

	let queued = false;
	function frame() {
		queued = false;
		fit();
		if (root.classList.contains("is-live")) readBeats();
	}
	const queue = () => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(frame);
	};
	addEventListener("scroll", queue, { passive: true });
	addEventListener("resize", () => {
		slotSized = false;
		measure();
	});
	new ResizeObserver(() => {
		slotSized = false;
		measure();
	}).observe(anchor);
	wideQ.addEventListener("change", measure);
	tallQ.addEventListener("change", measure);
	document.fonts?.ready.then(measure);

	// The pane list: pinned, a click scrolls to that pane's place in the walk;
	// otherwise it lights the pane at once.
	items.forEach((b, i) => {
		b.addEventListener("click", () => {
			if (mode === "pinned" && stage) {
				const top = stage.getBoundingClientRect().top + scrollY;
				scrollTo({ top: top + geo.pull + (geo.run / parts.length) * (i + 0.5), behavior: "smooth" });
				return;
			}
			at = `pick:${i}`;
			showPart(i);
		});
	});
	for (const c of chapters) {
		c.addEventListener("click", () => {
			const beat = beats.find((b) => b.dataset.chapterOf === c.dataset.chapter && b.offsetParent !== null);
			if (!beat) return;
			const top = beat.getBoundingClientRect().top + scrollY - innerHeight * 0.3;
			scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
		});
	}

	// The TUI mounts in its own script; wait for it before the first goto.
	function start() {
		const screen = tui?.querySelector<HTMLElement>("[data-screen]");
		if (screen && !spot) {
			spot = document.createElement("i");
			spot.className = "vh-spot";
			spot.setAttribute("aria-hidden", "true");
			screen.append(spot);
			place(spotAt);
		}
		root.classList.add("is-live");
		measure();
	}
	if (tui.dataset.ready !== undefined) start();
	else {
		const mo = new MutationObserver(() => {
			if (tui.dataset.ready === undefined) return;
			mo.disconnect();
			start();
		});
		mo.observe(tui, { attributes: true, attributeFilter: ["data-ready"] });
	}
	// Place the flight before the TUI is ready, so the hero never shows it docked.
	measure();
}
