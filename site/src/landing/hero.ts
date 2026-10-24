// The landing hero's motion: while Hero.astro's stage is pinned, scrolling pulls the view back from the live
// TUI and then walks the spotlight over its panes, each pane's name lighting beside it; otherwise the hero
// stays settled and picking a pane's name lights that pane. Hides the scroll geometry and which mode is on.

import { liveTui } from "../tui/live-tui.ts";
import type { TuiPaneName } from "../tui/tui-frames.ts";

/** Mounts the hero whose stage is `stage`, the element with data-hero in Hero.astro. */
export function mountHero(stage: HTMLElement): void {
	const pin = stage.querySelector<HTMLElement>("[data-hero-pin]");
	const slot = stage.querySelector<HTMLElement>("[data-hero-slot]");
	const fly = stage.querySelector<HTMLElement>("[data-hero-fly]");
	const side = stage.querySelector<HTMLElement>("[data-hero-side]");
	const list = stage.querySelector<HTMLElement>("[data-hero-panes]");
	const root = stage.querySelector<HTMLElement>("[data-live-tui]");
	if (!pin || !slot || !fly || !side || !list || !root)
		throw new Error(
			"The hero needs Hero.astro's pin, slot, fly, side, pane list and live TUI",
		);
	const tui = liveTui(root);
	const buttons = [...list.querySelectorAll<HTMLButtonElement>("[data-pane]")];

	// The lit pane, by its index in the list, or -1 for none.
	let lit = -1;
	const light = (index: number) => {
		lit = index;
		const button = buttons[index];
		for (const [each, other] of buttons.entries())
			other.setAttribute("aria-pressed", String(each === index));
		if (button === undefined) return tui.spotlight(undefined);
		tui.goto(JSON.parse(button.dataset.place ?? "{}"));
		tui.spotlight(button.dataset.pane as TuiPaneName);
	};

	// The visitor driving the TUI puts the spotlight out; while pinned, the walk lights the next pane.
	tui.onTakeover(() => light(-1));

	// Pinned, where it sits: how far the view pulls back, then how long the walk over the panes runs, both
	// in pixels scrolled, and the TUI's scale and drop once pulled back.
	let pinned = false;
	let pull = 1;
	let walk = 1;
	let scale = 1;
	let drop = 0;
	// The pane the walk is on, which it lights once on reaching it; the visitor's takeover holds until then.
	let walking = -1;

	const measure = () => {
		// The stylesheet decides when the hero pins, by making the pin sticky.
		pinned = getComputedStyle(pin).position === "sticky";
		fly.style.transform = "";
		if (!pinned) {
			stage.style.removeProperty("--hero-height");
			side.inert = false;
			return;
		}
		const screen = innerHeight;
		const top = slot.offsetTop;
		const width = slot.offsetWidth;
		const height = fly.offsetHeight;
		// Pulled back, the TUI fits under the headline and leaves room on its left for the pane list.
		const room = screen - top - pulledMargin;
		scale = Math.min(pulledScale, room / height, (width - listWidth) / width);
		drop = Math.max(0, (room - height * scale) / 2);
		pull = screen * pullScreens;
		walk = screen * paneScreens * buttons.length;
		stage.style.setProperty("--hero-height", `${screen + pull + walk}px`);
		side.style.setProperty("--side-top", `${top + drop}px`);
		side.style.setProperty("--side-width", `${width * (1 - scale)}px`);
		side.style.setProperty("--side-height", `${height * scale}px`);
		frame();
	};

	const frame = () => {
		if (!pinned) return;
		const scrolled = -stage.getBoundingClientRect().top;
		const pulled = easeOut(clamp01(scrolled / pull));
		fly.style.transform = `translate3d(0, ${drop * pulled}px, 0) scale(${1 - (1 - scale) * pulled})`;
		side.style.setProperty("--pulled", String(pulled));
		// Unseen, the list takes no clicks nor focus.
		side.inert = pulled < 0.5;
		const walked = scrolled - pull;
		// The walk lights Goals a little before the pull-back ends, so the list never shows with none lit.
		const pane =
			walked < -pull * 0.05
				? -1
				: Math.min(
						buttons.length - 1,
						Math.floor(clamp01(walked / walk) * buttons.length),
					);
		if (pane === walking) return;
		walking = pane;
		light(pane);
	};

	let queued = false;
	addEventListener(
		"scroll",
		() => {
			if (queued) return;
			queued = true;
			requestAnimationFrame(() => {
				queued = false;
				frame();
			});
		},
		{ passive: true },
	);
	addEventListener("resize", measure);
	new ResizeObserver(measure).observe(fly);
	matchMedia("(prefers-reduced-motion: reduce)").addEventListener(
		"change",
		measure,
	);

	// Pinned, a pane's name scrolls to its place in the walk; settled, it lights the pane at once.
	for (const [index, button] of buttons.entries())
		button.addEventListener("click", () => {
			// The walk is already there, after the visitor took over: nothing would scroll, so light it here.
			if (!pinned || index === walking) return light(index);
			const top = stage.getBoundingClientRect().top + scrollY;
			scrollTo({
				top: top + pull + (walk / buttons.length) * (index + 0.5),
				behavior: "smooth",
			});
		});

	// Settled, the spotlight goes out once the list has scrolled away, so it never lights a pane nobody is
	// reading about.
	new IntersectionObserver((entries) => {
		if (!pinned && lit >= 0 && !entries.some((entry) => entry.isIntersecting))
			light(-1);
	}).observe(list);

	measure();
}

// The pulled-back TUI's largest scale, the space it keeps under itself, and the narrowest the pane list
// beside it gets, its gap included. Then how far the visitor scrolls, in screen heights, to pull the view
// back and to move the walk on by one pane.
const pulledScale = 0.66;
const pulledMargin = 40;
const listWidth = 400;
const pullScreens = 0.7;
const paneScreens = 0.5;

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function easeOut(time: number): number {
	return 1 - (1 - time) ** 3;
}
