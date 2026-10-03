// The Project view: the Goals table, one row per Goal in the order
// `goal-rows.ts` gives, with the selection moved by keys. Hides the columns,
// their widths and which drop out on a narrow terminal.

import { basename } from "node:path";
import { type JSX, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createResource, createSignal, For, Show } from "solid-js";
import {
	type GoalRow,
	type GoalStanding,
	type GoalTicketCounts,
	projectTotals,
	readGoalRows,
} from "./goal-rows.ts";
import { fitText } from "./text-fit.ts";
import { color, goalColor, symbol, ticketColor } from "./theme.ts";

/**
 * The Project view of the Project at `root`: a header line with the
 * Project's counts and spend, and a Goals box with one row per Goal showing
 * its standing, Tickets, time, cost, what it is doing and its title, the
 * selected one in the accent colour, moved by ↑↓ and j k, with `n/N` on the
 * box's bottom border. Reads the Goals itself.
 */
export function ProjectView(props: { root: string }): JSX.Element {
	const [rows] = createResource(() => readGoalRows(props.root, new Date()));
	const [selected, setSelected] = createSignal(0);
	// Clamped, not wrapped, so holding a key stops at the end of the list.
	const move = (by: number) =>
		setSelected((index) =>
			Math.max(0, Math.min((rows()?.length ?? 0) - 1, index + by)),
		);
	useKeyboard((key) => {
		if (key.name === "up" || key.name === "k") move(-1);
		if (key.name === "down" || key.name === "j") move(1);
	});
	// No count until the Goals are read, so an empty Project and a slow read
	// never look alike.
	const position = () => {
		const list = rows();
		if (list === undefined) return undefined;
		return list.length === 0 ? " 0/0 " : ` ${selected() + 1}/${list.length} `;
	};
	const terminal = useTerminalDimensions();
	const wide = () => terminal().width >= wideFrom;
	const nameWidth = () =>
		Math.min(
			30,
			Math.max(12, ...(rows() ?? []).map(({ goal }) => goal.length)),
		);
	// Left of NOW every column has a fixed width; NOW and TITLE share the
	// rest.
	const widths = () => {
		const rest =
			terminal().width -
			boxEdges -
			stateWidth -
			(nameWidth() + 1) -
			ticketsWidth -
			(wide() ? 2 * timesWidth : 0);
		const longest = Math.max(
			"NOW".length,
			...(rows() ?? []).map(({ now }) => Bun.stringWidth(now)),
		);
		const now = wide() ? Math.min(longest + 2, nowWidth, rest) : rest;
		return { name: nameWidth(), now, title: rest - now };
	};
	return (
		<box flexDirection="column" flexGrow={1}>
			<Show when={rows()}>
				{(read: () => GoalRow[]) => (
					<HeaderLine root={props.root} rows={read()} />
				)}
			</Show>
			<box
				border
				borderColor={color.border}
				title=" Goals "
				bottomTitle={position()}
				bottomTitleAlignment="right"
				paddingLeft={1}
				paddingRight={1}
			>
				<text fg={color.dim} flexShrink={0} wrapMode="none">
					{`${"  STATE".padEnd(stateWidth)}${"GOAL".padEnd(nameWidth())} ${"TICKETS".padEnd(ticketsWidth)}${wide() ? `${"ELAPSED".padEnd(timesWidth)}${"COST".padEnd(timesWidth)}` : ""}${fitText("NOW", widths().now)}${fitText("TITLE", widths().title)}`}
				</text>
				<For each={rows() ?? []}>
					{(row, index) => (
						<GoalRowLine
							row={row}
							selected={index() === selected()}
							widths={widths()}
							wide={wide()}
						/>
					)}
				</For>
			</box>
		</box>
	);
}

// The Project's name and its counts on one line above the Goals box. Not
// drawn until the Goals are read, so a slow read never shows zero Goals.
function HeaderLine(props: { root: string; rows: GoalRow[] }): JSX.Element {
	const totals = () => projectTotals(props.rows);
	return (
		<box flexDirection="row" flexShrink={0} paddingLeft={1} paddingRight={1}>
			<text fg={color.dim} wrapMode="none">
				{`${basename(props.root)} ${symbol.sep} ${totals().goals} Goals`}
			</text>
			<box flexGrow={1} />
			<text fg={color.dim} wrapMode="none">
				{[
					`${totals().running} running`,
					`${totals().needYou} need you`,
					`${money(totals().costUsd)} spent`,
				].join(` ${symbol.sep} `)}
			</text>
		</box>
	);
}

// The largest two units, like `13h 36m`, `25m 52s` or `0s`.
function duration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

// Dollars to the cent, like `$3.70`.
function money(usd: number): string {
	return `$${usd.toFixed(2)}`;
}

// The Goals box's border and padding, on both sides.
const boxEdges = 4;
// The symbol, a space and the longest standing word, then a space.
const stateWidth = 10;
// Below this many columns the ELAPSED and COST columns drop out.
const wideFrom = 100;
// ELAPSED and COST each: `13h 36m` or `$103.70`, then a space.
const timesWidth = 9;
// The most NOW takes at wide sizes, where it is as wide as its longest
// phrase and a gap before TITLE: room for `NN <step>, no vago run process
// runs it` with a short Step.
const nowWidth = 46;
const barWidth = 10;
// The bar, a space, and room for `99/99` and a space.
const ticketsWidth = barWidth + 7;

function GoalRowLine(props: {
	row: GoalRow;
	selected: boolean;
	widths: { name: number; now: number; title: number };
	wide: boolean;
}): JSX.Element {
	// The selected row is drawn in bg on accent throughout, so its own
	// colours don't fight the highlight.
	const fg = (own: string) => (props.selected ? color.bg : own);
	return (
		<text
			fg={fg(color.fg)}
			bg={props.selected ? color.accent : undefined}
			flexShrink={0}
			wrapMode="none"
		>
			<span style={{ fg: fg(goalColor(props.row.standing)) }}>
				{`${symbol[props.row.standing]} ${props.row.standing}`.padEnd(
					stateWidth,
				)}
			</span>
			<span style={{ fg: fg(color.fg) }}>
				{fitText(props.row.goal, props.widths.name)}
			</span>
			<span style={{ fg: fg(color.dim) }}> </span>
			<TicketBar
				tickets={props.row.tickets}
				standing={props.row.standing}
				width={barWidth}
				selected={props.selected}
			/>
			<span style={{ fg: fg(color.dim) }}>
				{` ${`${props.row.tickets.done}/${ticketTotal(props.row.tickets)}`.padEnd(ticketsWidth - barWidth - 1)}`}
				{props.wide
					? `${duration(props.row.elapsedMs).padEnd(timesWidth)}${money(props.row.costUsd).padEnd(timesWidth)}`
					: ""}
				{fitText(props.row.now, props.widths.now)}
			</span>
			<span style={{ fg: fg(color.dim) }}>
				{fitText(props.row.title, props.widths.title)}
			</span>
		</text>
	);
}

function ticketTotal(tickets: GoalTicketCounts): number {
	return barStatuses.reduce((sum, status) => sum + tickets[status], 0);
}

// The order of a bar's segments, left to right.
const barStatuses = ["done", "running", "stuck", "ready"] as const;

// `width` cells of the bar, split between the Ticket statuses by their share
// of the Tickets. Every status present gets at least one cell, so one stuck
// Ticket among many never rounds away. Each takes the whole cells of its
// share, the cells left go to the largest fractions, and the largest segment
// gives up what the one-cell floor adds. Spans, so it sits inside a row's
// text.
function TicketBar(props: {
	tickets: GoalTicketCounts;
	standing: GoalStanding;
	width: number;
	selected: boolean;
}): JSX.Element {
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
