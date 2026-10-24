// The landing's story: its beats in order, each sending the one live TUI to a screen the replay has, the
// Workflow and Run beats moving the replay's clock, and every artifact agreeing with the captured frames.
import { expect, test } from "bun:test";
import type { ReplayPlace } from "../src/tui/tui-replay.ts";
import {
	placeReplay,
	replayFrame,
	restingState,
	tuiFrames,
} from "../src/tui/tui-replay.ts";
import { servedAt } from "./built-site.ts";

const landing = servedAt("/") ?? "";

function decodeEntities(html: string): string {
	return html
		.replaceAll("&#34;", '"')
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

// Each story beat as the page carries it: its title, where it sends the TUI, its scrub and its artifact.
const beats = landing
	.split("<article")
	.slice(1)
	.filter((html) => html.includes("data-chapter-of"))
	.map((html) => {
		const attribute = (name: string) =>
			decodeEntities(html.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "");
		return {
			title: decodeEntities(html.match(/<h3[^>]*>(.*?)<\/h3>/)?.[1] ?? ""),
			place: JSON.parse(attribute("data-place") || "{}") as ReplayPlace,
			scrub: attribute("data-scrub"),
			artifact: decodeEntities(
				(html.match(/<figure[\s\S]*?<\/figure>/)?.[0] ?? "").replace(
					/<[^>]+>/g,
					"",
				),
			),
		};
	});

const frameText = [...new Set(tuiFrames.lines.map(({ text }) => text))].join(
	"\n",
);

test("the story opens with its statement, then its beats in order", () => {
	const statement = landing.indexOf("Stop babysitting your agents");
	expect(statement).toBeGreaterThan(-1);
	expect(landing.indexOf("You write the Goal")).toBeGreaterThan(statement);
	expect(beats.map(({ title }) => title)).toEqual([
		"You write the Goal",
		"You split it into Tickets",
		"Each Ticket runs your Workflow",
		"Watch a Run, or don't",
		"One Ticket, one commit",
		"One Goal, one PR",
		"When a Step keeps failing",
	]);
});

test("the landing carries one live TUI, which the story drives", () => {
	expect(landing.match(/data-live-tui/g)?.length).toBe(1);
	expect(landing).toMatch(/data-drive[^>]*>Scrolling drives it/);
});

test("the chapter strip names the story's chapters", () => {
	const chapters = [
		...landing.matchAll(/data-chapter="\d+"[^>]*>([^<]+)</g),
	].map(([, name]) => name);
	expect(chapters).toEqual([
		"Goal",
		"Tickets",
		"Workflow",
		"Run",
		"Commit",
		"PR",
	]);
});

test("each beat sends the TUI to a screen the replay has", () => {
	for (const { title, place } of beats) {
		const state = placeReplay(restingState, place);
		const { frame } = replayFrame(state);
		expect(tuiFrames.frames[frame], title).toBeDefined();
	}
});

test("the Workflow and Run beats move the replay's clock as they scroll past", () => {
	const scrubbed = beats.filter(({ scrub }) => scrub !== "");
	expect(scrubbed.map(({ title }) => title)).toEqual([
		"Each Ticket runs your Workflow",
		"Watch a Run, or don't",
	]);
	for (const { title, place, scrub } of scrubbed) {
		const { from, to }: { from: number; to: number } = JSON.parse(scrub);
		const at = (time: number) =>
			replayFrame(placeReplay(restingState, { ...place, time })).frame;
		expect(at(from), title).not.toBe(at(to));
	}
});

test("every Goal, time and cost in the artifacts shows in the captured frames", () => {
	const artifacts = beats.map(({ artifact }) => artifact).join("\n");
	// `vago run` and the Goal report write 3m34s and 6.7s where the TUI writes 3m 34s and 6s.
	const shown = [
		...[...artifacts.matchAll(/\b(\d+)m(\d\d)s\b/g)].map(
			([, minutes, seconds]) => `${minutes}m ${Number(seconds)}s`,
		),
		...[...artifacts.matchAll(/\b(\d+)\.\ds\b/g)].map(
			([, seconds]) => `${seconds}s`,
		),
		...[...artifacts.matchAll(/\$\d+\.\d\d/g)].map(([cost]) => cost),
	];
	expect(shown.length).toBeGreaterThan(10);
	expect(shown.filter((text) => !frameText.includes(text))).toEqual([]);
	const goals = tuiFrames.goals.map(({ name }) => name);
	const named = [...artifacts.matchAll(/vago run ([a-z-]+)/g)].map(
		([, goal]) => goal,
	);
	expect(named.filter((goal) => !goals.includes(goal ?? ""))).toEqual([]);
});
