// What the Goal view knows of each Ticket of a Goal, and of its `before_all`
// and `after_all` Goal Steps, which it lists before and after the Tickets:
// the mark its symbol and colour come from, the state word before its title,
// the Step it is on with the time left while it waits to retry it, its
// blockers, its Workflow's Steps marked from its latest pass, its Runs, live
// or lost while open, and their totals, and its text as paragraphs. Hides
// the rules behind each.

import {
	type GoalState,
	goalStepsPass,
	latestPassStart,
	type TicketRun,
	type TicketRunResume,
	type TicketStatus,
	ticketNumberText,
} from "../tickets/tickets.ts";
import type { GoalStepGroup, NamedStep, NamedWorkflow } from "../workflow.ts";
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

/**
 * One Ticket as the Goal view shows it, or a Goal Step group, which the Goal
 * view lists like a Ticket.
 */
export type GoalTicket = {
	/**
	 * What the Tickets list shows before the title, one of a kind in the
	 * Goal: a Ticket's number as file names spell it, like `02`, or the
	 * group, like `before_all`.
	 */
	shortName: string;
	/** What a pane's title calls it, like `Ticket 02` or `before_all`. */
	label: string;
	/** `Goal Steps` for a group. */
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
	 * The Steps of the Workflow the Ticket goes through, or of the group, in
	 * order; none when the Workflow can't be read.
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
 * The Steps of a Workflow, or, with none, why it can't be read, with paths
 * relative to the Project.
 */
export type GoalWorkflowSteps = {
	workflow: NamedWorkflow;
	problem: string | undefined;
};

/**
 * The Tickets of the Goal read as `state`, lowest number first, after its
 * `before_all` and before its `after_all` when its Workflow lists or its
 * `goal.md` records any. `claimed` says whether a live `vago run` holds the
 * Goal: its open Runs are then live, timed to `now`, and otherwise lost,
 * timed to their log's last write as `lastWritten` holds it by the log's
 * path, or to their start without one. `workflows` holds the Steps of the
 * Goal's Workflow and each Workflow the Tickets go through, by name; a
 * Ticket whose Workflow it lacks has no Steps.
 *
 * A group is done when its latest pass got past its last Step, stuck when
 * that pass stopped short and no `vago run` holds the Goal, and ready with
 * no Runs, as is an `after_all` whose latest pass started before a Ticket
 * Run did, since it runs again. A `before_all` with no Runs is listed only
 * while `goalStepsPass` says the Goal owes it, since `vago run` runs it only
 * before a Ticket.
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
	const timed = (runs: TicketRun[], steps: NamedStep[]) =>
		runs.map((run) => goalTicketRun(run, steps, claimed, lastWritten, now));
	const tickets = state.tickets.map((ticket): GoalTicket => {
		const workflow = workflows.get(ticket.workflow);
		const steps = workflow?.workflow.steps ?? [];
		const [first] = steps;
		// `runs` holds one entry per Run of `ticket.runs`, in the same order.
		const passStart =
			first === undefined ? 0 : latestPassStart(ticket.runs, first.id);
		const runs = timed(ticket.runs, steps);
		const retryAt = ticket.runs.at(-1)?.retryAt;
		const retryInMs =
			claimed && ticket.status === "running" && retryAt !== undefined
				? Math.max(0, retryAt.getTime() - now.getTime())
				: undefined;
		const onStep = runningStep(runs, retryInMs);
		const number = ticketNumberText(ticket.ticket.number);
		return {
			shortName: number,
			label: `Ticket ${number}`,
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
			runsMs: totalMs(runs),
			costUsd: totalCost(runs),
		};
	});
	const own = workflows.get(state.workflow);
	// A group's entry, or none when it has no Runs and, for `before_all`, the
	// Goal doesn't owe it or, for `after_all`, it has no Steps.
	const groupEntry = (
		group: GoalStepGroup,
		steps: NamedStep[],
		groupRuns: TicketRun[],
	): GoalTicket[] => {
		const latest = goalStepsPass(state, group, steps);
		const listed =
			groupRuns.length > 0 ||
			(group === "before_all" ? latest.owed : steps.length > 0);
		if (!listed) return [];
		const runs = timed(groupRuns, steps);
		const pass = timed(latest.runs, steps);
		const mark = goalStepsMark(latest.succeeded, pass, claimed);
		const retryAt = groupRuns.at(-1)?.retryAt;
		const onStep = runningStep(
			pass,
			mark === "running" && retryAt !== undefined
				? Math.max(0, retryAt.getTime() - now.getTime())
				: undefined,
		);
		return [
			{
				shortName: group,
				label: group,
				title: "Goal Steps",
				mark,
				stateWord:
					mark === "running"
						? onStep
						: mark === "lost" || mark === "stuck"
							? mark
							: "",
				onStep,
				blockedBy: [],
				description: [],
				steps: markSteps(steps, pass),
				workflowProblem: own?.problem,
				runs,
				runsMs: totalMs(runs),
				costUsd: totalCost(runs),
			},
		];
	};
	return [
		...groupEntry("before_all", own?.workflow.beforeAll ?? [], state.beforeAll),
		...tickets,
		...groupEntry("after_all", own?.workflow.afterAll ?? [], state.afterAll),
	];
}

// `run`, of a Step of `steps`, as the Goal view shows it, timed as
// `goalTickets` says.
function goalTicketRun(
	run: TicketRun,
	steps: NamedStep[],
	claimed: boolean,
	lastWritten: Map<string, Date>,
	now: Date,
): GoalTicketRun {
	const state = run.ended !== undefined ? "ended" : claimed ? "live" : "lost";
	const end =
		run.ended ??
		(state === "live" ? now : (lastWritten.get(run.log) ?? run.started));
	return {
		stepId: run.step,
		stepName: steps.find(({ id }) => id === run.step)?.name ?? run.step,
		state,
		harness: run.harness,
		resume: run.resume,
		outcome: run.outcome,
		started: run.started,
		durationMs: Math.max(0, end.getTime() - run.started.getTime()),
		costUsd: run.costUsd,
		log: run.log,
	};
}

function totalMs(runs: GoalTicketRun[]): number {
	return runs.reduce((sum, run) => sum + run.durationMs, 0);
}

function totalCost(runs: GoalTicketRun[]): number {
	return runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
}

// The mark of a Goal Step group from `pass`, the Runs of its latest pass,
// which `succeeded` says got past its last Step, as `goalTickets` says. A
// pass held by a `vago run` is running even between its Runs, as while it
// waits to retry one.
function goalStepsMark(
	succeeded: boolean,
	pass: GoalTicketRun[],
	claimed: boolean,
): GoalTicketMark {
	const last = pass.at(-1);
	if (last === undefined) return "ready";
	if (last.state === "live") return "running";
	if (last.state === "lost") return "lost";
	if (succeeded) return "done";
	return claimed ? "running" : "stuck";
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
