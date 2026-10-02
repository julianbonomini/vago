// The main loop of `punt run`: takes the Goal's ready Tickets one at a time
// and runs each through every Step of the Workflow. Hides the order of a
// Goal's lifecycle.

import { printGoalSummary, printStuck } from "./progress.ts";
import { runStep } from "./step-runner.ts";
import { readGoal, setStatus, type Ticket } from "./tickets.ts";
import { loadWorkflow, type Workflow } from "./workflow.ts";

/** How `punt run` left the Goal: every Ticket `done`, or not. */
export type GoalEnd = "done" | "unfinished";

/**
 * Runs `goal` of the Project at `root` until no Ticket is ready or a Ticket
 * fails, then prints the Goal summary. Throws an Error naming the problem
 * when the Workflow or the Goal's format is bad. The Goal is checked before
 * the first Run and again after each Ticket, so a Ticket file broken
 * mid-Goal stops it there, without a summary.
 */
export async function runGoal(root: string, goal: string): Promise<GoalEnd> {
	const workflow = await loadWorkflow(root);
	let state = await readGoal(root, goal);
	while (state.nextReady !== undefined) {
		const finished = await runTicket(workflow, state.nextReady);
		state = await readGoal(root, goal);
		if (!finished) break;
	}
	printGoalSummary(goal, state);
	return state.done ? "done" : "unfinished";
}

// Returns whether the Ticket got to `done`. A failed Step leaves it `stuck`,
// unless it's a shell Step whose failure the Workflow lets the Ticket go on
// from.
async function runTicket(workflow: Workflow, ticket: Ticket): Promise<boolean> {
	await setStatus(ticket, "running");
	const stepOutputs = new Map<string, string>();
	for (const step of workflow.steps) {
		const run = await runStep(step, ticket, stepOutputs);
		stepOutputs.set(step.id, run.output);
		const goesOn =
			run.outcome.kind === "ok" ||
			(step.type === "shell" && step.onFail === "continue");
		if (!goesOn) {
			await setStatus(ticket, "stuck");
			printStuck(ticket, step.id, run.log, run.resumeHint);
			return false;
		}
	}
	await setStatus(ticket, "done");
	return true;
}
