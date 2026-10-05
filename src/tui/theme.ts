// The TUI's look: the colour tokens every text takes, the symbols, the box
// borders, a focused pane's title, which colour each Goal standing and Ticket
// status is drawn in, and the look of each Ticket, Step and Run mark, with
// `NO_COLOR` and `VAGO_ASCII` already applied. No view names a colour, a
// glyph or an environment variable of its own.

import {
	type BorderCharacters,
	type ColorInput,
	RGBA,
	TextAttributes,
} from "@opentui/core";
import type { TicketStatus } from "../tickets/tickets.ts";
import type { GoalStanding } from "./goal-rows.ts";
import type {
	GoalRunState,
	GoalTicketMark,
	GoalTicketStepMark,
} from "./goal-tickets.ts";

/** The colour tokens. */
export type ThemeColors = {
	bg: ColorInput;
	fg: ColorInput;
	faint: ColorInput;
	border: ColorInput;
	accent: ColorInput;
	ok: ColorInput;
	bad: ColorInput;
	warn: ColorInput;
	/** Behind a block that stands out, a step lighter than the screen. */
	raised: ColorInput;
	/** Text brighter than `fg`, for what the human reads first. */
	bright: ColorInput;
};

/**
 * The symbols. The keys for the six Goal standings are the standing words,
 * so `symbol[standing]` is a standing's symbol. `blocked` is a ready Ticket
 * waiting on a blocker, `pending` a Step not run yet in a Ticket's pass,
 * `bar` one cell of a progress bar, `solidBar` one cell of the heavier bar a
 * Goal view's Goal box draws, `sep` the mark between items on a line,
 * `cut` the end of a text cut short, `prose` the mark before the agent's
 * prose, `times` the mark of a count, like `×5`, `rule` one cell of a
 * divider, and `upDown` and `leftRight` the arrow keys as a footer names
 * them.
 */
export type ThemeSymbols = {
	done: string;
	running: string;
	ready: string;
	stuck: string;
	lost: string;
	broken: string;
	blocked: string;
	pending: string;
	bar: string;
	solidBar: string;
	sep: string;
	cut: string;
	prose: string;
	times: string;
	rule: string;
	upDown: string;
	leftRight: string;
};

/** How the selected row of a list is drawn. */
export type ThemeSelection = {
	fg: ColorInput;
	/** Undefined leaves the terminal's own background. */
	bg: ColorInput | undefined;
	attributes: number;
};

/** Everything a view draws with. */
export type Theme = {
	color: ThemeColors;
	symbol: ThemeSymbols;
	/** Every box's border, as a box's `customBorderChars` takes it. */
	border: BorderCharacters;
	/**
	 * The focused pane's title, as a `<span>`'s style takes it: the accent,
	 * or underlined under `NO_COLOR`, where no accent tells the pane apart.
	 */
	focusTitle: { fg: ColorInput; underline: boolean };
	/** Whether scrollbars show: their glyphs have no ASCII form. */
	scrollbars: boolean;
	/**
	 * How a label or other secondary text is drawn: grey, or the DIM
	 * attribute without colour. `dimText` spreads onto a `<text>`, and
	 * `dimSpan` is a `<span>`'s style, which takes flags, not `attributes`.
	 * A span can't drop its text's DIM, so a bright span sits in a bright
	 * text beside dim spans.
	 */
	dimText: { fg: ColorInput; attributes: number };
	dimSpan: { fg: ColorInput; dim: boolean };
	selection: ThemeSelection;
};

/**
 * The look for the environment as it is now: no colour at all, only the
 * terminal's own, while `NO_COLOR` is set and not empty, and only ASCII
 * while `VAGO_ASCII` is `1`.
 */
export function theme(): Theme {
	const noColor = (process.env.NO_COLOR ?? "") !== "";
	const ascii = process.env.VAGO_ASCII === "1";
	if (noColor) return ascii ? plainAscii : plain;
	return ascii ? colouredAscii : coloured;
}

/**
 * The colour of a Goal's standing word and symbol: running accent, lost
 * warn, stuck and broken bad, ready fg, done ok.
 */
export function goalColor(standing: GoalStanding): ColorInput {
	const { color } = theme();
	switch (standing) {
		case "running":
			return color.accent;
		case "lost":
			return color.warn;
		case "stuck":
		case "broken":
			return color.bad;
		case "ready":
			return color.fg;
		case "done":
			return color.ok;
	}
}

/**
 * The colour of a Ticket status in a Goal's bar: done ok, running accent
 * (warn in a lost Goal, whose running Ticket has no process), stuck bad,
 * ready faint.
 */
export function ticketColor(
	status: TicketStatus,
	standing: GoalStanding,
): ColorInput {
	const { color } = theme();
	switch (status) {
		case "done":
			return color.ok;
		case "running":
			return standing === "lost" ? color.warn : color.accent;
		case "stuck":
			return color.bad;
		case "ready":
			return color.faint;
	}
}

/**
 * The span style of a Ticket's mark in the Goal view, its symbol and state
 * word: `goalColor` for the words they share, and dim for a blocked Ticket.
 */
export function ticketMarkStyle(mark: GoalTicketMark): {
	fg: ColorInput;
	dim: boolean;
} {
	return mark === "blocked"
		? theme().dimSpan
		: { fg: goalColor(mark), dim: false };
}

/**
 * The symbol and span style of a Step's mark in the Ticket pane: done `✓`
 * ok, current `●` accent, failed `✗` bad, lost `?` warn, pending `·` dim.
 */
export function stepMarkLook(mark: GoalTicketStepMark): {
	symbol: string;
	style: { fg: ColorInput; dim: boolean };
} {
	const { color, symbol, dimSpan } = theme();
	switch (mark) {
		case "done":
			return { symbol: symbol.done, style: { fg: color.ok, dim: false } };
		case "current":
			return {
				symbol: symbol.running,
				style: { fg: color.accent, dim: false },
			};
		case "failed":
			return { symbol: symbol.stuck, style: { fg: color.bad, dim: false } };
		case "lost":
			return { symbol: symbol.lost, style: { fg: color.warn, dim: false } };
		case "pending":
			return { symbol: symbol.pending, style: dimSpan };
	}
}

/**
 * A Run in `state` with its symbol and colour: `● live` accent, `? lost`
 * warn, and an ended Run by its `outcome`: `✓ ok` ok, `? lost` warn when the
 * next `vago run` ended it lost, and `✗ exit 1` and the like bad.
 */
export function runMarkLook(
	state: GoalRunState,
	outcome: string | undefined,
): { text: string; fg: ColorInput } {
	const { color, symbol } = theme();
	if (state === "live") {
		return { text: `${symbol.running} live`, fg: color.accent };
	}
	if (state === "lost" || outcome === "lost") {
		return { text: `${symbol.lost} lost`, fg: color.warn };
	}
	if (outcome === "ok") return { text: `${symbol.done} ok`, fg: color.ok };
	return { text: `${symbol.stuck} ${outcome}`, fg: color.bad };
}

const terminalForeground = RGBA.defaultForeground();
const terminalBackground = RGBA.defaultBackground();

// One orange accent on the terminal's own background, which every cell
// shares, the panes' lines included.
const palette: ThemeColors = {
	bg: terminalBackground,
	fg: "#d6d6d6",
	faint: "#4a4a4a",
	border: "#2e2e2e",
	accent: "#ff8a3d",
	ok: "#8fae8b",
	bad: "#e5736b",
	warn: "#e0b357",
	raised: "#1b1b1b",
	bright: "#f0f0f0",
};

// Secondary text, which takes no token of its own.
const grey = "#7a7a7a";

// The selected row's text, dark on the accent.
const onAccent = "#0c0c0c";

// Every token is the terminal's own colour, so meaning rests on the symbols,
// DIM and INVERSE.
const noPalette: ThemeColors = {
	bg: terminalBackground,
	fg: terminalForeground,
	faint: terminalForeground,
	border: terminalForeground,
	accent: terminalForeground,
	ok: terminalForeground,
	bad: terminalForeground,
	warn: terminalForeground,
	raised: terminalBackground,
	bright: terminalForeground,
};

const glyphs: ThemeSymbols = {
	done: "✓",
	running: "●",
	ready: "○",
	stuck: "✗",
	lost: "?",
	broken: "!",
	blocked: "◌",
	pending: "·",
	bar: "━",
	solidBar: "█",
	sep: "·",
	cut: "…",
	prose: "⁘",
	times: "×",
	rule: "─",
	upDown: "↑↓",
	leftRight: "←→",
};

const asciiGlyphs: ThemeSymbols = {
	done: "+",
	running: "*",
	ready: "o",
	stuck: "x",
	lost: "?",
	broken: "!",
	blocked: "-",
	pending: ".",
	bar: "=",
	solidBar: "#",
	sep: "|",
	cut: "~",
	prose: ">",
	times: "x",
	rule: "-",
	upDown: "Up Dn",
	leftRight: "Lt Rt",
};

const lines: BorderCharacters = {
	topLeft: "┌",
	topRight: "┐",
	bottomLeft: "└",
	bottomRight: "┘",
	horizontal: "─",
	vertical: "│",
	topT: "┬",
	bottomT: "┴",
	leftT: "├",
	rightT: "┤",
	cross: "┼",
};

const asciiLines: BorderCharacters = {
	topLeft: "+",
	topRight: "+",
	bottomLeft: "+",
	bottomRight: "+",
	horizontal: "-",
	vertical: "|",
	topT: "+",
	bottomT: "+",
	leftT: "+",
	rightT: "+",
	cross: "+",
};

const coloured: Theme = {
	color: palette,
	symbol: glyphs,
	border: lines,
	focusTitle: { fg: palette.accent, underline: false },
	scrollbars: true,
	dimText: { fg: grey, attributes: 0 },
	dimSpan: { fg: grey, dim: false },
	selection: { fg: onAccent, bg: palette.accent, attributes: 0 },
};

const plain: Theme = {
	color: noPalette,
	symbol: glyphs,
	border: lines,
	focusTitle: { fg: terminalForeground, underline: true },
	scrollbars: true,
	dimText: { fg: terminalForeground, attributes: TextAttributes.DIM },
	dimSpan: { fg: terminalForeground, dim: true },
	selection: {
		fg: terminalForeground,
		bg: undefined,
		attributes: TextAttributes.INVERSE,
	},
};

const colouredAscii: Theme = {
	...coloured,
	symbol: asciiGlyphs,
	border: asciiLines,
	scrollbars: false,
};

const plainAscii: Theme = {
	...plain,
	symbol: asciiGlyphs,
	border: asciiLines,
	scrollbars: false,
};
