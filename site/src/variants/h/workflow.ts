// PROTOTYPE: the two starter Workflows as variant H shows them, built from
// starter/workflows/small.toml and try-hard.toml with their comments left
// out. Each block of small.toml knows the Step name the TUI's replay prints
// for it, so the page can light the block that's running. The replay only
// runs small.toml, so try-hard's blocks never light.

export type WorkflowBlock = {
	/** The Step's name as the replay labels it; "" for blocks that never run in it. */
	step: string;
	/** "setting" for the top lines, "skip" for a Step the replay's Ticket skips. */
	kind: "setting" | "step" | "skip" | "after";
	lines: string[];
};

export type StarterFile = {
	file: string;
	blurb: string;
	/** Whether the replay runs this file, so its blocks light up. */
	replayed: boolean;
	blocks: WorkflowBlock[];
};

const table = (name: string, fields: [string, string][]) => {
	const pad = Math.max(...fields.map(([k]) => k.length));
	return [`[[${name}]]`, ...fields.map(([k, v]) => `${k.padEnd(pad)} = ${v}`)];
};
const agent = (id: string, name: string, prompt: string, extra: [string, string][] = []): WorkflowBlock => ({
	step: "",
	kind: "step",
	lines: table("steps", [["id", `"${id}"`], ["name", `"${name}"`], ["type", '"agent"'], ["prompt", `"${prompt}"`], ...extra]),
});
const shell = (id: string, name: string, run: string, extra: [string, string][] = []): WorkflowBlock => ({
	step: "",
	kind: "step",
	lines: table("steps", [["id", `"${id}"`], ["name", `"${name}"`], ["type", '"shell"'], ["run", `"${run}"`], ...extra]),
});
const lit = (b: WorkflowBlock, step: string): WorkflowBlock => ({ ...b, step });

const settings: WorkflowBlock = {
	step: "",
	kind: "setting",
	lines: ['harness      = "claude-code"', 'model        = "claude-opus-5-5"', 'idle_timeout = "10m"'],
};
const goalReview: WorkflowBlock = { ...agent("goal-review", "Goal review", "prompts/goal-review.md", [["when", '"last-ticket"']]), kind: "skip" };
const after: WorkflowBlock[] = [
	{ step: "", kind: "after", lines: table("after_all", [["id", '"describe"'], ["name", '"PR description"'], ["type", '"agent"'], ["prompt", '"prompts/describe.md"']]) },
	{ step: "", kind: "after", lines: table("after_all", [["id", '"ready"'], ["name", '"Ready for review"'], ["type", '"shell"'], ["run", '"sh .vago/scripts/ready.sh"']]) },
];

export const starterFiles: StarterFile[] = [
	{
		file: "small.toml",
		blurb: "For small Tickets that are already clear. One agent builds, a fresh one reviews.",
		replayed: true,
		blocks: [
			settings,
			lit(shell("branch", "New branch", "sh .vago/scripts/branch.sh"), "New branch"),
			lit(agent("implement", "Build", "prompts/small-implement.md"), "Build"),
			lit(shell("check", "Checks", "bun run check", [["on_fail", '"continue"']]), "Checks"),
			lit(agent("review", "Review", "prompts/small-review.md"), "Review"),
			goalReview,
			lit(shell("merge", "Squash merge", "sh .vago/scripts/merge.sh"), "Squash merge"),
			...after,
		],
	},
	{
		file: "try-hard.toml",
		blurb: "For Tickets that need thinking first: design, product and architecture passes before anything is built. The replay runs small.toml, so nothing lights up here.",
		replayed: false,
		blocks: [
			settings,
			shell("branch", "New branch", "sh .vago/scripts/branch.sh"),
			agent("design", "Design", "prompts/design.md"),
			agent("product", "Product", "prompts/product.md"),
			agent("architecture", "Architecture", "prompts/architecture.md"),
			agent("design-choices", "Design choices", "prompts/design-choices.md", [["goal_report", "true"]]),
			agent("implement", "Build", "prompts/implement.md"),
			shell("check", "Checks", "bun run check", [["on_fail", '"continue"']]),
			agent("review", "Review", "prompts/review.md"),
			goalReview,
			shell("merge", "Squash merge", "sh .vago/scripts/merge.sh"),
			...after,
		],
	},
];

/** The Ticket Steps in the order the replay runs them. */
export const replaySteps = ["New branch", "Build", "Checks", "Review", "Squash merge"];
