// Where the landing's live TUI stops on its way down the page: the panes the hero's spotlight walks, and the
// story's beats, each with the screen it sends the TUI to and the real artifact it shows from acme-shop.
// The Goal and its Tickets come from the example Project the frames are captured from, and the Workflow from
// the starter's small.toml; the times and costs are the frames', which test/story.test.ts checks.

import smallWorkflow from "../../../starter/workflows/small.toml?raw";
import { exampleGoals } from "../../capture/acme-shop.ts";
import type { TuiPaneName } from "../tui/tui-frames.ts";
import type { ReplayPlace } from "../tui/tui-replay.ts";
import { tuiFrames } from "../tui/tui-replay.ts";

/** A pane the spotlight walks, the screen that shows it, and the line that names it. */
export type PaneStop = { name: TuiPaneName; place: ReplayPlace; text: string };

/** How a piece of an artifact is drawn: as the page's text, dimmed, bright, or in the accent, ok or bad
 *  colour. */
export type ArtifactTone = "plain" | "dim" | "bright" | "accent" | "ok" | "bad";

export type ArtifactPiece = { text: string; tone: ArtifactTone };

/** A file or a command's output as a beat shows it: its path or command, and its lines, each a run of
 *  pieces. */
export type StoryArtifact = { caption: string; lines: ArtifactPiece[][] };

/** A beat of the story: what it says, the screen it sends the TUI to, and its artifact. */
export type StoryBeat = {
	/** The beat's fragment id. */
	id: string;
	title: string;
	body: string;
	/** An honest limit on what the beat claims, shown beside it. */
	limit?: string;
	/** The chapter of the strip over the TUI that the beat lights; a beat without one comes after them all. */
	chapter?: string;
	place: ReplayPlace;
	/** The replay's clock, from 0 to 1, as the beat's top crosses the reading line and as it leaves it. */
	scrub?: { from: number; to: number };
	artifact: StoryArtifact;
};

const goal = tuiFrames.replay.goal;
const ticket = tuiFrames.replay.ticket;

/** The panes in the order the spotlight walks them, each with the screen that shows it. */
export const paneStops: PaneStop[] = [
	{
		name: "Goals",
		place: { view: "project", goal },
		text: "Every Goal in the Project with its progress and cost, and what it's doing right now.",
	},
	{
		name: "Tickets",
		place: { view: "goal", goal, pane: "Tickets" },
		text: `Open a Goal and its Tickets run top to bottom, one at a time. Here ${ticket} is the one running.`,
	},
	{
		name: "Ticket",
		place: { view: "goal", goal, pane: "Ticket" },
		text: "What the running Ticket asks for, and the Steps your Workflow takes it through.",
	},
	{
		name: "Runs",
		place: { view: "goal", goal, pane: "Runs" },
		text: "Every time a Step runs is a Run, with its time and cost. A retry is one more Run.",
	},
	{
		name: "Run activity",
		place: { view: "goal", goal, pane: "Run activity" },
		text: "The live Run as it happens. You see each file the agent writes and each test it runs.",
	},
];

/** The line that says the TUI is a replay of an invented Project, wherever the page first shows it. */
export const replayNote = `A replay of Vago's TUI on ${tuiFrames.project}, an example Project made up for this page. Nothing here is running.`;

/** Where the story opens: the running Goal's live Run, as the spotlight walk left it. */
export const storyOpening: ReplayPlace = {
	view: "goal",
	goal,
	pane: "Run activity",
};

const piece =
	(tone: ArtifactTone) =>
	(text: string): ArtifactPiece => ({ text, tone });
const plain = piece("plain");
const dim = piece("dim");
const bright = piece("bright");
const accent = piece("accent");
const ok = piece("ok");
const bad = piece("bad");

const giftCards = exampleGoals.find(({ name }) => name === goal);
if (giftCards === undefined)
	throw new Error(`capture/acme-shop.ts has no Goal ${goal}`);

// goal.md as the capture writes it, down to its Solution's heading.
const goalFile: StoryArtifact = {
	caption: `.vago-goals/${goal}/goal.md`,
	lines: [
		[dim("+++")],
		[plain("workflow = "), accent('"small"')],
		[plain("created = 2026-10-21T12:45:00.000Z")],
		[dim("+++")],
		[bright(`# ${giftCards.title}`)],
		[],
		[bright("## Problem Statement")],
		[],
		[plain(giftCards.problem)],
		[],
		[bright("## Solution")],
		[dim("…")],
	],
};

// The Goal's Ticket files, marked as the TUI marks them, with the Tickets each waits for.
const ticketFiles: StoryArtifact = {
	caption: `.vago-goals/${goal}/tickets/`,
	lines: giftCards.tickets.map(({ slug, state, blockedBy = [] }) => {
		const mark =
			state === "done"
				? ok("✓ ")
				: state === "replay"
					? accent("● ")
					: dim("○ ");
		const after = blockedBy
			.map((number) => String(number).padStart(2, "0"))
			.join(", ");
		return [
			mark,
			state === "replay" ? bright(`${slug}.md`) : plain(`${slug}.md`),
			dim(after === "" ? "" : `  after ${after}`),
		];
	}),
};

// small.toml without its comments, from the top down to its Checks Step.
const workflowLines = smallWorkflow
	.split("\n")
	.filter((line) => !line.startsWith("#"))
	.map((line) => line.replace(/\s+#.*$/, ""))
	.join("\n")
	.replace(/\n{3,}/g, "\n\n")
	.trim()
	.split("\n");
const lastShownStep = workflowLines.findIndex((line) =>
	line.endsWith('"Checks"'),
);
if (lastShownStep < 0)
	throw new Error("starter/workflows/small.toml has no Checks Step");
const workflowFile: StoryArtifact = {
	caption: ".vago/workflows/small.toml",
	lines: [
		...workflowLines
			.slice(0, workflowLines.indexOf("", lastShownStep))
			.map((line) => {
				if (line.startsWith("[[")) return [bright(line)];
				const value = line.match(/^(.*= )(".*")$/);
				return value === null
					? [plain(line)]
					: [plain(value[1] ?? ""), accent(value[2] ?? "")];
			}),
		[],
		[dim("# then Review, Goal review, Squash merge")],
	],
};

// A line of `vago run`: when, how long and what it cost, the Step and how it ended.
const stepLine = (
	at: string,
	step: string,
	outcome: ArtifactPiece,
	took = "",
	cost = "",
): ArtifactPiece[] => [
	dim(`  ${at}Z  ${took.padStart(6)}  ${cost.padStart(6)}  `),
	plain(`${step} `),
	outcome,
];

/** The story's beats in order, the Goal written to its PR, then the Step that keeps failing. */
export const storyBeats: StoryBeat[] = [
	{
		id: "goal",
		title: "You write the Goal",
		body: "What you want and why, what's in scope and what isn't, the way you'd brief a colleague. It's a Markdown file in your repo, and its header names the Workflow that runs it.",
		chapter: "Goal",
		place: { view: "project", goal },
		artifact: goalFile,
	},
	{
		id: "tickets",
		title: "You split it into Tickets",
		body: `Write them yourself, or plan them with an agent in the TUI and accept what it proposes. A Ticket can wait on another: ${ticket} starts once 01 is done.`,
		limit: "Tickets run one at a time. Separate Goals can run side by side.",
		chapter: "Tickets",
		place: { view: "goal", goal, pane: "Tickets" },
		artifact: ticketFiles,
	},
	{
		id: "workflow",
		title: "Each Ticket runs your Workflow",
		body: "A Workflow is a short TOML file of Steps. An agent Step runs on Claude Code or Codex with the prompt you wrote. A shell Step runs a command: a branch, your checks, a merge.",
		chapter: "Workflow",
		place: { view: "goal", goal, ticket: 2, pane: "Ticket" },
		scrub: { from: 0, to: 0.5 },
		artifact: workflowFile,
	},
	{
		id: "run",
		title: "Watch a Run, or don't",
		body: "Each time a Step runs is a Run. The TUI streams what the agent reads, edits and runs. In your terminal, vago run prints a line as each Step starts and ends, with what it took and cost.",
		chapter: "Run",
		place: { view: "goal", goal, ticket: 2, pane: "Run activity" },
		scrub: { from: 0.5, to: 0.93 },
		artifact: {
			caption: `vago run ${goal}`,
			lines: [
				[bright("03-balance-page")],
				stepLine("2026-10-21T14:20:00", "New branch", dim("started")),
				stepLine("2026-10-21T14:20:00", "New branch", ok("ok"), "0.1s"),
				stepLine("2026-10-21T14:20:00", "Build", dim("started")),
				stepLine("2026-10-21T14:29:12", "Build", ok("ok"), "9m12s", "$0.86"),
				stepLine("2026-10-21T14:29:12", "Checks", dim("started")),
				stepLine("2026-10-21T14:30:50", "Checks", ok("ok"), "1m38s"),
				stepLine("2026-10-21T14:30:51", "Review", dim("started")),
				stepLine("2026-10-21T14:34:25", "Review", ok("ok"), "3m34s", "$0.31"),
				stepLine("2026-10-21T14:34:25", "Goal review", dim("skipped")),
				stepLine("2026-10-21T14:34:25", "Squash merge", dim("started")),
				stepLine("2026-10-21T14:34:32", "Squash merge", ok("ok"), "6.7s"),
			],
		},
	},
	{
		id: "commit",
		title: "One Ticket, one commit",
		body: "Each Ticket is built on its own branch. Once its Steps pass, the Workflow's merge Step squashes it onto the Goal's branch as one commit, and the next Ticket starts.",
		chapter: "Commit",
		place: { view: "goal", goal, ticket: 2, pane: "Run activity", time: 1 },
		artifact: {
			caption: `git log --oneline vago/${goal}`,
			lines: [
				[accent("4e0c2d8 "), bright("03 balance page")],
				[dim("9679a1b "), plain("02 redeem at checkout")],
				[dim("bd49572 "), plain("01 gift card codes")],
			],
		},
	},
	{
		id: "pr",
		title: "One Goal, one PR",
		body: "The first merge opens the Goal's PR. After the last Ticket, two Goal Steps write its description from the Goal's report and mark it ready for review. Reviewing and merging it is yours. Here's low-stock-email, a Goal of acme-shop that's finished.",
		limit: "The PR goes through gh, so it needs a GitHub repo.",
		chapter: "PR",
		place: { view: "goal", goal: "low-stock-email", pane: "Tickets" },
		artifact: {
			caption: "acme-example/acme-shop #34",
			lines: [
				[bright("Owners get an email before stock runs out")],
				[dim("vago/low-stock-email into main · "), ok("Ready for review")],
				[],
				[bright("Runs")],
				[plain("Workflow: small")],
				[],
				[dim("Ticket                Runs    Took   Cost")],
				[plain("01-threshold-setting     5  11m58s  $1.00")],
				[plain("02-daily-check           5  16m04s  $0.75")],
				[plain("03-email-template        6  12m51s  $1.40")],
				[plain("after_all                2   46.2s  $0.14")],
				[bright("Total                   18  41m41s  $3.30")],
			],
		},
	},
	{
		id: "stuck",
		title: "When a Step keeps failing",
		body: "An agent Step that fails resumes its own session and tries again, three times. Then the Ticket is stuck and waits for you. Fix what it needs, run vago run again, and it picks up at that Step on the same branch.",
		place: { view: "goal", goal: "order-export", pane: "Run activity" },
		artifact: {
			caption: "vago run order-export",
			lines: [
				stepLine("2026-10-19T09:47:43", "Build", dim("started")),
				stepLine(
					"2026-10-19T09:49:52",
					"Build",
					bad("exit 1"),
					"2m09s",
					"$0.21",
				),
				[bad("02-date-range-filter is stuck after Build: exit 1")],
				[
					dim("  log:    "),
					plain(".vago-goals/order-export/logs/02-implement-5.jsonl"),
				],
				[
					dim("  resume: "),
					plain("claude --resume 301ac8cf-44a8-4da8-a21b-67f46b3ce090"),
				],
				[dim("  again:  "), plain("vago run order-export")],
				[dim("  reset:  "), plain("vago ticket reset order-export 02")],
			],
		},
	},
];

/** The chapters of the strip over the TUI, in the order the beats light them. */
export const storyChapters: string[] = storyBeats.flatMap(({ chapter }) =>
	chapter === undefined ? [] : [chapter],
);
