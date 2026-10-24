// PROTOTYPE: variant E's behaviour. The hero TUI fills the first screen and
// the camera pulls back as the page scrolls, then a spotlight walks its panes
// while the column beside it names each one. Further down, the pipeline is
// lit by scroll, and the Workflow file lights the Step the second TUI is on.

import { replaySteps } from "./workflow.ts";

type Rect = { r: number; c: number; h: number; w: number };
type Part = { moment: "project" | "goal-running"; pane?: number; rect: Rect };

// Where each pane sits in the TUI's 120 x 34 grid.
const parts: Part[] = [
	{ moment: "project", rect: { r: 2, c: 0, h: 9, w: 120 } },
	{ moment: "goal-running", pane: 0, rect: { r: 6, c: 0, h: 10, w: 47 } },
	{ moment: "goal-running", pane: 1, rect: { r: 6, c: 48, h: 15, w: 72 } },
	{ moment: "goal-running", pane: 2, rect: { r: 17, c: 0, h: 4, w: 47 } },
	{ moment: "goal-running", pane: 3, rect: { r: 22, c: 0, h: 10, w: 120 } },
];

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const ease = (t: number) => 1 - (1 - t) ** 3;

function goto(tui: HTMLElement, detail: Record<string, unknown>) {
	tui.dispatchEvent(new CustomEvent("vago-tui:goto", { detail }));
}

function whenReady(tui: HTMLElement, cb: () => void) {
	if (tui.dataset.ready !== undefined) return cb();
	tui.addEventListener("vago-tui:change", () => queueMicrotask(cb), { once: true });
}

function hero(root: HTMLElement) {
	const stage = root.querySelector<HTMLElement>("[data-stage]");
	const tui = root.querySelector<HTMLElement>("#ve-tui");
	const slot = root.querySelector<HTMLElement>("[data-slot]");
	const side = root.querySelector<HTMLElement>("[data-side]");
	const items = [...root.querySelectorAll<HTMLButtonElement>("[data-part]")];
	if (!stage || !tui || !slot || !side) return;

	let spot: HTMLElement | null = null;
	let active = -1;
	whenReady(tui, () => {
		const screen = tui.querySelector<HTMLElement>("[data-screen]");
		if (!screen) return;
		spot = document.createElement("i");
		spot.className = "ve-spot";
		spot.setAttribute("aria-hidden", "true");
		screen.append(spot);
		if (active >= 0) place(active);
	});

	function place(i: number) {
		const part = parts[i];
		if (!spot) return;
		spot.classList.toggle("is-on", !!part);
		if (!part) return;
		const { r, c, h, w } = part.rect;
		spot.style.setProperty("--r", String(r));
		spot.style.setProperty("--c", String(c));
		spot.style.setProperty("--h", String(h));
		spot.style.setProperty("--w", String(w));
	}
	function show(i: number) {
		if (i === active) return;
		active = i;
		items.forEach((b, k) => {
			b.classList.toggle("is-on", k === i);
			b.setAttribute("aria-pressed", String(k === i));
		});
		const part = parts[i];
		if (part) goto(tui, { moment: part.moment, ...(part.pane === undefined ? {} : { pane: part.pane }) });
		place(i);
	}

	// Pinned only where there's room for it and motion is welcome.
	const roomy = matchMedia("(min-width: 1000px) and (min-height: 640px)");
	let pinned = false;
	let geo = { pull: 1, run: 1, s: 1, dy: 0 };

	function measure() {
		pinned = roomy.matches && !reduce;
		stage?.classList.toggle("is-pinned", pinned);
		if (!pinned || !slot || !stage) {
			slot?.style.removeProperty("transform");
			side?.style.removeProperty("--e");
			return;
		}
		const vh = window.innerHeight;
		const top = slot.offsetTop;
		const w = slot.offsetWidth;
		const h = slot.offsetHeight;
		// The settled TUI leaves a column on its left and fits under the copy.
		const s = Math.min(0.66, (vh - top - 40) / h, (w - 400) / w);
		const settledH = h * s;
		const dy = Math.max(0, (vh - top - 40 - settledH) / 2);
		const pull = vh * 0.7;
		const run = vh * 0.5 * parts.length;
		geo = { pull, run, s, dy };
		stage.style.setProperty("--ve-stage-h", `${vh + pull + run}px`);
		side?.style.setProperty("--side-w", `${w * (1 - s) - 56}px`);
		side?.style.setProperty("--side-top", `${top + dy}px`);
		side?.style.setProperty("--side-h", `${settledH}px`);
		frame();
	}

	function frame() {
		if (!pinned || !stage || !slot || !side) return;
		const y = -stage.getBoundingClientRect().top;
		const e = ease(clamp01(y / geo.pull));
		const sc = 1 - (1 - geo.s) * e;
		slot.style.transform = `translate3d(0, ${geo.dy * e}px, 0) scale(${sc})`;
		side.style.setProperty("--e", String(e));
		const into = y - geo.pull;
		const i = into < -geo.pull * 0.05 ? -1 : Math.min(parts.length - 1, Math.floor(clamp01(into / geo.run) * parts.length));
		if (i < 0) {
			if (active !== -1) {
				active = -1;
				items.forEach((b) => b.classList.remove("is-on"));
				place(-1);
			}
		} else show(i);
	}

	let raf = 0;
	window.addEventListener(
		"scroll",
		() => {
			if (!pinned || raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				frame();
			});
		},
		{ passive: true },
	);
	window.addEventListener("resize", measure);
	roomy.addEventListener("change", measure);
	document.fonts?.ready.then(measure);
	measure();

	items.forEach((b, i) => {
		b.addEventListener("click", () => {
			if (pinned && stage) {
				const top = stage.getBoundingClientRect().top + window.scrollY;
				window.scrollTo({ top: top + geo.pull + (geo.run / parts.length) * (i + 0.5), behavior: "smooth" });
			} else {
				show(i);
				if (!roomy.matches) tui.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
			}
		});
	});

	// The key row under the TUI presses keys in it.
	for (const k of root.querySelectorAll<HTMLButtonElement>("[data-press]")) {
		k.addEventListener("click", () => {
			tui.dispatchEvent(new CustomEvent("vago-tui:key", { detail: { key: k.dataset.press } }));
			k.classList.remove("is-pressed");
			void k.offsetWidth;
			k.classList.add("is-pressed");
			if (active >= 0) {
				active = -1;
				items.forEach((b) => b.classList.remove("is-on"));
				place(-1);
			}
		});
	}
}

// The pipeline lights stage by stage as it crosses the screen.
function pipeline(root: HTMLElement) {
	const pipe = root.querySelector<HTMLElement>("[data-pipe]");
	if (!pipe || reduce) return;
	const stages = [...pipe.querySelectorAll<HTMLElement>("[data-stage-i]")];
	const steps = [...pipe.querySelectorAll<HTMLElement>("[data-step]")];
	const set = (el: Element | null, state: string) => {
		if (el instanceof HTMLElement) el.dataset.state = state;
	};
	function frame() {
		if (!pipe) return;
		const r = pipe.getBoundingClientRect();
		const vh = window.innerHeight;
		const t = clamp01((vh * 0.82 - r.top) / (r.height + vh * 0.3)) * 5;
		pipe.style.setProperty("--fill", String(clamp01((t - 0.2) / 4)));
		stages.forEach((s, i) => s.classList.toggle("is-lit", t >= i + 0.2));
		steps.forEach((s, k) => {
			const a = 2 + k / steps.length;
			set(s, t >= a + 1 / steps.length ? "done" : t >= a ? "cur" : "pend");
		});
		set(pipe.querySelector("[data-t03]"), t >= 3 ? "done" : t >= 1.2 ? "cur" : "pend");
		set(pipe.querySelector("[data-landed]"), t >= 3.1 ? "done" : "pend");
		set(pipe.querySelector("[data-pr]"), t >= 4.1 ? "done" : "pend");
	}
	let raf = 0;
	window.addEventListener(
		"scroll",
		() => {
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				frame();
			});
		},
		{ passive: true },
	);
	frame();
}

// The Workflow file lights the block of the Step the second TUI is on.
function workflow(root: HTMLElement) {
	const tui = root.querySelector<HTMLElement>("#ve-flow-tui");
	const file = root.querySelector<HTMLElement>("[data-file]");
	const now = root.querySelector<HTMLElement>("[data-now]");
	if (!tui || !file) return;
	const blocks = [...file.querySelectorAll<HTMLElement>("[data-block]")];
	type Change = { goal: string; label: string };
	tui.addEventListener("vago-tui:change", (e) => {
		const { goal, label } = (e as CustomEvent<Change>).detail;
		const stuck = goal === "order-export";
		const at = label === "Done" ? replaySteps.length : replaySteps.indexOf(label);
		file.classList.toggle("is-stuck", stuck);
		for (const b of blocks) {
			const k = replaySteps.indexOf(b.dataset.block ?? "");
			if (k < 0) continue;
			let state = k < at ? "done" : k === at ? "cur" : "pend";
			if (stuck) state = k === 0 ? "done" : k === 1 ? "bad" : "pend";
			b.dataset.state = state;
		}
		if (now) {
			if (stuck) now.textContent = "order-export, Ticket 02: Build failed four times and the Ticket is stuck.";
			else if (label === "Done") now.textContent = "gift-cards, Ticket 03: merged. Ticket 04 starts.";
			else now.textContent = `gift-cards, Ticket 03: ${label}`;
		}
	});
	const stuckBtn = root.querySelector<HTMLButtonElement>("[data-show-stuck]");
	stuckBtn?.addEventListener("click", () => {
		const on = stuckBtn.getAttribute("aria-pressed") !== "true";
		stuckBtn.setAttribute("aria-pressed", String(on));
		stuckBtn.textContent = on ? "Back to gift-cards" : "Show the stuck Goal in the TUI";
		goto(tui, on ? { moment: "stuck", pane: 3, play: false } : { moment: "ticket-steps", play: true });
		if (on) tui.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
	});
	// A goto with nothing in it only redraws, so the file lights at once.
	whenReady(tui, () => goto(tui, {}));
}

// Each section's parts rise in once, in order.
function reveals(root: HTMLElement) {
	if (reduce || !("IntersectionObserver" in window)) return;
	root.classList.add("ve-anim");
	const io = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				e.target.classList.add("is-in");
				io.unobserve(e.target);
			}
		},
		{ threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
	);
	for (const el of root.querySelectorAll("[data-rise]")) io.observe(el);
}

export function mountVariantE(root: HTMLElement) {
	hero(root);
	pipeline(root);
	workflow(root);
	reveals(root);
}
