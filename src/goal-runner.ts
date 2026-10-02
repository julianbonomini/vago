// A Goal's lifecycle: creating it with the Workflow it names, the main loop
// of `punt run`, which takes the Goal's ready Tickets one at a time through
// every Step of the Workflow, and resetting a stuck Ticket. Hides the order
// of a Goal's lifecycle.

import { printGoalSummary, printStuck, printStuckRefusal } from "./progress.ts";
import { runStep, spellOutcome } from "./step-runner.ts";
import {
	closeOpenRun,
	createGoal,
	readGoal,
	setStatus,
	type Ticket,
} from "./tickets.ts";
import { loadWorkflow, type Workflow } from "./workflow.ts";

/** How `punt run` left the Goal: every Ticket `done`, or not. */
export type GoalEnd = "done" | "unfinished";

/**
 * Creates Goal `goal` of the Project at `root`, naming Workflow `workflow`
 * in its `goal.md` header, with `body` exactly as given after it, or a
 * `# <goal>` title without one. Returns the path of `goal.md`. Throws an
 * Error naming the problem, and creates nothing, when `punt run` would
 * refuse the Workflow (one not in `.punt/workflows/` is refused with the
 * names that are), the body is empty or only whitespace, the Goal already
 * exists, or `goal` isn't a valid name.
 */
export async function newGoal(
	root: string,
	goal: string,
	workflow: string,
	body?: string,
): Promise<string> {
	// The check punt run makes, so goal new never writes a Goal punt run would refuse.
	await loadWorkflow(root, workflow);
	return createGoal(root, goal, workflow, body);
}

/**
 * Runs `goal` of the Project at `root` until no Ticket is ready or a Ticket
 * goes stuck, then prints the Goal summary. A Ticket found `running`, left so
 * by a `punt run` that crashed or was killed, goes stuck with its open Run
 * ended `lost`. While any Ticket of the Goal is stuck it runs nothing and
 * prints which ones instead. Throws an Error naming the problem, before any
 * Ticket changes, when `goal.md` names no Workflow or one that doesn't exist,
 * or when the Workflow or the Goal's format is bad. The Goal is checked
 * before the first Run and again after each Ticket, so a `goal.md` or Ticket
 * file broken mid-Goal stops it there, without a summary.
 */
export async function runGoal(root: string, goal: string): Promise<GoalEnd> {
	let state = await readGoal(root, goal);
	const workflow = await loadWorkflow(root, state.workflow);
	// The checkout may hold a lost Run's partial work, so its Ticket goes
	// stuck for the human to look at instead of running again on top of it.
	for (const { ticket, status } of state.tickets) {
		if (status !== "running") continue;
		await closeOpenRun(ticket, "lost", new Date());
		await setStatus(ticket, "stuck");
	}
	state = await readGoal(root, goal);
	const stuck = state.tickets
		.filter(({ status }) => status === "stuck")
		.map(({ ticket }) => ticket);
	if (stuck.length > 0) {
		printStuckRefusal(goal, stuck);
		return "unfinished";
	}
	while (state.nextReady !== undefined) {
		const finished = await runTicket(workflow, state.nextReady);
		state = await readGoal(root, goal);
		if (!finished) break;
	}
	printGoalSummary(goal, state);
	return state.done ? "done" : "unfinished";
}

/**
 * Sets Ticket `number` of `goal` from `stuck` back to `ready`, keeping its
 * `[[runs]]`, so the next `punt run` takes it again. Throws an Error naming
 * the problem when the Goal's format is bad, the Goal has no such Ticket, or
 * the Ticket isn't stuck.
 */
export async function resetTicket(
	root: string,
	goal: string,
	number: number,
): Promise<void> {
	const { tickets } = await readGoal(root, goal);
	const found = tickets.find(({ ticket }) => ticket.number === number);
	if (found === undefined) {
		throw new Error(`Goal ${goal} has no Ticket ${number}`);
	}
	if (found.status !== "stuck") {
		throw new Error(
			`${found.ticket.name} is ${found.status}, not stuck, so there is nothing to reset`,
		);
	}
	await setStatus(found.ticket, "ready");
}

// Returns whether the Ticket got to `done`. A failed Step leaves it `stuck`,
// unless it's a shell Step whose failure the Workflow lets the Ticket go on
// from. `on_fail` covers a Step that exits non-zero, never one the human
// interrupted.
async function runTicket(workflow: Workflow, ticket: Ticket): Promise<boolean> {
	await setStatus(ticket, "running");
	const stepOutputs = new Map<string, string>();
	for (const step of workflow.steps) {
		const run = await runStep(step, ticket, stepOutputs);
		stepOutputs.set(step.id, run.output);
		const goesOn =
			run.outcome.kind === "ok" ||
			(run.outcome.kind === "exit" &&
				step.type === "shell" &&
				step.onFail === "continue");
		if (!goesOn) {
			await setStatus(ticket, "stuck");
			printStuck(
				ticket,
				step.id,
				spellOutcome(run.outcome),
				run.log,
				run.resumeHint,
			);
			return false;
		}
	}
	await setStatus(ticket, "done");
	return true;
}
