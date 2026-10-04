// The Goal view: one Goal's header, its Tickets, the selected Ticket's text
// and Runs, and the selected Run, opened from the Project view. Hides the
// panes' layout, which Ticket and Run are selected and how the keys move
// them.

import {
	type ColorInput,
	type ScrollBoxRenderable,
	TextAttributes,
} from "@opentui/core";
import { type JSX, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import {
	createEffect,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import { readRunLog } from "../tickets/tickets.ts";
import { type GoalRow, type GoalStanding, ticketTotal } from "./goal-rows.ts";
import type {
	GoalTicket,
	GoalTicketRun,
	GoalTicketStep,
} from "./goal-tickets.ts";
import { RunLine } from "./run-line.tsx";
import {
	type FooterKey,
	type HelpKey,
	KeyFooter,
	KeyHelp,
} from "./screen-keys.tsx";
import { fitText, wrapText } from "./text-fit.ts";
import {
	goalColor,
	runMarkLook,
	stepMarkLook,
	theme,
	ticketMarkStyle,
} from "./theme.ts";
import { TicketBar } from "./ticket-bar.tsx";
import { duration, money, tokenCount } from "./time-and-money.ts";

/**
 * The Goal view of the Goal `row` shows, the `position`th of `count` Goals
 * in the Project list: a header box with the Goal's progress and numbers,
 * its Tickets on the left with `n/N` on their border and the selected
 * Ticket's Runs under them, the selected Ticket's title, blockers and text
 * on the right, and the selected Run across the bottom. The Ticket the Goal
 * is on starts selected, the first not done or else the last, and ↑↓ and
 * j k move the selection. A Ticket starts on its latest Run, and ←→ and h l
 * move to the one before or after. A footer names the keys, and `?` shows
 * them all until `?` or Esc. Esc otherwise calls `onClose`.
 */
export function GoalView(props: {
	row: GoalRow;
	position: number;
	count: number;
	onClose: () => void;
}): JSX.Element {
	const { symbol } = theme();
	const terminal = useTerminalDimensions();
	const [chosen, setChosen] = createSignal<string>();
	const selectedIndex = () => {
		const tickets = props.row.tickets;
		const index = tickets.findIndex(({ number }) => number === chosen());
		if (index !== -1) return index;
		const current = tickets.findIndex(({ mark }) => mark !== "done");
		return current === -1 ? tickets.length - 1 : current;
	};
	const ticket = () => props.row.tickets[selectedIndex()];
	// The Run picked on Ticket `ticket`; another Ticket starts on its latest.
	const [chosenRun, setChosenRun] = createSignal<{
		ticket: string;
		index: number;
	}>();
	// -1 for a Ticket with no Runs.
	const runIndex = () => {
		const runs = ticket()?.runs ?? [];
		const chosen = chosenRun();
		return chosen !== undefined && chosen.ticket === ticket()?.number
			? Math.min(chosen.index, runs.length - 1)
			: runs.length - 1;
	};
	const [helpShown, setHelpShown] = createSignal(false);
	// Clamped, not wrapped, so holding a key stops at the end of the list.
	const clamp = (index: number, length: number) =>
		Math.max(0, Math.min(length - 1, index));
	const select = (index: number) => {
		const tickets = props.row.tickets;
		const ticket = tickets[clamp(index, tickets.length)];
		if (ticket !== undefined) setChosen(ticket.number);
	};
	const selectRun = (index: number) => {
		const selected = ticket();
		if (selected === undefined || selected.runs.length === 0) return;
		setChosenRun({
			ticket: selected.number,
			index: clamp(index, selected.runs.length),
		});
	};
	useKeyboard((key) => {
		if (key.name === "?") setHelpShown(!helpShown());
		else if (key.name === "escape" && helpShown()) setHelpShown(false);
		else if (key.name === "escape") props.onClose();
		else if (helpShown()) return;
		else if (key.name === "up" || key.name === "k") select(selectedIndex() - 1);
		else if (key.name === "down" || key.name === "j")
			select(selectedIndex() + 1);
		else if (key.name === "left" || key.name === "h") selectRun(runIndex() - 1);
		else if (key.name === "right" || key.name === "l")
			selectRun(runIndex() + 1);
	});
	const ticketsWidth = () => Math.floor(terminal().width * ticketsShare);
	const topRows = () =>
		Math.round((terminal().height - headerRows - 1) * topShare);
	// Enough rows for every Run, between 3 and 8, and at most a third of the
	// top's, so the Tickets keep the most.
	const runsRows = () =>
		Math.max(
			3,
			Math.min((ticket()?.runs.length ?? 0) + 2, 8, Math.floor(topRows() / 3)),
		);
	return (
		<box flexDirection="column" flexGrow={1}>
			<GoalHeader
				row={props.row}
				position={props.position}
				count={props.count}
				width={terminal().width}
				height={terminal().height}
			/>
			<box flexDirection="row" height={topRows()} flexShrink={0}>
				<box flexDirection="column" width={ticketsWidth()} flexShrink={0}>
					<TicketsPane
						tickets={props.row.tickets}
						selected={selectedIndex()}
						width={ticketsWidth()}
					/>
					<RunsPane
						ticket={ticket()}
						selected={runIndex()}
						standing={props.row.standing}
						width={ticketsWidth()}
						height={runsRows()}
					/>
				</box>
				<Show when={ticket()}>
					{(ticket: () => GoalTicket) => (
						<TicketPane
							ticket={ticket()}
							width={terminal().width - ticketsWidth()}
						/>
					)}
				</Show>
			</box>
			<RunPane
				ticket={ticket()}
				selected={runIndex()}
				standing={props.row.standing}
			/>
			<box flexShrink={0} paddingLeft={1} paddingRight={1}>
				<KeyFooter
					keys={footerKeys(symbol.upDown, symbol.leftRight)}
					width={terminal().width - 2}
				/>
			</box>
			<Show when={helpShown()}>
				<KeyHelp keys={helpKeys(symbol.upDown, symbol.leftRight)} />
			</Show>
		</box>
	);
}

// `q` and Ctrl-C belong to `tui.tsx`, which quits on them on every screen.
// `upDown` and `leftRight` name the arrow keys.
const footerKeys = (upDown: string, leftRight: string): FooterKey[] => [
	{ keys: upDown, label: "Ticket", use: 5 },
	{ keys: leftRight, label: "Run", use: 4 },
	{ keys: "Esc", label: "Goals", use: 3 },
	{ keys: "?", label: "Help", use: 2 },
	{ keys: "q", label: "Quit", use: 1 },
];

const helpKeys = (upDown: string, leftRight: string): HelpKey[] => [
	{ keys: `${upDown} j k`, meaning: "select the Ticket above, below" },
	{ keys: `${leftRight} h l`, meaning: "select the Run before, after" },
	{ keys: "wheel", meaning: "scroll the pane under the pointer" },
	{ keys: "Esc", meaning: "back to the Goals" },
	{ keys: "? Esc", meaning: "show, hide these keys" },
	{ keys: "q Ctrl-C", meaning: "quit" },
];

// The share of the screen's width the Tickets and Runs panes take; the
// Ticket pane takes the rest.
const ticketsShare = 0.4;
// The share of the rows under the header and over the footer that the
// Tickets, Runs and Ticket panes take; the Run pane takes the rest.
const topShare = 0.62;
// The header box's rows: its border and two lines.
const headerRows = 4;
// A box's border and padding, on both sides.
const paneEdges = 4;

// Below this many rows the header's bar is the lighter one.
const solidBarFrom = 30;

// The header box, `width` columns wide on a screen `height` rows tall,
// titled with the Goal's place in the Project list, its symbol and its name,
// over its progress bar and a line of its numbers, labels dim and values
// bold. The Goal's title takes what the numbers leave.
function GoalHeader(props: {
	row: GoalRow;
	position: number;
	count: number;
	width: number;
	height: number;
}): JSX.Element {
	const { color, symbol, border, dimSpan } = theme();
	const inner = () => props.width - paneEdges;
	const done = () => `  ${props.row.ticketCounts.done}`;
	const total = () => `/${ticketTotal(props.row.ticketCounts)} Tickets`;
	const value = (text: string, fg: ColorInput = color.fg) => ({
		text,
		style: { fg, bold: true },
	});
	const label = (text: string) => ({ text, style: dimSpan });
	const numbers = () =>
		fitSpans(
			[
				value(props.row.standing.toUpperCase(), goalColor(props.row.standing)),
				label("   "),
				value(duration(props.row.elapsedMs)),
				label(" elapsed   "),
				value(tokenCount(props.row.tokens)),
				label(" tokens   "),
				value(money(props.row.costUsd)),
				label("   Workflow "),
				value(props.row.workflow),
				label("   "),
				{ text: props.row.title, style: { fg: color.fg } },
			],
			inner(),
		);
	return (
		<box
			border
			customBorderChars={border}
			borderColor={color.border}
			title={` Goal ${props.position}/${props.count} ${symbol.sep} ${symbol[props.row.standing]} ${props.row.goal} `}
			titleColor={goalColor(props.row.standing)}
			paddingLeft={1}
			paddingRight={1}
			flexShrink={0}
		>
			<text fg={color.fg} flexShrink={0} wrapMode="none">
				<TicketBar
					tickets={props.row.ticketCounts}
					standing={props.row.standing}
					width={Math.max(0, inner() - done().length - total().length)}
					selected={false}
					solid={props.height >= solidBarFrom}
				/>
				<span style={{ fg: color.fg, bold: true }}>{done()}</span>
				<span style={dimSpan}>{total()}</span>
			</text>
			<text fg={color.fg} flexShrink={0} wrapMode="none">
				<For each={numbers()}>
					{(span) => <span style={span.style}>{span.text}</span>}
				</For>
			</text>
		</box>
	);
}

type StyledSpan = {
	text: string;
	style: { fg: ColorInput; bold?: boolean; dim?: boolean };
};

// `spans` cut to `width` columns in all: the span that crosses the edge is
// cut with the theme's mark, and those past it dropped.
function fitSpans(spans: StyledSpan[], width: number): StyledSpan[] {
	let left = width;
	const fitted: StyledSpan[] = [];
	for (const span of spans) {
		if (left <= 0) break;
		const spanWidth = Bun.stringWidth(span.text);
		fitted.push(
			spanWidth <= left ? span : { ...span, text: fitText(span.text, left) },
		);
		left -= spanWidth;
	}
	return fitted;
}

// The id of Ticket `number`'s row, which the Tickets pane scrolls to.
const ticketRowId = (number: string) => `ticket-row-${number}`;

// Every Ticket of the Goal, one row each, `width` columns wide with its
// border and as tall as its parent leaves it: its symbol, number, state word
// and title, the `selected`th in the selection's colours and scrolled into
// view.
function TicketsPane(props: {
	tickets: GoalTicket[];
	selected: number;
	width: number;
}): JSX.Element {
	const { color, symbol, border, selection } = theme();
	let list: ScrollBoxRenderable | undefined;
	createEffect(() => {
		const ticket = props.tickets[props.selected];
		if (ticket !== undefined)
			list?.scrollChildIntoView(ticketRowId(ticket.number));
	});
	return (
		<box
			border
			customBorderChars={border}
			borderColor={color.border}
			title=" Tickets "
			bottomTitle={` ${props.selected + 1}/${props.tickets.length} `}
			bottomTitleAlignment="right"
			paddingLeft={1}
			paddingRight={1}
			flexGrow={1}
		>
			<scrollbox
				ref={(box: ScrollBoxRenderable) => {
					list = box;
				}}
				flexGrow={1}
				verticalScrollbarOptions={{ visible: false }}
			>
				<For each={props.tickets}>
					{(ticket, index) => {
						const selected = () => index() === props.selected;
						// The selected row is drawn in the selection's colours
						// throughout, so its own colours don't fight the highlight.
						const fg = (own: ColorInput) => (selected() ? selection.fg : own);
						const markStyle = () =>
							selected() ? { fg: selection.fg } : ticketMarkStyle(ticket.mark);
						const spans = () =>
							fitSpans(
								[
									{
										text: `${symbol[ticket.mark]} `,
										style: markStyle(),
									},
									{ text: `${ticket.number} `, style: { fg: fg(color.fg) } },
									{
										text:
											ticket.stateWord === "" ? "" : `${ticket.stateWord}  `,
										style: markStyle(),
									},
									{ text: ticket.title, style: { fg: fg(color.fg) } },
								],
								props.width - paneEdges,
							);
						return (
							<text
								id={ticketRowId(ticket.number)}
								fg={fg(color.fg)}
								bg={selected() ? selection.bg : undefined}
								attributes={selected() ? selection.attributes : 0}
								flexShrink={0}
								wrapMode="none"
							>
								<For each={spans()}>
									{(span) => <span style={span.style}>{span.text}</span>}
								</For>
							</text>
						);
					}}
				</For>
			</scrollbox>
		</box>
	);
}

// The selected Ticket, `width` columns wide with its border: its title,
// the Tickets it comes after, its Workflow's Steps marked, or why the
// Workflow can't be read, and its text wrapped to the pane, scrolled by the
// wheel. Its Runs' totals sit on its border.
function TicketPane(props: { ticket: GoalTicket; width: number }): JSX.Element {
	const { color, symbol, border, dimText } = theme();
	const inner = () => props.width - paneEdges;
	const totals = () =>
		[
			`${props.ticket.runs.length} ${props.ticket.runs.length === 1 ? "Run" : "Runs"}`,
			duration(props.ticket.runsMs),
			money(props.ticket.costUsd),
		].join(` ${symbol.sep} `);
	return (
		<box
			border
			customBorderChars={border}
			borderColor={color.border}
			title={` Ticket ${props.ticket.number} `}
			bottomTitle={` ${totals()} `}
			bottomTitleAlignment="right"
			paddingLeft={1}
			paddingRight={1}
			flexGrow={1}
		>
			<For each={wrapText(props.ticket.title, inner())}>
				{(line) => (
					<text
						fg={color.fg}
						attributes={TextAttributes.BOLD}
						flexShrink={0}
						wrapMode="none"
					>
						{line}
					</text>
				)}
			</For>
			<Show when={props.ticket.blockedBy.length > 0}>
				<text {...dimText} flexShrink={0} wrapMode="none">
					{fitText(`after ${props.ticket.blockedBy.join(", ")}`, inner())}
				</text>
			</Show>
			<box height={1} flexShrink={0} />
			<For each={stepLines(props.ticket.steps, inner())}>
				{(line) => (
					<text fg={color.fg} flexShrink={0} wrapMode="none">
						<For each={line}>
							{(step, index) => {
								const look = stepMarkLook(step.mark);
								return (
									<>
										<Show when={index() > 0}>{stepGap}</Show>
										<span style={look.style}>{look.symbol}</span>
										<span style={{ fg: color.fg }}>{` ${step.id}`}</span>
									</>
								);
							}}
						</For>
					</text>
				)}
			</For>
			<Show when={props.ticket.workflowProblem !== undefined}>
				<For each={wrapText(props.ticket.workflowProblem ?? "", inner())}>
					{(line) => (
						<text {...dimText} flexShrink={0} wrapMode="none">
							{line}
						</text>
					)}
				</For>
			</Show>
			<box height={1} flexShrink={0} />
			<scrollbox flexGrow={1} verticalScrollbarOptions={{ visible: false }}>
				<For
					each={props.ticket.description.flatMap((paragraph) =>
						wrapText(paragraph, inner()),
					)}
				>
					{(line) => (
						<text fg={color.fg} flexShrink={0} wrapMode="none">
							{line}
						</text>
					)}
				</For>
			</scrollbox>
		</box>
	);
}

// The space between two marked Steps on a line.
const stepGap = "  ";

// `steps` broken into lines of at most `width` columns between Steps, each
// Step its mark, a space and its id. A Step wider than `width` gets a line
// of its own, cut by the pane.
function stepLines(steps: GoalTicketStep[], width: number): GoalTicketStep[][] {
	const lines: GoalTicketStep[][] = [];
	let line: GoalTicketStep[] = [];
	let lineWidth = 0;
	for (const step of steps) {
		const stepWidth = 2 + Bun.stringWidth(step.id);
		const joined =
			line.length === 0 ? stepWidth : lineWidth + stepGap.length + stepWidth;
		if (line.length > 0 && joined > width) {
			lines.push(line);
			line = [];
			lineWidth = stepWidth;
		} else {
			lineWidth = joined;
		}
		line.push(step);
	}
	if (line.length > 0) lines.push(line);
	return lines;
}

// The id of Run `index`'s row, which the Runs pane scrolls to.
const runRowId = (index: number) => `run-row-${index}`;

// The width of a Run row's position, with the space after it.
const positionWidth = 3;

// The Runs of `ticket`, `width` columns wide and `height` rows tall with its
// border, one `RunLine` each led by its position. The `selected`th is bold
// and scrolled into view.
function RunsPane(props: {
	ticket: GoalTicket | undefined;
	selected: number;
	standing: GoalStanding;
	width: number;
	height: number;
}): JSX.Element {
	const { color, border, dimText } = theme();
	let list: ScrollBoxRenderable | undefined;
	const showSelected = () =>
		list?.scrollChildIntoView(runRowId(props.selected));
	createEffect(showSelected);
	const runs = () => props.ticket?.runs ?? [];
	return (
		<box
			border
			customBorderChars={border}
			borderColor={color.border}
			title={
				props.ticket === undefined
					? " Runs "
					: ` Runs of Ticket ${props.ticket.number} `
			}
			paddingLeft={1}
			paddingRight={1}
			height={props.height}
			flexShrink={0}
		>
			<Show
				when={runs().length > 0}
				fallback={
					<text {...dimText} flexShrink={0} wrapMode="none">
						{fitText("No Run yet.", props.width - paneEdges)}
					</text>
				}
			>
				<scrollbox
					ref={(box: ScrollBoxRenderable) => {
						list = box;
					}}
					flexGrow={1}
					verticalScrollbarOptions={{ visible: false }}
				>
					<For each={runs()}>
						{(run, index) => (
							// A row has no place until it is first laid out, which
							// its box, unlike a text, reports, so the selected Run is
							// scrolled to again then.
							<box
								id={runRowId(index())}
								flexShrink={0}
								onSizeChange={() => {
									if (index() === props.selected) showSelected();
								}}
							>
								<RunLine
									lead={`${index() + 1}`.padEnd(positionWidth)}
									run={run}
									standing={props.standing}
									width={props.width - paneEdges}
									bold={index() === props.selected}
								/>
							</box>
						)}
					</For>
				</scrollbox>
			</Show>
		</box>
	);
}

// The `selected`th Run of `ticket` across the screen, titled with its
// position, Ticket and Step, its outcome, duration and, for an agent Step,
// cost on its border. A shell Step's Run shows its log, scrolled by the
// wheel.
function RunPane(props: {
	ticket: GoalTicket | undefined;
	selected: number;
	standing: GoalStanding;
}): JSX.Element {
	const { color, symbol, border, dimText } = theme();
	const run = () => props.ticket?.runs[props.selected];
	// Read again each time the Goal is, so a growing log shows what it adds.
	// The path comes back with the text, so another Run's log never shows
	// under this one's title while this one is read.
	const [log] = createResource(run, async ({ log }: GoalTicketRun) => ({
		log,
		text: Bun.stripANSI(await readRunLog(log)).trimEnd(),
	}));
	const title = () => {
		const shown = run();
		return shown === undefined
			? " Run "
			: ` Run ${props.selected + 1} ${symbol.sep} ${props.ticket?.number} ${shown.step} `;
	};
	const numbers = () => {
		const shown = run();
		if (shown === undefined) return "";
		return ` ${[
			runMarkLook(shown.outcome, props.standing).text,
			duration(shown.durationMs),
			...(shown.costUsd === undefined ? [] : [money(shown.costUsd)]),
		].join(` ${symbol.sep} `)} `;
	};
	return (
		<box
			border
			customBorderChars={border}
			borderColor={color.border}
			title={title()}
			bottomTitle={numbers()}
			bottomTitleAlignment="right"
			paddingLeft={1}
			paddingRight={1}
			flexGrow={1}
		>
			<Show
				when={run()}
				fallback={
					<text {...dimText} flexShrink={0}>
						No Run yet.
					</text>
				}
			>
				{(shown: () => GoalTicketRun) => (
					<Show
						when={shown().stepType === "shell"}
						fallback={
							// TODO 05: the agent's activity, condensed by its Harness.
							<text {...dimText} flexShrink={0}>
								An agent Run's activity shows here soon.
							</text>
						}
					>
						<scrollbox
							flexGrow={1}
							verticalScrollbarOptions={{ visible: false }}
						>
							<text fg={color.fg} wrapMode="word">
								{log.latest?.log === shown().log ? log.latest.text : ""}
							</text>
						</scrollbox>
					</Show>
				)}
			</Show>
		</box>
	);
}
