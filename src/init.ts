// `vago init`: puts the starter, embedded in the binary with every Workflow,
// into a Project's `.vago/`. Hides the starter's file list and the lines it
// adds to `.git/info/exclude`.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import architecturePrompt from "../starter/prompts/architecture.md" with {
	type: "text",
};
import designPrompt from "../starter/prompts/design.md" with { type: "text" };
import implementPrompt from "../starter/prompts/implement.md" with {
	type: "text",
};
import productPrompt from "../starter/prompts/product.md" with { type: "text" };
import reviewPrompt from "../starter/prompts/review.md" with { type: "text" };
import smallImplementPrompt from "../starter/prompts/small-implement.md" with {
	type: "text",
};
import smallReviewPrompt from "../starter/prompts/small-review.md" with {
	type: "text",
};
import aposd from "../starter/rules/aposd.md" with { type: "text" };
import codeStyle from "../starter/rules/code-style.md" with { type: "text" };
import branchScript from "../starter/scripts/branch.sh" with { type: "text" };
import mergeScript from "../starter/scripts/merge.sh" with { type: "text" };
import smallWorkflow from "../starter/workflows/small.toml" with {
	type: "text",
};
import tryHardWorkflow from "../starter/workflows/try-hard.toml" with {
	type: "text",
};
import { goalsFolderName } from "./tickets.ts";

// Each starter file's text, by its path under `starter/`, which is its path
// under `.vago/` too.
const starterFiles: Record<string, string> = {
	"workflows/try-hard.toml": tryHardWorkflow,
	"workflows/small.toml": smallWorkflow,
	"rules/aposd.md": aposd,
	"rules/code-style.md": codeStyle,
	"prompts/design.md": designPrompt,
	"prompts/product.md": productPrompt,
	"prompts/architecture.md": architecturePrompt,
	"prompts/implement.md": implementPrompt,
	"prompts/review.md": reviewPrompt,
	"prompts/small-implement.md": smallImplementPrompt,
	"prompts/small-review.md": smallReviewPrompt,
	"scripts/branch.sh": branchScript,
	"scripts/merge.sh": mergeScript,
};

// The trailing slash makes git match only a directory.
const goalsExcludeLine = `${goalsFolderName}/`;

const commitExplanation = `Committing the Workflow in .vago/ shares it with everyone who clones this repo.
Not committing it adds all of .vago/ to .git/info/exclude, so it stays in this checkout.
Goals and Tickets in ${goalsExcludeLine} stay out of git either way.`;

/**
 * Asks on stdin whether the Workflow will be committed, then copies the
 * starter, every Workflow included, into `.vago/` of the Project at `root`.
 * `.git/info/exclude` gets the Goals folder, and `.vago/` unless the
 * answer is yes. An empty answer, or no stdin, counts as no. Throws an Error
 * naming the problem, before asking or changing anything, when a file it
 * would write already exists or `root` has no `.git` directory.
 */
export async function initProject(root: string): Promise<void> {
	const vago = join(root, ".vago");
	// Every file, not only the Workflows: a Project laid out before
	// `.vago/workflows/` has no Workflow there but may hold tuned prompts.
	for (const path of Object.keys(starterFiles)) {
		const starterPath = join(vago, path);
		if (await Bun.file(starterPath).exists()) {
			throw new Error(
				`${starterPath} already exists, and vago init never replaces a file in .vago/`,
			);
		}
	}
	const git = join(root, ".git");
	// `Bun.file().exists()` is false for a directory, so it can't tell a repo.
	const isRepo = await stat(git).then(
		(found) => found.isDirectory(),
		() => false,
	);
	if (!isRepo) {
		throw new Error(
			`${root} has no .git directory, and vago init needs .git/info/exclude to keep Goals out of git`,
		);
	}
	console.log(commitExplanation);
	const answer = prompt("Commit the Workflow? [y/N]") ?? "";
	const commitWorkflow = /^y(es)?$/i.test(answer.trim());
	for (const [path, text] of Object.entries(starterFiles)) {
		await Bun.write(join(vago, path), text);
	}
	const exclude = Bun.file(join(git, "info", "exclude"));
	const excluded = (await exclude.exists()) ? await exclude.text() : "";
	const wantedLines = commitWorkflow
		? [goalsExcludeLine]
		: [goalsExcludeLine, ".vago/"];
	const missing = wantedLines.filter(
		(line) => !excluded.split("\n").includes(line),
	);
	if (missing.length === 0) return;
	// A last line without its newline would run into the first added one.
	const separator = excluded === "" || excluded.endsWith("\n") ? "" : "\n";
	await Bun.write(exclude, `${excluded}${separator}${missing.join("\n")}\n`);
}
