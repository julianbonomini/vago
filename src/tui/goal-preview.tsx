// The preview of the selected Goal under the Goals table: its title, its
// progress, its Step totals and its description, each in a slot of its own.
// Hides the slots' sizes, which never depend on the Goal shown, so nothing
// moves as the selection does.

import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createEffect, For, on, Show } from "solid-js";
import { type GoalRow, ticketTotal } from "./goal-rows.ts";
import { sharedLine, usePane } from "./pane-grid.ts";
import { PaneTitle } from "./pane-title.tsx";
import { fitText, wrapText } from "./text-fit.ts";
import { theme } from "./theme.ts";
import { TicketBar } from "./ticket-bar.tsx";
import { day, duration, money } from "./time-and-money.ts";

/**
 * The preview of the Goal `row` shows, `width` columns wide and as tall as
 * the space its parent gives it, its top line shared with the box over it.
 * Its title row names the Goal, and its Workflow, when it was created and its
 * last activity. The description scrolls by the wheel and in `scrollRef`'s
 * scrollbox, and another Goal's opens at its top.
 */
export function GoalPreview(props: {
	row: GoalRow;
	width: number;
	scrollRef: (box: ScrollBoxRenderable) => void;
}): JSX.Element {
	const { color, symbol, dimText } = theme();
	const inner = () => props.width - boxEdges;
	// The Steps column keeps its full width while the description has room
	// for a few words, and gives up the rest below that.
	const stepsColumn = () =>
		Math.max(0, Math.min(stepsWidth, inner() - columnGap - descriptionMin));
	const descriptionColumn = () => inner() - stepsColumn() - columnGap;
	const totalRuns = () =>
		props.row.stepTotals.reduce((sum, step) => sum + step.runs, 0);
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
	let description: ScrollBoxRenderable | undefined;
	createEffect(
		on(
			() => props.row.goal,
			() => description?.scrollTo(0),
		),
	);
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
					width={stepsColumn()}
					flexShrink={0}
					flexDirection="column"
					overflow="hidden"
				>
					<Show
						when={props.row.stepTotals.length > 0}
						fallback={
							<text {...dimText} flexShrink={0} wrapMode="none">
								{fitText("No Runs yet.", stepsColumn())}
							</text>
						}
					>
						<text {...dimText} flexShrink={0} wrapMode="none">
							{fitText(
								stepLine({
									step: "STEP",
									runs: "RUNS",
									took: "TOOK",
									cost: "COST",
								}),
								stepsColumn(),
							)}
						</text>
						<For each={props.row.stepTotals}>
							{(step) => (
								<text fg={color.fg} flexShrink={0} wrapMode="none">
									{fitText(
										stepLine({
											step: step.stepName,
											runs: `${step.runs}`,
											took: duration(step.runMs),
											cost:
												step.costUsd === undefined ? "" : money(step.costUsd),
										}),
										stepsColumn(),
									)}
								</text>
							)}
						</For>
						<text
							fg={color.fg}
							attributes={TextAttributes.BOLD}
							flexShrink={0}
							wrapMode="none"
						>
							{fitText(
								stepLine({
									step: "total",
									runs: `${totalRuns()}`,
									took: duration(props.row.runMs),
									cost: money(props.row.costUsd),
								}),
								stepsColumn(),
							)}
						</text>
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
					<scrollbox
						ref={(box: ScrollBoxRenderable) => {
							description = box;
							props.scrollRef(box);
						}}
						flexGrow={1}
						verticalScrollbarOptions={{ visible: false }}
					>
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
					</scrollbox>
				</box>
			</box>
		</box>
	);
}

// The preview's border and padding, on both sides.
const boxEdges = 4;
const columnGap = 3;
// The least the description column keeps before the Steps column narrows.
const descriptionMin = 24;
// The widths of the Steps column's fields, each with the space after it.
// The cost comes last and fits `$123.45`.
const stepNameWidth = 14;
const runsWidth = 6;
const tookWidth = 9;
const stepsWidth = stepNameWidth + runsWidth + tookWidth + "$123.45".length;

// One line of the Step totals in its fixed columns, the Runs right-aligned
// under their heading.
function stepLine(fields: {
	step: string;
	runs: string;
	took: string;
	cost: string;
}): string {
	const step = fitText(fields.step, stepNameWidth - 1).padEnd(stepNameWidth);
	const runs = `${fields.runs.padStart(runsWidth - 2)}  `;
	return `${step}${runs}${fields.took.padEnd(tookWidth)}${fields.cost}`;
}
