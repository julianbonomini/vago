// The preview of the selected Goal under the Goals table: its title, its
// progress, its latest Runs and its description, each in a slot of its own.
// Hides the slots' sizes, which never depend on the Goal shown, so nothing
// moves as the selection does.

import type { JSX } from "@opentui/solid";
import { For, Show } from "solid-js";
import type { GoalRow, GoalRowRun, GoalStanding } from "./goal-rows.ts";
import { fitText, wrapText } from "./text-fit.ts";
import { color, symbol } from "./theme.ts";
import { TicketBar, ticketTotal } from "./ticket-bar.tsx";
import { clock, duration, money } from "./time-and-money.ts";

/**
 * The preview of the Goal `row` shows, `width` columns wide and as tall as
 * the space its parent gives it. Its border names the Goal at the top, and
 * its Workflow and last activity at the bottom.
 */
export function GoalPreview(props: {
	row: GoalRow;
	width: number;
}): JSX.Element {
	const inner = () => props.width - boxEdges;
	// The Runs column keeps its full width while the description has room
	// for a few words, and gives up the rest below that.
	const runsColumn = () =>
		Math.max(0, Math.min(runWidth, inner() - columnGap - descriptionMin));
	const descriptionColumn = () => inner() - runsColumn() - columnGap;
	const ticketsLabel = () =>
		`  ${props.row.tickets.done}/${ticketTotal(props.row.tickets)} Tickets`;
	const activity = () =>
		props.row.sinceLastActivityMs === undefined
			? "no Runs yet"
			: `last activity ${duration(props.row.sinceLastActivityMs)} ago`;
	return (
		<box
			border
			borderColor={color.border}
			title={` ${props.row.goal} `}
			bottomTitle={` Workflow ${props.row.workflow} ${symbol.sep} ${activity()} `}
			bottomTitleAlignment="right"
			paddingLeft={1}
			paddingRight={1}
			flexGrow={1}
			overflow="hidden"
		>
			<text fg={color.fg} flexShrink={0} wrapMode="none">
				{fitText(props.row.title, inner())}
			</text>
			<text fg={color.dim} flexShrink={0} wrapMode="none">
				<TicketBar
					tickets={props.row.tickets}
					standing={props.row.standing}
					width={Math.max(0, inner() - ticketsLabel().length)}
					selected={false}
				/>
				{ticketsLabel()}
			</text>
			<box height={1} flexShrink={0} />
			<box flexDirection="row" flexGrow={1} overflow="hidden">
				<box
					width={runsColumn()}
					flexShrink={0}
					flexDirection="column"
					overflow="hidden"
				>
					<text fg={color.dim} flexShrink={0} wrapMode="none">
						{fitText("LATEST RUNS", runsColumn())}
					</text>
					<Show
						when={props.row.latestRuns.length > 0}
						fallback={
							<text fg={color.dim} flexShrink={0} wrapMode="none">
								{fitText("No Run yet.", runsColumn())}
							</text>
						}
					>
						<For each={props.row.latestRuns}>
							{(run) => (
								<RunLine
									run={run}
									standing={props.row.standing}
									width={runsColumn()}
								/>
							)}
						</For>
					</Show>
				</box>
				<box width={columnGap} flexShrink={0} />
				<box
					width={descriptionColumn()}
					flexShrink={0}
					flexDirection="column"
					overflow="hidden"
				>
					<text fg={color.dim} flexShrink={0} wrapMode="none">
						{fitText("GOAL", descriptionColumn())}
					</text>
					<For
						each={props.row.description.flatMap((paragraph) =>
							wrapText(paragraph, descriptionColumn()),
						)}
					>
						{(line) => (
							<text fg={color.fg} flexShrink={0} wrapMode="none">
								{fitText(line, descriptionColumn())}
							</text>
						)}
					</For>
				</box>
			</box>
		</box>
	);
}

// The preview's border and padding, on both sides.
const boxEdges = 4;
const columnGap = 3;
// The least the description column keeps before the Runs column narrows.
const descriptionMin = 24;
// The widths of a Run line's fields, each with the space after it.
const startWidth = 9;
const stepWidth = 13;
const outcomeWidth = 12;
const durationWidth = 8;
// The four fields and room for a cost like `$12.34`.
const runWidth = startWidth + stepWidth + outcomeWidth + durationWidth + 7;

// One Run in `width` columns: when it started and its Ticket, its Step, its
// outcome, how long it took and, for an agent Step, what it cost. A narrow
// column cuts the fields on the right first.
function RunLine(props: {
	run: GoalRowRun;
	standing: GoalStanding;
	width: number;
}): JSX.Element {
	const mark = () => runMark(props.run.outcome, props.standing);
	const fields = () => {
		let left = props.width;
		const take = (text: string, width: number) => {
			const cells = Math.min(width, left);
			left -= cells;
			return fitText(text, cells);
		};
		const ticket = String(props.run.ticketNumber).padStart(2, "0");
		const cost =
			props.run.costUsd === undefined ? "" : money(props.run.costUsd);
		return {
			start: take(`${clock(props.run.started)} ${ticket}`, startWidth),
			step: take(props.run.step, stepWidth),
			outcome: take(mark().text, outcomeWidth),
			rest: take(
				`${duration(props.run.durationMs).padEnd(durationWidth)}${cost}`,
				left,
			),
		};
	};
	return (
		<text fg={color.dim} flexShrink={0} wrapMode="none">
			{fields().start}
			<span style={{ fg: color.fg }}>{fields().step}</span>
			<span style={{ fg: mark().fg }}>{fields().outcome}</span>
			{fields().rest}
		</text>
	);
}

// A Run's outcome with its symbol and colour. An open Run is live while its
// Goal runs, and lost otherwise, as is one the next `vago run` ended `lost`.
function runMark(
	outcome: string | undefined,
	standing: GoalStanding,
): { text: string; fg: string } {
	if (outcome === undefined && standing === "running") {
		return { text: `${symbol.running} live`, fg: color.accent };
	}
	if (outcome === undefined || outcome === "lost") {
		return { text: `${symbol.lost} lost`, fg: color.warn };
	}
	if (outcome === "ok") return { text: `${symbol.done} ok`, fg: color.ok };
	return { text: `${symbol.stuck} ${outcome}`, fg: color.bad };
}
