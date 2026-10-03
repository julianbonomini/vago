// The TUI's look: the colour tokens every text takes, the symbols, the box
// borders, and which colour each Goal standing and Ticket status is drawn in,
// with `NO_COLOR` and `VAGO_ASCII` already applied. No view names a colour, a
// glyph or an environment variable of its own.

import {
	type BorderCharacters,
	type ColorInput,
	RGBA,
	TextAttributes,
} from "@opentui/core";
import type { TicketStatus } from "../tickets/tickets.ts";
import type { GoalStanding } from "./goal-rows.ts";

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
};

/**
 * The symbols. The keys for the six Goal standings are the standing words,
 * so `symbol[standing]` is a standing's symbol. `blocked` is a ready Ticket
 * waiting on a blocker, `bar` one cell of a progress bar, `sep` the mark
 * between items on a line, `cut` the end of a text cut short, and `upDown`
 * the arrow keys as a footer names them.
 */
export type ThemeSymbols = {
	done: string;
	running: string;
	ready: string;
	stuck: string;
	lost: string;
	broken: string;
	blocked: string;
	bar: string;
	sep: string;
	cut: string;
	upDown: string;
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

// One orange accent on near-black, as the human picked in the prototype.
const palette: ThemeColors = {
	bg: "#0c0c0c",
	fg: "#d6d6d6",
	faint: "#4a4a4a",
	border: "#2e2e2e",
	accent: "#ff8a3d",
	ok: "#8fae8b",
	bad: "#e5736b",
	warn: "#e0b357",
};

// Secondary text, which takes no token of its own.
const grey = "#7a7a7a";

const terminalForeground = RGBA.defaultForeground();
const terminalBackground = RGBA.defaultBackground();

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
};

const glyphs: ThemeSymbols = {
	done: "✓",
	running: "●",
	ready: "○",
	stuck: "✗",
	lost: "?",
	broken: "!",
	blocked: "◌",
	bar: "━",
	sep: "·",
	cut: "…",
	upDown: "↑↓",
};

const asciiGlyphs: ThemeSymbols = {
	done: "+",
	running: "*",
	ready: "o",
	stuck: "x",
	lost: "?",
	broken: "!",
	blocked: "-",
	bar: "=",
	sep: "|",
	cut: "~",
	upDown: "Up Dn",
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
	scrollbars: true,
	dimText: { fg: grey, attributes: 0 },
	dimSpan: { fg: grey, dim: false },
	selection: { fg: palette.bg, bg: palette.accent, attributes: 0 },
};

const plain: Theme = {
	color: noPalette,
	symbol: glyphs,
	border: lines,
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
