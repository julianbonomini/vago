// What the Goal view knows of each Ticket of a Goal: the mark its symbol and
// colour come from, the state word before its title, its blockers, its
// Workflow's Steps marked from its latest pass, its Runs and their totals,
// and its text as paragraphs. Hides the rules behind each.

import {
	type GoalState,
	type TicketRun,
	type TicketStatus,
	ticketNumberText,
} from "../tickets/tickets.ts";
import { joinParagraphs } from "./text-fit.ts";

/**
 * How a Ticket stands in the Goal view: its status, except `lost` for a
 * running Ticket no `vago run` runs, and `blocked` for a ready Ticket
 * waiting on a blocker not done yet.
 */
export type GoalTicketMark =
	| "done"
	| "running"
	| "lost"
	| "stuck"
	| "ready"
	| "blocked";

/** One Ticket as the Goal view shows it. */
export type GoalTicket = {
	/** As file names spell it, like `02`. */
	number: string;
	title: string;
	mark: GoalTicketMark;
	/**
	 * Shown before the title: the running Step, `lost`, `stuck`, or the
	 * blockers waited on, like `after 02`; "" for a done or ready Ticket.
	 */
	stateWord: string;
	/** Every blocker as file names spell it, done or not. */
	blockedBy: string[];
	/** The text after the title as `joinParagraphs` gives it. */
	description: string[];
	/**
	 * The Steps of the Workflow the Ticket goes through, in order; none when
	 * the Workflow can't be read.
	 */
	steps: GoalTicketStep[];
	/**
	 * Why the Ticket's Workflow can't be read, with paths relative to the
	 * Project; undefined when it can.
	 */
	workflowProblem: string | undefined;
	/** In the order they ran, so Run N is `runs[N - 1]`. */
	runs: GoalTicketRun[];
	/** Every Run's `durationMs` added up. */
	runsMs: number;
	/** Every Run's cost added up, 0 with none. */
	costUsd: number;
};

/** One Run of a Ticket as the Runs pane lists it and the Run pane shows it. */
export type GoalTicketRun = {
	step: string;
	/**
	 * The Harness an agent Step's Run ran on, whose stream its log holds;
	 * absent for a shell Step's, whose log is text.
	 */
	harness?: string;
	/** As spelled in the header, like `ok` or `exit 1`; absent while open. */
	outcome?: string;
	/**
	 * To the Run's end; an open one's to when it was read, or to its start
	 * when the Ticket is lost, as the Goal's clock stops then too.
	 */
	durationMs: number;
	/** Absent for a shell Step, and for an agent Step's until it ends. */
	costUsd?: number;
	/** Absolute path of the Run's log, for `readRunLog`. */
	log: string;
};

/**
 * How a Step stands in the Ticket's latest pass through its Workflow: its
 * last Run there ended `ok` (done), ended otherwise (failed), is open
 * (current, or lost when no `vago run` runs the Goal), or there is none
 * (pending).
 */
export type GoalTicketStepMark =
	| "done"
	| "current"
	| "failed"
	| "lost"
	| "pending";

/** One Step of a Ticket's Workflow as the Ticket pane marks it. */
export type GoalTicketStep = { id: string; mark: GoalTicketStepMark };

/**
 * The Step ids of a Workflow in order, or, with none, why it can't be read,
 * with paths relative to the Project.
 */
export type GoalWorkflowSteps = {
	stepIds: string[];
	problem: string | undefined;
};

/**
 * The Tickets of the Goal read as `state`, lowest number first, with open
 * Runs timed to `now`. `claimed` says whether a live `vago run` holds the
 * Goal. `workflows` holds the Steps of each Workflow the Tickets go through,
 * by name; a Ticket whose Workflow it lacks has no Steps.
 */
export function goalTickets(
	state: GoalState,
	claimed: boolean,
	workflows: Map<string, GoalWorkflowSteps>,
	now: Date,
): GoalTicket[] {
	const done = state.tickets
		.filter(({ status }) => status === "done")
		.map(({ ticket }) => ticket.number);
	return state.tickets.map((ticket) => {
		const markAndWord = markAndStateWord(
			ticket.status,
			ticket.runs.at(-1)?.step,
			claimed,
			ticket.blockedBy.filter((blocker) => !done.includes(blocker)),
		);
		const lost = markAndWord.mark === "lost";
		const workflow = workflows.get(ticket.workflow);
		const runs = ticket.runs.map(
			(run): GoalTicketRun => ({
				step: run.step,
				harness: run.harness,
				outcome: run.outcome,
				durationMs:
					(run.ended ?? (lost ? run.started : now)).getTime() -
					run.started.getTime(),
				costUsd: run.costUsd,
				log: run.log,
			}),
		);
		return {
			number: ticketNumberText(ticket.ticket.number),
			title: ticket.title,
			...markAndWord,
			blockedBy: ticket.blockedBy.map(ticketNumberText),
			description: joinParagraphs(ticket.description),
			steps: markSteps(workflow?.stepIds ?? [], ticket.runs, lost),
			workflowProblem: workflow?.problem,
			runs,
			runsMs: runs.reduce((sum, run) => sum + run.durationMs, 0),
			costUsd: runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
		};
	});
}

// Each of `stepIds` marked from the Ticket's latest pass, the Runs from the
// last one of its first Step on, since a Ticket can start over from there.
// `lost` says no `vago run` runs the Ticket, so its open Run is lost.
function markSteps(
	stepIds: string[],
	runs: TicketRun[],
	lost: boolean,
): GoalTicketStep[] {
	const passStart = runs.findLastIndex(({ step }) => step === stepIds[0]);
	const pass = runs.slice(Math.max(0, passStart));
	return stepIds.map((id) => {
		const run = pass.findLast(({ step }) => step === id);
		if (run === undefined) return { id, mark: "pending" };
		if (run.ended === undefined) return { id, mark: lost ? "lost" : "current" };
		return { id, mark: run.outcome === "ok" ? "done" : "failed" };
	});
}

// A Ticket's mark and state word from its status, the Step of its last Run,
// whether a `vago run` holds its Goal and the blockers it waits on.
function markAndStateWord(
	status: TicketStatus,
	lastStep: string | undefined,
	claimed: boolean,
	waitingOn: number[],
): { mark: GoalTicketMark; stateWord: string } {
	switch (status) {
		case "running":
			return claimed
				? { mark: "running", stateWord: lastStep ?? "starting" }
				: { mark: "lost", stateWord: "lost" };
		case "stuck":
			return { mark: "stuck", stateWord: "stuck" };
		case "done":
			return { mark: "done", stateWord: "" };
		case "ready":
			return waitingOn.length === 0
				? { mark: "ready", stateWord: "" }
				: {
						mark: "blocked",
						stateWord: `after ${waitingOn.map(ticketNumberText).join(", ")}`,
					};
	}
}
