// One Run on one line, as the Project view's preview and the Goal view's
// Runs pane list it: a leading field of the caller's, then its Step, outcome,
// duration and cost in fixed columns. Hides the columns' widths and how a
// narrow line is cut.

import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import type { GoalStanding } from "./goal-rows.ts";
import { fitText } from "./text-fit.ts";
import { runMarkLook, theme } from "./theme.ts";
import { duration, money } from "./time-and-money.ts";

/** What a Run line shows of a Run after its leading field. */
export type RunLineRun = {
	step: string;
	/** As spelled in the header, like `ok`; absent while the Run is open. */
	outcome?: string;
	durationMs: number;
	/** Absent for a shell Step. */
	costUsd?: number;
};

// The widths of the fields after the leading one, each with the space after
// it.
const stepWidth = 13;
const outcomeWidth = 12;
const durationWidth = 8;

/** The columns a Run line needs after its leading field, cost included. */
export const runLineFieldsWidth =
	stepWidth + outcomeWidth + durationWidth + "$12.34".length + 1;

/**
 * `run` in `width` columns: `lead` dim, its Step, its outcome in its colour
 * as `runMarkLook` gives it for a Goal of `standing`, how long it took and,
 * for an agent Step, what it cost, all bold when `bold`. A narrow line cuts
 * the fields on the right first.
 */
export function RunLine(props: {
	lead: string;
	run: RunLineRun;
	standing: GoalStanding;
	width: number;
	bold?: boolean;
}): JSX.Element {
	const { color, dimSpan } = theme();
	const mark = () => runMarkLook(props.run.outcome, props.standing);
	const fields = () => {
		let left = props.width;
		const take = (text: string, width: number) => {
			const cells = Math.min(width, left);
			left -= cells;
			return fitText(text, cells);
		};
		const cost =
			props.run.costUsd === undefined ? "" : money(props.run.costUsd);
		return {
			lead: take(props.lead, Bun.stringWidth(props.lead)),
			step: take(props.run.step, stepWidth),
			outcome: take(mark().text, outcomeWidth),
			rest: take(
				`${duration(props.run.durationMs).padEnd(durationWidth)}${cost}`,
				left,
			),
		};
	};
	return (
		<text
			fg={color.fg}
			attributes={props.bold === true ? TextAttributes.BOLD : 0}
			flexShrink={0}
			wrapMode="none"
		>
			<span style={dimSpan}>{fields().lead}</span>
			{fields().step}
			<span style={{ fg: mark().fg }}>{fields().outcome}</span>
			<span style={dimSpan}>{fields().rest}</span>
		</text>
	);
}
