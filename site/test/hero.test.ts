// The landing hero names the TUI's panes in the order the spotlight walks them, each sending the TUI to a
// screen that shows that pane, and its key row presses the hero's TUI.
import { expect, test } from "bun:test";
import type { TuiPaneName } from "../src/tui/tui-frames.ts";
import {
	placeReplay,
	replayFrame,
	restingState,
	tuiFrames,
} from "../src/tui/tui-replay.ts";
import { servedAt } from "./built-site.ts";

const landing = servedAt("/") ?? "";

const panes = [
	...landing.matchAll(/data-pane="([^"]+)" data-place="([^"]+)"/g),
].map(([, name = "", place = ""]) => ({
	name,
	place: JSON.parse(place.replaceAll("&#34;", '"')),
}));

test("the hero names the TUI's panes in the order the spotlight walks them", () => {
	expect(panes.map(({ name }) => name)).toEqual([
		"Goals",
		"Tickets",
		"Ticket",
		"Runs",
		"Run activity",
	]);
});

test("each pane the hero names is on the screen it sends the TUI to", () => {
	const missing = panes.filter(({ name, place }) => {
		const { frame } = replayFrame(placeReplay(restingState, place));
		return !tuiFrames.frames[frame]?.panes.some(
			(pane) => pane.name === (name as TuiPaneName),
		);
	});
	expect(missing).toEqual([]);
});

test("the hero's key row presses the hero's TUI", () => {
	const tuiId = landing.match(/id="([^"]+)" data-live-tui/)?.[1];
	expect(tuiId).toBeDefined();
	expect(landing).toContain(`data-tui-keys data-for="${tuiId}"`);
});
