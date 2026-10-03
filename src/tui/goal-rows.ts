// What the Project view knows of each Goal: its standing, the "now" phrase
// saying what it is doing or waiting for, how many Tickets it has, its
// elapsed time, tokens and cost, the order of the rows, the header line's
// totals, what the preview shows of the selected Goal, and the Tickets the
// Goal view shows of it. Hides the rules behind each.

import { sep } from "node:path";
import {
	type GoalState,
	isGoalClaimed,
	listGoals,
	readGoal,
	type TicketStatus,
	ticketNumberText,
} from "../tickets/tickets.ts";
import { type GoalTicket, goalTickets } from "./goal-tickets.ts";
import { joinParagraphs } from "./text-fit.ts";

/**
 * A Goal's state as the Goals list shows it. `broken` is a Goal whose files
 * can't be read.
 */
export type GoalStanding =
	| "running"
	| "lost"
	| "stuck"
	| "broken"
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
	goal: string;
	standing: GoalStanding;
	/** From goal.md's first heading. */
	title: string;
	ticketCounts: GoalTicketCounts;
	elapsedMs: number;
	/** Sum of every Run's input and output tokens, 0 with none. */
	tokens: number;
	/** Sum of every Run's cost, 0 with none. */
	costUsd: number;
	/**
	 * What the Goal is doing or waiting for, like `04 review`; for a broken
	 * Goal, why its files can't be read.
	 */
	now: string;
	/** The Workflow the Goal's header names; `unknown` for a broken Goal. */
	workflow: string;
	/**
	 * How long before the rows were read a Run last started or ended;
	 * undefined with no Runs.
	 */
	sinceLastActivityMs: number | undefined;
	/** Every Ticket of the Goal, lowest number first. */
	tickets: GoalTicket[];
	/** The Goal's eight latest Runs, newest first. */
	latestRuns: GoalRowRun[];
	/**
	 * `goal.md`'s body after its title as `joinParagraphs` gives it. For a
	 * broken Goal, why its files can't be read.
	 */
	description: string[];
};

/** One Run as the preview lists it. */
export type GoalRowRun = {
	started: Date;
	/** The Run's Ticket number as file names spell it, like `02`. */
	ticketNumber: string;
	step: string;
	/** As spelled in the header, like `ok`; absent while the Run is open. */
	outcome?: string;
	/** To the Run's end, or to the time the rows were read while open. */
	durationMs: number;
	/** Absent for a shell Step. */
	costUsd?: number;
};

/**
 * Every Goal of the Project at `root` as a row, sorted running, lost, stuck,
 * broken, ready, done, then latest activity first, then name. Elapsed time
 * runs to `now` while a Goal is running. A Goal `readGoal` can't read is a
 * broken row saying why, with paths relative to `root`. Throws what
 * `listGoals` throws.
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
				const message = (error instanceof Error ? error.message : `${error}`)
					.replaceAll(`${root}${sep}`, "")
					.trim();
				return { row: brokenRow(goal, message), last: undefined };
			}
			const claimed = await isGoalClaimed(root, goal);
			const last = lastActivity(state);
			return { row: goalRow(goal, state, claimed, now, last), last };
		}),
	);
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

/** The header line's counts of the Goals of a Project and their spend. */
export type ProjectTotals = {
	goals: number;
	running: number;
	/** Stuck, lost and broken: the Goals waiting on the human. */
	needYou: number;
	costUsd: number;
};

/** The header line's counts for `rows`, every Goal of a Project. */
export function projectTotals(rows: GoalRow[]): ProjectTotals {
	const inStanding = (...standings: GoalStanding[]) =>
		rows.filter((row) => standings.includes(row.standing)).length;
	return {
		goals: rows.length,
		running: inStanding("running"),
		needYou: inStanding("stuck", "lost", "broken"),
		costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
	};
}

const standingOrder: GoalStanding[] = [
	"running",
	"lost",
	"stuck",
	"broken",
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
		elapsedMs: 0,
		tokens: 0,
		costUsd: 0,
		now: message.replace(/\s+/g, " "),
		workflow: "unknown",
		sinceLastActivityMs: undefined,
		tickets: [],
		latestRuns: [],
		description: joinParagraphs(message),
	};
}

// `last` is the Goal's last activity, which the sort reads too.
function goalRow(
	goal: string,
	state: GoalState,
	claimed: boolean,
	now: Date,
	last: Date | undefined,
): GoalRow {
	const { standing, phrase } = goalStanding(state, claimed);
	const runs = state.tickets.flatMap((ticket) => ticket.runs);
	const starts = runs.map(({ started }) => started.getTime());
	const end = standing === "running" ? now : last;
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
		// From the first Run's start; 0 with no Runs.
		elapsedMs:
			end === undefined || starts.length === 0
				? 0
				: end.getTime() - Math.min(...starts),
		tokens: runs.reduce(
			(sum, run) => sum + (run.tokens?.input ?? 0) + (run.tokens?.output ?? 0),
			0,
		),
		costUsd: runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
		now: phrase,
		workflow: state.workflow,
		sinceLastActivityMs:
			last === undefined ? undefined : now.getTime() - last.getTime(),
		tickets: goalTickets(state, claimed),
		latestRuns: state.tickets
			.flatMap(({ ticket, runs }) =>
				runs.map((run) => ({
					started: run.started,
					ticketNumber: ticketNumberText(ticket.number),
					step: run.step,
					outcome: run.outcome,
					durationMs: (run.ended ?? now).getTime() - run.started.getTime(),
					costUsd: run.costUsd,
				})),
			)
			.sort((a, b) => b.started.getTime() - a.started.getTime())
			.slice(0, 8),
		description: joinParagraphs(state.description),
	};
}

// The Goal's standing and the "now" phrase that goes with it. The first
// Ticket in a status is the lowest-numbered, as `readGoal` lists them in
// number order. Done is not `GoalState.done`, which a Goal with no Tickets
// is: such a Goal has nothing done yet and is ready to start.
function goalStanding(
	state: GoalState,
	claimed: boolean,
): { standing: GoalStanding; phrase: string } {
	const first = (status: TicketStatus) =>
		state.tickets.find((ticket) => ticket.status === status);
	const running = first("running");
	const runningStep =
		running &&
		`${ticketNumberText(running.ticket.number)} ${running.runs.at(-1)?.step ?? "starting"}`;
	if (claimed) {
		return { standing: "running", phrase: runningStep ?? "between Tickets" };
	}
	if (runningStep !== undefined) {
		return {
			standing: "lost",
			phrase: `${runningStep}, no vago run process runs it`,
		};
	}
	const stuck = first("stuck");
	if (stuck !== undefined) {
		const number = ticketNumberText(stuck.ticket.number);
		const last = stuck.runs.at(-1);
		return {
			standing: "stuck",
			phrase:
				last === undefined
					? `${number} stuck`
					: `${number} stuck after ${last.step} ${last.outcome ?? ""}`.trimEnd(),
		};
	}
	if (
		state.tickets.length > 0 &&
		state.tickets.every(({ status }) => status === "done")
	) {
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
	const times = state.tickets.flatMap(({ runs }) =>
		runs.map((run) => (run.ended ?? run.started).getTime()),
	);
	return times.length === 0 ? undefined : new Date(Math.max(...times));
}
