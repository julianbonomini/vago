// A Goal's lifecycle: creating it and its Tickets with the Workflows they
// name, accepting a planning item's Proposal as a ready Goal, the main loop
// of `vago run`, which runs the Goal's `before_all` once, then takes the
// Goal's Tickets one at a time through the Steps of their Workflow in the
// Goal's worktree, then its `after_all`, and closes it once the Goal is
// done, and resetting a stuck Ticket. Hides the order of a Goal's
// lifecycle and where its Steps run.

import { type PassEnd, runPass } from "./pass-runner.ts";
import {
	printGoalSummary,
	printWorktree,
	printWorktreeClose,
} from "./progress.ts";
import {
	acceptPlanningItem,
	addTicket,
	closeOpenRun,
	createGoal,
	goalStepsPass,
	readGoal,
	readPlanningProposal,
	setStatus,
	withGoalClaimed,
} from "./tickets/tickets.ts";
import { listWorkflows, loadWorkflow, type Workflow } from "./workflow.ts";
import { closeWorktree, openWorktree } from "./worktree.ts";

/**
 * How `vago run` left the Goal: every Ticket `done` and `after_all` gone
 * through since the last of them ran, or not.
 */
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
 * Workflow or `addTicket` refuses the Ticket. Also refuses a `workflow` that
 * has Goal Steps and isn't the Goal's own, since only the Goal's Workflow's
 * Goal Steps run.
 */
export async function newTicket(
	root: string,
	goal: string,
	slug: string,
	blockedBy: number[],
	workflow: string | undefined,
	body?: string,
): Promise<string> {
	if (workflow !== undefined) {
		// The check vago run makes, so ticket add never writes a Ticket vago run would refuse.
		const { beforeAll, afterAll } = await loadWorkflow(root, workflow);
		const hasGoalSteps = beforeAll.length > 0 || afterAll.length > 0;
		if (hasGoalSteps && workflow !== (await readGoal(root, goal)).workflow) {
			throw new Error(
				`Workflow "${workflow}" has Goal Steps (before_all or after_all), which run only from the Goal's Workflow, so a Ticket can't go through it`,
			);
		}
	}
	return addTicket(root, goal, slug, blockedBy, workflow, body);
}

/**
 * Accepts planning item `item` of the Project at `root` as
 * `acceptPlanningItem` does, and also refuses, creating nothing, when
 * `vago run` would refuse the Proposal's Workflow. Returns the path of
 * `goal.md`.
 */
export async function acceptProposal(
	root: string,
	item: string,
): Promise<string> {
	const workflows = await listWorkflows(root);
	const proposal = await readPlanningProposal(root, item, workflows);
	// The check vago run makes, so accepting never writes a Goal vago run would refuse.
	if (proposal?.workflow !== undefined && proposal.problems.length === 0) {
		await loadWorkflow(root, proposal.workflow);
	}
	return acceptPlanningItem(root, item, workflows);
}

/**
 * Runs `goal` of the Project at `root` until no Ticket is ready or stuck and no
 * `after_all` is owed, or a Ticket or a Goal Step goes stuck, then prints the
 * Goal summary. Its Steps run in the Goal's worktree, whose path it prints
 * before the first Run; a Goal with nothing to run gets none. Once the worktree
 * is open, it runs the Goal Workflow's `before_all` before the first Ticket,
 * unless its latest pass already succeeded, picking the pass up at the Step of
 * its last Run as it picks up a stuck Ticket, with retries, after closing a Run
 * a dead `vago run` left open as `lost`. A `before_all` that goes stuck or
 * can't be picked up runs no Ticket. Once every Ticket is done, it runs
 * `after_all` the same way, opening the worktree for it alone if need be,
 * unless its latest pass succeeded after the last Ticket Run started. Tickets
 * an `after_all` Step adds run next, then `after_all` starts over. A Ticket
 * found `running`, left so by a `vago run` that crashed or was killed, goes
 * stuck with its open Run ended `lost`. A stuck Ticket continues at the Step it
 * stopped on, its earlier Steps' outputs rebuilt from its latest pass, and an
 * agent Step resuming the Harness session it stopped in; when an output can't
 * be rebuilt, it prints which Step, leaves the Ticket as it was and stops
 * there. Throws an Error naming the problem, before any Ticket changes, when
 * `goal.md` names no Workflow or one that doesn't exist, or when the Workflow
 * or the Goal's format is bad. The Goal is checked before the first Run and
 * again after each Ticket, so a `goal.md` or Ticket file broken mid-Goal stops
 * it there, without a summary. When this run leaves the Goal done, it then
 * removes the Goal's worktree if nothing in it would be lost, or prints why it
 * keeps it. Throws an Error naming the Goal, before anything changes, when
 * another `vago run` is running it.
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
	// A lost Ticket goes stuck with its open Run ended `lost`, and is picked
	// up below at that Run's Step like any stuck Ticket.
	for (const { ticket, status } of state.tickets) {
		if (status !== "running") continue;
		await closeOpenRun({ kind: "ticket", ticket }, "lost", new Date());
		await setStatus(ticket, "stuck");
	}
	state = await readGoal(root, goal);
	const { beforeAll, afterAll } = await workflowNamed(state.workflow);
	const opened =
		state.next !== undefined ||
		goalStepsPass(state, "after_all", afterAll).owed;
	if (opened) {
		const worktree = await openWorktree(root, goal);
		printWorktree(worktree);
		let end: PassEnd = "done";
		const beforeAllPass = goalStepsPass(state, "before_all", beforeAll);
		if (beforeAllPass.owed) {
			end = await runPass(
				beforeAll,
				{ kind: "goal", root, goal, group: "before_all" },
				worktree,
				beforeAllPass.runs,
			);
		}
		while (end === "done") {
			if (state.next !== undefined) {
				const { ticket, status, runs } = state.next;
				const workflow = await workflowNamed(state.next.workflow);
				// A ready Ticket starts over even with Runs, as after a reset.
				end = await runPass(
					workflow.steps,
					{ kind: "ticket", ticket },
					worktree,
					status === "stuck" ? runs : [],
				);
				// A refused Ticket is left as it was.
				if (end !== "refused") await setStatus(ticket, end);
			} else {
				const afterAllPass = goalStepsPass(state, "after_all", afterAll);
				if (!afterAllPass.owed) break;
				end = await runPass(
					afterAll,
					{ kind: "goal", root, goal, group: "after_all" },
					worktree,
					afterAllPass.runs,
				);
			}
			state = await readGoal(root, goal);
		}
	}
	printGoalSummary(goal, state);
	// `after_all` makes a Goal with every Ticket done unfinished until it has
	// gone through them.
	const done = state.done && !goalStepsPass(state, "after_all", afterAll).owed;
	if (opened && done) printWorktreeClose(await closeWorktree(root, goal));
	return done ? "done" : "unfinished";
}

/**
 * Sets Ticket `number` of `goal` from `stuck` back to `ready`, keeping its
 * `[[runs]]`, so the next `vago run` starts it over from its first Step.
 * Throws an Error naming the problem when the Goal's format is bad, the Goal
 * has no such Ticket, or the Ticket isn't stuck.
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
