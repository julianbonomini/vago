// Everything `punt run` prints to stdout while it runs: one line when a Step
// starts and one when it ends. Hides the line formats and how durations and
// costs read.

import type { HarnessSessionReport } from "./harness/registry.ts";
import { type Outcome, outcomeText, type StartedRun } from "./tickets.ts";

/** Prints the line saying the Run's Step started on its Ticket. */
export function printStepStarted(run: StartedRun): void {
	console.log(
		`${timestamp(run.started)} ${run.ticket.name} ${run.stepId} started`,
	);
}

/**
 * Prints the line saying how the Run's Step ended, how long it took and,
 * when its Harness session reported one, what it cost.
 */
export function printStepEnded(
	run: StartedRun,
	outcome: Outcome,
	ended: Date,
	session?: HarnessSessionReport,
): void {
	const took = duration(ended.getTime() - run.started.getTime());
	const cost =
		session?.costUsd === undefined ? "" : ` $${session.costUsd.toFixed(2)}`;
	console.log(
		`${timestamp(ended)} ${run.ticket.name} ${run.stepId} ${outcomeText(outcome)} ${took}${cost}`,
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
