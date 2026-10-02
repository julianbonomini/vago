// `punt init`: puts the starter Workflow, embedded in the binary, into a
// Project's `.punt/`. Hides the starter's file list and the lines it adds to
// `.git/info/exclude`.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import codeStyle from "../starter/code-style.md" with { type: "text" };
import implementPrompt from "../starter/prompts/implement.md" with {
	type: "text",
};
import mergePrompt from "../starter/prompts/merge.md" with { type: "text" };
import reviewPrompt from "../starter/prompts/review.md" with { type: "text" };
import workflow from "../starter/workflow.toml" with { type: "text" };

// Each starter file's text, by its path under `.punt/`.
const starterFiles: Record<string, string> = {
	"workflow.toml": workflow,
	"code-style.md": codeStyle,
	"prompts/implement.md": implementPrompt,
	"prompts/review.md": reviewPrompt,
	"prompts/merge.md": mergePrompt,
};

const commitExplanation = `Committing the Workflow in .punt/ shares it with everyone who clones this repo.
Not committing it adds all of .punt/ to .git/info/exclude, so it stays in this checkout.
Goals and Tickets in .punt/goals/ stay out of git either way.`;

/**
 * Asks on stdin whether the Workflow will be committed, then copies the starter
 * Workflow into `.punt/` of the Project at `root`. `.git/info/exclude` gets
 * `.punt/goals/`, and all of `.punt/` unless the answer is yes. An empty
 * answer, or no stdin, counts as no. Throws an Error naming the problem,
 * before asking or changing anything, when `.punt/workflow.toml` already
 * exists or `root` has no `.git` directory.
 */
export async function initProject(root: string): Promise<void> {
	const punt = join(root, ".punt");
	const workflowPath = join(punt, "workflow.toml");
	if (await Bun.file(workflowPath).exists()) {
		throw new Error(
			`${workflowPath} already exists, and punt init never replaces a Workflow`,
		);
	}
	const git = join(root, ".git");
	// `Bun.file().exists()` is false for a directory, so it can't tell a repo.
	const isRepo = await stat(git).then(
		(found) => found.isDirectory(),
		() => false,
	);
	if (!isRepo) {
		throw new Error(
			`${root} has no .git directory, and punt init needs .git/info/exclude to keep Goals out of git`,
		);
	}
	console.log(commitExplanation);
	const answer = prompt("Commit the Workflow? [y/N]") ?? "";
	const commitWorkflow = /^y(es)?$/i.test(answer.trim());
	for (const [path, text] of Object.entries(starterFiles)) {
		await Bun.write(join(punt, path), text);
	}
	const exclude = Bun.file(join(git, "info", "exclude"));
	const excluded = (await exclude.exists()) ? await exclude.text() : "";
	const wantedLines = commitWorkflow
		? [".punt/goals/"]
		: [".punt/goals/", ".punt/"];
	const missing = wantedLines.filter(
		(line) => !excluded.split("\n").includes(line),
	);
	if (missing.length === 0) return;
	// A last line without its newline would run into the first added one.
	const separator = excluded === "" || excluded.endsWith("\n") ? "" : "\n";
	await Bun.write(exclude, `${excluded}${separator}${missing.join("\n")}\n`);
}
