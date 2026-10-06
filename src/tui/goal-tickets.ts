// What the Goal view knows of each Ticket of a Goal: the mark its symbol and
// colour come from, the state word before its title, the Step it is on with
// the time left while it waits to retry it, its blockers, its
// Workflow's Steps marked from its latest pass, its Runs, live or lost while
// open, and their totals, and its text as paragraphs. Hides the rules behind
// each.

import {
	type GoalState,
	latestPassStart,
	type TicketRunResume,
	type TicketStatus,
	ticketNumberText,
} from "../tickets/tickets.ts";
import type { NamedStep } from "../workflow.ts";
import { joinParagraphs } from "./text-fit.ts";
import { duration } from "./time-and-money.ts";

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
	 * Shown before the title: `onStep` while running, `lost`, `stuck`, or
	 * the blockers waited on, like `after 02`; "" for a done or ready Ticket.
	 */
	stateWord: string;
	/**
	 * The Step a running or lost Ticket is on, as the Goals table's "now"
	 * phrase spells it: its latest Run's, or `starting` before its first,
	 * with the time left while a `vago run` waits to retry it, like
	 * `review retries in 42s`.
	 */
	onStep: string;
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
	/** The id of the Run's Step, as its Ticket's header records it. */
	stepId: string;
	/** The name of the Run's Step, its id when the Workflow has no such Step. */
	stepName: string;
	state: GoalRunState;
	/**
	 * The Harness an agent Step's Run ran on, whose stream its log holds;
	 * absent for a shell Step's, whose log is text.
	 */
	harness?: string;
	/** Absent for a Run that started a fresh session as usual. */
	resume?: TicketRunResume;
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
export type GoalTicketStep = { name: string; mark: GoalTicketStepMark };

/**
 * The Steps of a Workflow in order, or, with none, why it can't be read,
 * with paths relative to the Project.
 */
export type GoalWorkflowSteps = {
	steps: NamedStep[];
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
		const workflow = workflows.get(ticket.workflow);
		const steps = workflow?.steps ?? [];
		const [first] = steps;
		// `runs` holds one entry per Run of `ticket.runs`, in the same order.
		const passStart =
			first === undefined ? 0 : latestPassStart(ticket.runs, first.id);
		const runs = ticket.runs.map((run): GoalTicketRun => {
			const runState =
				run.ended !== undefined ? "ended" : claimed ? "live" : "lost";
			const end =
				run.ended ??
				(runState === "live" ? now : (lastWritten.get(run.log) ?? run.started));
			return {
				stepId: run.step,
				stepName: steps.find(({ id }) => id === run.step)?.name ?? run.step,
				state: runState,
				harness: run.harness,
				resume: run.resume,
				outcome: run.outcome,
				started: run.started,
				durationMs: Math.max(0, end.getTime() - run.started.getTime()),
				costUsd: run.costUsd,
				log: run.log,
			};
		});
		const retryAt = ticket.runs.at(-1)?.retryAt;
		const retryInMs =
			claimed && ticket.status === "running" && retryAt !== undefined
				? Math.max(0, retryAt.getTime() - now.getTime())
				: undefined;
		const onStep = runningStep(runs, retryInMs);
		return {
			number: ticketNumberText(ticket.ticket.number),
			title: ticket.title,
			...markAndStateWord(
				ticket.status,
				onStep,
				claimed,
				ticket.blockedBy.filter((blocker) => !done.includes(blocker)),
			),
			onStep,
			blockedBy: ticket.blockedBy.map(ticketNumberText),
			description: joinParagraphs(ticket.description),
			steps: markSteps(steps, runs.slice(passStart)),
			workflowProblem: workflow?.problem,
			runs,
			runsMs: runs.reduce((sum, run) => sum + run.durationMs, 0),
			costUsd: runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0),
		};
	});
}

// Each of `steps` marked from `pass`, the Runs of the Ticket's latest pass.
function markSteps(
	steps: NamedStep[],
	pass: GoalTicketRun[],
): GoalTicketStep[] {
	return steps.map(({ id, name }) => {
		const run = pass.findLast(({ stepId }) => stepId === id);
		if (run === undefined) return { name, mark: "pending" };
		if (run.state === "live") return { name, mark: "current" };
		if (run.state === "lost") return { name, mark: "lost" };
		return { name, mark: run.outcome === "ok" ? "done" : "failed" };
	});
}

// `GoalTicket.onStep` of a Ticket whose Runs are `runs`, which a `vago run`
// retries in `retryInMs` when it is waiting to.
function runningStep(
	runs: GoalTicketRun[],
	retryInMs: number | undefined,
): string {
	const step = runs.at(-1)?.stepName ?? "starting";
	return retryInMs === undefined
		? step
		: `${step} retries in ${duration(retryInMs)}`;
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
