// `vago init`: puts the starter, embedded in the binary with every Workflow,
// into a Project's `.vago/` and its `vago-` skills into `.claude/skills/`.
// Hides the starter's file list, where each file goes, and the lines it adds
// to `.git/info/exclude`.

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
import branchScript from "../starter/scripts/branch.sh" with { type: "text" };
import mergeScript from "../starter/scripts/merge.sh" with { type: "text" };
import checkRedFlagsSkill from "../starter/skills/vago-check-red-flags/SKILL.md" with {
	type: "text",
};
import designModuleAposd from "../starter/skills/vago-design-module/aposd.md" with {
	type: "text",
};
import designModuleSkill from "../starter/skills/vago-design-module/SKILL.md" with {
	type: "text",
};
import writeCodeSkill from "../starter/skills/vago-write-code/SKILL.md" with {
	type: "text",
};
import smallWorkflow from "../starter/workflows/small.toml" with {
	type: "text",
};
import tryHardWorkflow from "../starter/workflows/try-hard.toml" with {
	type: "text",
};
import { goalsFolderName } from "./tickets.ts";

// Each starter file's text, by its path in the Project. A file under
// `starter/skills/` goes under `.claude/skills/`, where Claude Code finds it;
// every other one keeps its `starter/` path under `.vago/`.
const starterFiles: Record<string, string> = {
	".vago/workflows/try-hard.toml": tryHardWorkflow,
	".vago/workflows/small.toml": smallWorkflow,
	".vago/prompts/design.md": designPrompt,
	".vago/prompts/product.md": productPrompt,
	".vago/prompts/architecture.md": architecturePrompt,
	".vago/prompts/implement.md": implementPrompt,
	".vago/prompts/review.md": reviewPrompt,
	".vago/prompts/small-implement.md": smallImplementPrompt,
	".vago/prompts/small-review.md": smallReviewPrompt,
	".vago/scripts/branch.sh": branchScript,
	".vago/scripts/merge.sh": mergeScript,
	".claude/skills/vago-check-red-flags/SKILL.md": checkRedFlagsSkill,
	".claude/skills/vago-design-module/SKILL.md": designModuleSkill,
	".claude/skills/vago-design-module/aposd.md": designModuleAposd,
	".claude/skills/vago-write-code/SKILL.md": writeCodeSkill,
};

// The folders holding `starterFiles`, which `.git/info/exclude` lists when the
// Workflow isn't committed. Each skill gets its own line, found by the
// `SKILL.md` every skill has, so the rest of `.claude/` stays as git saw it.
// The trailing slash makes git match only a directory.
const workflowExcludeLines = [
	".vago/",
	...Object.keys(starterFiles)
		.filter((path) => path.endsWith("/SKILL.md"))
		.map((path) => path.slice(0, -"SKILL.md".length)),
];

const goalsExcludeLine = `${goalsFolderName}/`;

const commitExplanation = `Committing the Workflow in .vago/ and the vago- skills in .claude/skills/
shares them with everyone who clones this repo. Not committing them adds .vago/
and each vago- skill to .git/info/exclude, so they stay in this checkout.
Goals and Tickets in ${goalsExcludeLine} stay out of git either way.`;

/**
 * Asks on stdin whether the Workflow will be committed, then copies the
 * starter, every Workflow included, into `.vago/` of the Project at `root`,
 * and its `vago-` skills into `.claude/skills/`. `.git/info/exclude` gets the
 * Goals folder, and `.vago/` and each skill's folder unless the answer is
 * yes. An empty answer, or no stdin, counts as no. Throws an Error naming the
 * problem, before asking or changing anything, when a file it would write
 * already exists or `root` has no `.git` directory.
 */
export async function initProject(root: string): Promise<void> {
	// Every file, not only the Workflows: a Project laid out before
	// `.vago/workflows/` has no Workflow there but may hold tuned prompts.
	for (const path of Object.keys(starterFiles)) {
		const projectPath = join(root, path);
		if (await Bun.file(projectPath).exists()) {
			throw new Error(
				`${projectPath} already exists, and vago init never replaces a file`,
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
		await Bun.write(join(root, path), text);
	}
	const exclude = Bun.file(join(git, "info", "exclude"));
	const excluded = (await exclude.exists()) ? await exclude.text() : "";
	const wantedLines = commitWorkflow
		? [goalsExcludeLine]
		: [goalsExcludeLine, ...workflowExcludeLines];
	const missing = wantedLines.filter(
		(line) => !excluded.split("\n").includes(line),
	);
	if (missing.length === 0) return;
	// A last line without its newline would run into the first added one.
	const separator = excluded === "" || excluded.endsWith("\n") ? "" : "\n";
	await Bun.write(exclude, `${excluded}${separator}${missing.join("\n")}\n`);
}
