// The preview of the selected Goal under the Goals table: its title, its
// progress, its latest Runs and its description, each in a slot of its own.
// Hides the slots' sizes, which never depend on the Goal shown, so nothing
// moves as the selection does.

import type { JSX } from "@opentui/solid";
import { For, Show } from "solid-js";
import { type GoalRow, ticketTotal } from "./goal-rows.ts";
import { sharedLine, usePane } from "./pane-grid.ts";
import { PaneTitle } from "./pane-title.tsx";
import { RunLine, runLineFieldsWidth } from "./run-line.tsx";
import { fitText, wrapText } from "./text-fit.ts";
import { theme } from "./theme.ts";
import { TicketBar } from "./ticket-bar.tsx";
import { clock, day, duration } from "./time-and-money.ts";

/**
 * The preview of the Goal `row` shows, `width` columns wide and as tall as
 * the space its parent gives it, its top line shared with the box over it.
 * Its title row names the Goal, and its Workflow, when it was created and its
 * last activity.
 */
export function GoalPreview(props: {
	row: GoalRow;
	width: number;
}): JSX.Element {
	const { color, symbol, dimText } = theme();
	const inner = () => props.width - boxEdges;
	// The Runs column keeps its full width while the description has room
	// for a few words, and gives up the rest below that.
	const runsColumn = () =>
		Math.max(0, Math.min(runWidth, inner() - columnGap - descriptionMin));
	const descriptionColumn = () => inner() - runsColumn() - columnGap;
	const ticketsLabel = () =>
		`  ${props.row.ticketCounts.done}/${ticketTotal(props.row.ticketCounts)} Tickets`;
	const activity = () =>
		props.row.sinceLastActivityMs === undefined
			? "no Runs yet"
			: `last activity ${duration(props.row.sinceLastActivityMs)} ago`;
	const created = () =>
		props.row.created === undefined
			? ""
			: ` ${symbol.sep} created ${day(props.row.created)}`;
	const pane = usePane();
	return (
		<box
			ref={pane}
			border
			marginTop={-sharedLine}
			paddingLeft={1}
			paddingRight={1}
			flexGrow={1}
			overflow="hidden"
		>
			<PaneTitle
				title={props.row.goal}
				aside={`Workflow ${props.row.workflow}${created()} ${symbol.sep} ${activity()}`}
				focused={false}
				width={inner()}
			/>
			<text fg={color.fg} flexShrink={0} wrapMode="none">
				{fitText(props.row.title, inner())}
			</text>
			<text {...dimText} flexShrink={0} wrapMode="none">
				<TicketBar
					tickets={props.row.ticketCounts}
					standing={props.row.standing}
					width={Math.max(0, inner() - ticketsLabel().length)}
					selected={false}
					solid={false}
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
					<text {...dimText} flexShrink={0} wrapMode="none">
						{fitText("LATEST RUNS", runsColumn())}
					</text>
					<Show
						when={props.row.latestRuns.length > 0}
						fallback={
							<text {...dimText} flexShrink={0} wrapMode="none">
								{fitText("No Run yet.", runsColumn())}
							</text>
						}
					>
						<For each={props.row.latestRuns}>
							{(run) => (
								<RunLine
									lead={`${clock(run.started)} ${run.ticketNumber}`.padEnd(
										startWidth,
									)}
									run={run}
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
					<text {...dimText} flexShrink={0} wrapMode="none">
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
// The width of a Run line's leading field, when it started and its Ticket,
// with the space after it.
const startWidth = 9;
const runWidth = startWidth + runLineFieldsWidth;
