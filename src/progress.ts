// Everything `punt run` prints to stdout while it runs: one line when a Step
// starts and one when it ends. Hides the line formats and how durations and
// costs read.

import { outcomeText, type StepEnd } from "./step-runner.ts";
import type { Ticket } from "./tickets.ts";

/** Prints the line saying `step` started on `ticket` at `started`. */
export function printStepStarted(
	ticket: Ticket,
	step: string,
	started: Date,
): void {
	console.log(`${timestamp(started)} ${ticket.name} ${step} started`);
}

/**
 * Prints the line saying how `step` on `ticket` ended, how long it took and,
 * when its Harness reported one, what it cost.
 */
export function printStepEnded(
	ticket: Ticket,
	step: string,
	end: StepEnd,
	started: Date,
	ended: Date,
): void {
	const took = duration(ended.getTime() - started.getTime());
	const cost =
		end.report.costUsd === undefined
			? ""
			: ` $${end.report.costUsd.toFixed(2)}`;
	console.log(
		`${timestamp(ended)} ${ticket.name} ${step} ${outcomeText(end.outcome)} ${took}${cost}`,
	);
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
