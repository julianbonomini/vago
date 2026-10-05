// What the Goal view knows of each Ticket of a Goal: the mark its symbol and
// colour come from, the state word before its title, its blockers, its
// Workflow's Steps marked from its latest pass, its Runs, live or lost while
// open, and their totals, and its text as paragraphs. Hides the rules behind
// each.

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

/**
 * Whether a Run is going: `live` while open and a `vago run` holds its Goal,
 * `lost` while open and none does, `ended` once it ended.
 */
export type GoalRunState = "live" | "lost" | "ended";

/** One Run of a Ticket as the Runs pane lists it and the Run pane shows it. */
export type GoalTicketRun = {
	step: string;
	state: GoalRunState;
	/**
	 * The Harness an agent Step's Run ran on, whose stream its log holds;
	 * absent for a shell Step's, whose log is text.
	 */
	harness?: string;
	/** As spelled in the header, like `ok` or `exit 1`; absent while open. */
	outcome?: string;
	started: Date;
	/**
	 * To the Run's end; a live one's to when it was read, and a lost one's to
	 * when its log was last written, the last time it was heard from.
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
 * The Tickets of the Goal read as `state`, lowest number first. `claimed`
 * says whether a live `vago run` holds the Goal: its open Runs are then
 * live, timed to `now`, and otherwise lost, timed to their log's last write
 * as `lastWritten` holds it by the log's path, or to their start without
 * one. `workflows` holds the Steps of each Workflow the Tickets go through,
 * by name; a Ticket whose Workflow it lacks has no Steps.
 */
export function goalTickets(
	state: GoalState,
	claimed: boolean,
	lastWritten: Map<string, Date>,
	workflows: Map<string, GoalWorkflowSteps>,
	now: Date,
): GoalTicket[] {
	const done = state.tickets
		.filter(({ status }) => status === "done")
		.map(({ ticket }) => ticket.number);
	return state.tickets.map((ticket) => {
		const markAndWord = markAndStateWord(
			ticket.status,
			runningStep(ticket.runs),
			claimed,
			ticket.blockedBy.filter((blocker) => !done.includes(blocker)),
		);
		const workflow = workflows.get(ticket.workflow);
		const runs = ticket.runs.map((run): GoalTicketRun => {
			const runState =
				run.ended !== undefined ? "ended" : claimed ? "live" : "lost";
			const end =
				run.ended ??
				(runState === "live" ? now : (lastWritten.get(run.log) ?? run.started));
			return {
				step: run.step,
				state: runState,
				harness: run.harness,
				outcome: run.outcome,
				started: run.started,
				durationMs: Math.max(0, end.getTime() - run.started.getTime()),
				costUsd: run.costUsd,
				log: run.log,
			};
		});
		return {
			number: ticketNumberText(ticket.ticket.number),
			title: ticket.title,
			...markAndWord,
			blockedBy: ticket.blockedBy.map(ticketNumberText),
			description: joinParagraphs(ticket.description),
			steps: markSteps(workflow?.stepIds ?? [], runs),
			workflowProblem: workflow?.problem,
			runs,
			runsMs: runs.reduce((sum, run) => sum + run.durationMs, 0),
			costUsd: runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
		};
	});
}

// Each of `stepIds` marked from the Ticket's latest pass, the Runs from the
// last one of its first Step on, since a Ticket can start over from there.
function markSteps(stepIds: string[], runs: GoalTicketRun[]): GoalTicketStep[] {
	const passStart = runs.findLastIndex(({ step }) => step === stepIds[0]);
	const pass = runs.slice(Math.max(0, passStart));
	return stepIds.map((id) => {
		const run = pass.findLast(({ step }) => step === id);
		if (run === undefined) return { id, mark: "pending" };
		if (run.state === "live") return { id, mark: "current" };
		if (run.state === "lost") return { id, mark: "lost" };
		return { id, mark: run.outcome === "ok" ? "done" : "failed" };
	});
}

/**
 * The Step a running Ticket whose Runs are `runs` is on, as its state word
 * and the Goals table's "now" phrase spell it: its latest Run's, or
 * `starting` before its first.
 */
export function runningStep(runs: TicketRun[]): string {
	return runs.at(-1)?.step ?? "starting";
}

// A Ticket's mark and state word from its status, the Step it is on while
// running, whether a `vago run` holds its Goal and the blockers it waits on.
function markAndStateWord(
	status: TicketStatus,
	step: string,
	claimed: boolean,
	waitingOn: number[],
): { mark: GoalTicketMark; stateWord: string } {
	switch (status) {
		case "running":
			return claimed
				? { mark: "running", stateWord: step }
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
