// The landing's one live TUI carried down the page. It lives in the story's dock and is laid out there
// once; until the visitor reaches the dock, a transform carries it up into the hero. On a wide, tall screen
// without reduced motion the hero pins while scrolling pulls the view back and walks the spotlight over the
// panes, then the TUI glides into the dock in one motion; otherwise it sits in the hero's slot until the
// hero is behind, then in the dock. In the story each beat sends it to its screen, the Workflow and Run
// beats move the replay's clock, and the chapter strip follows. A click or a key hands it to the visitor
// until the next stop. Hides the scroll geometry, which layout is on, and who is driving.

import { liveTui } from "../tui/live-tui.ts";
import type { TuiPaneName } from "../tui/tui-frames.ts";
import type { ReplayPlace } from "../tui/tui-replay.ts";

/** Mounts the tour on the landing page, `page` holding Hero.astro and Story.astro. */
export function mountTour(page: HTMLElement): void {
	const find = (selector: string) => {
		const element = page.querySelector<HTMLElement>(selector);
		if (element === null)
			throw new Error(
				`The landing tour needs ${selector} from Hero.astro or Story.astro`,
			);
		return element;
	};
	const stage = find("[data-hero]");
	const pin = find("[data-hero-pin]");
	const slot = find("[data-hero-slot]");
	const side = find("[data-hero-side]");
	const dockColumn = find("[data-dock-col]");
	const dock = find("[data-dock]");
	const anchor = find("[data-anchor]");
	const fly = find("[data-fly]");
	const drive = find("[data-drive]");
	// The line Story.astro shows while scrolling drives the TUI.
	const scrollingLine = drive.textContent ?? "";
	const tui = liveTui(find("[data-live-tui]"));
	const paneButtons = [
		...page.querySelectorAll<HTMLButtonElement>("[data-pane]"),
	];
	const beats = [...page.querySelectorAll<HTMLElement>("[data-beat]")];
	const chapterButtons = [
		...page.querySelectorAll<HTMLButtonElement>("[data-chapter]"),
	];
	const reduced = matchMedia("(prefers-reduced-motion: reduce)");
	const play = () => {
		if (!reduced.matches) tui.play();
	};

	// The pane the hero lights, by its index in the list, or -1 for none.
	const light = (index: number) => {
		const button = paneButtons[index];
		for (const [each, other] of paneButtons.entries())
			other.setAttribute("aria-pressed", String(each === index));
		if (button === undefined) return tui.spotlight(undefined);
		tui.goto(placeOf(button));
		tui.spotlight(button.dataset.pane as TuiPaneName);
	};

	// The visitor drives from a click or a key until the tour reaches its next stop.
	const setDriving = (driving: boolean) => {
		page.toggleAttribute("data-driving", driving);
		drive.textContent = driving ? drivingLine : scrollingLine;
	};
	tui.onTakeover(() => {
		light(-1);
		setDriving(true);
	});

	// Measured by measure(): the layout the stylesheet picked, and when pinned, how far the view pulls back
	// and how long the walk over the panes runs, in pixels scrolled, the TUI's scale and drop once pulled
	// back, and the slot's top in the pinned stage.
	let layout: "pinned" | "settled" | "narrow" = "settled";
	let pull = 1;
	let walk = 1;
	let scale = 1;
	let drop = 0;
	let slotTop = 0;

	const measure = () => {
		// The stylesheet decides: a sticky stage pins, and a phone hides the hero's slot.
		layout =
			getComputedStyle(pin).position === "sticky"
				? "pinned"
				: slot.offsetParent === null
					? "narrow"
					: "settled";
		const width = slot.offsetWidth;
		const height =
			anchor.offsetWidth === 0
				? 0
				: (anchor.offsetHeight * width) / anchor.offsetWidth;
		slot.style.height = layout === "narrow" ? "" : `${height}px`;
		if (layout !== "pinned") {
			stage.style.removeProperty("--hero-height");
			side.style.removeProperty("--pulled");
			side.inert = false;
			return frame();
		}
		const screen = innerHeight;
		slotTop = slot.offsetTop;
		// Pulled back, the TUI fits under the headline and leaves room on its left for the pane list.
		const room = screen - slotTop - pulledMargin;
		scale = Math.min(pulledScale, room / height, (width - listWidth) / width);
		drop = Math.max(0, (room - height * scale) / 2);
		pull = screen * pullScreens;
		walk = screen * paneScreens * paneButtons.length;
		stage.style.setProperty("--hero-height", `${screen + pull + walk}px`);
		side.style.setProperty("--side-top", `${slotTop + drop}px`);
		side.style.setProperty("--side-width", `${width * (1 - scale)}px`);
		side.style.setProperty("--side-height", `${height * scale}px`);
		frame();
	};

	// Moves the TUI so its top right corner sits at `right`, `top` on screen, `width` wide; none leaves it
	// in the dock.
	const carry = (to?: { right: number; top: number; width: number }) => {
		if (to === undefined) {
			fly.style.transform = "";
			return;
		}
		const home = anchor.getBoundingClientRect();
		fly.style.transform = `translate3d(${to.right - home.right}px, ${to.top - home.top}px, 0) scale(${to.width / home.width})`;
	};
	const docked = (amount: number) =>
		dock.style.setProperty("--docked", String(amount));

	// How far from the top of the screen the dock sticks, and the scroll at which it does, the TUI home.
	const stickyTop = () => Number.parseFloat(getComputedStyle(dock).top) || 0;
	const dockingScroll = () => documentTop(dockColumn) - stickyTop();

	const fit = () => {
		if (layout === "narrow" || scrollY >= dockingScroll()) {
			carry();
			docked(1);
			return;
		}
		const inSlot = slot.getBoundingClientRect();
		if (layout === "settled") {
			// Home once the hero's TUI is mostly scrolled past; with reduced motion this is the one move.
			const home = inSlot.bottom < innerHeight / 2;
			carry(
				home
					? undefined
					: { right: inSlot.right, top: inSlot.top, width: inSlot.width },
			);
			docked(home ? 1 : 0);
			return;
		}
		const scrolled = -stage.getBoundingClientRect().top;
		if (scrolled <= pull + walk) {
			const pulled = easeOut(clamp01(scrolled / pull));
			carry({
				right: inSlot.right,
				top: inSlot.top + drop * pulled,
				width: inSlot.width * (1 - (1 - scale) * pulled),
			});
			side.style.setProperty("--pulled", String(pulled));
			// Unseen, the list takes no clicks nor focus.
			side.inert = pulled < 0.5;
			docked(0);
			return;
		}
		// The hand-off: the stage scrolls away, and the TUI glides from where it was pulled back to where it
		// sticks in the dock, so it lands there on the very scroll the dock sticks at.
		const handOff = Math.max(
			1,
			dockingScroll() - (documentTop(stage) + pull + walk),
		);
		const glided = smoothStep(clamp01((scrolled - pull - walk) / handOff));
		const from = {
			right: inSlot.right,
			top: slotTop + drop,
			width: inSlot.width * scale,
		};
		const home = anchor.getBoundingClientRect();
		const dockTop = stickyTop() + home.top - dock.getBoundingClientRect().top;
		carry({
			right: mix(from.right, home.right, glided),
			top: mix(from.top, dockTop, glided),
			width: mix(from.width, home.width, glided),
		});
		side.style.setProperty("--pulled", "1");
		docked(clamp01((glided - 0.75) / 0.25));
	};

	// Where the tour is: the hero, a pane of the walk, the hand-off, or a beat, each pane or beat by its
	// index. Beats include the phone's pane beats, which show only there.
	let at: TourStop = { kind: "hero", index: 0 };
	let scrubbed = -1;
	const seen = new Set<HTMLElement>();

	// The line on screen a beat's top crosses to become the tour's stop: mid-screen, or on a phone past
	// halfway down what the docked strip leaves, so the beat's text stays in view under the strip while it
	// is the stop.
	const readingLine = () => {
		if (layout !== "narrow") return innerHeight / 2;
		const strip = dockColumn.getBoundingClientRect().bottom;
		return strip + (innerHeight - strip) * 0.55;
	};

	const stopNow = (): { stop: TourStop; progress: number } => {
		const line = readingLine();
		let beat = -1;
		let progress = 0;
		for (const [index, element] of beats.entries()) {
			if (element.offsetParent === null) continue;
			const box = element.getBoundingClientRect();
			if (box.top > line) break;
			beat = index;
			progress = clamp01((line - box.top) / Math.max(1, box.height));
		}
		if (beat >= 0) return { stop: { kind: "beat", index: beat }, progress };
		if (layout !== "pinned")
			return { stop: { kind: "hero", index: 0 }, progress };
		const walked = -stage.getBoundingClientRect().top - pull;
		// The walk lights Goals a little before the pull-back ends, so the list never shows with none lit.
		if (walked < -pull * 0.05)
			return { stop: { kind: "hero", index: 0 }, progress };
		if (walked > walk) return { stop: { kind: "handoff", index: 0 }, progress };
		const pane = Math.min(
			paneButtons.length - 1,
			Math.floor(clamp01(walked / walk) * paneButtons.length),
		);
		return { stop: { kind: "pane", index: pane }, progress };
	};

	const enter = (stop: TourStop) => {
		const from = at;
		at = stop;
		scrubbed = -1;
		setDriving(false);
		const beat = stop.kind === "beat" ? beats[stop.index] : undefined;
		for (const element of beats)
			element.classList.toggle("is-active", element === beat);
		if (beat !== undefined && !seen.has(beat)) {
			seen.add(beat);
			beat.classList.add("is-seen");
		}
		const chapter = Number(beat?.dataset.chapterOf ?? -1);
		for (const [index, button] of chapterButtons.entries()) {
			button.classList.toggle("is-on", index === chapter);
			button.classList.toggle("is-past", index < chapter);
		}

		if (stop.kind === "pane") {
			light(stop.index);
			return play();
		}
		light(-1);
		if (beat !== undefined) {
			const place = placeOf(beat);
			tui.goto(place);
			tui.spotlight(beat.dataset.spotlight as TuiPaneName | undefined);
			// A beat that sets the clock holds it there; the others let the replay run.
			if (place.time !== undefined || beat.dataset.scrub !== undefined)
				return tui.pause();
			return play();
		}
		// Back up from the story, the hero shows the Goals list again, running.
		if (stop.kind === "hero" && from.kind === "beat")
			tui.goto({ view: "project" });
		play();
	};

	const frame = () => {
		fit();
		const { stop, progress } = stopNow();
		if (stop.kind !== at.kind || stop.index !== at.index) enter(stop);
		const scrub =
			stop.kind === "beat" ? beats[stop.index]?.dataset.scrub : undefined;
		if (scrub === undefined) return;
		const { from, to }: { from: number; to: number } = JSON.parse(scrub);
		const time = mix(from, to, progress);
		if (Math.abs(time - scrubbed) < 0.005) return;
		scrubbed = time;
		tui.goto({ time });
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
	new ResizeObserver(measure).observe(anchor);
	reduced.addEventListener("change", measure);

	// Pinned, a pane's name scrolls to its place in the walk; otherwise it lights the pane at once.
	for (const [index, button] of paneButtons.entries())
		button.addEventListener("click", () => {
			// The walk is already there, after the visitor took over: nothing would scroll, so light it here.
			if (layout !== "pinned" || (at.kind === "pane" && at.index === index))
				return light(index);
			scrollTo({
				top:
					documentTop(stage) +
					pull +
					(walk / paneButtons.length) * (index + 0.5),
				behavior: "smooth",
			});
		});

	// A chapter's name scrolls its first beat onto the reading line.
	for (const button of chapterButtons)
		button.addEventListener("click", () => {
			const beat = beats.find(
				(element) => element.dataset.chapterOf === button.dataset.chapter,
			);
			if (beat === undefined) return;
			scrollTo({
				top: beat.getBoundingClientRect().top + scrollY - readingLine() + 8,
				behavior: reduced.matches ? "auto" : "smooth",
			});
		});

	page.toggleAttribute("data-tour", true);
	measure();
}

/** A stop of the tour: the hero, a pane of the walk, the hand-off to the dock, or a beat, the pane or beat
 *  by its index and 0 for the others. */
type TourStop = { kind: "hero" | "pane" | "handoff" | "beat"; index: number };

const drivingLine = "You're driving. Scroll on and the story takes it back.";

// How far down the document `element` starts.
function documentTop(element: HTMLElement): number {
	return element.getBoundingClientRect().top + scrollY;
}

// The place a pane button or a beat sends the TUI to, from its data-place.
function placeOf(element: HTMLElement): ReplayPlace {
	return JSON.parse(element.dataset.place ?? "{}");
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

function smoothStep(time: number): number {
	return time * time * (3 - 2 * time);
}

function mix(from: number, to: number, amount: number): number {
	return from + (to - from) * amount;
}
