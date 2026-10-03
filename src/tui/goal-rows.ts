// The Goals table's knowledge: each Goal's standing, the "now" phrase saying
// what it is doing or waiting for, its elapsed time and cost, the order of
// the rows, and the header line's totals. Hides the rules behind each.

import {
	type GoalState,
	isGoalClaimed,
	listGoals,
	readGoal,
	type TicketStatus,
} from "../tickets/tickets.ts";

/** A Goal's state as the Goals list shows it. */
export type GoalStanding = "running" | "lost" | "stuck" | "ready" | "done";

/** How many of a Goal's Tickets are in each status. */
export type GoalTicketCounts = {
	done: number;
	running: number;
	stuck: number;
	ready: number;
};

/** One row of the Goals table. */
export type GoalRow = {
	goal: string;
	standing: GoalStanding;
	/** From goal.md's first heading. */
	title: string;
	tickets: GoalTicketCounts;
	elapsedMs: number;
	/** Sum of every Run's cost, 0 with none. */
	costUsd: number;
	/** What the Goal is doing or waiting for, like `04 review`. */
	now: string;
};

/**
 * Every Goal of the Project at `root` as a row, sorted running, lost, stuck,
 * ready, done, then latest activity first, then name. Elapsed time runs to
 * `now` while a Goal is running. Throws what `readGoal` throws.
 */
export async function readGoalRows(
	root: string,
	now: Date,
): Promise<GoalRow[]> {
	const read = await Promise.all(
		(await listGoals(root)).map(async (goal) => {
			const state = await readGoal(root, goal);
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
	/** Stuck plus lost: the Goals waiting on the human. */
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
		needYou: inStanding("stuck", "lost"),
		costUsd: rows.reduce((sum, row) => sum + row.costUsd, 0),
	};
}

const standingOrder: GoalStanding[] = [
	"running",
	"lost",
	"stuck",
	"ready",
	"done",
];

// `last` is the Goal's last activity, which the sort reads too.
function goalRow(
	goal: string,
	state: GoalState,
	claimed: boolean,
	now: Date,
	last: Date | undefined,
): GoalRow {
	const { standing, phrase } = goalStanding(state, claimed);
	const starts = state.tickets.flatMap(({ runs }) =>
		runs.map(({ started }) => started.getTime()),
	);
	const end = standing === "running" ? now : last;
	const count = (status: TicketStatus) =>
		state.tickets.filter((ticket) => ticket.status === status).length;
	return {
		goal,
		standing,
		title: state.title,
		tickets: {
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
		costUsd: state.tickets
			.flatMap(({ runs }) => runs)
			.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
		now: phrase,
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
		`${twoDigits(running.ticket.number)} ${running.runs.at(-1)?.step ?? "starting"}`;
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
		const number = twoDigits(stuck.ticket.number);
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

function twoDigits(number: number): string {
	return String(number).padStart(2, "0");
}
