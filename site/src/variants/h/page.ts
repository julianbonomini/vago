// PROTOTYPE: variant H's behaviour below the story, from E: the pipeline
// lit by scroll, the Workflow file lighting the Step the second TUI is on
// (with F's small/try-hard tabs), and each section's parts rising in once.
// run.ts carries the hero, the walk over the panes and the story.

import { mountRun } from "./run.ts";
import { replaySteps } from "./workflow.ts";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function goto(tui: HTMLElement, detail: Record<string, unknown>) {
	tui.dispatchEvent(new CustomEvent("vago-tui:goto", { detail }));
}

function whenReady(tui: HTMLElement, cb: () => void) {
	if (tui.dataset.ready !== undefined) return cb();
	tui.addEventListener("vago-tui:change", () => queueMicrotask(cb), { once: true });
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
		const vh = innerHeight;
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
	addEventListener(
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

// The Workflow file lights the block of the Step the second TUI is on, and
// the tabs switch between the two starter files.
function workflow(root: HTMLElement) {
	const tui = root.querySelector<HTMLElement>("#vh-flow-tui");
	const file = root.querySelector<HTMLElement>("[data-file='small.toml']");
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
		stuckBtn.textContent = on ? "Back to gift-cards" : "Show a stuck Goal in the TUI";
		goto(tui, on ? { moment: "stuck", pane: 3, play: false } : { moment: "ticket-steps", play: true });
		if (on) tui.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
	});
	// A goto with nothing in it only redraws, so the file lights at once.
	whenReady(tui, () => goto(tui, {}));

	const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-tab]")];
	const panels = [...root.querySelectorAll<HTMLElement>("[data-panel]")];
	const pick = (i: number) => {
		tabs.forEach((t, j) => {
			t.setAttribute("aria-selected", String(i === j));
			t.tabIndex = i === j ? 0 : -1;
		});
		panels.forEach((p, j) => {
			p.hidden = i !== j;
		});
	};
	for (const t of tabs) {
		t.addEventListener("click", () => pick(Number(t.dataset.tab)));
		t.addEventListener("keydown", (e) => {
			if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
			e.preventDefault();
			const next = (Number(t.dataset.tab) + 1) % tabs.length;
			pick(next);
			tabs[next]?.focus();
		});
	}
}

// Each section's parts rise in once, in order.
function reveals(root: HTMLElement) {
	if (reduce || !("IntersectionObserver" in window)) return;
	root.classList.add("vh-anim");
	const io = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				if (!e.isIntersecting) continue;
				e.target.classList.add("is-in");
				io.unobserve(e.target);
			}
		},
		{ threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
	);
	for (const el of root.querySelectorAll("[data-rise]")) io.observe(el);
}

export function mountVariantH(root: HTMLElement) {
	mountRun(root);
	pipeline(root);
	workflow(root);
	reveals(root);
}
