// The Project view: the Goals table, one row per Goal in the order
// `goal-rows.ts` gives, with the selection moved by keys. Hides the columns,
// their widths and which drop out on a narrow terminal.

import { basename } from "node:path";
import { type JSX, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createResource, createSignal, For, Show } from "solid-js";
import { GoalPreview } from "./goal-preview.tsx";
import { type GoalRow, projectTotals, readGoalRows } from "./goal-rows.ts";
import { fitText } from "./text-fit.ts";
import { color, goalColor, symbol } from "./theme.ts";
import { TicketBar, ticketTotal } from "./ticket-bar.tsx";
import { duration, money } from "./time-and-money.ts";

/**
 * The Project view of the Project at `root`: a header line with the
 * Project's counts and spend, and a Goals box with one row per Goal showing
 * its standing, Tickets, time, cost, what it is doing and its title, the
 * selected one in the accent colour, moved by ↑↓ and j k, with `n/N` on the
 * box's bottom border. Below it, the selected Goal's preview fills the rest
 * of the screen. Reads the Goals itself.
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
				flexShrink={0}
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
			<Show when={rows()?.[selected()]}>
				{(row: () => GoalRow) => (
					<GoalPreview row={row()} width={terminal().width} />
				)}
			</Show>
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
