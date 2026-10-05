import { expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { goalText, makeProject, ticketText } from "./project.ts";
import { frameWith, renderView, setEnv } from "./view-render.tsx";

// Goal `worktrees`, stuck on Ticket 02 after Ticket 01 is done.
function stuckGoal(): Promise<string> {
	const ended = (step: string, outcome: string) => ({
		step,
		started: new Date("2026-10-01T08:00:00Z"),
		ended: new Date("2026-10-01T08:30:00Z"),
		outcome,
		costUsd: 1.25,
	});
	return makeProject({
		".vago-goals/worktrees/goal.md": goalText(
			"small",
			"# Each Goal runs in its own worktree\n",
		),
		".vago-goals/worktrees/tickets/01-separate.md": ticketText("done", {
			runs: [ended("implement", "ok")],
		}),
		".vago-goals/worktrees/tickets/02-run-in-worktree.md": ticketText("stuck", {
			blockedBy: [1],
			runs: [ended("check", "exit 1")],
		}),
	});
}

// Each screen, opened from the Project view, with a text only it shows.
const screens: {
	name: string;
	open: (view: TestRendererSetup) => void;
	shows: string;
}[] = [
	{ name: "the Project view", open: () => {}, shows: "Workflow small" },
	{
		name: "the help screen",
		open: (view) => view.mockInput.pressKey("?"),
		shows: "Keys",
	},
	{
		name: "the Goal view",
		open: (view) => view.mockInput.pressEnter(),
		shows: "Goal 1/1",
	},
	{
		name: "the Ticket full screen",
		open: (view) => {
			view.mockInput.pressEnter();
			view.mockInput.pressKey("t");
		},
		shows: "Ticket 02",
	},
	{
		name: "the Run full screen",
		open: (view) => {
			view.mockInput.pressEnter();
			view.mockInput.pressKey("r");
		},
		shows: "Run 1",
	},
];

// The glyphs a pane's left or right edge is drawn with, in every look.
const edge = /[│┃├┤┣┫┌┐└┘┏┓┗┛|+#]/;

for (const size of [
	{ width: 60, height: 24 },
	{ width: 80, height: 24 },
]) {
	for (const look of ["colour", "NO_COLOR", "VAGO_ASCII=1"]) {
		test(`at ${size.width}×${size.height} in ${look} every screen has the Project's header and its boxes edge to edge`, async () => {
			if (look === "NO_COLOR") setEnv({ NO_COLOR: "1" });
			if (look === "VAGO_ASCII=1") setEnv({ VAGO_ASCII: "1" });
			const root = await stuckGoal();
			let header: string | undefined;
			for (const screen of screens) {
				const view = await renderView(root, size);
				await frameWith(view, "1/1 ");
				screen.open(view);
				await Bun.sleep(20);
				const frame = await frameWith(view, screen.shows);
				const lines = frame.split("\n").slice(0, size.height);

				// The header is the same line on every screen.
				expect(lines[0]).toMatch(/ [·|] 1 Goals .* spent/);
				header ??= lines[0];
				expect(lines[0]).toBe(header ?? "");
				// Between the header and the footer every row is inside a box, so
				// no blank row sits between two, and no two borders sit side by
				// side, so neither does a blank column.
				for (const line of lines.slice(1, -1)) {
					expect(line[0] ?? "").toMatch(edge);
					expect(line.at(-1) ?? "").toMatch(edge);
				}
				expect(frame).not.toMatch(/[│┃|][│┃|]|[┘┛┐┓+][┌┏└┗+]/);
				expect(lines.at(-1)).toContain("? Help");
			}
		});
	}
}

test("a box under another shares its line, joined at the corners, with both titles on it", async () => {
	const root = await stuckGoal();
	const view = await renderView(root);
	const project = await frameWith(view, "Workflow small");
	expect(project).toMatch(/\n├─ worktrees ─+ 1\/1 ─┤\n/);

	view.mockInput.pressEnter();
	const goal = await frameWith(view, "Goal 1/1");
	// The Goal's box over the Tickets and the Ticket, the Tickets over their
	// Runs, and both over the Run.
	expect(goal).toMatch(/\n├─ Tickets ─+┬─ Ticket 02 ─+┤\n/);
	expect(goal).toMatch(/\n├─ Runs of Ticket 02 ─+ 2\/2 ─┤ /);
	expect(goal).toMatch(
		/\n├─ Run 1 · 02 check ─+┴─+ 1 Run · 30m 0s · \$1\.25 ─┤\n/,
	);
});
