// The captured TUI frames file, tui-frames.json: what `bun run capture` writes from Vago's real renderer and
// what the live TUI plays back. This module owns its shape and how a screen of the TUI is named in it.

/** One run of cells drawn alike: its foreground and background, each absent where the terminal's own
 *  shows, and whether it is bold. */
export type TuiStyle = { fg?: string; bg?: string; bold: boolean };

/** Cells side by side drawn in the style at index `style` of `styles`. */
export type TuiRun = { cells: number; style: number };

/** One row of the screen: its text with trailing spaces cut, and the runs covering the row's whole width. */
export type TuiLine = { text: string; runs: TuiRun[] };

/** The panes the live TUI names: the Goals list and its preview of the selected Goal, and the open Goal's
 *  four panes. */
export type TuiPaneName =
	| "Goals"
	| "Goal"
	| "Tickets"
	| "Ticket"
	| "Runs"
	| "Run activity";

/** A rectangle of the screen, in cells from its top left. */
export type TuiBox = {
	row: number;
	column: number;
	rows: number;
	columns: number;
};

/** A pane, where its box sits, the lines around it included, and whether it has the focus. */
export type TuiPane = { name: TuiPaneName; box: TuiBox; focused: boolean };

/** One captured screen: an index into `lines` per row, and its panes. */
export type TuiFrame = { rows: number[]; panes: TuiPane[] };

/** A Goal of the example Project as the Goals list orders them. */
export type TuiGoal = {
	name: string;
	/** Rows of the Goal view's Tickets pane, its Goal Steps included. */
	tickets: number;
	/** The Tickets pane's row the Goal view opens on, at each replay moment, or one row for all of them. */
	openTicket: number[];
	/** The word the Goals list shows for it, such as "running" or "stuck". */
	standing: string;
};

/** Which screen the TUI shows: the Goals list on a Goal, or a Goal open on a row of its Tickets pane with
 *  the focus on the pane that many Tabs reach. Every index counts from 0. */
export type TuiScreen =
	| { view: "project"; goal: number }
	| { view: "goal"; goal: number; ticket: number; pane: number };

/** How many panes the Goal view has, which Tab goes round and 1-4 pick. */
export const goalPaneCount = 4;

/** A help screen: the frame `?` drew on a view, and the box of keys in it, which the live TUI lays over
 *  whatever screen it shows. */
export type TuiHelp = { frame: number; box: TuiBox };

/** The whole file. */
export type TuiFrames = {
	size: { width: number; height: number };
	project: string;
	/** The Ticket the replay plays through its Steps, and the one that starts after it. */
	replay: { goal: string; ticket: string; next: string; phases: string[] };
	goals: TuiGoal[];
	styles: TuiStyle[];
	lines: TuiLine[];
	frames: TuiFrame[];
	/** Per `screenKey`, the frame at each replay phase, or one frame when the screen never changes. */
	screens: Record<string, number[]>;
	help: { project: TuiHelp; goal: TuiHelp };
};

/** The key `screens` files `screen` under. */
export function screenKey(screen: TuiScreen): string {
	return screen.view === "project"
		? `project/${screen.goal}`
		: `goal/${screen.goal}/${screen.ticket}/${screen.pane}`;
}
