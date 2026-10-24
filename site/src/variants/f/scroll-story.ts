// PROTOTYPE, variant F: scrolling drives the LiveTui. Two jobs:
//
// 1. On a wide screen the TUI starts in the hero at full width and flies into
//    the story's sticky column as the hero scrolls away. It's laid out once,
//    at its docked size, and moved with a transform, so nothing reflows.
// 2. Each story beat ([data-beat]) carries the goto it wants in data-goto.
//    The beat at the reading line sends it; a beat with data-scrub="a,b"
//    also moves the replay's time from a to b as it scrolls past.
//
// Above the first beat the TUI plays on its own, as the hero shows it.

type Goto = Record<string, unknown>;

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function mountScrollStory(root: HTMLElement): void {
	const tui = root.querySelector<HTMLElement>("[data-live-tui]");
	const slot = root.querySelector<HTMLElement>("[data-slot]");
	const anchor = root.querySelector<HTMLElement>("[data-anchor]");
	const fly = root.querySelector<HTMLElement>("[data-fly]");
	const dock = root.querySelector<HTMLElement>("[data-dock]");
	const dockCol = root.querySelector<HTMLElement>("[data-dock-col]");
	const status = root.querySelector<HTMLElement>("[data-drive]");
	const beats = [...root.querySelectorAll<HTMLElement>("[data-beat]")];
	const chapters = [...root.querySelectorAll<HTMLElement>("[data-chapter]")];
	if (!tui || !slot || !anchor || !fly || !dock || !dockCol) return;

	const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
	const wide = matchMedia("(min-width: 1024px)");

	const send = (detail: Goto) => tui.dispatchEvent(new CustomEvent("vago-tui:goto", { detail }));

	// The visitor takes over with a click or a key; the next beat hands it back.
	let driving = false;
	const setDriving = (on: boolean) => {
		if (driving === on) return;
		driving = on;
		root.classList.toggle("is-driving", on);
		if (status) status.textContent = on ? "You're driving. Scroll on and the story takes it back." : "Scrolling drives it. Click it to take over.";
	};
	tui.addEventListener("pointerdown", () => setDriving(true));
	document.addEventListener(
		"keydown",
		(e) => {
			if (tui.classList.contains("is-hot") && !e.metaKey && !e.ctrlKey) setDriving(true);
		},
		true,
	);
	for (const b of root.querySelectorAll<HTMLElement>("[data-tui-key]")) {
		b.addEventListener("click", () => {
			setDriving(true);
			tui.dispatchEvent(new CustomEvent("vago-tui:key", { detail: { key: b.dataset.tuiKey } }));
			b.classList.remove("is-pressed");
			void b.offsetWidth;
			b.classList.add("is-pressed");
		});
	}
	for (const c of chapters) {
		c.addEventListener("click", () => {
			const beat = beats[Number(c.dataset.chapter)];
			if (!beat) return;
			const top = beat.getBoundingClientRect().top + scrollY - innerHeight * 0.3;
			scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
		});
	}

	// Where the story stands: -1 above the first beat.
	let active = -2;
	let lastTime = -1;
	const seen = new Set<number>();

	function readBeats() {
		const narrow = !wide.matches;
		const dockBottom = narrow ? dockCol.getBoundingClientRect().bottom : 0;
		const line = narrow ? dockBottom + (innerHeight - dockBottom) * 0.35 : innerHeight * 0.5;
		let index = -1;
		let progress = 0;
		for (let i = 0; i < beats.length; i++) {
			const r = (beats[i] as HTMLElement).getBoundingClientRect();
			if (r.top <= line) {
				index = i;
				progress = clamp01((line - r.top) / Math.max(1, r.height));
			}
		}
		if (index !== active) {
			const from = active;
			active = index;
			lastTime = -1;
			setDriving(false);
			beats.forEach((b, i) => {
				b.classList.toggle("is-active", i === index);
			});
			const beat = beats[index];
			if (beat && !seen.has(index)) {
				seen.add(index);
				beat.classList.add("is-seen");
			}
			const chapter = beat ? Number(beat.dataset.chapterOf ?? -1) : -1;
			chapters.forEach((c, i) => {
				c.classList.toggle("is-on", i === chapter);
				c.classList.toggle("is-past", i < chapter);
			});
			if (beat) send(JSON.parse(beat.dataset.goto ?? "{}") as Goto);
			// Back above the story, it plays on its own again. On load it's
			// already playing, with its tour.
			else if (from >= 0) send({ moment: "goal-running", pane: 0, play: true });
		}
		const beat = beats[index];
		const scrub = beat?.dataset.scrub;
		if (beat && scrub) {
			const [a = 0, b = 1] = scrub.split(",").map(Number);
			// The replay has 15 frames; send only when the frame changes.
			const t = Math.round((a + (b - a) * smooth(progress)) * 14) / 14;
			if (t !== lastTime) {
				lastTime = t;
				send({ time: t });
			}
		}
	}

	// The hero-to-dock flight, wide screens only.
	let slotSized = false;
	function fit() {
		if (!wide.matches) {
			fly.style.transform = "";
			dock.style.removeProperty("--dock-in");
			root.style.removeProperty("--hero-out");
			return;
		}
		const a = anchor.getBoundingClientRect();
		const s = slot.getBoundingClientRect();
		if (a.width === 0) return;
		const big = s.width / a.width;
		if (!slotSized || Math.abs(s.height - a.height * big) > 1) {
			slot.style.height = `${a.height * big}px`;
			slotSized = true;
		}
		// The flight runs from where the hero shows it at the top of the page to
		// where it docks, in screen terms, over the scroll it takes the story to
		// reach the dock. It glides up and to the right while the page moves
		// under it, so the hero never leaves an empty hole behind.
		const dockTop = Number.parseFloat(getComputedStyle(dock).top || "0");
		const engage = dockCol.getBoundingClientRect().top + scrollY - dockTop;
		const p = clamp01(scrollY / Math.max(1, engage));
		const e = 1 - (1 - p) ** 3;
		const startTop = s.top + scrollY;
		if (reduce) {
			// No flight: it scrolls with the hero, then sits in the dock.
			const docked = p >= 1;
			fly.style.transform = docked ? "" : `translate(${s.right - a.right}px, ${s.top - a.top}px) scale(${big})`;
			dock.style.setProperty("--dock-in", docked ? "1" : "0");
			return;
		}
		const dockedTop = dockTop + (a.top - dock.getBoundingClientRect().top);
		const k = big + (1 - big) * e;
		const x = (s.right - a.right) * (1 - e);
		const y = startTop + (dockedTop - startTop) * e - a.top;
		fly.style.transform = e >= 1 ? "" : `translate(${x}px, ${y}px) scale(${k})`;
		dock.style.setProperty("--dock-in", String(clamp01((p - 0.9) / 0.1)));
		root.style.setProperty("--hero-out", String(clamp01(1 - p * 4)));
	}

	let queued = false;
	const frame = () => {
		queued = false;
		fit();
		readBeats();
	};
	const queue = () => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(frame);
	};
	addEventListener("scroll", queue, { passive: true });
	addEventListener("resize", () => {
		slotSized = false;
		queue();
	});
	new ResizeObserver(() => {
		slotSized = false;
		queue();
	}).observe(anchor);
	wide.addEventListener("change", queue);

	// The TUI mounts in its own script; wait for it before the first goto.
	const start = () => {
		root.classList.add("is-live");
		frame();
	};
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
	fit();
}
