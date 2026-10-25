// The When things go wrong page: it follows Planning a Goal, embeds the TUI on acme-shop's stuck Goal, and
// its `vago run` output retries a failed agent Step after 1, 1 and 5 minutes, as pass-runner.ts does, with
// the Run times and costs the frames show.
import { expect, test } from "bun:test";
import {
	placeReplay,
	replayFrame,
	restingState,
	tuiFrames,
} from "../src/tui/tui-replay.ts";
import { servedAt } from "./built-site.ts";
import {
	liveTuis,
	numbersNotInFrames,
	sidebarLinks,
	vagoRunOutput,
} from "./docs-page.ts";

const page = servedAt("/docs/when-things-go-wrong/") ?? "";
const copy = servedAt("/docs/when-things-go-wrong.md") ?? "";

test("the page follows Planning a Goal in the sidebar", () => {
	const docs = sidebarLinks(page, "/docs/");
	expect(docs[docs.indexOf("/docs/planning-a-goal/") + 1]).toBe(
		"/docs/when-things-go-wrong/",
	);
});

test("the page embeds the TUI on the stuck Goal, in the Goals list and the Goal view", () => {
	const places = liveTuis(page).map(({ place }) => place);
	const views = places.map((place) => placeReplay(restingState, place));
	expect(views.map(({ view }) => view)).toEqual(["project", "goal"]);
	for (const place of places) {
		expect(place.goal).toBe("order-export");
		expect(
			tuiFrames.frames[replayFrame(placeReplay(restingState, place)).frame],
		).toBeDefined();
	}
});

test("the stuck Ticket's output retries after 1, 1 and 5 minutes, with the frames' Run times and costs", () => {
	const output = vagoRunOutput(copy);
	const retries = output
		.filter((line) => line.includes("retries in"))
		.map((line) => line.match(/retries in (\S+)$/)?.[1]);
	expect(retries).toEqual(["1m00s", "1m00s", "5m00s"]);
	// Each retry starts when its wait is over.
	const at = (line: string) => Date.parse(line.trim().slice(0, 20));
	for (const [index, line] of output.entries()) {
		const wait = line.match(/retries in (\d)m00s$/)?.[1];
		if (wait === undefined) continue;
		const next = output[index + 1] ?? "";
		expect(next).toEndWith("Build started");
		expect(at(next) - at(line)).toBe(Number(wait) * 60_000);
	}
	// The Runs pane the page embeds shows the last two.
	const failed = output.filter((line) => line.endsWith("Build exit 1"));
	expect(failed.length).toBe(4);
	expect(numbersNotInFrames(failed.slice(-2))).toEqual([]);
	expect(output).toContain("  reset:  vago ticket reset order-export 02");
});
