// `vago init` and `vago update`: put the starter, embedded in the binary with
// every Workflow, into a Project's `.vago/` and its `vago-` skills into
// `.claude/skills/` and `.agents/skills/`, the first time or over an older
// starter. Hides the starter's file list, where each file goes, and the lines
// it adds to `.git/info/exclude`.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import architecturePrompt from "../starter/prompts/architecture.md" with {
	type: "text",
};
import describePrompt from "../starter/prompts/describe.md" with {
	type: "text",
};
import designPrompt from "../starter/prompts/design.md" with { type: "text" };
import designChoicesPrompt from "../starter/prompts/design-choices.md" with {
	type: "text",
};
import goalReviewPrompt from "../starter/prompts/goal-review.md" with {
	type: "text",
};
import implementPrompt from "../starter/prompts/implement.md" with {
	type: "text",
};
import planningPrompt from "../starter/prompts/planning.md" with {
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
import githubScript from "../starter/scripts/github.sh" with { type: "text" };
import mergeScript from "../starter/scripts/merge.sh" with { type: "text" };
import readyScript from "../starter/scripts/ready.sh" with { type: "text" };
import checkRedFlagsSkill from "../starter/skills/vago-check-red-flags/SKILL.md" with {
	type: "text",
};
import designModuleAposd from "../starter/skills/vago-design-module/aposd.md" with {
	type: "text",
};
import designModuleSkill from "../starter/skills/vago-design-module/SKILL.md" with {
	type: "text",
};
import grillingCredits from "../starter/skills/vago-grilling/CREDITS.md" with {
	type: "text",
};
import grillingSkill from "../starter/skills/vago-grilling/SKILL.md" with {
	type: "text",
};
import prCredits from "../starter/skills/vago-pr/CREDITS.md" with {
	type: "text",
};
import prSkill from "../starter/skills/vago-pr/SKILL.md" with { type: "text" };
import toGoalSkill from "../starter/skills/vago-to-goal/SKILL.md" with {
	type: "text",
};
import toTicketsSkill from "../starter/skills/vago-to-tickets/SKILL.md" with {
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
import { goalsFolderName } from "./tickets/tickets.ts";

// Each skill file's text, by its path under `starter/skills/`.
const skillFiles: Record<string, string> = {
	"vago-check-red-flags/SKILL.md": checkRedFlagsSkill,
	"vago-design-module/SKILL.md": designModuleSkill,
	"vago-design-module/aposd.md": designModuleAposd,
	"vago-grilling/CREDITS.md": grillingCredits,
	"vago-grilling/SKILL.md": grillingSkill,
	"vago-pr/CREDITS.md": prCredits,
	"vago-pr/SKILL.md": prSkill,
	"vago-to-goal/SKILL.md": toGoalSkill,
	"vago-to-tickets/SKILL.md": toTicketsSkill,
	"vago-write-code/SKILL.md": writeCodeSkill,
};

// Where each Harness finds a Project's skills: Claude Code in `.claude/skills/`,
// Codex in `.agents/skills/`. Every skill goes into both, so a starter prompt
// that names one works on either Harness.
const skillFolders = [".claude/skills", ".agents/skills"];

// Each starter file's text, by its path in the Project. A skill goes into every
// skill folder; every other file keeps its `starter/` path under `.vago/`.
const starterFiles: Record<string, string> = {
	".vago/workflows/try-hard.toml": tryHardWorkflow,
	".vago/workflows/small.toml": smallWorkflow,
	".vago/prompts/design.md": designPrompt,
	".vago/prompts/product.md": productPrompt,
	".vago/prompts/architecture.md": architecturePrompt,
	".vago/prompts/design-choices.md": designChoicesPrompt,
	".vago/prompts/implement.md": implementPrompt,
	".vago/prompts/review.md": reviewPrompt,
	".vago/prompts/small-implement.md": smallImplementPrompt,
	".vago/prompts/small-review.md": smallReviewPrompt,
	".vago/prompts/goal-review.md": goalReviewPrompt,
	".vago/prompts/describe.md": describePrompt,
	".vago/prompts/planning.md": planningPrompt,
	".vago/scripts/branch.sh": branchScript,
	".vago/scripts/merge.sh": mergeScript,
	".vago/scripts/github.sh": githubScript,
	".vago/scripts/ready.sh": readyScript,
	...Object.fromEntries(
		skillFolders.flatMap((folder) =>
			Object.entries(skillFiles).map(([path, text]) => [
				`${folder}/${path}`,
				text,
			]),
		),
	),
};

// The folders holding `starterFiles`, which `.git/info/exclude` lists when the
// Workflow isn't committed. Each skill gets its own line, found by the
// `SKILL.md` every skill has, so the rest of `.claude/` and `.agents/` stays as
// git saw it.
// The trailing slash makes git match only a directory.
const workflowExcludeLines = [
	".vago/",
	...Object.keys(starterFiles)
		.filter((path) => path.endsWith("/SKILL.md"))
		.map((path) => path.slice(0, -"SKILL.md".length)),
];

const goalsExcludeLine = `${goalsFolderName}/`;

const commitExplanation = `Committing the Workflow in .vago/ and the vago- skills in .claude/skills/
and .agents/skills/ shares them with everyone who clones this repo. Not
committing them adds .vago/ and each vago- skill to .git/info/exclude, so they
stay in this checkout.
Goals and Tickets in ${goalsExcludeLine} stay out of git either way.`;

/**
 * Asks on stdin whether the Workflow will be committed, then copies the
 * starter, every Workflow included, into `.vago/` of the Project at `root`,
 * and its `vago-` skills into `.claude/skills/` and `.agents/skills/`.
 * `.git/info/exclude` gets the Goals folder, and `.vago/` and each skill's
 * folder unless the answer is yes. An empty answer, or no stdin, counts as no.
 * Throws an Error naming the problem, before asking or changing anything, when
 * a file it would write already exists or `root` has no `.git` directory.
 */
export async function initProject(root: string): Promise<void> {
	// Every file, not only the Workflows: a Project laid out before
	// `.vago/workflows/` has no Workflow there but may hold tuned prompts.
	for (const path of Object.keys(starterFiles)) {
		const projectPath = join(root, path);
		if (await Bun.file(projectPath).exists()) {
			throw new Error(
				`${projectPath} already exists, and vago init never replaces a file. vago update brings a set-up Project to the current starter`,
			);
		}
	}
	const git = await gitFolder(root);
	const commitWorkflow = askCommitWorkflow();
	for (const [path, text] of Object.entries(starterFiles)) {
		await Bun.write(join(root, path), text);
	}
	await addExcludeLines(git, commitWorkflow);
}

/**
 * Brings the Project at `root`, set up by `vago init`, to the starter this
 * binary ships: writes every starter file in `.vago/`, `.claude/skills/` and
 * `.agents/skills/` whose text differs or is missing, and prints each path it
 * wrote, relative to `root`. Files that aren't the starter's, and
 * `.vago-goals/`, stay as they are. It keeps the commit answer
 * `.git/info/exclude` records, adding any exclude line a newer starter needs
 * and printing `.git/info/exclude` when it does; it asks, as init does, only
 * when the exclude names neither `.vago/` nor the Goals folder. Prints nothing when the Project already matches.
 * Throws an Error naming the problem, before changing anything, when `root`
 * has no `.vago/` or no `.git` directory.
 */
export async function updateProject(root: string): Promise<void> {
	if (!(await isDirectory(join(root, ".vago")))) {
		throw new Error(`${root} has no .vago/, so run vago init to set it up`);
	}
	const git = await gitFolder(root);
	const excluded = (await excludeText(git)).split("\n");
	// Init always excludes the Goals folder, and `.vago/` only when the answer
	// was no, so the Goals line alone means the answer was yes.
	const commitWorkflow = excluded.includes(".vago/")
		? false
		: excluded.includes(goalsExcludeLine) || askCommitWorkflow();
	for (const [path, text] of Object.entries(starterFiles)) {
		const file = Bun.file(join(root, path));
		if ((await file.exists()) && (await file.text()) === text) continue;
		await Bun.write(file, text);
		console.log(path);
	}
	if (await addExcludeLines(git, commitWorkflow)) {
		console.log(".git/info/exclude");
	}
}

// `Bun.file().exists()` is false for a directory, so it can't tell one.
async function isDirectory(path: string): Promise<boolean> {
	return stat(path).then(
		(found) => found.isDirectory(),
		() => false,
	);
}

// The Project's `.git` directory. Throws when there is none, since every
// Project needs `.git/info/exclude` to keep Goals out of git.
async function gitFolder(root: string): Promise<string> {
	const git = join(root, ".git");
	if (!(await isDirectory(git))) {
		throw new Error(
			`${root} has no .git directory, and vago needs .git/info/exclude to keep Goals out of git`,
		);
	}
	return git;
}

// Explains the choice and asks on stdin. An empty answer, or no stdin, is no.
function askCommitWorkflow(): boolean {
	console.log(commitExplanation);
	const answer = prompt("Commit the Workflow? [y/N]") ?? "";
	return /^y(es)?$/i.test(answer.trim());
}

async function excludeText(git: string): Promise<string> {
	const exclude = Bun.file(join(git, "info", "exclude"));
	return (await exclude.exists()) ? await exclude.text() : "";
}

// Appends the exclude lines the commit answer needs and the file lacks, and
// says whether it appended any.
async function addExcludeLines(
	git: string,
	commitWorkflow: boolean,
): Promise<boolean> {
	const excluded = await excludeText(git);
	const wantedLines = commitWorkflow
		? [goalsExcludeLine]
		: [goalsExcludeLine, ...workflowExcludeLines];
	const missing = wantedLines.filter(
		(line) => !excluded.split("\n").includes(line),
	);
	if (missing.length === 0) return false;
	// A last line without its newline would run into the first added one.
	const separator = excluded === "" || excluded.endsWith("\n") ? "" : "\n";
	await Bun.write(
		join(git, "info", "exclude"),
		`${excluded}${separator}${missing.join("\n")}\n`,
	);
	return true;
}
