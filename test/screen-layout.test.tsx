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

// Each screen, opened from the Project view, with a text only it shows and
// the rows of its header area: the Project's line, then in the Goal view the
// Goal's name, numbers and bar.
const screens: {
	name: string;
	open: (view: TestRendererSetup) => void;
	shows: string;
	headerRows: number;
}[] = [
	{
		name: "the Project view",
		open: () => {},
		shows: "Workflow small",
		headerRows: 1,
	},
	{
		name: "the help screen",
		open: (view) => view.mockInput.pressKey("?"),
		shows: "Keys",
		headerRows: 1,
	},
	{
		name: "the Goal view",
		open: (view) => view.mockInput.pressEnter(),
		shows: "1/2 Tickets",
		headerRows: 5,
	},
	{
		name: "the Ticket full screen",
		open: (view) => {
			view.mockInput.pressEnter();
			view.mockInput.pressKey("t");
		},
		shows: "Ticket 02",
		headerRows: 5,
	},
	{
		name: "the Run full screen",
		open: (view) => {
			view.mockInput.pressEnter();
			view.mockInput.pressKey("r");
		},
		shows: "Run 1",
		headerRows: 5,
	},
];

// A line between panes, in every look.
const divider = /^[─┬┴┼├┤+-]+$/;

for (const size of [
	{ width: 60, height: 24 },
	{ width: 80, height: 24 },
]) {
	for (const look of ["colour", "NO_COLOR", "VAGO_ASCII=1"]) {
		test(`at ${size.width}×${size.height} in ${look} every screen has the Project's header and its panes edge to edge, framed by lines`, async () => {
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
				expect(lines[0]).toMatch(
					/ 0 done [·|] 0 ready [·|] 0 running [·|] 1 stuck [·|] \$2\.50 spent $/,
				);
				header ??= lines[0];
				expect(lines[0]).toBe(header ?? "");
				// A line under the header area and one over the footer frame the
				// panes.
				expect(lines[screen.headerRows]).toMatch(divider);
				expect(lines.at(-2)).toMatch(divider);
				// Between the header area and the footer every row spans the
				// screen, no pane sits empty between two lines, and no two lines
				// sit side by side.
				const body = lines.slice(screen.headerRows, -1);
				for (const line of body) {
					expect(Bun.stringWidth(line)).toBe(size.width);
				}
				body.forEach((line, index) => {
					if (divider.test(line)) {
						expect(body[index + 1] ?? "").not.toMatch(divider);
					}
				});
				expect(frame).not.toMatch(/[│┃|][│┃|]/);
				expect(lines.at(-1)).toContain("? Help");
			}
		});
	}
}

test("panes share one line, joined where lines meet, and each title is a row of its own", async () => {
	const root = await stuckGoal();
	const view = await renderView(root);
	const project = await frameWith(view, "Workflow small");
	expect(project).toMatch(/\n─+\n {2}worktrees +Workflow small/);

	view.mockInput.pressEnter();
	const goal = await frameWith(view, "Goal 1 of 1");
	// The header area's line over the Tickets and the Ticket, the Tickets
	// over their Runs, and both over the Run.
	expect(goal).toMatch(
		/\n─+┬─+\n {2}Tickets +2\/2 │ Ticket 02 +1 Run · 30m 0s · \$1\.25 {2}\n/,
	);
	expect(goal).toMatch(/\n─+┤ .*\n {2}Runs of Ticket 02 +│/);
	expect(goal).toMatch(/\n─+┴─+\n {2}Run 1 · 02 check /);
});
