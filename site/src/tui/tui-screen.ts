// Draws captured frames as HTML, the same on the server, for the first paint, and in the page: one string
// per row, each run of cells a span of its style's class, and the help box laid over the cells it covers.
// Hides how lines are drawn: a font's box-drawing glyphs don't always fill their cell, so the panes
// wouldn't join, and fontsource's JetBrains Mono has none, so lines are drawn with CSS, one cell wide.

import type { TuiHelp, TuiLine } from "./tui-frames.ts";
import { tuiFrames } from "./tui-replay.ts";

/** CSS for the class of each captured style, `s` and its index, under the selector `scope`. */
export function tuiStyleCss(scope: string): string {
	return tuiFrames.styles
		.map(({ fg, bg, bold }, index) => {
			const colour = fg === undefined ? "" : `color:${fg};`;
			const background = bg === undefined ? "" : `background:${bg};`;
			const weight = bold ? "font-weight:700;" : "";
			return `${scope} .s${index}{${colour}${background}${weight}}`;
		})
		.join("");
}

/** The HTML of each row of the frame at index `frame`, with `help`'s box over it when given. */
export function screenRows(frame: number, help?: TuiHelp): string[] {
	const rows = tuiFrames.frames[frame]?.rows ?? [];
	return rows.map((line, row) => {
		const box = help?.box;
		const covered =
			box !== undefined && row >= box.row && row < box.row + box.rows;
		if (!covered || help === undefined) return lineHtml(line);
		const under = tuiFrames.frames[help.frame]?.rows[row] ?? line;
		const right = box.column + box.columns;
		return (
			lineHtml(line, 0, box.column) +
			lineHtml(under, box.column, right) +
			lineHtml(line, right, Number.POSITIVE_INFINITY)
		);
	});
}

const drawn = new Map<string, string>();

// The cells from `from` to before `to` of the line at index `line`.
function lineHtml(
	line: number,
	from = 0,
	to = Number.POSITIVE_INFINITY,
): string {
	const key = `${line}:${from}:${to}`;
	const cached = drawn.get(key);
	if (cached !== undefined) return cached;
	const html = cellsHtml(tuiFrames.lines[line], from, to);
	drawn.set(key, html);
	return html;
}

function cellsHtml(
	line: TuiLine | undefined,
	from: number,
	to: number,
): string {
	if (line === undefined) return "";
	const width = line.runs.reduce((total, { cells }) => total + cells, 0);
	const chars = [...line.text.padEnd(width)];
	let at = 0;
	let html = "";
	for (const { cells, style } of line.runs) {
		const start = Math.max(at, from);
		const end = Math.min(at + cells, to);
		if (end > start)
			html += `<span class="s${style}">${runHtml(chars.slice(start, end))}</span>`;
		at += cells;
	}
	return html;
}

// Which sides of its cell each box-drawing glyph reaches: left, right, up, down.
const boxSides: Record<string, string> = {
	"│": "u d",
	"┌": "r d",
	"┐": "l d",
	"└": "r u",
	"┘": "l u",
	"┬": "l r d",
	"┴": "l r u",
	"├": "r u d",
	"┤": "l u d",
	"┼": "l r u d",
};

// A run of cells of one style. A stretch of ─ or ━ is one drawn line.
function runHtml(chars: string[]): string {
	return chars
		.join("")
		.split(/([─━]+)/)
		.map((part) => {
			if (part === "") return "";
			const width = [...part].length;
			if (part.startsWith("─"))
				return `<i class="h" style="width:${width}ch"></i>`;
			if (part.startsWith("━"))
				return `<i class="h heavy" style="width:${width}ch"></i>`;
			return [...part].map(cellHtml).join("");
		})
		.join("");
}

// One cell. Any glyph outside ASCII may fall back to a font of another width, so it gets a cell of its own.
function cellHtml(char: string): string {
	const sides = boxSides[char];
	if (sides !== undefined) return `<i class="b ${sides}"></i>`;
	if (char === "█") return `<i class="b full"></i>`;
	if (char === "▀") return `<i class="b top"></i>`;
	const text = char
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	return (char.codePointAt(0) ?? 0) < 0x80 ? text : `<i class="g">${text}</i>`;
}
