// The docs pages that embed the live TUI, Running and watching and Planning a Goal in the TUI: each TUI
// starts on a screen the capture has, `vago run`'s output is in its real format with the frames' numbers,
// the Markdown copies show the screens as text, and the replay's planning view takes the planning keys.
import { expect, test } from "bun:test";
import {
	focusedPane,
	placeReplay,
	pressReplayKey,
	type ReplayPlace,
	type ReplayState,
	replayFrame,
	restingState,
	tuiFrames,
} from "../src/tui/tui-replay.ts";
import { servedAt } from "./built-site.ts";

const running = servedAt("/docs/running-and-watching/") ?? "";
const planning = servedAt("/docs/planning-a-goal/") ?? "";

function decodeEntities(html: string): string {
	return html
		.replaceAll("&#34;", '"')
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

// Each live TUI on `html`: where it starts, and the text of the first screen drawn into the page.
function liveTuis(html: string): { place: ReplayPlace; text: string }[] {
	return html
		.split("data-live-tui")
		.slice(1)
		.map((tui) => ({
			place: JSON.parse(
				decodeEntities(tui.match(/data-place="([^"]*)"/)?.[1] ?? "{}"),
			),
			text: decodeEntities(
				[...tui.matchAll(/<div class="row" data-row>(.*?)<\/div>/g)]
					.map(([, row = ""]) => row.replace(/<[^>]+>/g, ""))
					.join("\n"),
			),
		}));
}

const frameText = tuiFrames.lines.map(({ text }) => text).join("\n");

test("the two pages follow Workflows in the sidebar", () => {
	const docs = [...running.matchAll(/href="(\/docs\/[^"#]+)"/g)].map(
		([, path]) => path,
	);
	const workflows = docs.indexOf("/docs/workflows/");
	expect(docs.slice(workflows + 1, workflows + 3)).toEqual([
		"/docs/running-and-watching/",
		"/docs/planning-a-goal/",
	]);
});

test("Running and watching embeds the TUI on the Goals list and in the Goal view", () => {
	const tuis = liveTuis(running);
	const views = tuis.map(({ place }) => placeReplay(restingState, place).view);
	expect(views).toContain("project");
	expect(views).toContain("goal");
	for (const { place, text } of tuis) {
		const { frame } = replayFrame(placeReplay(restingState, place));
		expect(tuiFrames.frames[frame]).toBeDefined();
		expect(text).toContain("acme-shop");
	}
});

test("Planning a Goal embeds the TUI on the planning view, its session and Preview from the capture", () => {
	const tuis = liveTuis(planning);
	expect(tuis.length).toBeGreaterThan(0);
	for (const { place } of tuis)
		expect(placeReplay(restingState, place).view).toBe("planning");
	const first = tuis[0]?.text ?? "";
	expect(first).toContain("self-service-returns");
	expect(first).toContain("Preview");
	expect(first).toContain("ready to accept");
});

test("the vago run output on Running and watching is in vago run's format, with the frames' numbers", () => {
	const copy = servedAt("/docs/running-and-watching.md") ?? "";
	const output =
		copy.match(/```text\n(Worktree [\s\S]*?)```/)?.[1]?.split("\n") ?? [];
	// As progress.ts prints them: the time in UTC, what it took and cost right-aligned, the Step, the outcome.
	const stepLines = output.filter((line) => line.startsWith("  20"));
	expect(stepLines.length).toBeGreaterThan(5);
	for (const line of stepLines)
		expect(line).toMatch(
			/^ {2}\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ {2}[ \dhms.]{6} {2}[ $\d.]{6} {2}\S.* (started|ok|skipped)$/,
		);
	// Each Ticket's time and cost in the summary, as its Ticket pane gives them. `vago run` writes 3m34s
	// where the TUI writes 3m 34s.
	const summary = output.filter((line) => /^\d\d-\S+ +done /.test(line));
	expect(summary.length).toBeGreaterThan(1);
	const numbers = summary.flatMap((line) => [
		...[...line.matchAll(/\b(\d+)m(\d\d)s\b/g)].map(
			([, minutes, seconds]) => `${minutes}m ${Number(seconds)}s`,
		),
		...(line.match(/\$\d+\.\d\d/g) ?? []),
	]);
	expect(numbers.filter((text) => !frameText.includes(text))).toEqual([]);
});

test("each page's Markdown copy shows its TUI's screens as text", () => {
	const copy = servedAt("/docs/planning-a-goal.md") ?? "";
	expect(copy).not.toContain("<DocsTui");
	expect(copy).toContain("ready to accept");
	expect(servedAt("/docs/running-and-watching.md")).not.toContain("<DocsTui");
});

test("the replay's planning item opens on its session, and Ctrl-], a, Esc work as in the TUI", () => {
	const item = tuiFrames.goals.findIndex(
		({ standing }) => standing === "planning",
	);
	const press = (state: ReplayState, key: string) =>
		pressReplayKey(state, key, false).state;
	const goals = { ...restingState, goal: item };
	const opened = press(goals, "Enter");
	expect(opened.view).toBe("planning");
	expect(focusedPane(opened)).toBe("Session");
	expect(pressReplayKey(opened, "a", false).notice).toContain("agent's");
	const preview = press(opened, "Ctrl-]");
	expect(focusedPane(preview)).toBe("Preview");
	const asking = press(preview, "a");
	const footer = (state: ReplayState) => {
		const { frame } = replayFrame(state);
		const rows = tuiFrames.frames[frame]?.rows ?? [];
		return tuiFrames.lines[rows.at(-1) ?? 0]?.text ?? "";
	};
	expect(footer(asking)).toContain("Accept self-service-returns");
	expect(press(preview, "Escape").view).toBe("project");
});
