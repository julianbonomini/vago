// The Goal view: one Goal's header, its Tickets and the selected Ticket's
// text, opened from the Project view. Hides the panes' layout, which Ticket
// is selected and how the keys move it.

import {
	type ColorInput,
	type ScrollBoxRenderable,
	TextAttributes,
} from "@opentui/core";
import { type JSX, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { type GoalRow, ticketTotal } from "./goal-rows.ts";
import type { GoalTicket } from "./goal-tickets.ts";
import {
	type FooterKey,
	type HelpKey,
	KeyFooter,
	KeyHelp,
} from "./screen-keys.tsx";
import { fitText, wrapText } from "./text-fit.ts";
import { goalColor, theme, ticketMarkStyle } from "./theme.ts";
import { TicketBar } from "./ticket-bar.tsx";
import { duration, money, tokenCount } from "./time-and-money.ts";

/**
 * The Goal view of the Goal `row` shows, the `position`th of `count` Goals
 * in the Project list: a header box with the Goal's progress and numbers,
 * its Tickets on the left with `n/N` on their border, and the selected
 * Ticket's title, blockers and text on the right. The Ticket the Goal is on
 * starts selected, the first not done or else the last, and ↑↓ and j k move
 * the selection. A footer names the keys, and `?` shows them all until `?`
 * or Esc. Esc otherwise calls `onClose`.
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
	const [helpShown, setHelpShown] = createSignal(false);
	// Clamped, not wrapped, so holding a key stops at the end of the list.
	const select = (index: number) => {
		const tickets = props.row.tickets;
		const ticket = tickets[Math.max(0, Math.min(tickets.length - 1, index))];
		if (ticket !== undefined) setChosen(ticket.number);
	};
	useKeyboard((key) => {
		if (key.name === "?") setHelpShown(!helpShown());
		else if (key.name === "escape" && helpShown()) setHelpShown(false);
		else if (key.name === "escape") props.onClose();
		else if (helpShown()) return;
		else if (key.name === "up" || key.name === "k") select(selectedIndex() - 1);
		else if (key.name === "down" || key.name === "j")
			select(selectedIndex() + 1);
	});
	const ticketsWidth = () => Math.floor(terminal().width * ticketsShare);
	return (
		<box flexDirection="column" flexGrow={1}>
			<GoalHeader
				row={props.row}
				position={props.position}
				count={props.count}
				width={terminal().width}
				height={terminal().height}
			/>
			<box flexDirection="row" flexGrow={1}>
				<TicketsPane
					tickets={props.row.tickets}
					selected={selectedIndex()}
					width={ticketsWidth()}
				/>
				<Show when={props.row.tickets[selectedIndex()]}>
					{(ticket: () => GoalTicket) => (
						<TicketPane
							ticket={ticket()}
							width={terminal().width - ticketsWidth()}
						/>
					)}
				</Show>
			</box>
			<box flexShrink={0} paddingLeft={1} paddingRight={1}>
				<KeyFooter
					keys={footerKeys(symbol.upDown)}
					width={terminal().width - 2}
				/>
			</box>
			<Show when={helpShown()}>
				<KeyHelp keys={helpKeys(symbol.upDown)} />
			</Show>
		</box>
	);
}

// `q` and Ctrl-C belong to `tui.tsx`, which quits on them on every screen.
// `upDown` names the arrow keys.
const footerKeys = (upDown: string): FooterKey[] => [
	{ keys: upDown, label: "Ticket", use: 4 },
	{ keys: "Esc", label: "Goals", use: 3 },
	{ keys: "?", label: "Help", use: 2 },
	{ keys: "q", label: "Quit", use: 1 },
];

const helpKeys = (upDown: string): HelpKey[] => [
	{ keys: `${upDown} j k`, meaning: "select the Ticket above, below" },
	{ keys: "wheel", meaning: "scroll the pane under the pointer" },
	{ keys: "Esc", meaning: "back to the Goals" },
	{ keys: "? Esc", meaning: "show, hide these keys" },
	{ keys: "q Ctrl-C", meaning: "quit" },
];

// The share of the screen's width the Tickets pane takes; the Ticket pane
// takes the rest.
const ticketsShare = 0.4;
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
// border: its symbol, number, state word and title, the `selected`th in the
// selection's colours and scrolled into view.
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
			width={props.width}
			flexShrink={0}
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
// the Tickets it comes after, and its text wrapped to the pane, scrolled by
// the wheel.
function TicketPane(props: { ticket: GoalTicket; width: number }): JSX.Element {
	const { color, border, dimText } = theme();
	const inner = () => props.width - paneEdges;
	return (
		<box
			border
			customBorderChars={border}
			borderColor={color.border}
			title={` Ticket ${props.ticket.number} `}
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
