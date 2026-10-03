// Fitting text to a column of the terminal by display width, cut to one line
// or wrapped to many, so CJK and emoji, which take two cells, keep columns
// aligned. Hides the grapheme splitting and the width measure.

import { theme } from "./theme.ts";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * `text` in exactly `width` terminal cells as `Bun.stringWidth` counts them:
 * padded with spaces when shorter, cut at a whole character (grapheme) and
 * ended with the theme's `cut` symbol when longer. "" for a width of 0 or
 * less.
 */
export function fitText(text: string, width: number): string {
	if (width <= 0) return "";
	const textWidth = Bun.stringWidth(text);
	if (textWidth <= width) return text + " ".repeat(width - textWidth);
	let cut = "";
	let cutWidth = 0;
	for (const { segment } of graphemes.segment(text)) {
		const segmentWidth = Bun.stringWidth(segment);
		if (cutWidth + segmentWidth > width - 1) break;
		cut += segment;
		cutWidth += segmentWidth;
	}
	// A wide character that didn't fit before the mark leaves one cell over.
	return `${cut}${theme().symbol.cut}${" ".repeat(width - 1 - cutWidth)}`;
}

/**
 * `text` wrapped into lines of at most `width` terminal cells, broken at
 * spaces, and a word wider than `width` broken inside it. One empty line for
 * "". None for a width of 0 or less.
 */
export function wrapText(text: string, width: number): string[] {
	if (width <= 0) return [];
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ").filter((each) => each !== "")) {
		const joined = line === "" ? word : `${line} ${word}`;
		if (Bun.stringWidth(joined) <= width) {
			line = joined;
			continue;
		}
		if (line !== "") lines.push(line);
		line = "";
		for (const { segment } of graphemes.segment(word)) {
			if (line !== "" && Bun.stringWidth(line + segment) > width) {
				lines.push(line);
				line = "";
			}
			line += segment;
		}
	}
	lines.push(line);
	return lines;
}
