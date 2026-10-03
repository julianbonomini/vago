// A Goal's lifecycle: creating it and its Tickets with the Workflows they
// name, the main loop of `vago run`, which takes the Goal's ready Tickets one
// at a time through every Step of their Workflow in the Goal's worktree and
// closing it once every Ticket is done, and resetting a stuck Ticket. Hides the order of a Goal's
// lifecycle and where its Steps run.

import {
	printGoalSummary,
	printStepSkipped,
	printStuck,
	printStuckRefusal,
	printTicketStarted,
	printWorktree,
	printWorktreeClose,
} from "./progress.ts";
import { runStep, spellOutcome } from "./step-runner.ts";
import {
	addTicket,
	closeOpenRun,
	createGoal,
	isLastTicket,
	readGoal,
	setStatus,
	type Ticket,
	withGoalClaimed,
} from "./tickets.ts";
import { loadWorkflow, type Workflow } from "./workflow.ts";
import { closeWorktree, openWorktree } from "./worktree.ts";

/** How `vago run` left the Goal: every Ticket `done`, or not. */
export type GoalEnd = "done" | "unfinished";

/**
 * Creates Goal `goal` of the Project at `root`, naming Workflow `workflow`
 * in its `goal.md` header, with `body` exactly as given after it, or a
 * `# <goal>` title without one. Returns the path of `goal.md`. Throws an
 * Error naming the problem, and creates nothing, when `vago run` would
 * refuse the Workflow (one not in `.vago/workflows/` is refused with the
 * names that are), the body is empty or only whitespace, the Goal already
 * exists, or `goal` isn't a valid name.
 */
export async function newGoal(
	root: string,
	goal: string,
	workflow: string,
	body?: string,
): Promise<string> {
	// The check vago run makes, so goal new never writes a Goal vago run would refuse.
	await loadWorkflow(root, workflow);
	return createGoal(root, goal, workflow, body);
}

/**
 * Adds a ready Ticket named `slug` to `goal` of the Project at `root`, as
 * `addTicket` does, going through Workflow `workflow` in place of the Goal's
 * when it's given. Returns the path of the Ticket file. Throws an Error
 * naming the problem, and writes nothing, when `vago run` would refuse the
 * Workflow or `addTicket` refuses the Ticket.
 */
export async function newTicket(
	root: string,
	goal: string,
	slug: string,
	blockedBy: number[],
	workflow: string | undefined,
	body?: string,
): Promise<string> {
	// The check vago run makes, so ticket add never writes a Ticket vago run would refuse.
	if (workflow !== undefined) await loadWorkflow(root, workflow);
	return addTicket(root, goal, slug, blockedBy, workflow, body);
}

/**
 * Runs `goal` of the Project at `root` until no Ticket is ready or a Ticket
 * goes stuck, then prints the Goal summary. Its Steps run in the Goal's
 * worktree, whose path it prints before the first Ticket; a Goal with no
 * ready Ticket gets none. A Ticket found `running`, left so by a `vago run`
 * that crashed or was killed, goes stuck with its open Run ended `lost`.
 * While any Ticket of the Goal is stuck it runs nothing and prints which ones
 * instead. Throws an Error naming the problem, before any Ticket changes,
 * when `goal.md` names no Workflow or one that doesn't exist, or when the
 * Workflow or the Goal's format is bad. The Goal is checked before the first
 * Run and again after each Ticket, so a `goal.md` or Ticket file broken
 * mid-Goal stops it there, without a summary. When this run takes the Goal's
 * last Tickets to done, it then removes the Goal's worktree if nothing in it
 * would be lost, or prints why it keeps it. Throws an Error naming the Goal,
 * before anything changes, when another `vago run` is running it.
 */
export async function runGoal(root: string, goal: string): Promise<GoalEnd> {
	return withGoalClaimed(root, goal, () => runClaimedGoal(root, goal));
}

async function runClaimedGoal(root: string, goal: string): Promise<GoalEnd> {
	let state = await readGoal(root, goal);
	// Each Workflow is loaded once, so every Ticket that names it runs the
	// Workflow as it was when first loaded, even if an agent edits `.vago/`.
	const workflows = new Map<string, Workflow>();
	const workflowNamed = async (name: string): Promise<Workflow> => {
		const loaded = workflows.get(name) ?? (await loadWorkflow(root, name));
		workflows.set(name, loaded);
		return loaded;
	};
	// Loaded before any Run, so a Workflow name that's wrong anywhere in the
	// Goal refuses it before anything changes. A Ticket added mid-Goal loads
	// its Workflow when it comes up.
	await workflowNamed(state.workflow);
	for (const { status, workflow } of state.tickets) {
		if (status !== "done") await workflowNamed(workflow);
	}
	// The Goal's worktree may hold a lost Run's partial work, so its Ticket
	// goes stuck for the human to look at instead of running again on top of
	// it.
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
	const opened = state.nextReady !== undefined;
	if (opened) {
		const worktree = await openWorktree(root, goal);
		printWorktree(worktree);
		while (state.nextReady !== undefined) {
			const { ticket, workflow } = state.nextReady;
			const finished = await runTicket(
				await workflowNamed(workflow),
				ticket,
				worktree,
			);
			state = await readGoal(root, goal);
			if (!finished) break;
		}
	}
	printGoalSummary(goal, state);
	if (opened && state.done) printWorktreeClose(await closeWorktree(root, goal));
	return state.done ? "done" : "unfinished";
}

/**
 * Sets Ticket `number` of `goal` from `stuck` back to `ready`, keeping its
 * `[[runs]]`, so the next `vago run` takes it again. Throws an Error naming
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

// Runs every Step of `workflow` on `ticket` in `worktree`, skipping a
// `last-ticket` Step unless this is the Goal's last Ticket, and returns
// whether the Ticket got to `done`. A failed Step leaves it `stuck`,
// unless it's a shell Step whose failure the Workflow lets the Ticket go on
// from. `on_fail` covers a Step that exits non-zero, never one the human
// interrupted.
async function runTicket(
	workflow: Workflow,
	ticket: Ticket,
	worktree: string,
): Promise<boolean> {
	await setStatus(ticket, "running");
	printTicketStarted(ticket);
	const stepOutputs = new Map<string, string>();
	for (const step of workflow.steps) {
		if (step.when === "last-ticket" && !(await isLastTicket(ticket))) {
			printStepSkipped(step.id, new Date());
			continue;
		}
		const run = await runStep(step, ticket, worktree, stepOutputs);
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
