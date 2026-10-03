// Everything `vago run` prints to stdout while it runs: one line naming each
// Ticket as it starts, and under it a line when each Step starts and one when
// it ends, where to look when a Ticket goes stuck, and the Goal summary table
// on exit. Also the Goal report `vago goal report` prints. Hides the line
// formats, columns and colours, and how durations and costs read.

import { relative } from "node:path";
import type { GoalState, Ticket, TicketRun, TicketStatus } from "./tickets.ts";

/** Prints the line naming `ticket`, under which its Step lines follow, indented. */
export function printTicketStarted(ticket: Ticket): void {
	console.log(ticket.name);
}

/** Prints the indented line saying Step `stepId` started at `started`. */
export function printStepStarted(stepId: string, started: Date): void {
	console.log(paint(stepLine(started, stepId, "started"), "dim"));
}

/**
 * Prints the indented line saying how Step `stepId` ended, with `outcome` as
 * spelled in the header (`ok`, `exit 1`), how long it took and, when the
 * Harness reported one, what it cost.
 */
export function printStepEnded(
	stepId: string,
	outcome: string,
	started: Date,
	ended: Date,
	costUsd?: number,
): void {
	const took = duration(ended.getTime() - started.getTime());
	const colour = outcome === "ok" ? "green" : "red";
	console.log(stepLine(ended, stepId, outcome, colour, took, dollars(costUsd)));
}

/**
 * Prints that `ticket` went stuck after Step `stepId`, whose Run ended with
 * `outcome` as spelled in the header, with what the human needs next: the
 * Run's log at the absolute path `log`, the command that resumes its Harness
 * session when there is one, and the command that resets the Ticket.
 */
export function printStuck(
	ticket: Ticket,
	stepId: string,
	outcome: string,
	log: string,
	resumeHint?: string,
): void {
	console.log(
		paint(`${ticket.name} is stuck after ${stepId}: ${outcome}`, "red"),
	);
	// Relative to the repo root, which `vago run` runs in, so it's short
	// enough to read and still opens from where the human is.
	console.log(`  log:    ${relative(ticket.root, log)}`);
	if (resumeHint !== undefined) console.log(`  resume: ${resumeHint}`);
	console.log(`  reset:  ${resetCommand(ticket)}`);
}

/**
 * Prints why `vago run` won't start `goal`: the Tickets in `stuck`, each with
 * the command that resets it.
 */
export function printStuckRefusal(goal: string, stuck: Ticket[]): void {
	console.log(
		`${goal} has stuck Tickets. Check the checkout, then reset each one:`,
	);
	for (const ticket of stuck) {
		console.log(`  ${ticket.name}: ${resetCommand(ticket)}`);
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
 * Prints `goal.md` without its header, as `goalBody`, and then in Markdown
 * the Workflow the Goal names and what the Goal's Runs took and cost: a
 * table with one row per Ticket and a total, and every Run in a collapsed
 * table under it. Made to be a PR description. A Run still going counts
 * toward neither total.
 */
export function printGoalReport(goalBody: string, state: GoalState): void {
	const lines = [
		goalBody.trimEnd(),
		"",
		"## Runs",
		"",
		`Workflow: ${state.workflow}`,
		"",
	];
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
// cost right-aligned so their units line up. The Step id and outcome vary in
// length, so they come last, where nothing after them needs aligning. A
// started line leaves the duration and cost blank, which keeps its Step id in
// line with the ended lines'.
function stepLine(
	at: Date,
	stepId: string,
	outcome: string,
	colour?: Colour,
	took = "",
	cost = "",
): string {
	const cells = [
		timestamp(at),
		took.padStart(durationWidth),
		cost.padStart(costWidth),
		`${stepId} ${paint(outcome, colour)}`,
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
	return `vago ticket reset ${ticket.goal} ${String(ticket.number).padStart(2, "0")}`;
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
