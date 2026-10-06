// One Run on one line, as the Project view's preview and the Goal view's
// Runs pane list it: a leading field of the caller's, then its Step, marked
// when it resumed a session or fell back to a fresh one, outcome, duration
// and cost in fixed columns. Hides the columns' widths and how a
// narrow line is cut.

import type { ColorInput } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import type { TicketRunResume } from "../tickets/tickets.ts";
import type { GoalRunState } from "./goal-tickets.ts";
import { fitText } from "./text-fit.ts";
import { runMarkLook, theme } from "./theme.ts";

/**
 * How a selected Run line stands out: in the selection's colours in the
 * focused pane, or the idle selection's in another.
 */
export type RunLineSelection = "focused" | "idle";

import { duration, money } from "./time-and-money.ts";

/** What a Run line shows of a Run after its leading field. */
export type RunLineRun = {
	stepName: string;
	/** Absent for a Run that started a fresh session as usual. */
	resume?: TicketRunResume;
	state: GoalRunState;
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
// The resume mark's, taken from the end of the Step's when there is one.
const resumeWidth = 2;

/** The columns a Run line needs after its leading field, cost included. */
export const runLineFieldsWidth =
	stepWidth + outcomeWidth + durationWidth + "$12.34".length + 1;

/**
 * `run` in `width` columns: `lead` dim, its Step, its resume mark dim when
 * it resumed a session or fell back to a fresh one, its state or outcome in
 * its colour as `runMarkLook` gives it, how long it took and, for an agent
 * Step, what it cost, all as `selection` has it when given. A narrow line
 * cuts the fields on the right first.
 */
export function RunLine(props: {
	lead: string;
	run: RunLineRun;
	width: number;
	selection?: RunLineSelection;
}): JSX.Element {
	const { color, symbol, dimSpan, selection, idleSelection } = theme();
	const filled = () => props.selection === "focused";
	const idle = () => props.selection === "idle";
	// A filled line is drawn in the selection's colours throughout, so its
	// own colours don't fight the highlight.
	const fg = (own: ColorInput) => (filled() ? selection.fg : own);
	const mark = () => runMarkLook(props.run.state, props.run.outcome);
	const fields = () => {
		let left = props.width;
		const take = (text: string, width: number) => {
			const cells = Math.min(width, left);
			left -= cells;
			return fitText(text, cells);
		};
		const cost =
			props.run.costUsd === undefined ? "" : money(props.run.costUsd);
		const { resume } = props.run;
		return {
			lead: take(props.lead, Bun.stringWidth(props.lead)),
			step: take(
				props.run.stepName,
				resume === undefined ? stepWidth : stepWidth - resumeWidth,
			),
			resume:
				resume === undefined ? "" : take(`${symbol[resume]} `, resumeWidth),
			outcome: take(mark().text, outcomeWidth),
			rest: take(
				`${duration(props.run.durationMs).padEnd(durationWidth)}${cost}`,
				left,
			),
		};
	};
	return (
		<text
			fg={fg(color.fg)}
			bg={filled() ? selection.bg : idle() ? idleSelection.bg : undefined}
			attributes={
				filled() ? selection.attributes : idle() ? idleSelection.attributes : 0
			}
			flexShrink={0}
			wrapMode="none"
		>
			<span style={{ ...dimSpan, fg: fg(dimSpan.fg) }}>{fields().lead}</span>
			{fields().step}
			<span style={{ ...dimSpan, fg: fg(dimSpan.fg) }}>{fields().resume}</span>
			<span style={{ fg: fg(mark().fg) }}>{fields().outcome}</span>
			<span style={{ ...dimSpan, fg: fg(dimSpan.fg) }}>{fields().rest}</span>
		</text>
	);
}
