// Which lines of hard-wrapped Markdown, such as a Goal's or a Ticket's text,
// belong to one paragraph. Hides the rule for which lines start a block of
// their own and which prose lines join the line before them.

/** One line of Markdown after `joinParagraphLines`. */
export type MarkdownLine = {
	text: string;
	/** A fence of a fenced code block or a line inside one. */
	fenced: boolean;
};

/**
 * The lines of `markdown` with each hard-wrapped paragraph's lines joined into
 * one line by a space, and every other line as it was: list items, headings,
 * quotes, table rows, HTML tags, rules, indented code, blank lines and every
 * line of a fenced code block. A line ending in a hard break, two spaces or a
 * backslash, keeps the break after it.
 */
export function joinParagraphLines(markdown: string): MarkdownLine[] {
	const lines: MarkdownLine[] = [];
	let inFence = false;
	let previousJoins = false;
	for (const line of markdown.split("\n")) {
		const isFence = /^ {0,3}(```|~~~)/.test(line);
		const fenced = isFence || inFence;
		if (isFence) inFence = !inFence;
		const isProse = !fenced && line.trim() !== "" && !blockLineStart.test(line);
		const previous = lines.at(-1);
		if (isProse && previousJoins && previous)
			previous.text = `${previous.text.trimEnd()} ${line}`;
		else lines.push({ text: line, fenced });
		previousJoins = isProse && !hardBreakEnd.test(line);
	}
	return lines;
}

const blockLineStart = /^(\s|[-*+]\s|\d+[.)]\s|[#>|<]|[-=*_]{3,}\s*$)/;
const hardBreakEnd = /( {2}|\\)\r?$/;
