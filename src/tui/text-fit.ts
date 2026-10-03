// Fitting text to a column of the terminal by display width, so CJK and
// emoji, which take two cells, keep columns aligned. Hides the grapheme
// splitting and the width measure.

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * `text` in exactly `width` terminal cells as `Bun.stringWidth` counts them:
 * padded with spaces when shorter, cut at a whole character (grapheme) and
 * ended with `…` when longer. "" for a width of 0 or less.
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
	// A wide character that didn't fit before `…` leaves one cell over.
	return `${cut}…${" ".repeat(width - 1 - cutWidth)}`;
}
