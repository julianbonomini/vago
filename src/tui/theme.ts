// The TUI's look: the colour tokens every text takes, the symbols, and which
// colour each Goal standing and Ticket status is drawn in. No view names a
// colour or a glyph of its own.

import type { TicketStatus } from "../tickets/tickets.ts";
import type { GoalStanding } from "./goal-rows.ts";

/** The colour tokens, each a hex colour. */
export type ThemeColors = {
	bg: string;
	fg: string;
	dim: string;
	faint: string;
	border: string;
	accent: string;
	ok: string;
	bad: string;
	warn: string;
};

/** One orange accent on near-black, as the human picked in the prototype. */
export const color: ThemeColors = {
	bg: "#0c0c0c",
	fg: "#d6d6d6",
	dim: "#7a7a7a",
	faint: "#4a4a4a",
	border: "#2e2e2e",
	accent: "#ff8a3d",
	ok: "#8fae8b",
	bad: "#e5736b",
	warn: "#e0b357",
};

/**
 * The symbols. The keys for the five Goal standings are the standing words,
 * so `symbol[standing]` is a standing's symbol. `blocked` is a ready Ticket
 * waiting on a blocker, `bar` one cell of a progress bar, and `sep` the dot
 * between items on a line.
 */
export type ThemeSymbols = {
	done: string;
	running: string;
	ready: string;
	stuck: string;
	lost: string;
	blocked: string;
	bar: string;
	sep: string;
};

export const symbol: ThemeSymbols = {
	done: "✓",
	running: "●",
	ready: "○",
	stuck: "✗",
	lost: "?",
	blocked: "◌",
	bar: "━",
	sep: "·",
};

/**
 * The colour of a Goal's standing word and symbol: running accent, lost
 * warn, stuck bad, ready fg, done ok.
 */
export function goalColor(standing: GoalStanding): string {
	switch (standing) {
		case "running":
			return color.accent;
		case "lost":
			return color.warn;
		case "stuck":
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
): string {
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
