// PROTOTYPE, variant G: one evening with the example Project acme-shop, as a
// track the hero's scrubber moves along. A position on the track (0 to 1)
// gives the clock, what you're doing, what Vago is doing, and which frame the
// LiveTui replay shows. The track isn't to scale: Ticket 03, the part the
// replay has frames for, gets most of it.

/** Minutes after midnight. */
const at = (h: number, m: number, s = 0) => h * 60 + m + s / 60;

/** When you typed `vago run gift-cards`. The replay's run times count from here. */
const RUN_STARTED = at(18, 52);

// Goal run time on each replay phase, from the frames' RUNNING line.
const phaseRunTime = [
	[27, 34],
	[28, 44],
	[29, 52],
	[31, 1],
	[32, 11],
	[33, 19],
	[34, 29],
	[35, 37],
	[37, 19],
	[37, 52],
	[39, 18],
	[40, 11],
	[41, 5],
	[42, 2],
	[42, 6],
].map(([m = 0, s = 0]) => RUN_STARTED + m + s / 60);
export const LAST_PHASE = phaseRunTime.length - 1;

export type EveningPart = "goal" | "early" | "replay" | "late" | "pr";

export type EveningSegment = {
	part: EveningPart;
	from: number;
	to: number;
	/** Share of the track. */
	width: number;
	/** Seconds it takes when the evening plays. */
	plays: number;
	name: string;
};

export const segments: EveningSegment[] = [
	{ part: "goal", from: at(18, 30), to: RUN_STARTED, width: 0.15, plays: 4, name: "The Goal" },
	{ part: "early", from: RUN_STARTED, to: phaseRunTime[0] ?? 0, width: 0.1, plays: 2.4, name: "01, 02" },
	{ part: "replay", from: phaseRunTime[0] ?? 0, to: phaseRunTime[LAST_PHASE] ?? 0, width: 0.47, plays: 19, name: "Ticket 03" },
	{ part: "late", from: phaseRunTime[LAST_PHASE] ?? 0, to: at(20, 12), width: 0.11, plays: 2.6, name: "04, 05" },
	{ part: "pr", from: at(20, 12), to: at(23, 10), width: 0.17, plays: 4.5, name: "The PR" },
];

/** Where each segment starts on the track, 0 to 1. */
export const segmentStarts = segments.map((_, i) => segments.slice(0, i).reduce((n, s) => n + s.width, 0));

export const PR_AT = at(20, 12);
export const NIGHT_AT = at(21, 0);

export type EveningMoment = {
	part: EveningPart;
	/** Within the segment, 0 to 1. */
	local: number;
	/** Minutes after midnight. */
	clock: number;
	/** Replay phase, 0 to LAST_PHASE, for the LiveTui's `time`. */
	phase: number;
	you: string;
	vago: string;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// What you're doing, by the clock. The last entry at or before the clock wins.
const yours: [number, string][] = [
	[at(18, 30), "You write the Goal: what you want, what's in, what's out."],
	[at(18, 47), "You split it into five Tickets and type one command."],
	[at(18, 53), "Laptop stays open. You leave the room."],
	[at(19, 2), "Dinner. Nobody asks you about tests."],
	[at(19, 19), "Couch. First episode."],
	[at(19, 27), "You don't check on it."],
	[at(19, 34), "Second episode. You still don't check on it."],
	[at(20, 12), "Your phone buzzes during the third episode."],
	[at(21, 0), "One more episode, against your own rules."],
	[at(22, 50), "You read the PR in bed. You'll merge it in the morning."],
];

// What Vago is doing, outside the replay.
const vagos: [number, string][] = [
	[at(18, 30), "Nothing. It waits for vago run."],
	[RUN_STARTED, "Cuts vago/gift-cards in its own worktree and starts Ticket 01."],
	[at(19, 5), "Ticket 01 has landed as a commit. Ticket 02 is in Build."],
	[phaseRunTime[LAST_PHASE] ?? 0, "Ticket 04, then 05, the same way. The last one gets a Goal review."],
	[at(20, 5), "Writes the PR description from the Goal report."],
	[PR_AT, "PR #37 is ready for review."],
	[at(20, 20), "Done."],
];

// What Vago is doing during the replay, by phase.
const byPhase = [
	"Ticket 03 gets its own branch, gift-cards/03-balance-page.",
	"Build. An agent reads the Ticket and the code around it.",
	"Build. An agent reads the Ticket and the code around it.",
	"Build. It finds the shop already has a rate limiter.",
	"Build. Failing tests first, as your prompt asks.",
	"Build. Four failing tests, as expected.",
	"Build. The balance lookup and its page.",
	"Build. Running the balance tests.",
	"Checks. bun run check, a shell Step.",
	"Checks. bun run check, a shell Step.",
	"Review. A fresh agent reads what the Ticket changed.",
	"Review. A fresh agent reads what the Ticket changed.",
	"Review. A fresh agent reads what the Ticket changed.",
	"Squash merge onto vago/gift-cards.",
	"Ticket 03 is one commit. Ticket 04 starts.",
];

const pick = (list: [number, string][], clock: number) => {
	let out = list[0]?.[1] ?? "";
	for (const [t, text] of list) if (clock >= t - 1e-6) out = text;
	return out;
};

/** Everything the hero shows at track position `pos`, 0 to 1. */
export function eveningAt(pos: number): EveningMoment {
	const p = clamp01(pos);
	let i = segments.length - 1;
	for (let k = 0; k < segments.length; k++) {
		const start = segmentStarts[k] ?? 0;
		const seg = segments[k];
		if (seg && p < start + seg.width) {
			i = k;
			break;
		}
	}
	const seg = segments[i] as EveningSegment;
	const local = clamp01((p - (segmentStarts[i] ?? 0)) / seg.width);
	let clock = seg.from + (seg.to - seg.from) * local;
	let phase = seg.part === "goal" || seg.part === "early" ? 0 : LAST_PHASE;
	let vago = pick(vagos, clock);
	if (seg.part === "replay") {
		const f = local * LAST_PHASE;
		phase = Math.min(LAST_PHASE, Math.floor(f + 1e-6));
		const a = phaseRunTime[phase] ?? seg.from;
		const b = phaseRunTime[Math.min(LAST_PHASE, phase + 1)] ?? a;
		clock = a + (b - a) * (f - phase);
		vago = byPhase[phase] ?? "";
	}
	return { part: seg.part, local, clock, phase, you: pick(yours, clock), vago };
}

/** "19:24". */
export function clockText(minutes: number): string {
	const m = Math.floor(minutes + 1e-6);
	return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** The track position of a replay phase, to start the page on. */
export function positionOfPhase(phase: number): number {
	const i = segments.findIndex((s) => s.part === "replay");
	const seg = segments[i] as EveningSegment;
	return (segmentStarts[i] ?? 0) + (seg.width * (phase + 0.5)) / LAST_PHASE;
}

// The Goal as you type it in the first segment. Its words are the example
// Goal's own, as the TUI shows them.
export const goalFile = `# Customers can pay with a gift card

## Problem Statement

Customers ask for gift cards every December and the shop has
nothing to sell them. Staff work around it with discount codes,
which can't hold a balance, so a code is either used up in one
order or shared around.

## Solution

A gift card is a code with a balance. Customers buy one like any
product, spend it at checkout over one or several orders, and
check what's left on a page of its own. Staff can issue a card by
hand, and a refund on an order paid by card goes back to the card.

## Out of Scope

Printed cards. Cards in other currencies.
`;
export const runCommand = "vago run gift-cards";
