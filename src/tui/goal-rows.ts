// What the Project view knows of each Goal and planning item: its
// standing, the "now" phrase saying what it is doing or waiting for, how
// many Tickets it has, its run time, tokens and cost, the order of the
// rows, the header line's totals, what the preview shows of the selected
// Goal, and the Tickets the Goal view shows of it. Hides the rules behind
// each.

import { sep } from "node:path";
import {
	type GoalState,
	isGoalClaimed,
	listGoals,
	listPlanningItems,
	type PlanningChat,
	type PlanningProposal,
	readGoal,
	readPlanningChat,
	readPlanningProposal,
	runLogLastWritten,
	type TicketRun,
	type TicketStatus,
} from "../tickets/tickets.ts";
import { listWorkflows, readWorkflowStepNames } from "../workflow.ts";
import {
	type GoalTicket,
	type GoalTicketMark,
	type GoalWorkflowSteps,
	goalTickets,
} from "./goal-tickets.ts";
import { joinParagraphs } from "./text-fit.ts";

/**
 * A Goal's state as the Goals list shows it. `broken` is a Goal whose files
 * can't be read, and `planning` a planning item, a Goal still being planned.
 */
export type GoalStanding =
	| "running"
	| "lost"
	| "stuck"
	| "broken"
	| "planning"
	| "ready"
	| "done";

/** How many of a Goal's Tickets are in each status. */
export type GoalTicketCounts = {
	done: number;
	running: number;
	stuck: number;
	ready: number;
};

/** How many Tickets `tickets` counts in all. */
export function ticketTotal(tickets: GoalTicketCounts): number {
	return tickets.done + tickets.running + tickets.stuck + tickets.ready;
}

/** One row of the Goals table, with what the preview shows of its Goal. */
export type GoalRow = {
	/** The Goal's name, or the planning item's. */
	goal: string;
	standing: GoalStanding;
	/** From goal.md's first heading. */
	title: string;
	ticketCounts: GoalTicketCounts;
	/**
	 * Every Ticket's `runsMs` added up: the time the Goal's Runs ran, not
	 * the pauses between them.
	 */
	runMs: number;
	/** Sum of every Run's input and output tokens, 0 with none. */
	tokens: number;
	/** Sum of every Run's cost, 0 with none. */
	costUsd: number;
	/**
	 * What the Goal is doing or waiting for, like `04 review`; for a broken
	 * Goal, why its files can't be read; for a planning item, its planning
	 * activity, like `proposal ready`.
	 */
	now: string;
	/**
	 * The Workflow the Goal's header names; `unknown` for a broken Goal and
	 * `not chosen` for a planning item.
	 */
	workflow: string;
	/**
	 * When the Goal was created; undefined for a broken Goal or one made
	 * before Vago recorded it.
	 */
	created: Date | undefined;
	/**
	 * How long before the rows were read a Run last started or ended;
	 * undefined with no Runs.
	 */
	sinceLastActivityMs: number | undefined;
	/** Every Ticket of the Goal, lowest number first. */
	tickets: GoalTicket[];
	/**
	 * One total for each Step the Goal's Runs went through, in the order the
	 * Steps first ran, Ticket by Ticket; none with no Runs.
	 */
	stepTotals: GoalStepTotal[];
	/**
	 * `goal.md`'s body after its title as `joinParagraphs` gives it. For a
	 * broken Goal, why its files can't be read.
	 */
	description: string[];
	/** Whether the Goal was accepted from a planning item, whose chat it keeps. */
	planned: boolean;
};

/** The Runs of one Workflow Step summed over every Ticket of a Goal. */
export type GoalStepTotal = {
	stepName: string;
	runs: number;
	/** Every Run's `durationMs` added up. */
	runMs: number;
	/** Every Run's cost added up; absent when none had one, as with a shell Step. */
	costUsd?: number;
};

/**
 * Every Goal and planning item of the Project at `root` as a row, sorted
 * running, lost, stuck, broken, planning, ready, done, then latest activity
 * first, then name. A live Run's time runs to `now`. A Goal `readGoal` can't
 * read is a broken row saying why, with paths relative to `root`. Throws
 * what `listGoals` throws.
 */
export async function readGoalRows(
	root: string,
	now: Date,
): Promise<GoalRow[]> {
	const read = await Promise.all(
		(await listGoals(root)).map(async (goal) => {
			let state: GoalState;
			try {
				state = await readGoal(root, goal);
			} catch (error) {
				return {
					row: brokenRow(goal, projectMessage(error, root)),
					last: undefined,
				};
			}
			const claimed = await isGoalClaimed(root, goal);
			const last = lastActivity(state);
			const tickets = goalTickets(
				state,
				claimed,
				await readOpenLogsLastWritten(state),
				await readWorkflows(root, state),
				now,
			);
			return {
				row: goalRow(goal, state, claimed, tickets, now, last),
				last,
			};
		}),
	);
	const items = await listPlanningItems(root);
	if (items.length > 0) {
		const workflows = await listWorkflows(root);
		for (const item of items) {
			read.push(await readPlanningRow(root, item, workflows));
		}
	}
	// A Goal with no activity sorts after the rest of its standing, and the
	// name breaks ties so the order holds from one read to the next.
	read.sort(
		(a, b) =>
			standingOrder.indexOf(a.row.standing) -
				standingOrder.indexOf(b.row.standing) ||
			(b.last?.getTime() ?? -Infinity) - (a.last?.getTime() ?? -Infinity) ||
			(a.row.goal < b.row.goal ? -1 : 1),
	);
	return read.map(({ row }) => row);
}

// The Steps of the Goal's Workflow and each Workflow its Tickets go
// through, by name.
async function readWorkflows(
	root: string,
	state: GoalState,
): Promise<Map<string, GoalWorkflowSteps>> {
	const names = [
		...new Set([
			state.workflow,
			...state.tickets.map(({ workflow }) => workflow),
		]),
	];
	return new Map(
		await Promise.all(
			names.map(async (name): Promise<[string, GoalWorkflowSteps]> => {
				try {
					const workflow = await readWorkflowStepNames(root, name);
					return [name, { workflow, problem: undefined }];
				} catch (error) {
					const workflow = { beforeAll: [], steps: [], afterAll: [] };
					return [name, { workflow, problem: projectMessage(error, root) }];
				}
			}),
		),
	);
}

// When each open Run of the Goal last wrote its log, by the log's path.
async function readOpenLogsLastWritten(
	state: GoalState,
): Promise<Map<string, Date>> {
	const logs = goalRuns(state)
		.filter(({ ended }) => ended === undefined)
		.map(({ log }) => log);
	const written = new Map<string, Date>();
	for (const log of logs) {
		const at = await runLogLastWritten(log);
		if (at !== undefined) written.set(log, at);
	}
	return written;
}

/**
 * What `error` says, its paths relative to the Project at `root`, so it
 * fits the screen.
 */
export function projectMessage(error: unknown, root: string): string {
	return (error instanceof Error ? error.message : `${error}`)
		.replaceAll(`${root}${sep}`, "")
		.trim();
}

/** The header line's counts of the Goals of a Project and their spend. */
export type ProjectTotals = {
	done: number;
	ready: number;
	running: number;
	/** Stuck, lost and broken: the Goals waiting on the human. */
	stuck: number;
	costUsd: number;
};

/** The header line's counts for `rows`, every Goal of a Project. */
export function projectTotals(rows: GoalRow[]): ProjectTotals {
	const inStanding = (...standings: GoalStanding[]) =>
		rows.filter((row) => standings.includes(row.standing)).length;
	return {
		done: inStanding("done"),
		ready: inStanding("ready"),
		running: inStanding("running"),
		stuck: inStanding("stuck", "lost", "broken"),
		costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
	};
}

const standingOrder: GoalStanding[] = [
	"running",
	"lost",
	"stuck",
	"broken",
	"planning",
	"ready",
	"done",
];

// The row of Goal `goal`, whose files can't be read because of `message`:
// the row's "now" says it on one line, the preview in full.
function brokenRow(goal: string, message: string): GoalRow {
	return {
		goal,
		standing: "broken",
		title: "",
		ticketCounts: { done: 0, running: 0, stuck: 0, ready: 0 },
		runMs: 0,
		tokens: 0,
		costUsd: 0,
		now: message.replace(/\s+/g, " "),
		workflow: "unknown",
		created: undefined,
		sinceLastActivityMs: undefined,
		tickets: [],
		stepTotals: [],
		description: joinParagraphs(message),
		planned: false,
	};
}

// The row of planning item `item` of the Project at `root`, whose
// Workflows are named `workflows`: its "now" says what its chat is doing or
// waiting for, or why it can't be read, and `last` when its last response
// started or ended. Its agent's time and cost stay out of the row, which
// counts build Runs only.
async function readPlanningRow(
	root: string,
	item: string,
	workflows: string[],
): Promise<{ row: GoalRow; last: Date | undefined }> {
	try {
		const chat = await readPlanningChat(root, item);
		const proposal = await readPlanningProposal(root, item, workflows);
		const turn = chat.turns.at(-1);
		return {
			row: planningRow(item, planningNow(chat, proposal)),
			last: turn?.endedAt ?? turn?.startedAt,
		};
	} catch (error) {
		const message = projectMessage(error, root).replace(/\s+/g, " ");
		return { row: planningRow(item, message), last: undefined };
	}
}

// What the chat of a planning item with `proposal` is doing or waiting for:
// its agent writing a response, or the human, to send the first message,
// retry a response that stopped, answer after one that failed, reply, or
// accept a Proposal that is ready.
function planningNow(
	chat: PlanningChat,
	proposal: PlanningProposal | undefined,
): string {
	const last = chat.turns.at(-1);
	if (last === undefined) return "no chat yet";
	const { outcome } = last;
	if (outcome === undefined) return "agent working";
	if (outcome === "interrupted") return "response interrupted";
	if (outcome !== "ok") return "response failed";
	return proposal?.problems.length === 0
		? "proposal ready"
		: "waiting for your reply";
}

// The row of planning item `item`, which has no Workflow, Tickets or Runs
// yet, its "now" saying `now`.
function planningRow(item: string, now: string): GoalRow {
	return {
		goal: item,
		standing: "planning",
		title: "",
		ticketCounts: { done: 0, running: 0, stuck: 0, ready: 0 },
		runMs: 0,
		tokens: 0,
		costUsd: 0,
		now,
		workflow: "not chosen",
		created: undefined,
		sinceLastActivityMs: undefined,
		tickets: [],
		stepTotals: [],
		description: [
			"A Goal still being planned, with no Workflow or Tickets yet.",
		],
		planned: false,
	};
}

// `last` is the Goal's last activity, which the sort reads too.
function goalRow(
	goal: string,
	state: GoalState,
	claimed: boolean,
	tickets: GoalTicket[],
	now: Date,
	last: Date | undefined,
): GoalRow {
	const { standing, phrase } = goalStanding(claimed, tickets);
	const runs = goalRuns(state);
	const count = (status: TicketStatus) =>
		state.tickets.filter((ticket) => ticket.status === status).length;
	return {
		goal,
		standing,
		title: state.title,
		ticketCounts: {
			done: count("done"),
			running: count("running"),
			stuck: count("stuck"),
			ready: count("ready"),
		},
		runMs: tickets.reduce((sum, ticket) => sum + ticket.runsMs, 0),
		tokens: runs.reduce(
			(sum, run) => sum + (run.tokens?.input ?? 0) + (run.tokens?.output ?? 0),
			0,
		),
		costUsd: runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
		now: phrase,
		workflow: state.workflow,
		created: state.created,
		sinceLastActivityMs:
			last === undefined ? undefined : now.getTime() - last.getTime(),
		tickets,
		stepTotals: stepTotals(tickets),
		description: joinParagraphs(state.description),
		planned: state.planned,
	};
}

// The totals of each Step the Runs of `tickets` went through, in the order
// the Steps first ran, entry by entry, its Goal Step groups' included.
function stepTotals(tickets: GoalTicket[]): GoalStepTotal[] {
	const totals = new Map<string, GoalStepTotal>();
	for (const run of tickets.flatMap(({ runs }) => runs)) {
		const total = totals.get(run.stepName) ?? {
			stepName: run.stepName,
			runs: 0,
			runMs: 0,
		};
		totals.set(run.stepName, {
			stepName: run.stepName,
			runs: total.runs + 1,
			runMs: total.runMs + run.durationMs,
			costUsd:
				run.costUsd === undefined
					? total.costUsd
					: (total.costUsd ?? 0) + run.costUsd,
		});
	}
	return [...totals.values()];
}

// The Goal's standing and the "now" phrase that goes with it, from its
// Tickets as `goalTickets` gives them, lowest number first, so the first
// Ticket found is the lowest-numbered. Done is not `GoalState.done`, which a
// Goal with no Tickets is: such a Goal has nothing done yet and is ready to
// start.
function goalStanding(
	claimed: boolean,
	tickets: GoalTicket[],
): { standing: GoalStanding; phrase: string } {
	const first = (...marks: GoalTicketMark[]) =>
		tickets.find((ticket) => marks.includes(ticket.mark));
	// A running Ticket is marked lost while no `vago run` holds the Goal.
	const running = first("running", "lost");
	const runningOn = running && `${running.shortName} ${running.onStep}`;
	if (claimed) {
		return { standing: "running", phrase: runningOn ?? "between Tickets" };
	}
	if (runningOn !== undefined) {
		return {
			standing: "lost",
			phrase: `${runningOn}, no vago run process runs it`,
		};
	}
	const stuck = first("stuck");
	if (stuck !== undefined) {
		const last = stuck.runs.at(-1);
		return {
			standing: "stuck",
			phrase:
				last === undefined
					? `${stuck.shortName} stuck`
					: `${stuck.shortName} stuck after ${last.stepName} ${last.outcome ?? ""}`.trimEnd(),
		};
	}
	if (tickets.length > 0 && tickets.every(({ mark }) => mark === "done")) {
		return { standing: "done", phrase: "finished" };
	}
	return {
		standing: "ready",
		phrase:
			first("done") === undefined ? "ready to start" : "paused, ready to go on",
	};
}

// When a Run of the Goal last started or ended, or undefined with no Runs.
function lastActivity(state: GoalState): Date | undefined {
	const times = goalRuns(state).map((run) =>
		(run.ended ?? run.started).getTime(),
	);
	return times.length === 0 ? undefined : new Date(Math.max(...times));
}

// Every Run of the Goal, its Goal Steps' and its Tickets'.
function goalRuns(state: GoalState): TicketRun[] {
	return [
		...state.beforeAll,
		...state.tickets.flatMap(({ runs }) => runs),
		...state.afterAll,
	];
}
