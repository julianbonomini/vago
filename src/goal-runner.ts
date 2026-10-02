// The main loop of `punt run`: takes the Goal's ready Tickets one at a time
// and runs each through every Step of the Workflow. Hides the order of a
// Goal's lifecycle.

import { printStepEnded, printStepStarted } from "./progress.ts";
import { runStep } from "./step-runner.ts";
import {
	nextReadyTicket,
	readGoalText,
	readTicketText,
	recordRunEnd,
	recordRunStart,
	setStatus,
} from "./tickets.ts";
import { loadWorkflow } from "./workflow.ts";

/** How `punt run` left the Goal: every Ticket `done`, or not. */
export type GoalEnd = "done" | "unfinished";

/**
 * Runs `goal` of the Project at `root` until no Ticket is ready. Throws an
 * Error naming the file when the Workflow or a Ticket can't be read.
 */
export async function runGoal(root: string, goal: string): Promise<GoalEnd> {
	const workflow = await loadWorkflow(root);
	const goalText = await readGoalText(root, goal);
	for (
		let ticket = await nextReadyTicket(root, goal);
		ticket !== undefined;
		ticket = await nextReadyTicket(root, goal)
	) {
		await setStatus(ticket, "running");
		const texts = { ticket: await readTicketText(ticket), goal: goalText };
		for (const step of workflow.steps) {
			const started = new Date();
			const run = await recordRunStart(ticket, step, started);
			printStepStarted(ticket, step.id, started);
			const end = await runStep(step, root, run.log, texts);
			const ended = new Date();
			await recordRunEnd(run, end, ended);
			printStepEnded(ticket, step.id, end, started, ended);
			// TODO(07): a failed Step marks the Ticket stuck.
			if (end.outcome.kind !== "ok") return "unfinished";
		}
		await setStatus(ticket, "done");
	}
	// TODO(04): done only when every Ticket of the Goal is done.
	return "done";
}
