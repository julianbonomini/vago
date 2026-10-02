// Everything `punt run` prints to stdout while it runs: one line when a Step
// starts and one when it ends, where to look when a Ticket goes stuck, and
// the Goal summary on exit. Also the Goal report `punt goal report` prints.
// Hides the line formats and how durations and costs read.

import { relative } from "node:path";
import type { GoalState, Ticket, TicketRun } from "./tickets.ts";

/** Prints the line saying Step `stepId` started on `ticket` at `started`. */
export function printStepStarted(
	ticket: Ticket,
	stepId: string,
	started: Date,
): void {
	console.log(`${timestamp(started)} ${ticket.name} ${stepId} started`);
}

/**
 * Prints the line saying how Step `stepId` on `ticket` ended, with `outcome`
 * as spelled in the header (`ok`, `exit 1`), how long it took and, when the
 * Harness reported one, what it cost.
 */
export function printStepEnded(
	ticket: Ticket,
	stepId: string,
	outcome: string,
	started: Date,
	ended: Date,
	costUsd?: number,
): void {
	const took = duration(ended.getTime() - started.getTime());
	const cost = costUsd === undefined ? "" : ` ${dollars(costUsd)}`;
	console.log(
		`${timestamp(ended)} ${ticket.name} ${stepId} ${outcome} ${took}${cost}`,
	);
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
	console.log(`${ticket.name} is stuck after ${stepId}: ${outcome}`);
	// Relative to the repo root, which `punt run` runs in, so it's short
	// enough to read and still opens from where the human is.
	console.log(`  log:    ${relative(ticket.root, log)}`);
	if (resumeHint !== undefined) console.log(`  resume: ${resumeHint}`);
	console.log(`  reset:  ${resetCommand(ticket)}`);
}

/**
 * Prints why `punt run` won't start `goal`: the Tickets in `stuck`, each with
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
 * Prints how `goal` ended: how many of its Tickets are `done`, then each
 * Ticket with its status.
 */
export function printGoalSummary(goal: string, state: GoalState): void {
	const done = state.tickets.filter(({ status }) => status === "done").length;
	console.log(`${goal}: ${done} of ${state.tickets.length} Tickets done`);
	for (const { ticket, status } of state.tickets) {
		console.log(`  ${ticket.name} ${status}`);
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
	const all: TicketRun[] = [];
	for (const { ticket, runs } of state.tickets) {
		lines.push(
			`| ${ticket.name} | ${runs.length} | ${duration(took(runs))} | ${cost(runs)} |`,
		);
		all.push(...runs);
	}
	lines.push(
		`| **Total** | **${all.length}** | **${duration(took(all))}** | **${cost(all)}** |`,
	);
	lines.push("", "<details>", "<summary>Every Run</summary>", "");
	lines.push(
		"| Ticket | Step | Outcome | Took | Cost |",
		"|---|---|---|---:|---:|",
	);
	for (const { ticket, runs } of state.tickets) {
		for (const run of runs) {
			const ran = run.ended === undefined ? "" : duration(took([run]));
			lines.push(
				`| ${ticket.name} | ${run.step} | ${run.outcome ?? "running"} | ${ran} | ${cost([run])} |`,
			);
		}
	}
	lines.push("", "</details>");
	console.log(lines.join("\n"));
}

// Milliseconds the ended Runs took between them.
function took(runs: TicketRun[]): number {
	let total = 0;
	for (const { started, ended } of runs) {
		if (ended !== undefined) total += ended.getTime() - started.getTime();
	}
	return total;
}

// Blank when no Run reported a cost, so a shell Step doesn't read as free.
function cost(runs: TicketRun[]): string {
	const costs = runs.flatMap(({ costUsd }) =>
		costUsd === undefined ? [] : [costUsd],
	);
	if (costs.length === 0) return "";
	return dollars(costs.reduce((sum, each) => sum + each, 0));
}

function dollars(usd: number): string {
	return `$${usd.toFixed(2)}`;
}

// Numbered as the Ticket file is, so it reads like the name above it.
function resetCommand(ticket: Ticket): string {
	return `punt ticket reset ${ticket.goal} ${String(ticket.number).padStart(2, "0")}`;
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
