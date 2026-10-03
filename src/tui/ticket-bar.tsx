// A Goal's progress bar: cells of `━` split between its Ticket statuses.
// Hides how the cells are shared out and coloured.

import type { JSX } from "@opentui/solid";
import { For } from "solid-js";
import type { GoalStanding, GoalTicketCounts } from "./goal-rows.ts";
import { color, symbol, ticketColor } from "./theme.ts";

/** How many Tickets `tickets` counts in all. */
export function ticketTotal(tickets: GoalTicketCounts): number {
	return barStatuses.reduce((sum, status) => sum + tickets[status], 0);
}

// The order of a bar's segments, left to right.
const barStatuses = ["done", "running", "stuck", "ready"] as const;

/**
 * `width` cells of the bar, split between the Ticket statuses by their share
 * of the Tickets, done first. Every status present gets at least one cell,
 * so one stuck Ticket among many never rounds away. All faint with no
 * Tickets, all bg on a `selected` row. Spans, so it sits inside a `<text>`.
 */
export function TicketBar(props: {
	tickets: GoalTicketCounts;
	standing: GoalStanding;
	width: number;
	selected: boolean;
}): JSX.Element {
	// Each status takes the whole cells of its share, the cells left go to
	// the largest fractions, and the largest segment gives up what the
	// one-cell floor adds.
	const segments = () => {
		const total = ticketTotal(props.tickets);
		if (total === 0) return [{ fg: color.faint, cells: props.width }];
		const shares = barStatuses
			.filter((status) => props.tickets[status] > 0)
			.map((status) => {
				const share = (props.tickets[status] / total) * props.width;
				return {
					fg: ticketColor(status, props.standing),
					cells: Math.max(1, Math.floor(share)),
					fraction: share - Math.floor(share),
				};
			});
		let left = props.width - shares.reduce((sum, s) => sum + s.cells, 0);
		for (const share of [...shares].sort((a, b) => b.fraction - a.fraction)) {
			if (left <= 0) break;
			share.cells++;
			left--;
		}
		const largest = shares.reduce((a, b) => (b.cells > a.cells ? b : a));
		largest.cells += left;
		return shares;
	};
	return (
		<For each={segments()}>
			{(segment) => (
				<span style={{ fg: props.selected ? color.bg : segment.fg }}>
					{symbol.bar.repeat(segment.cells)}
				</span>
			)}
		</For>
	);
}
