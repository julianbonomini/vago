// Everything `vago run` prints to stdout while it runs: the Goal's worktree,
// one line naming each Ticket as it starts, and under it a line when each
// Step starts and one when it ends, where to look when a Ticket goes stuck,
// the Goal summary table on exit, and what became of the Goal's worktree,
// after the summary. Also the Goal report `vago goal report` prints. Hides the
// line formats, columns and colours, and how durations and costs read.

import { relative } from "node:path";
import {
	type GoalState,
	type Ticket,
	type TicketRun,
	type TicketStatus,
	ticketNumberText,
} from "./tickets/tickets.ts";
import type { WorktreeClose } from "./worktree.ts";

/** Prints the line naming the worktree the Goal's Steps run in. */
export function printWorktree(path: string): void {
	console.log(`Worktree ${path}`);
}

/** Prints the line naming `ticket`, under which its Step lines follow, indented. */
export function printTicketStarted(ticket: Ticket): void {
	console.log(ticket.name);
}

/** Prints the indented line saying Step `stepName` started at `started`. */
export function printStepStarted(stepName: string, started: Date): void {
	console.log(paint(stepLine(started, stepName, "started"), "dim"));
}

/** Prints the indented line saying Step `stepName` was skipped on this Ticket. */
export function printStepSkipped(stepName: string, at: Date): void {
	console.log(paint(stepLine(at, stepName, "skipped"), "dim"));
}

/**
 * Prints the indented line saying how Step `stepName` ended, with `outcome` as
 * spelled in the header (`ok`, `exit 1`), how long it took and, when the
 * Harness reported one, what it cost.
 */
export function printStepEnded(
	stepName: string,
	outcome: string,
	started: Date,
	ended: Date,
	costUsd?: number,
): void {
	const took = duration(ended.getTime() - started.getTime());
	const colour = outcome === "ok" ? "green" : "red";
	console.log(
		stepLine(ended, stepName, outcome, colour, took, dollars(costUsd)),
	);
}

/**
 * Prints that `ticket` went stuck after Step `stepName`, whose Run ended with
 * `outcome` as spelled in the header, with what the human needs next: the
 * Run's log at the absolute path `log`, the command that resumes its Harness
 * session when there is one, and the command that resets the Ticket.
 */
export function printStuck(
	ticket: Ticket,
	stepName: string,
	outcome: string,
	log: string,
	resumeHint?: string,
): void {
	console.log(
		paint(`${ticket.name} is stuck after ${stepName}: ${outcome}`, "red"),
	);
	// Relative to the repo root, which `vago run` runs in, so it's short
	// enough to read and still opens from where the human is.
	console.log(`  log:    ${relative(ticket.root, log)}`);
	if (resumeHint !== undefined) console.log(`  resume: ${resumeHint}`);
	console.log(`  reset:  ${resetCommand(ticket)}`);
}

/**
 * Prints why `vago run` won't start `goal`: the Tickets in `stuck`, each with
 * the command that resets it and, when given, the command that resumes its
 * last Run's Harness session.
 */
export function printStuckRefusal(
	goal: string,
	stuck: { ticket: Ticket; resumeHint?: string }[],
): void {
	console.log(
		`${goal} has stuck Tickets. Check the Goal's worktree, then reset each one:`,
	);
	for (const { ticket, resumeHint } of stuck) {
		console.log(`  ${ticket.name}: ${resetCommand(ticket)}`);
		if (resumeHint !== undefined) console.log(`    resume: ${resumeHint}`);
	}
}

/**
 * Prints how `goal` ended: how many of its Tickets are `done`, then a table
 * of each Ticket with its status and what its Runs took and cost, and a
 * total row. A Run still going counts toward neither. It opens with a blank
 * line, so it stands apart from whatever `vago run` printed before it.
 */
export function printGoalSummary(goal: string, state: GoalState): void {
	console.log();
	const done = state.tickets.filter(({ status }) => status === "done").length;
	console.log(`${goal}: ${done} of ${state.tickets.length} Tickets done`);
	const { tickets, total } = goalTotals(state);
	const lines: SummaryLine[] = [
		{
			name: "Ticket",
			status: "Status",
			colour: undefined,
			runs: "Runs",
			took: "Took",
			cost: "Cost",
		},
		...tickets.map(({ name, status, totals }) => ({
			name,
			status,
			colour: statusColour(status),
			runs: String(totals.runs),
			took: duration(totals.tookMs),
			cost: dollars(totals.costUsd),
		})),
		{
			name: "Total",
			status: "",
			colour: undefined,
			runs: String(total.runs),
			took: duration(total.tookMs),
			cost: dollars(total.costUsd),
		},
	];
	// Never empty, since the heading is always there.
	const widest = (cell: (line: SummaryLine) => string) =>
		Math.max(...lines.map((line) => cell(line).length));
	const nameWidth = widest(({ name }) => name);
	const statusWidth = widest(({ status }) => status);
	const runsWidth = widest(({ runs }) => runs);
	const tookWidth = widest(({ took }) => took);
	const costWidth = widest(({ cost }) => cost);
	for (const { name, status, colour, runs, took, cost } of lines) {
		const cells = [
			name.padEnd(nameWidth),
			paint(status.padEnd(statusWidth), colour),
			runs.padStart(runsWidth),
			took.padStart(tookWidth),
			cost.padStart(costWidth),
		];
		console.log(cells.join("  ").trimEnd());
	}
}

/**
 * Prints what became of a done Goal's worktree: removed, with its path and
 * the branch that's kept, or kept, with its path and each reason.
 */
export function printWorktreeClose(close: WorktreeClose): void {
	if (close.outcome === "removed") {
		console.log(
			`Removed worktree ${close.path}; branch ${close.branch} is kept`,
		);
		return;
	}
	const why = close.reasons.map((reason) =>
		reason === "uncommitted"
			? "it has uncommitted changes"
			: `${close.branch} has commits not pushed`,
	);
	console.log(`Kept worktree ${close.path}: ${why.join(" and ")}`);
}

/**
 * Prints `goal.md` without its header, as `goalBody`, each of its paragraphs
 * on one line, and then in Markdown what each Ticket's Steps put in the Goal
 * report, collapsed by Ticket, the Workflow the Goal names and what the
 * Goal's Runs took and cost: a table with one row per Ticket and a total, and
 * every Run in a collapsed table under it. Made to be a PR description.
 * `outputs` holds the output of each Run whose Step puts it in the report, by
 * the Run's log; a Ticket shows the latest such Run of each Step that ended
 * `ok`, and nothing when none did. A Run still going counts toward neither
 * total.
 */
export function printGoalReport(
	goalBody: string,
	state: GoalState,
	outputs: ReadonlyMap<string, string>,
): void {
	const lines = [joinParagraphLines(goalBody.trimEnd()), ""];
	const reported = state.tickets.flatMap(({ ticket, runs }) => {
		const latest = new Map<string, string>();
		for (const run of runs) {
			const output = outputs.get(run.log)?.trim();
			if (run.outcome === "ok" && output) latest.set(run.step, output);
		}
		return latest.size === 0
			? []
			: [{ name: ticket.name, texts: [...latest.values()] }];
	});
	if (reported.length > 0) lines.push("## Tickets", "");
	for (const { name, texts } of reported) {
		lines.push("<details>", `<summary>${name}</summary>`, "");
		for (const text of texts) lines.push(text, "");
		lines.push("</details>", "");
	}
	lines.push("## Runs", "", `Workflow: ${state.workflow}`, "");
	lines.push("| Ticket | Runs | Took | Cost |", "|---|---:|---:|---:|");
	const { tickets, total } = goalTotals(state);
	for (const { name, totals } of tickets) {
		lines.push(
			`| ${name} | ${totals.runs} | ${duration(totals.tookMs)} | ${dollars(totals.costUsd)} |`,
		);
	}
	lines.push(
		`| **Total** | **${total.runs}** | **${duration(total.tookMs)}** | **${dollars(total.costUsd)}** |`,
	);
	lines.push("", "<details>", "<summary>Every Run</summary>", "");
	lines.push(
		"| Ticket | Step | Outcome | Took | Cost |",
		"|---|---|---|---:|---:|",
	);
	for (const { ticket, runs } of state.tickets) {
		for (const run of runs) {
			const took =
				run.ended === undefined
					? ""
					: duration(run.ended.getTime() - run.started.getTime());
			lines.push(
				`| ${ticket.name} | ${run.step} | ${run.outcome ?? "running"} | ${took} | ${dollars(run.costUsd)} |`,
			);
		}
	}
	lines.push("", "</details>");
	console.log(lines.join("\n"));
}

// `goal.md` is hard-wrapped, and GitHub keeps every line break in a PR body,
// so a paragraph's lines are joined. A line that starts a list item, heading,
// quote, table row, HTML tag, rule or indented code is left as it is, and so
// is every line of a fenced code block. A line ending in a hard break, two
// spaces or a backslash, keeps the break after it.
const blockLineStart = /^(\s|[-*+]\s|\d+[.)]\s|[#>|<]|[-=*_]{3,}\s*$)/;
const hardBreakEnd = /( {2}|\\)\r?$/;

function joinParagraphLines(markdown: string): string {
	const lines: string[] = [];
	let inFence = false;
	let previousJoins = false;
	for (const line of markdown.split("\n")) {
		const isFence = /^ {0,3}(```|~~~)/.test(line);
		if (isFence) inFence = !inFence;
		const isProse =
			!isFence && !inFence && line.trim() !== "" && !blockLineStart.test(line);
		if (isProse && previousJoins)
			lines.push(`${(lines.pop() ?? "").trimEnd()} ${line}`);
		else lines.push(line);
		previousJoins = isProse && !hardBreakEnd.test(line);
	}
	return lines.join("\n");
}

type Colour = "dim" | "green" | "red";

// Only a person at a terminal reads colour; a log file or a test gets the
// escape codes as noise. NO_COLOR set to anything but empty turns it off.
const coloured = process.stdout.isTTY === true && !process.env.NO_COLOR;

const escapes: Record<Colour, [string, string]> = {
	dim: ["\x1b[2m", "\x1b[22m"],
	green: ["\x1b[32m", "\x1b[39m"],
	red: ["\x1b[31m", "\x1b[39m"],
};

function paint(text: string, colour: Colour | undefined): string {
	if (!coloured || colour === undefined || text === "") return text;
	const [on, off] = escapes[colour];
	return `${on}${text}${off}`;
}

function statusColour(status: TicketStatus): Colour | undefined {
	if (status === "done") return "green";
	if (status === "stuck") return "red";
	return undefined;
}

// Wide enough for every duration up to 99h59m and every cost under $100. A
// longer one pushes only its own line right.
const durationWidth = "99h59m".length;
const costWidth = "$99.99".length;

// Indented under the Ticket's name, columns two spaces apart, the duration and
// cost right-aligned so their units line up. The Step name and outcome vary in
// length, so they come last, where nothing after them needs aligning. A
// started line leaves the duration and cost blank, which keeps its Step name in
// line with the ended lines'.
function stepLine(
	at: Date,
	stepName: string,
	outcome: string,
	colour?: Colour,
	took = "",
	cost = "",
): string {
	const cells = [
		timestamp(at),
		took.padStart(durationWidth),
		cost.padStart(costWidth),
		`${stepName} ${paint(outcome, colour)}`,
	];
	return `  ${cells.join("  ")}`;
}

// One line of the summary table, its cells already spelled. `colour` is the
// status cell's, picked from the Ticket's TicketStatus.
type SummaryLine = {
	name: string;
	status: string;
	colour: Colour | undefined;
	runs: string;
	took: string;
	cost: string;
};

// What a set of Runs took and cost between them. A Run still going counts
// toward neither; `costUsd` is undefined when no Run reported a cost.
type RunTotals = { runs: number; tookMs: number; costUsd: number | undefined };

type TicketTotals = { name: string; status: TicketStatus; totals: RunTotals };

// One row per Ticket, lowest number first, and the total over every Run of
// the Goal.
function goalTotals(state: GoalState): {
	tickets: TicketTotals[];
	total: RunTotals;
} {
	return {
		tickets: state.tickets.map(({ ticket, status, runs }) => ({
			name: ticket.name,
			status,
			totals: runTotals(runs),
		})),
		// Over every Run, not the Tickets' sums: floats added in another order
		// can round the total to a different cent.
		total: runTotals(state.tickets.flatMap(({ runs }) => runs)),
	};
}

function runTotals(runs: TicketRun[]): RunTotals {
	let tookMs = 0;
	let costUsd: number | undefined;
	for (const run of runs) {
		if (run.ended !== undefined) {
			tookMs += run.ended.getTime() - run.started.getTime();
		}
		if (run.costUsd !== undefined) {
			costUsd = costUsd === undefined ? run.costUsd : costUsd + run.costUsd;
		}
	}
	return { runs: runs.length, tookMs, costUsd };
}

// Blank when no Run reported a cost, so a shell Step doesn't read as free.
function dollars(usd: number | undefined): string {
	return usd === undefined ? "" : `$${usd.toFixed(2)}`;
}

// Numbered as the Ticket file is, so it reads like the name above it.
function resetCommand(ticket: Ticket): string {
	return `vago ticket reset ${ticket.goal} ${ticketNumberText(ticket.number)}`;
}

// UTC like the Ticket header, cut to whole seconds since a glance needs no more.
function timestamp(at: Date): string {
	return `${at.toISOString().slice(0, 19)}Z`;
}

function duration(milliseconds: number): string {
	const seconds = milliseconds / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
	}
	return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}
