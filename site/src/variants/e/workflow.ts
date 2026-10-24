// PROTOTYPE: the example Workflow as the page shows it, built from
// starter/workflows/small.toml with its comments left out. Each block knows
// the Step name the TUI's replay prints for it, so the page can light the
// block that's running.

export type WorkflowBlock = {
	/** The Step's name as the replay labels it; "" for blocks that never run in it. */
	step: string;
	/** "setting" for the top lines, "skip" for a Step the replay's Ticket skips. */
	kind: "setting" | "step" | "skip" | "after";
	lines: string[];
};

const stepBlock = (table: string, fields: [string, string][]) => {
	const pad = Math.max(...fields.map(([k]) => k.length));
	return [`[[${table}]]`, ...fields.map(([k, v]) => `${k.padEnd(pad)} = ${v}`)];
};

export const workflowBlocks: WorkflowBlock[] = [
	{
		step: "",
		kind: "setting",
		lines: ['harness      = "claude-code"', 'model        = "claude-opus-5-5"', 'idle_timeout = "10m"'],
	},
	{
		step: "New branch",
		kind: "step",
		lines: stepBlock("steps", [
			["id", '"branch"'],
			["name", '"New branch"'],
			["type", '"shell"'],
			["run", '"sh .vago/scripts/branch.sh"'],
		]),
	},
	{
		step: "Build",
		kind: "step",
		lines: stepBlock("steps", [
			["id", '"implement"'],
			["name", '"Build"'],
			["type", '"agent"'],
			["prompt", '"prompts/small-implement.md"'],
		]),
	},
	{
		step: "Checks",
		kind: "step",
		lines: stepBlock("steps", [
			["id", '"check"'],
			["name", '"Checks"'],
			["type", '"shell"'],
			["run", '"bun run check"'],
			["on_fail", '"continue"'],
		]),
	},
	{
		step: "Review",
		kind: "step",
		lines: stepBlock("steps", [
			["id", '"review"'],
			["name", '"Review"'],
			["type", '"agent"'],
			["prompt", '"prompts/small-review.md"'],
		]),
	},
	{
		step: "Goal review",
		kind: "skip",
		lines: stepBlock("steps", [
			["id", '"goal-review"'],
			["name", '"Goal review"'],
			["type", '"agent"'],
			["prompt", '"prompts/goal-review.md"'],
			["when", '"last-ticket"'],
		]),
	},
	{
		step: "Squash merge",
		kind: "step",
		lines: stepBlock("steps", [
			["id", '"merge"'],
			["name", '"Squash merge"'],
			["type", '"shell"'],
			["run", '"sh .vago/scripts/merge.sh"'],
		]),
	},
	{
		step: "",
		kind: "after",
		lines: stepBlock("after_all", [
			["id", '"describe"'],
			["name", '"PR description"'],
			["type", '"agent"'],
			["prompt", '"prompts/describe.md"'],
		]),
	},
];

/** The Ticket Steps in the order the replay runs them. */
export const replaySteps = ["New branch", "Build", "Checks", "Review", "Squash merge"];
