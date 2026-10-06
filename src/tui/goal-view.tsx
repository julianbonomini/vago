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
	createMemo,
	createSignal,
	For,
	on,
	onCleanup,
	Show,
} from "solid-js";
import {
	findHarness,
	knownHarness,
	type RunActivity,
	type RunToolCalls,
} from "../harness/registry.ts";
import { readRunLog } from "../tickets/tickets.ts";
import { type GoalRow, ticketTotal } from "./goal-rows.ts";
import { startGoal } from "./goal-start.ts";
import type {
	GoalTicket,
	GoalTicketRun,
	GoalTicketStep,
} from "./goal-tickets.ts";
import { sharedLine, usePane } from "./pane-grid.ts";
import { PaneTitle } from "./pane-title.tsx";
import {
	activityItemId,
	editIndexes,
	RunActivityLines,
	RunDiffLines,
} from "./run-activity.tsx";
import { RunLine } from "./run-line.tsx";
import {
	type FooterKey,
	type HelpKey,
	KeyFooter,
	KeyHelp,
} from "./screen-keys.tsx";
import { fitSpans, fitText, wrapText } from "./text-fit.ts";
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
 * The Goal view of the Goal `row` shows, of the Project at `root`, the
 * `position`th of `count` Goals in the Project list. Under the Project
 * view's header line and a rule under it sit the Goal's name, its
 * numbers with its place in the list, and its one-row progress bar. Below
 * the line under them come its Tickets on the left with `n/N` on their
 * border and the selected Ticket's Runs under them, three quarters and a
 * quarter of that column whatever the Runs, the selected Ticket's title,
 * blockers and text on the right, and the selected Run across the bottom.
 * The Ticket the Goal is on starts selected, the first not done or else the
 * last. A Ticket starts on its latest Run, and ←→ and h l move to
 * the one before or after from any pane. One pane has the focus, the
 * Tickets at first, its border in the accent: Tab and Shift+Tab move it on
 * and back, and 1 to 4 put it on the Tickets, the Runs, the Ticket or the
 * Run. ↑↓ and j k move in the focused pane: the selected Ticket or Run, or
 * the Ticket's text or the Run by a line. Space, PgUp and PgDn page the
 * Ticket's text when it has the focus and the Run otherwise. `t` gives the
 * Ticket the whole screen and `r` the Run, with the focus, which stays on it
 * until Esc. A click on a Ticket or a Run selects it, and a click on a pane
 * focuses it. A footer names the keys, and `?` shows them all until `?` or
 * Esc. Esc otherwise closes the whole screen, then calls `onClose`. `[` and
 * `]` call `onNeighbour` with -1 and 1, to open the Goal before or after.
 * `s` starts the Goal in a `vago run` of its own, through the command `vago`
 * (`startGoal`), and the footer says what came of it until the next key.
 * `e` selects the shown Run's latest edit, then the edit before it, and `E`
 * the one after, scrolled into view; `d` shows the selected edit's diff in
 * place of the Run, the latest edit's when none is selected, until `d` or
 * Esc.
 */
export function GoalView(props: {
	root: string;
	vago: string[];
	row: GoalRow;
	position: number;
	count: number;
	onClose: () => void;
	onNeighbour: (step: -1 | 1) => void;
}): JSX.Element {
	const { color, symbol } = theme();
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
	const run = () => ticket()?.runs[runIndex()];
	const log = liveRunLog(run);
	// A log whose Harness this build doesn't know shows as text.
	const activity = createMemo(() => {
		const harness = run()?.harness;
		const text = log()?.text;
		if (harness === undefined || !knownHarness(harness)) return undefined;
		if (text === undefined) return undefined;
		return findHarness(harness).runActivity(text.split("\n"), props.root);
	});
	// The edit picked in the Run whose log is `log`, by its item's index, and
	// whether its diff shows. Another Run has neither.
	const [chosenEdit, setChosenEdit] = createSignal<{
		log: string;
		item: number;
		diff: boolean;
	}>();
	const shownEdit = () => {
		const chosen = chosenEdit();
		return chosen?.log === run()?.log ? chosen : undefined;
	};
	const selectedEdit = () => shownEdit()?.item;
	// The selected edit while its diff shows. A live Run's items can shift
	// under the selection, so the item is checked to be an edit still.
	const diffEdit = () => {
		const chosen = shownEdit();
		const shown = activity();
		if (chosen?.diff !== true || shown === undefined) return undefined;
		const item = shown.items[chosen.item];
		return item?.kind === "tool-calls" &&
			editIndexes(shown).includes(chosen.item)
			? item
			: undefined;
	};
	const diffOpen = () => diffEdit() !== undefined;
	// One edit back for -1 and on for 1, from the latest when none is
	// selected, keeping the diff shown or not.
	const moveEdit = (step: -1 | 1) => {
		const shown = activity();
		const logPath = run()?.log;
		if (shown === undefined || logPath === undefined) return;
		const edits = editIndexes(shown);
		const at = edits.indexOf(selectedEdit() ?? -1);
		const item =
			at === -1 ? edits.at(-1) : edits[clamp(at + step, edits.length)];
		if (item === undefined) return;
		setChosenEdit({ log: logPath, item, diff: diffOpen() });
		runBox?.scrollChildIntoView(activityItemId(item));
	};
	const showDiff = (diff: boolean) => {
		if (selectedEdit() === undefined) moveEdit(-1);
		const chosen = shownEdit();
		if (chosen !== undefined) setChosenEdit({ ...chosen, diff });
	};
	const [helpShown, setHelpShown] = createSignal(false);
	const [notice, setNotice] = createSignal<string>();
	const [focus, setFocus] = createSignal<GoalViewPane>("tickets");
	const [fullScreen, setFullScreen] = createSignal<"ticket" | "run">();
	// The scrollboxes of the Ticket's text and the shown Run, which the keys
	// scroll.
	let ticketBox: ScrollBoxRenderable | undefined;
	let runBox: ScrollBoxRenderable | undefined;
	let diffBox: ScrollBoxRenderable | undefined;
	// The Run pane's scrollbox the keys scroll: the diff's while it shows.
	const runScroll = () => (diffOpen() ? diffBox : runBox);
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
	// One line, or one Ticket or Run, back for -1 and on for 1.
	const moveInFocus = (step: number) => {
		const pane = focus();
		if (pane === "tickets") select(selectedIndex() + step);
		else if (pane === "runs") selectRun(runIndex() + step);
		else (pane === "ticket" ? ticketBox : runScroll())?.scrollBy(step);
	};
	// The lists have nothing to page, so from them the Run pages.
	const page = (pages: number) =>
		(focus() === "ticket" ? ticketBox : runScroll())?.scrollBy(
			pages,
			"viewport",
		);
	// A click on `pane`, or on a Ticket or Run in it, which `pick` selects.
	// The help screen hides what is under it, so a click there does nothing.
	const click = (pane: GoalViewPane, pick?: () => void) => {
		if (helpShown()) return;
		pick?.();
		setFocus(pane);
	};
	const openFullScreen = (pane: "ticket" | "run") => {
		setFullScreen(pane);
		setFocus(pane);
	};
	useKeyboard((key) => {
		// The pane 1 to 4 name, undefined for any other key.
		const numbered = paneOrder[Number(key.name) - 1];
		setNotice(undefined);
		if (key.name === "?") setHelpShown(!helpShown());
		else if (key.name === "escape" && helpShown()) setHelpShown(false);
		else if (key.name === "escape" && diffOpen()) showDiff(false);
		else if (key.name === "escape" && fullScreen() !== undefined)
			setFullScreen(undefined);
		else if (key.name === "escape") props.onClose();
		else if (helpShown()) return;
		// The whole screen keeps the focus on the one pane it shows.
		else if (fullScreen() !== undefined && (key.name === "tab" || numbered))
			return;
		else if (key.name === "tab") {
			const step = key.shift ? paneOrder.length - 1 : 1;
			const next = (paneOrder.indexOf(focus()) + step) % paneOrder.length;
			setFocus(paneOrder[next] ?? "tickets");
		} else if (numbered !== undefined) setFocus(numbered);
		else if (key.name === "[") props.onNeighbour(-1);
		else if (key.name === "]") props.onNeighbour(1);
		else if (key.name === "s")
			setNotice(startGoal(props.vago, props.root, props.row));
		// The selected edit is filled only in the focused pane, so picking
		// one focuses the Run.
		else if (key.name === "e") {
			setFocus("run");
			moveEdit(key.shift ? 1 : -1);
		} else if (key.name === "d") {
			setFocus("run");
			showDiff(!diffOpen());
		} else if (key.name === "t") openFullScreen("ticket");
		else if (key.name === "r") openFullScreen("run");
		else if (key.name === "up" || key.name === "k") moveInFocus(-1);
		else if (key.name === "down" || key.name === "j") moveInFocus(1);
		else if (key.name === "space" || key.name === "pagedown") page(1);
		else if (key.name === "pageup") page(-1);
		else if (key.name === "left" || key.name === "h") selectRun(runIndex() - 1);
		else if (key.name === "right" || key.name === "l")
			selectRun(runIndex() + 1);
		else if (key.name === "g" && key.shift)
			runBox?.scrollTo(runBox.scrollHeight);
	});
	const lost = () => props.row.standing === "lost";
	const ticketsWidth = () => Math.floor(terminal().width * ticketsShare);
	const topRows = () =>
		Math.round(
			(terminal().height - headerRows - goalHeaderRows(lost()) - footerRows) *
				topShare,
		);
	// Each pane of the left column counts its top line and its rows; the line
	// under the column is the Run pane's. Set by the screen alone, so neither
	// pane moves as Runs appear.
	const runsRows = () =>
		Math.max(
			minRunsRows,
			Math.round((topRows() - sharedLine) * runsShare) + sharedLine,
		);
	return (
		<box flexDirection="column" flexGrow={1}>
			<text fg={color.border} flexShrink={0} wrapMode="none">
				{symbol.rule.repeat(terminal().width)}
			</text>
			<GoalHeader
				row={props.row}
				position={props.position}
				count={props.count}
				width={terminal().width}
			/>
			{/* A pane off the whole screen is hidden, not dropped, so it keeps
			    its scroll and its Run's log. Each box under or beside another
			    pane overlaps it by its shared line. */}
			<box
				flexDirection="row"
				visible={fullScreen() !== "run"}
				height={fullScreen() === "ticket" ? undefined : topRows()}
				flexGrow={fullScreen() === "ticket" ? 1 : 0}
				flexShrink={0}
			>
				<box
					flexDirection="column"
					visible={fullScreen() === undefined}
					width={ticketsWidth()}
					flexShrink={0}
				>
					<TicketsPane
						tickets={props.row.tickets}
						selected={selectedIndex()}
						width={ticketsWidth()}
						focused={focus() === "tickets"}
						onClick={() => click("tickets")}
						onPick={(index) => click("tickets", () => select(index))}
					/>
					<RunsPane
						ticket={ticket()}
						selected={runIndex()}
						width={ticketsWidth()}
						height={runsRows()}
						focused={focus() === "runs"}
						onClick={() => click("runs")}
						onPick={(index) => click("runs", () => selectRun(index))}
					/>
				</box>
				<Show when={ticket()}>
					{(ticket: () => GoalTicket) => (
						<TicketPane
							ticket={ticket()}
							width={
								fullScreen() === "ticket"
									? terminal().width
									: terminal().width - ticketsWidth() + sharedLine
							}
							besideTickets={fullScreen() !== "ticket"}
							focused={focus() === "ticket"}
							onClick={() => click("ticket")}
							scrollRef={(box) => {
								ticketBox = box;
							}}
						/>
					)}
				</Show>
			</box>
			<box
				flexGrow={1}
				marginTop={fullScreen() === "run" ? 0 : -sharedLine}
				visible={fullScreen() !== "ticket"}
			>
				<RunPane
					ticket={ticket()}
					selected={runIndex()}
					log={log()?.text}
					activity={activity()}
					selectedEdit={selectedEdit()}
					diff={diffEdit()}
					width={terminal().width}
					focused={focus() === "run"}
					onClick={() => click("run")}
					scrollRef={(box) => {
						runBox = box;
					}}
					diffRef={(box) => {
						diffBox = box;
					}}
				/>
			</box>
			<box flexShrink={0} paddingLeft={1} paddingRight={1}>
				<KeyFooter
					keys={footerKeys(symbol.upDown, symbol.leftRight)}
					width={terminal().width - 2}
					notice={notice()}
				/>
			</box>
			<Show when={helpShown()}>
				<KeyHelp keys={helpKeys(symbol.upDown, symbol.leftRight)} />
			</Show>
		</box>
	);
}

// The panes the focus moves through, in the order of Tab and of 1 to 4.
type GoalViewPane = "tickets" | "runs" | "ticket" | "run";
const paneOrder: GoalViewPane[] = ["tickets", "runs", "ticket", "run"];

// `q` and Ctrl-C belong to `tui.tsx`, which quits on them on every screen.
// `upDown` and `leftRight` name the arrow keys.
const footerKeys = (upDown: string, leftRight: string): FooterKey[] => [
	{ keys: upDown, label: "Move", use: 5 },
	{ keys: leftRight, label: "Run", use: 4 },
	{ keys: "Tab", label: "Pane", use: 3 },
	{ keys: "PgUp PgDn", label: "Scroll", use: 3 },
	{ keys: "[ ]", label: "Goal", use: 2 },
	{ keys: "s", label: "Start", use: 2 },
	{ keys: "t r", label: "Full screen", use: 2 },
	{ keys: "G", label: "Follow", use: 2 },
	{ keys: "e d", label: "Diff", use: 2 },
	{ keys: "Esc", label: "Goals", use: 3 },
	// Kept over the rest at small sizes, since it names what drops out.
	{ keys: "?", label: "Help", use: 3 },
	{ keys: "q", label: "Quit", use: 1 },
];

const helpKeys = (upDown: string, leftRight: string): HelpKey[] => [
	{ keys: `${upDown} j k`, meaning: "move in the focused pane" },
	{ keys: `${leftRight} h l`, meaning: "select the Run before, after" },
	{ keys: "Tab", meaning: "focus the next pane, Shift the previous" },
	{ keys: "1 2 3 4", meaning: "focus the Tickets, Runs, Ticket, Run" },
	{ keys: "Space PgDn", meaning: "page the focused Ticket, else the Run" },
	{ keys: "PgUp", meaning: "page back" },
	{ keys: "t r", meaning: "Ticket, Run full screen" },
	{ keys: "G", meaning: "follow the live Run again" },
	{ keys: "e E", meaning: "select the Run's edit before, after" },
	{ keys: "d", meaning: "show, hide the selected edit's diff" },
	{ keys: "[ ]", meaning: "open the Goal before, after" },
	{ keys: "s", meaning: "start this Goal in vago run" },
	{ keys: "click", meaning: "select the Ticket or Run, focus the pane" },
	{ keys: "wheel", meaning: "scroll the pane under the pointer" },
	{ keys: "Esc", meaning: "close the diff, full screen, then the Goals" },
	{ keys: "? Esc", meaning: "show, hide these keys" },
	{ keys: "q Ctrl-C", meaning: "quit" },
];

// The share of the screen's width the Tickets and Runs panes take; the
// Ticket pane takes the rest.
const ticketsShare = 0.4;
// The share of the rows between the header area and the footer that the
// Tickets, Runs and Ticket panes take; the Run pane takes the rest.
const topShare = 0.62;
// The share of the left column the Runs pane takes, the Tickets pane the
// rest, and the fewest rows it keeps: its lines, its title and one Run.
const runsShare = 0.25;
const minRunsRows = 4;
// A box's border and padding, on both sides.
const paneEdges = 4;
// The Project view's header line over the Goal view with the rule under it,
// and the footer.
const headerRows = 2;
const footerRows = 1;

// The Goal's rows in the header area: its name, its numbers, its bar, and,
// while the Goal is lost, the line saying so.
const goalHeaderRows = (lost: boolean) => (lost ? 4 : 3);

// The Goal's rows under the Project's header line, `width` columns wide and
// inset by a space like it: the Goal's symbol and name in its standing's
// colour and its title, then its numbers and its place in the Project list,
// labels dim and values bold, then its progress bar, and for a lost Goal a
// line saying no `vago run` runs it.
function GoalHeader(props: {
	row: GoalRow;
	position: number;
	count: number;
	width: number;
}): JSX.Element {
	const { color, symbol, dimSpan } = theme();
	// Inside the space on both sides.
	const inner = () => props.width - 2;
	const done = () => `  ${props.row.ticketCounts.done}`;
	const total = () => `/${ticketTotal(props.row.ticketCounts)} Tickets`;
	const value = (text: string, fg: ColorInput = color.fg) => ({
		text,
		style: { fg, bold: true },
	});
	const label = (text: string) => ({ text, style: dimSpan });
	const name = () =>
		fitSpans(
			[
				value(
					`${symbol[props.row.standing]} ${props.row.goal}`,
					goalColor(props.row.standing),
				),
				{ text: `  ${props.row.title}`, style: { fg: color.fg } },
			],
			inner(),
		);
	const numbers = () =>
		fitSpans(
			[
				value(props.row.standing.toUpperCase(), goalColor(props.row.standing)),
				label("   "),
				value(duration(props.row.runMs)),
				label(" run time   "),
				value(tokenCount(props.row.tokens)),
				label(" tokens   "),
				value(money(props.row.costUsd)),
				label("   Workflow "),
				value(props.row.workflow),
				label("   Goal "),
				value(`${props.position} of ${props.count}`),
			],
			inner(),
		);
	return (
		<box paddingLeft={1} paddingRight={1} flexShrink={0}>
			<For each={[name(), numbers()]}>
				{(line) => (
					<text fg={color.fg} flexShrink={0} wrapMode="none">
						<For each={line}>
							{(span) => <span style={span.style}>{span.text}</span>}
						</For>
					</text>
				)}
			</For>
			<text fg={color.fg} flexShrink={0} wrapMode="none">
				<TicketBar
					tickets={props.row.ticketCounts}
					standing={props.row.standing}
					width={Math.max(0, inner() - done().length - total().length)}
					selected={false}
				/>
				<span style={{ fg: color.fg, bold: true }}>{done()}</span>
				<span style={dimSpan}>{total()}</span>
			</text>
			<Show when={props.row.standing === "lost"}>
				<text fg={color.warn} flexShrink={0} wrapMode="none">
					{fitText(
						`${symbol.lost} No vago run process runs this Goal; the next records its open Run as lost.`,
						inner(),
					)}
				</text>
			</Show>
		</box>
	);
}

// The id of Ticket `number`'s row, which the Tickets pane scrolls to.
const ticketRowId = (number: string) => `ticket-row-${number}`;

// Every Ticket of the Goal, one row each, `width` columns wide with its
// border and as tall as its parent leaves it: its symbol, number, state word
// and title, the `selected`th scrolled into view and in the selection's
// colours when `focused`, else the idle selection's, the title in the focus look when
// `focused`. A click anywhere on it calls
// `onClick`, and on a Ticket `onPick` first, with that Ticket's index.
function TicketsPane(props: {
	tickets: GoalTicket[];
	selected: number;
	width: number;
	focused: boolean;
	onClick: () => void;
	onPick: (index: number) => void;
}): JSX.Element {
	const { color, symbol, selection, idleSelection } = theme();
	let list: ScrollBoxRenderable | undefined;
	createEffect(() => {
		const ticket = props.tickets[props.selected];
		if (ticket !== undefined)
			list?.scrollChildIntoView(ticketRowId(ticket.number));
	});
	const pane = usePane();
	return (
		<box
			ref={pane}
			border
			paddingLeft={1}
			paddingRight={1}
			flexGrow={1}
			onMouseDown={props.onClick}
		>
			<PaneTitle
				title="Tickets"
				aside={`${props.selected + 1}/${props.tickets.length}`}
				focused={props.focused}
				width={props.width - paneEdges}
			/>
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
						const filled = () => selected() && props.focused;
						// The filled row is drawn in the selection's colours
						// throughout, so its own colours don't fight the highlight.
						const fg = (own: ColorInput) => (filled() ? selection.fg : own);
						const markStyle = () =>
							filled() ? { fg: selection.fg } : ticketMarkStyle(ticket.mark);
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
								onMouseDown={() => props.onPick(index())}
								fg={fg(color.fg)}
								bg={
									filled()
										? selection.bg
										: selected()
											? idleSelection.bg
											: undefined
								}
								attributes={
									filled()
										? selection.attributes
										: selected()
											? idleSelection.attributes
											: 0
								}
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

// The selected Ticket, `width` columns wide with its border, its left edge
// the Tickets' right one when `besideTickets`: its title, the Tickets it
// comes after, its Workflow's Steps marked, or why the Workflow can't be
// read, and its text wrapped to the pane, all of it scrolled by the wheel and
// in `scrollRef`'s scrollbox. Its Runs' totals sit on its title row, the
// title in the focus look when `focused`. A click on it calls `onClick`.
function TicketPane(props: {
	ticket: GoalTicket;
	width: number;
	besideTickets: boolean;
	focused: boolean;
	onClick: () => void;
	scrollRef: (box: ScrollBoxRenderable) => void;
}): JSX.Element {
	const { color, symbol, dimText } = theme();
	const inner = () => props.width - paneEdges;
	const totals = () =>
		[
			`${props.ticket.runs.length} ${props.ticket.runs.length === 1 ? "Run" : "Runs"}`,
			duration(props.ticket.runsMs),
			money(props.ticket.costUsd),
		].join(` ${symbol.sep} `);
	const pane = usePane();
	return (
		<box
			ref={pane}
			border
			marginLeft={props.besideTickets ? -sharedLine : 0}
			paddingLeft={1}
			paddingRight={1}
			flexGrow={1}
			onMouseDown={props.onClick}
		>
			<PaneTitle
				title={`Ticket ${props.ticket.number}`}
				aside={totals()}
				focused={props.focused}
				width={inner()}
			/>
			<scrollbox
				ref={props.scrollRef}
				flexGrow={1}
				verticalScrollbarOptions={{ visible: false }}
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
									// A function, so a Step whose mark changes in place is
									// drawn again.
									const look = () => stepMarkLook(step.mark);
									return (
										<>
											<Show when={index() > 0}>{stepGap}</Show>
											<span style={look().style}>{look().symbol}</span>
											<span style={{ fg: color.fg }}>{` ${step.name}`}</span>
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
		const stepWidth = 2 + Bun.stringWidth(step.name);
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
// border, one `RunLine` each led by its position, the title in the focus
// look when `focused`. The `selected`th is scrolled into view, in the
// selection's colours when `focused`, else the idle selection's. A click
// anywhere on it calls `onClick`, and on a Run `onPick` first, with that
// Run's index.
function RunsPane(props: {
	ticket: GoalTicket | undefined;
	selected: number;
	width: number;
	height: number;
	focused: boolean;
	onClick: () => void;
	onPick: (index: number) => void;
}): JSX.Element {
	const { dimText } = theme();
	let list: ScrollBoxRenderable | undefined;
	// Scrolled by hand: OpenTUI's `scrollChildIntoView` leaves out a row as
	// tall as the viewport, which a one-Run pane is.
	const showSelected = () => {
		const row = list?.content.findDescendantById(runRowId(props.selected));
		if (list === undefined || row === undefined) return;
		// The scroll that puts the row's top at the viewport's top, and the one
		// that puts its bottom at the viewport's bottom.
		const showTop = row.y - list.viewport.y + list.scrollTop;
		const showBottom = showTop + row.height - list.viewport.height;
		if (showTop < list.scrollTop) list.scrollTo(showTop);
		else if (showBottom > list.scrollTop) list.scrollTo(showBottom);
	};
	createEffect(showSelected);
	const runs = () => props.ticket?.runs ?? [];
	// A narrow pane says only Runs.
	const title = () => {
		const long = `Runs of Ticket ${props.ticket?.number}`;
		return props.ticket === undefined || long.length > props.width - paneEdges
			? "Runs"
			: long;
	};
	const pane = usePane();
	return (
		<box
			ref={pane}
			border
			marginTop={-sharedLine}
			paddingLeft={1}
			paddingRight={1}
			height={props.height}
			flexShrink={0}
			onMouseDown={props.onClick}
		>
			<PaneTitle
				title={title()}
				focused={props.focused}
				width={props.width - paneEdges}
			/>
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
								onMouseDown={() => props.onPick(index())}
								onSizeChange={() => {
									if (index() === props.selected) showSelected();
								}}
							>
								<RunLine
									lead={`${index() + 1}`.padEnd(positionWidth)}
									run={run}
									width={props.width - paneEdges}
									selection={
										index() !== props.selected
											? undefined
											: props.focused
												? "focused"
												: "idle"
									}
								/>
							</box>
						)}
					</For>
				</scrollbox>
			</Show>
		</box>
	);
}

// How often the shown Run's log is read again: what it adds shows within
// this.
const refreshMs = 1000;

// The log of the Run `run` gives, as read so far.
type ShownLog = {
	/** The log's path, which tells one Run's log from another's. */
	log: string;
	text: string;
	/** The bytes of the log `text` holds, to skip on the next read. */
	end: number;
};

// The log of the Run `run` gives, undefined until the first read of it ends,
// so another Run's log never shows under this one's title. Read again every
// `refreshMs` for as long as the calling component lives, each read taking
// only what the log added since the last.
function liveRunLog(
	run: () => GoalTicketRun | undefined,
): () => ShownLog | undefined {
	const [shown, setShown] = createSignal<ShownLog>();
	let reading = false;
	const read = async () => {
		const log = run()?.log;
		if (log === undefined || reading) return;
		reading = true;
		try {
			const last = shown();
			const before = last?.log === log ? last : undefined;
			const piece = await readRunLog(log, before?.end ?? 0);
			if (before !== undefined && piece.added === "") return;
			setShown({
				log,
				text: (before?.text ?? "") + piece.added,
				end: piece.end,
			});
		} finally {
			reading = false;
		}
		// Another Run picked during the read is read now, not a refresh later.
		if (run()?.log !== log) read();
	};
	createEffect(on(() => run()?.log, read));
	const timer = setInterval(read, refreshMs);
	onCleanup(() => clearInterval(timer));
	return () => {
		const last = shown();
		return last?.log === run()?.log ? last : undefined;
	};
}

// The `selected`th Run of `ticket` across the screen, `width` columns wide
// with its border, titled with its position, Ticket and Step, its outcome,
// duration and, for an agent Step, cost beside the title, or while it is
// open its tokens and cost so far. An agent Step's Run shows its `activity`, the
// `selectedEdit`th item selected, or in its place the edit `diff`'s diff, and
// a shell Step's Run its `log` as text, both scrolled by the wheel, and
// both undefined until the log is first read. An open Run opens at its
// bottom and follows what it adds until scrolled up, and `scrollRef` gets
// each Run's scrollbox, to scroll it and to follow again by scrolling it to
// its bottom, and `diffRef` each diff's. The title is in the focus look and
// the selected edit filled when `focused`, and a click on it calls
// `onClick`.
function RunPane(props: {
	ticket: GoalTicket | undefined;
	selected: number;
	log: string | undefined;
	activity: RunActivity | undefined;
	selectedEdit: number | undefined;
	diff: RunToolCalls | undefined;
	width: number;
	focused: boolean;
	onClick: () => void;
	scrollRef: (box: ScrollBoxRenderable) => void;
	diffRef: (box: ScrollBoxRenderable) => void;
}): JSX.Element {
	const { color, symbol, dimText } = theme();
	const run = () => props.ticket?.runs[props.selected];
	const live = () => run()?.state === "live";
	const title = () => {
		const shown = run();
		return shown === undefined
			? "Run"
			: `Run ${props.selected + 1} ${symbol.sep} ${props.ticket?.number} ${shown.stepName}`;
	};
	const numbers = () => {
		const shown = run();
		if (shown === undefined) return "";
		const mark = runMarkLook(shown.state, shown.outcome).text;
		if (shown.state !== "ended") {
			const after = shown.state === "lost" ? "after " : "";
			const spent = props.activity?.spent;
			return [
				`${mark} ${after}${duration(shown.durationMs)}`,
				...(spent === undefined ? [] : [`${tokenCount(spent.tokens)} tokens`]),
				...(spent?.costUsd === undefined ? [] : [money(spent.costUsd)]),
			].join(` ${symbol.sep} `);
		}
		return [
			mark,
			duration(shown.durationMs),
			...(shown.costUsd === undefined ? [] : [money(shown.costUsd)]),
		].join(` ${symbol.sep} `);
	};
	const pane = usePane();
	return (
		<box
			ref={pane}
			border
			paddingLeft={1}
			paddingRight={1}
			flexGrow={1}
			onMouseDown={props.onClick}
		>
			<PaneTitle
				title={title()}
				aside={numbers()}
				focused={props.focused}
				width={props.width - paneEdges}
			/>
			<Show
				when={run()?.log}
				keyed
				fallback={
					<text {...dimText} flexShrink={0}>
						No Run yet.
					</text>
				}
			>
				{/* One scrollbox per Run, so each opens at its own top or bottom,
				    hidden, not dropped, under a diff, so it keeps its scroll. */}
				<scrollbox
					ref={props.scrollRef}
					flexGrow={1}
					visible={props.diff === undefined}
					stickyScroll={run()?.outcome === undefined}
					stickyStart="bottom"
					verticalScrollbarOptions={{ visible: false }}
				>
					<Show
						when={props.activity}
						fallback={
							<text fg={color.fg} wrapMode="word">
								{Bun.stripANSI(props.log ?? "").trimEnd()}
							</text>
						}
					>
						{(shown: () => RunActivity) => (
							<RunActivityLines
								activity={shown()}
								live={live()}
								selected={props.selectedEdit}
								filled={props.focused}
								width={props.width - paneEdges}
							/>
						)}
					</Show>
				</scrollbox>
				<Show when={props.diff}>
					{(item: () => RunToolCalls) => (
						<scrollbox
							ref={props.diffRef}
							flexGrow={1}
							verticalScrollbarOptions={{ visible: false }}
						>
							<RunDiffLines item={item()} width={props.width - paneEdges} />
						</scrollbox>
					)}
				</Show>
			</Show>
		</box>
	);
}
