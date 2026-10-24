// PROTOTYPE, variant F: the story's beats and the artifact beside each, all
// from the example Project acme-shop that the TUI replays. A row is a list of
// [class, text] pieces; class "" is plain, "d" dim, "x" bright, "a" accent,
// "o" ok, "b" bad.

export type Piece = [string, string];
export type Row = Piece[];

export type Beat = {
	id: string;
	title: string;
	body: string;
	limit?: string;
	/** Which chapter of the strip over the TUI this beat lights. */
	chapter: number;
	goto: Record<string, unknown>;
	/** Replay time from a to b as the beat scrolls past. */
	scrub?: [number, number];
	file: string;
	rows: Row[];
	short?: boolean;
};

export const chapterNames = ["Goal", "Tickets", "Workflow", "Run", "Commit", "PR"];

const at = (time: string, day = "24") => `2026-10-${day}T${time}Z`;
const stepLine = (time: string, took: string, cost: string, step: string, outcome: string, cls: string, day = "24"): Row => [
	["d", `  ${at(time, day)}  ${took.padStart(6)}  ${cost.padStart(6)}  `],
	["", `${step} `],
	[cls, outcome],
];

export const beats: Beat[] = [
	{
		id: "goal",
		title: "You write the Goal",
		body: "What you want and why, what's in scope and what isn't, the way you'd brief a colleague. It's a Markdown file in your repo, and its header names the Workflow to run it with.",
		chapter: 0,
		goto: { moment: "project", goal: "gift-cards" },
		file: ".vago-goals/gift-cards/goal.md",
		rows: [
			[["d", "+++"]],
			[["", "workflow = "], ["a", '"small"']],
			[["d", "+++"]],
			[["x", "# Customers can pay with a gift card"]],
			[],
			[["x", "## Problem Statement"]],
			[["", "Customers ask for gift cards every December"]],
			[["", "and the shop has nothing to sell them."]],
			[],
			[["x", "## Out of scope"]],
			[["", "Printed cards. Selling cards in the shop's till."]],
		],
	},
	{
		id: "tickets",
		title: "You split it into Tickets",
		body: "Write them yourself, or plan them with an agent from the TUI and accept what it proposes. A Ticket can wait on another: 03 starts once 01 is done.",
		limit: "Tickets run one at a time. Separate Goals can run side by side.",
		chapter: 1,
		goto: { moment: "goal-running", pane: 0, time: 0 },
		file: ".vago-goals/gift-cards/tickets/",
		rows: [
			[["o", "✓ "], ["", "01 A gift card is a code with a balance"]],
			[["o", "✓ "], ["", "02 Checkout takes a gift card code"]],
			[["a", "● "], ["x", "03 Customers can check a card's balance"]],
			[["d", "  "], ["d", "   after 01"]],
			[["d", "○ "], ["", "04 Staff issue gift cards from the admin"]],
			[["d", "○ "], ["", "05 A refund on a gift card order goes"]],
			[["d", "  "], ["", "   back to the card"]],
		],
	},
	{
		id: "workflow",
		title: "Each Ticket runs your Workflow",
		body: "A Workflow is a short TOML file of Steps. An agent Step runs on Claude Code or Codex. A shell Step runs a command: a branch, your checks, a merge.",
		chapter: 2,
		goto: { moment: "ticket-steps" },
		scrub: [0, 0.36],
		file: ".vago/workflows/small.toml",
		rows: [
			[["", "harness = "], ["a", '"claude-code"']],
			[],
			[["x", "[[steps]]"]],
			[["", 'name = "New branch"']],
			[["", 'type = '], ["a", '"shell"']],
			[["", 'run  = "sh .vago/scripts/branch.sh"']],
			[],
			[["x", "[[steps]]"]],
			[["", 'name   = "Build"']],
			[["", 'type   = '], ["a", '"agent"']],
			[["", 'prompt = "prompts/small-implement.md"']],
			[],
			[["x", "[[steps]]"]],
			[["", 'name = "Checks"']],
			[["", 'type = '], ["a", '"shell"']],
			[["", 'run  = "bun run check"']],
			[],
			[["d", "# then Review, Goal review, Squash merge"]],
		],
	},
	{
		id: "run",
		title: "Watch a Run, or don't",
		body: "Every agent Step is a Run with its own session. The TUI streams what the agent reads, edits and runs. In your terminal, vago run prints one line per Step with what it took and what it cost.",
		chapter: 3,
		goto: { moment: "run-activity" },
		scrub: [0.36, 0.86],
		file: "vago run gift-cards",
		rows: [
			[["x", "03-balance-page"]],
			stepLine("14:02:11", "0.1s", "", "New branch", "ok", "o"),
			stepLine("14:11:23", "9m12s", "$0.86", "Build", "ok", "o"),
			stepLine("14:13:01", "1m38s", "", "Checks", "ok", "o"),
			stepLine("14:16:35", "3m34s", "$0.31", "Review", "ok", "o"),
			stepLine("14:16:40", "5.2s", "", "Squash merge", "ok", "o"),
		],
	},
	{
		id: "commit",
		title: "One Ticket, one commit",
		body: "Each Ticket is built on its own branch. When its Steps pass, the merge Step squashes it onto the Goal's branch as one commit, and the next Ticket starts.",
		chapter: 4,
		goto: { moment: "runs", time: 1 },
		file: "git log --oneline vago/gift-cards",
		rows: [
			[["a", "a83d5c1 "], ["x", "03 balance page"]],
			[["d", "7c41e0a "], ["", "02 redeem at checkout"]],
			[["d", "e19b3f2 "], ["", "01 gift card codes"]],
		],
	},
	{
		id: "pr",
		title: "One Goal, one PR",
		body: "After the last Ticket, two more Steps write the PR description from the Goal's report and mark the PR ready. Reviewing and merging it is your part. Here's low-stock-email, a Goal in acme-shop that's finished.",
		limit: "The PR goes through gh, so it needs a GitHub repo.",
		chapter: 5,
		goto: { moment: "done", pane: 0 },
		file: "acme-example/acme-shop #34",
		rows: [
			[["x", "Owners get an email before stock runs out"]],
			[["d", "vago/low-stock-email into main · "], ["o", "ready for review"]],
			[],
			[["d", "Workflow small · 3 of 3 Tickets · 41m 41s · $3.30"]],
			[["o", "✓ "], ["", "01 Each product has a low-stock threshold"]],
			[["o", "✓ "], ["", "02 A daily job finds products at or under it"]],
			[["o", "✓ "], ["", "03 The owner gets one email listing them"]],
		],
	},
	{
		id: "stuck",
		title: "When a Step keeps failing",
		body: "An agent Step that fails resumes its own session and tries again, up to three times. Then the Ticket is stuck and waits for you. Fix what it needs, run vago run again, and it picks up at that Step on the same branch.",
		// Past the strip's end: every chapter shows done.
		chapter: 6,
		goto: { moment: "stuck", pane: 3 },
		file: "vago run order-export",
		short: true,
		rows: [
			stepLine("10:15:47", "2m45s", "$0.19", "Build", "exit 1", "b", "22"),
			[["b", "02-date-range-filter is stuck after Build: exit 1"]],
			[["d", "  again:  "], ["", "vago run order-export"]],
		],
	},
];

// The two Workflows Vago ships in starter/workflows, as their Steps.
export type StarterStep = { name: string; type: "agent" | "shell"; what: string };
export const starters: { file: string; blurb: string; steps: StarterStep[]; after: StarterStep[] }[] = [
	{
		file: "small.toml",
		blurb: "For small Tickets that are already clear. One agent builds, a fresh one reviews.",
		steps: [
			{ name: "New branch", type: "shell", what: "sh .vago/scripts/branch.sh" },
			{ name: "Build", type: "agent", what: "prompts/small-implement.md" },
			{ name: "Checks", type: "shell", what: "bun run check" },
			{ name: "Review", type: "agent", what: "prompts/small-review.md" },
			{ name: "Goal review", type: "agent", what: "prompts/goal-review.md" },
			{ name: "Squash merge", type: "shell", what: "sh .vago/scripts/merge.sh" },
		],
		after: [
			{ name: "PR description", type: "agent", what: "prompts/describe.md" },
			{ name: "Ready for review", type: "shell", what: "sh .vago/scripts/ready.sh" },
		],
	},
	{
		file: "try-hard.toml",
		blurb: "For Tickets that need thinking first. Design, product and architecture passes before anything is built.",
		steps: [
			{ name: "New branch", type: "shell", what: "sh .vago/scripts/branch.sh" },
			{ name: "Design", type: "agent", what: "prompts/design.md" },
			{ name: "Product", type: "agent", what: "prompts/product.md" },
			{ name: "Architecture", type: "agent", what: "prompts/architecture.md" },
			{ name: "Design choices", type: "agent", what: "prompts/design-choices.md" },
			{ name: "Build", type: "agent", what: "prompts/implement.md" },
			{ name: "Checks", type: "shell", what: "bun run check" },
			{ name: "Review", type: "agent", what: "prompts/review.md" },
			{ name: "Goal review", type: "agent", what: "prompts/goal-review.md" },
			{ name: "Squash merge", type: "shell", what: "sh .vago/scripts/merge.sh" },
		],
		after: [
			{ name: "PR description", type: "agent", what: "prompts/describe.md" },
			{ name: "Ready for review", type: "shell", what: "sh .vago/scripts/ready.sh" },
		],
	},
];
