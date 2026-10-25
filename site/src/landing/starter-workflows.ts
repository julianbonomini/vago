// The starter Workflows as the landing shows them: the real files from starter/workflows/ with their
// comments left out, cut into the settings at the top and one block per Step. Hides how the TOML text is
// read; the page never parses a Workflow beyond this.

import smallToml from "../../../starter/workflows/small.toml?raw";
import tryHardToml from "../../../starter/workflows/try-hard.toml?raw";

/** A block of a Workflow file: the settings above its first Step, or one Step of a list. */
export type WorkflowBlock = {
	/** "settings" for the lines above the first Step, else the list the Step is in. */
	list: "settings" | "steps" | "before_all" | "after_all";
	/** The Step's name, which the TUI and `vago run` show; undefined for the settings. */
	step?: string;
	/** The Step's `when`, such as "last-ticket", when it has one. */
	when?: string;
	/** The block's lines, its `[[list]]` line first, without comments or blank lines. */
	lines: string[];
};

/** A starter Workflow: its file name, such as "small.toml", and its blocks in file order. */
export type StarterWorkflow = { file: string; blocks: WorkflowBlock[] };

/** The two starter Workflows, small first. */
export const starterWorkflows: StarterWorkflow[] = [
	{ file: "small.toml", blocks: workflowBlocks(smallToml) },
	{ file: "try-hard.toml", blocks: workflowBlocks(tryHardToml) },
];

/** A run of a Workflow line's text and how it reads: a `[[list]]` heading, a quoted string value, or the rest. */
export type WorkflowLinePart = {
	text: string;
	look: "head" | "value" | "plain";
};

/** A line of a Workflow block cut into the parts the page colours apart: a `[[list]]` line is one heading,
 *  a line setting a quoted string is the text up to the value and the value with its quotes. */
export function workflowLineParts(line: string): WorkflowLinePart[] {
	if (line.startsWith("[[")) return [{ text: line, look: "head" }];
	const match = line.match(/^(.*= )(".*")$/);
	return match === null
		? [{ text: line, look: "plain" }]
		: [
				{ text: match[1] ?? "", look: "plain" },
				{ text: match[2] ?? "", look: "value" },
			];
}

// The blocks of a Workflow file's text. The starter files keep `#` out of their strings, so a `#` after
// a space starts a comment.
function workflowBlocks(toml: string): WorkflowBlock[] {
	let block: WorkflowBlock = { list: "settings", lines: [] };
	const blocks = [block];
	for (const raw of toml.split("\n")) {
		if (raw.startsWith("#")) continue;
		const line = raw.replace(/\s+#.*$/, "");
		if (line.trim() === "") continue;
		const list = line.match(/^\[\[(steps|before_all|after_all)\]\]$/)?.[1];
		if (list === "steps" || list === "before_all" || list === "after_all") {
			block = { list, lines: [] };
			blocks.push(block);
		}
		block.lines.push(line);
		const value = line.match(/^(name|when)\s*=\s*"(.*)"$/);
		if (value?.[1] === "name") block.step = value[2];
		if (value?.[1] === "when") block.when = value[2];
	}
	return blocks;
}
