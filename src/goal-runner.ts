// The main loop of `punt run`: takes the Goal's ready Tickets one at a time
// and runs each through every Step of the Workflow. Hides the order of a
// Goal's lifecycle.

import { printStepEnded, printStepStarted } from "./progress.ts";
import { runStep } from "./step-runner.ts";
import { nextReadyTicket, setStatus, startRun } from "./tickets.ts";
import { loadWorkflow } from "./workflow.ts";

/** How `punt run` left the Goal: every Ticket `done`, or not. */
export type GoalEnd = "done" | "unfinished";

/**
 * Runs `goal` of the Project at `root` until no Ticket is ready. Throws an
 * Error naming the file when the Workflow or a Ticket can't be read.
 */
export async function runGoal(root: string, goal: string): Promise<GoalEnd> {
	const workflow = await loadWorkflow(root);
	for (
		let ticket = await nextReadyTicket(root, goal);
		ticket !== undefined;
		ticket = await nextReadyTicket(root, goal)
	) {
		await setStatus(ticket, "running");
		for (const step of workflow.steps) {
			const started = new Date();
			const run = await startRun(ticket, step.id, started);
			printStepStarted(ticket, step.id, started);
			const outcome = await runStep(step, root, run.log);
			const ended = new Date();
			await run.end(outcome, ended);
			printStepEnded(ticket, step.id, outcome, started, ended);
			// TODO(07): a failed Step marks the Ticket stuck.
			if (outcome.kind !== "ok") return "unfinished";
		}
		await setStatus(ticket, "done");
	}
	// TODO(04): done only when every Ticket of the Goal is done.
	return "done";
}
