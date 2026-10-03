// What the Goal view knows of each Ticket of a Goal: the mark its symbol and
// colour come from, the state word before its title, its blockers and its
// text as paragraphs. Hides the rules behind each.

import {
	type GoalState,
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
};

/**
 * The Tickets of the Goal read as `state`, lowest number first. `claimed`
 * says whether a live `vago run` holds the Goal.
 */
export function goalTickets(state: GoalState, claimed: boolean): GoalTicket[] {
	const done = state.tickets
		.filter(({ status }) => status === "done")
		.map(({ ticket }) => ticket.number);
	return state.tickets.map((ticket) => ({
		number: ticketNumberText(ticket.ticket.number),
		title: ticket.title,
		...markAndStateWord(
			ticket.status,
			ticket.runs.at(-1)?.step,
			claimed,
			ticket.blockedBy.filter((blocker) => !done.includes(blocker)),
		),
		blockedBy: ticket.blockedBy.map(ticketNumberText),
		description: joinParagraphs(ticket.description),
	}));
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
