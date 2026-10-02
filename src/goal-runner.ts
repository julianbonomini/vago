// The main loop of `punt run`: takes the Goal's ready Tickets one at a time
// and runs each through every Step of the Workflow. Hides the order of a
// Goal's lifecycle.

import { printGoalSummary } from "./progress.ts";
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

// Returns whether the Ticket got to `done`.
async function runTicket(workflow: Workflow, ticket: Ticket): Promise<boolean> {
	await setStatus(ticket, "running");
	for (const step of workflow.steps) {
		// TODO(07): a failed Step marks the Ticket stuck.
		if ((await runStep(step, ticket)).kind !== "ok") return false;
	}
	await setStatus(ticket, "done");
	return true;
}
