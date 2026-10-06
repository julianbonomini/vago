// The Project view: the Goals table, one row per Goal in the order
// `goal-rows.ts` gives, with the selection moved by keys and the mouse, and
// the screen's keys. Hides the columns, their widths, which drop out on a
// narrow terminal, how much of the screen the table takes, and when the
// Goals are read again.

import { basename } from "node:path";
import type { ColorInput, ScrollBoxRenderable } from "@opentui/core";
import { type JSX, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { GoalPreview } from "./goal-preview.tsx";
import {
	type GoalRow,
	projectTotals,
	readGoalRows,
	ticketTotal,
} from "./goal-rows.ts";
import { startGoal } from "./goal-start.ts";
import { GoalView } from "./goal-view.tsx";
import { usePane } from "./pane-grid.ts";
import { PaneTitle } from "./pane-title.tsx";
import {
	type FooterKey,
	type HelpKey,
	KeyFooter,
	KeyHelp,
} from "./screen-keys.tsx";
import { fitText } from "./text-fit.ts";
import { goalColor, theme } from "./theme.ts";
import { TicketBar } from "./ticket-bar.tsx";
import { duration, money } from "./time-and-money.ts";

// How often the Goals are read again: a change on disk shows within this.
const refreshMs = 1000;

// The rows of every Goal of the Project at `root`, undefined until the
// first read ends, then read again every `refreshMs` for as long as the
// calling component lives. A row that didn't change keeps its object, so
// its line in the table isn't drawn again. The accessor throws the first
// read's error. A later read that fails keeps the last rows: a broken Goal
// is a row of its own, so only the Project's `.vago-goals` going bad fails.
function liveGoalRows(root: string): () => GoalRow[] | undefined {
	const [store, setStore] = createStore<{ rows: GoalRow[] | undefined }>({
		rows: undefined,
	});
	// Wrapped, so that a thrown `undefined` still counts as a failure.
	const [failed, setFailed] = createSignal<{ error: unknown }>();
	let last = "";
	let reading = false;
	const refresh = async () => {
		if (reading) return;
		reading = true;
		try {
			const rows = await readGoalRows(root, new Date());
			const read = JSON.stringify(rows);
			if (read === last) return;
			last = read;
			setStore("rows", reconcile(rows, { key: "goal" }));
		} catch (error) {
			if (store.rows === undefined) setFailed({ error });
		} finally {
			reading = false;
		}
	};
	refresh();
	const timer = setInterval(refresh, refreshMs);
	onCleanup(() => clearInterval(timer));
	return () => {
		const failure = failed();
		if (failure !== undefined) throw failure.error;
		return store.rows;
	};
}

/**
 * The Project view of the Project at `root`: a header line with the
 * Project's counts and spend, which stays on every screen, the Goal view's
 * included, and a Goals box with one row per Goal showing
 * its standing, Tickets, time, cost, what it is doing and its title, the
 * selected one in the selection colours, moved by ↑↓ and j k, g and G, or a
 * click, with `n/N` on the box's bottom border, or a line naming
 * `vago goal new` while there are none. The box scrolls, by wheel or to
 * follow the selection, once the Goals outgrow its share of the screen.
 * Below it, the selected Goal's preview fills the rest of the screen, then
 * a footer names the keys, and `?` shows them all until `?` or Esc. Space
 * and PgDn page the preview's description and PgUp pages it back. Enter
 * opens the selected Goal, unless it is broken, in the Goal view in place of
 * all this; its `[` and `]` open the Goal before and after, passing over
 * broken ones and stopping at the ends, and its Esc leaves the selection on
 * the Goal last open. `s` starts the selected Goal in a `vago run` of its
 * own, through the command `vago` (`startGoal`), and the footer says what
 * came of it until the next key. Reads the Goals itself, and again every
 * second, so changes on disk show without a key; the selection stays on its
 * Goal when the rows reorder. Throws what the first read throws.
 */
export function ProjectView(props: {
	root: string;
	vago: string[];
}): JSX.Element {
	const { color, symbol, scrollbars, dimText } = theme();
	const rows = liveGoalRows(props.root);
	const [chosen, setChosen] = createSignal<string>();
	// Pinned on the first read, so the selection follows its Goal from the
	// start, not the top row.
	createEffect(() => {
		const first = rows()?.[0];
		if (chosen() === undefined && first !== undefined) setChosen(first.goal);
	});
	// The selected Goal's row, or, once that Goal is gone, the row now where it
	// was.
	const selectedIndex = createMemo<number>((previous) => {
		const list = rows() ?? [];
		const index = list.findIndex(({ goal }) => goal === chosen());
		if (index !== -1) return index;
		return Math.max(0, Math.min(list.length - 1, previous));
	}, 0);
	const [helpShown, setHelpShown] = createSignal(false);
	const [notice, setNotice] = createSignal<string>();
	// The Goal open in the Goal view, which takes the whole screen; undefined
	// on the Goals table.
	const [opened, setOpened] = createSignal<string>();
	const openedRow = () => rows()?.find(({ goal }) => goal === opened());
	// Clamped, not wrapped, so holding a key stops at the end of the list.
	// The help screen and the Goal view hide the selection, so it holds still
	// meanwhile, even for a click on a row under them.
	const select = (index: number) => {
		if (helpShown() || openedRow() !== undefined) return;
		const list = rows() ?? [];
		const row = list[Math.max(0, Math.min(list.length - 1, index))];
		if (row !== undefined) setChosen(row.goal);
	};
	// Opens the Goal `step` rows from the open one, passing over broken Goals;
	// past either end the open Goal stays, as the selection stops there.
	const openNeighbour = (step: number) => {
		const list = rows() ?? [];
		for (
			let index = selectedIndex() + step;
			index >= 0 && index < list.length;
			index += step
		) {
			const row = list[index];
			if (row !== undefined && row.standing !== "broken") {
				setChosen(row.goal);
				setOpened(row.goal);
				return;
			}
		}
	};
	let description: ScrollBoxRenderable | undefined;
	useKeyboard((key) => {
		if (openedRow() !== undefined) return;
		// A broken Goal has no Tickets to show; its preview says why.
		const row = rows()?.[selectedIndex()];
		setNotice(undefined);
		if (key.name === "return" && !helpShown() && row?.standing !== "broken") {
			setOpened(row?.goal);
		}
		if (key.name === "s" && !helpShown() && row !== undefined) {
			setNotice(startGoal(props.vago, props.root, row));
		}
		if (key.name === "?") setHelpShown(!helpShown());
		if (key.name === "escape") setHelpShown(false);
		if (key.name === "up" || key.name === "k") select(selectedIndex() - 1);
		if (key.name === "down" || key.name === "j") select(selectedIndex() + 1);
		if (key.name === "g") select(key.shift ? (rows() ?? []).length - 1 : 0);
		if (helpShown()) return;
		if (key.name === "space" || key.name === "pagedown") {
			description?.scrollBy(1, "viewport");
		}
		if (key.name === "pageup") description?.scrollBy(-1, "viewport");
	});
	// No count until the Goals are read, so an empty Project and a slow read
	// never look alike.
	const position = () => {
		const list = rows();
		if (list === undefined) return undefined;
		return list.length === 0 ? "0/0" : `${selectedIndex() + 1}/${list.length}`;
	};
	const goalsPane = usePane();
	const terminal = useTerminalDimensions();
	const wide = () => terminal().width >= wideFrom;
	// The Goals box takes what its rows need, up to its share of the screen,
	// and scrolls the rest. With no Goals it keeps one row, for the line
	// saying so.
	const shownRows = () =>
		Math.min(
			Math.max(1, (rows() ?? []).length),
			Math.max(
				minShownRows,
				Math.floor(terminal().height * goalsShare) - goalsBoxChrome,
			),
		);
	const scrollbarShown = () =>
		scrollbars && (rows() ?? []).length > shownRows();
	let list: ScrollBoxRenderable | undefined;
	createEffect(() => {
		const row = rows()?.[selectedIndex()];
		if (row !== undefined) list?.scrollChildIntoView(rowId(row.goal));
	});
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
			{/* One header over every screen, so it never moves. */}
			<Show when={rows()}>
				{(read: () => GoalRow[]) => (
					<HeaderLine
						root={props.root}
						rows={read()}
						width={terminal().width}
					/>
				)}
			</Show>
			{/* Keyed on the Goal, so another Goal opens on its own Ticket, Run
			    and focus. */}
			<Show when={openedRow()?.goal} keyed>
				<Show when={openedRow()}>
					{(row: () => GoalRow) => (
						<GoalView
							root={props.root}
							vago={props.vago}
							row={row()}
							position={selectedIndex() + 1}
							count={(rows() ?? []).length}
							onClose={() => setOpened(undefined)}
							onNeighbour={openNeighbour}
						/>
					)}
				</Show>
			</Show>
			{/* Hidden, not unmounted, so the Goals box keeps its scroll. */}
			<box
				visible={openedRow() === undefined}
				flexDirection="column"
				flexGrow={1}
			>
				<box
					ref={goalsPane}
					border
					paddingLeft={1}
					// The scrollbar, when there is one, takes the padding's column.
					paddingRight={scrollbarShown() ? 0 : 1}
					height={goalsBoxChrome + shownRows()}
					flexShrink={0}
				>
					<PaneTitle
						title="Goals"
						aside={position()}
						focused={true}
						width={terminal().width - boxEdges}
					/>
					<text {...dimText} flexShrink={0} wrapMode="none">
						{`${"  STATE".padEnd(stateWidth)}${"GOAL".padEnd(nameWidth())} ${"TICKETS".padEnd(ticketsWidth)}${wide() ? `${"RUN TIME".padEnd(timesWidth)}${"COST".padEnd(timesWidth)}` : ""}${fitText("NOW", widths().now)}${fitText("TITLE", widths().title)}`}
					</text>
					<scrollbox
						ref={(box: ScrollBoxRenderable) => {
							list = box;
						}}
						flexGrow={1}
						// Set here, not left to the scrollbox, which shows its scrollbar
						// a frame before placing it.
						verticalScrollbarOptions={{
							visible: scrollbarShown(),
							trackOptions: {
								foregroundColor: color.faint,
								backgroundColor: "transparent",
							},
						}}
					>
						<For each={rows() ?? []}>
							{(row, index) => (
								<GoalRowLine
									row={row}
									selected={index() === selectedIndex()}
									widths={widths()}
									wide={wide()}
									onClick={() => select(index())}
								/>
							)}
						</For>
						<Show when={rows()?.length === 0}>
							<text {...dimText} flexShrink={0} wrapMode="none">
								{fitText(
									"No Goals yet. Start one with vago goal new <goal>.",
									terminal().width - boxEdges,
								)}
							</text>
						</Show>
					</scrollbox>
				</box>
				<Show when={rows()?.[selectedIndex()]}>
					{(row: () => GoalRow) => (
						<GoalPreview
							row={row()}
							width={terminal().width}
							scrollRef={(box) => {
								description = box;
							}}
						/>
					)}
				</Show>
				<box flexShrink={0} paddingLeft={1} paddingRight={1}>
					<KeyFooter
						keys={footerKeys(symbol.upDown)}
						width={terminal().width - 2}
						notice={notice()}
					/>
				</box>
				<Show when={helpShown()}>
					<KeyHelp keys={helpKeys(symbol.upDown)} />
				</Show>
			</box>
		</box>
	);
}

// `q` and Ctrl-C belong to `tui.tsx`, which quits on them on every screen.
// `upDown` names the arrow keys.
const footerKeys = (upDown: string): FooterKey[] => [
	{ keys: upDown, label: "Goal", use: 6 },
	{ keys: "Enter", label: "Open", use: 5 },
	{ keys: "s", label: "Start", use: 2 },
	{ keys: "g G", label: "First, last", use: 1 },
	{ keys: "PgUp PgDn", label: "Scroll", use: 2 },
	{ keys: "?", label: "Help", use: 3 },
	{ keys: "q", label: "Quit", use: 2 },
];

const helpKeys = (upDown: string): HelpKey[] => [
	{ keys: `${upDown} j k`, meaning: "select the Goal above, below" },
	{ keys: "Enter", meaning: "open the selected Goal" },
	{ keys: "s", meaning: "start the selected Goal in vago run" },
	{ keys: "g G", meaning: "select the first, the last Goal" },
	{ keys: "click", meaning: "select the Goal clicked" },
	{ keys: "Space PgDn", meaning: "page the Goal's description" },
	{ keys: "PgUp", meaning: "page back" },
	{ keys: "wheel", meaning: "scroll the pane under the pointer" },
	{ keys: "? Esc", meaning: "show, hide these keys" },
	{ keys: "q Ctrl-C", meaning: "quit" },
];

// The Project's name and its counts on one line at the top of every screen,
// `width` columns wide: the name on the left, then the Goals done, ready,
// running and stuck on the right, and last the spend, bright and bold, the
// number the human reads first. The stuck count takes in the lost and broken
// Goals and says so while the whole name still fits, and is then just
// "stuck"; past that the name is cut. Not drawn until the Goals are read, so
// a slow read never shows zero Goals.
function HeaderLine(props: {
	root: string;
	rows: GoalRow[];
	width: number;
}): JSX.Element {
	const { color, symbol, dimSpan } = theme();
	const name = () => basename(props.root);
	const totals = () => projectTotals(props.rows);
	const spend = () => money(totals().costUsd);
	const countsWith = (stuckLabel: string) => {
		const { done, ready, running, stuck } = totals();
		return `${[
			`${done} done`,
			`${ready} ready`,
			`${running} running`,
			`${stuck} ${stuckLabel}`,
		].join(` ${symbol.sep} `)} ${symbol.sep} `;
	};
	// The room left for the name, past a space before it and one after it.
	const nameRoom = (counts: string) =>
		props.width - 2 - Bun.stringWidth(`${counts}${spend()}${spentLabel}`);
	const counts = () => {
		const spelledOut = countsWith("stuck, lost or broken");
		return nameRoom(spelledOut) >= Bun.stringWidth(name())
			? spelledOut
			: countsWith("stuck");
	};
	return (
		<text fg={color.fg} flexShrink={0} wrapMode="none">
			{` ${fitText(name(), nameRoom(counts()))} `}
			<span style={dimSpan}>{counts()}</span>
			<span style={{ fg: color.bright, bold: true }}>{spend()}</span>
			<span style={dimSpan}>{spentLabel}</span>
		</text>
	);
}

// With the space that ends the line.
const spentLabel = " spent ";

// The Goals box's border and padding, on both sides.
const boxEdges = 4;
// The Goals box's lines around its rows: its border, its title and the
// column names.
const goalsBoxChrome = 4;
// The most of the screen's height the Goals box takes, and the fewest rows
// it shows, so the preview below keeps its slots.
const goalsShare = 0.4;
const minShownRows = 3;

// The id of Goal `goal`'s row, which the Goals box scrolls to.
const rowId = (goal: string) => `goal-row-${goal}`;
// The symbol, a space and the longest standing word, then a space.
const stateWidth = 10;
// Below this many columns the RUN TIME and COST columns drop out.
const wideFrom = 100;
// RUN TIME and COST each: `13h 36m`, `$103.70` or the heading, then a
// space.
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
	onClick: () => void;
}): JSX.Element {
	const { color, symbol, selection, dimSpan } = theme();
	// The selected row is drawn in the selection's colours throughout, so its
	// own colours don't fight the highlight.
	const fg = (own: ColorInput) => (props.selected ? selection.fg : own);
	const dim = () => ({ ...dimSpan, fg: fg(dimSpan.fg) });
	return (
		<text
			id={rowId(props.row.goal)}
			onMouseDown={props.onClick}
			fg={fg(color.fg)}
			bg={props.selected ? selection.bg : undefined}
			attributes={props.selected ? selection.attributes : 0}
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
			<span style={dim()}> </span>
			<TicketBar
				tickets={props.row.ticketCounts}
				standing={props.row.standing}
				width={barWidth}
				selected={props.selected}
				solid={false}
			/>
			<span style={dim()}>
				{` ${`${props.row.ticketCounts.done}/${ticketTotal(props.row.ticketCounts)}`.padEnd(ticketsWidth - barWidth - 1)}`}
				{props.wide
					? `${duration(props.row.runMs).padEnd(timesWidth)}${money(props.row.costUsd).padEnd(timesWidth)}`
					: ""}
				{fitText(props.row.now, props.widths.now)}
			</span>
			<span style={dim()}>{fitText(props.row.title, props.widths.title)}</span>
		</text>
	);
}
