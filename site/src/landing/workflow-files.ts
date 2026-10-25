// Runs WorkflowFiles.astro: the tabs between the starter Workflows, small.toml's Steps marked from the state
// of the live TUI beside it, and the button that shows the stuck Goal in that TUI and back. Hides how a
// TUI state becomes a mark on each Step.

import { type LiveTuiState, liveTui } from "../tui/live-tui.ts";
import type { ReplayPlace } from "../tui/tui-replay.ts";

/** Mounts the section on `section`, the element with `data-workflow-files`. */
export function mountWorkflowFiles(section: HTMLElement): void {
	const find = (selector: string) => {
		const element = section.querySelector<HTMLElement>(selector);
		if (element === null)
			throw new Error(
				`The Workflow section needs ${selector} from WorkflowFiles.astro`,
			);
		return element;
	};
	const file = find("[data-workflow-tui]");
	const tuiRoot = document.getElementById(file.dataset.workflowTui ?? "");
	if (tuiRoot === null)
		throw new Error(
			"The Workflow section's file names no live TUI on the page",
		);
	const tui = liveTui(tuiRoot);
	const now = find("[data-now]");
	const stuckButton = find("[data-show-stuck]");
	const stuckGoal = stuckButton.dataset.showStuck ?? "";
	const blocks = [...file.querySelectorAll<HTMLElement>("[data-list=steps]")];
	const reduced = matchMedia("(prefers-reduced-motion: reduce)");

	const show = (state: LiveTuiState) => {
		const stuck = state.goal === stuckGoal;
		section.toggleAttribute("data-stuck", stuck);
		stuckButton.setAttribute("aria-pressed", String(stuck));
		stuckButton.textContent = stuck
			? `Back to ${now.dataset.goal}`
			: "Show a stuck Goal in the TUI";
		// Stuck, the Goal stopped on its stuck Step; otherwise the replayed Ticket is on the TUI's Step, or
		// merged when it has none.
		const at = stuck ? stuckButton.dataset.stuckStep : state.step;
		const current = blocks.findIndex(({ dataset }) => dataset.step === at);
		for (const [index, block] of blocks.entries())
			block.dataset.state = stepMark(index, current, stuck, block.dataset.when);
		now.textContent = stuck
			? `${stuckGoal}: ${at} failed four times, so its Ticket is stuck`
			: `${now.dataset.goal} · ${state.label}`;
	};
	tui.onChange(show);
	show(tui.state());

	stuckButton.addEventListener("click", () => {
		const toStuck = tui.state().goal !== stuckGoal;
		tui.goto(
			JSON.parse(
				(toStuck
					? stuckButton.dataset.stuckPlace
					: stuckButton.dataset.replayPlace) ?? "{}",
			) as ReplayPlace,
		);
		if (toStuck || reduced.matches) tui.pause();
		else tui.play();
	});

	// The tabs, as a tablist: a click or the arrow keys pick one.
	const tabs = [...section.querySelectorAll<HTMLElement>("[data-tab]")];
	const panels = [...section.querySelectorAll<HTMLElement>("[data-panel]")];
	const pick = (picked: number) => {
		for (const [index, tab] of tabs.entries()) {
			tab.setAttribute("aria-selected", String(index === picked));
			tab.tabIndex = index === picked ? 0 : -1;
		}
		for (const [index, panel] of panels.entries())
			panel.hidden = index !== picked;
	};
	for (const [index, tab] of tabs.entries()) {
		tab.addEventListener("click", () => pick(index));
		tab.addEventListener("keydown", (event) => {
			if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
			event.preventDefault();
			const next =
				(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
				tabs.length;
			pick(next);
			tabs[next]?.focus();
		});
	}
}

/** How a Step block is marked: not reached, running, done, skipped, or failed. */
type StepMark = "pend" | "cur" | "done" | "skip" | "bad";

// The mark of the `index`th Ticket Step when the Ticket is on the `current`th, -1 once merged. The
// replayed Ticket isn't its Goal's last, so a last-ticket Step is skipped.
function stepMark(
	index: number,
	current: number,
	stuck: boolean,
	when: string | undefined,
): StepMark {
	if (stuck)
		return index < current ? "done" : index === current ? "bad" : "pend";
	if (when === "last-ticket") return "skip";
	if (current < 0 || index < current) return "done";
	return index === current ? "cur" : "pend";
}
