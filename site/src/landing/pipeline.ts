// Lights Pipeline.astro's stages as the pipeline crosses the screen: the rail fills, the replayed Ticket
// goes from waiting to running to done while its Steps run one by one, its commit lands and the PR's
// figures move on. With reduced motion it leaves the pipeline as drawn, finished. Hides the scroll
// arithmetic.

/** Mounts the scroll lighting on `pipeline`, the element with `data-pipeline`. */
export function mountPipeline(pipeline: HTMLElement): void {
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const stages = [...pipeline.querySelectorAll<HTMLElement>("[data-stage]")];
	const steps = [...pipeline.querySelectorAll<HTMLElement>("[data-step]")];
	const ticket = pipeline.querySelector<HTMLElement>("[data-replayed-ticket]");
	const landed = pipeline.querySelector<HTMLElement>("[data-landed]");
	const pr = pipeline.querySelector<HTMLElement>("[data-pr]");
	const set = (element: HTMLElement | null, state: PipelineState) => {
		if (element !== null) element.dataset.state = state;
	};

	const frame = () => {
		// How far through, in stages: 0 as its top comes up the screen, 5 once its end is well in view.
		const box = pipeline.getBoundingClientRect();
		const at =
			clamp01(
				(innerHeight * 0.82 - box.top) / (box.height + innerHeight * 0.3),
			) * stages.length;
		pipeline.style.setProperty("--fill", String(clamp01((at - 0.2) / 4)));
		for (const [index, stage] of stages.entries())
			stage.classList.toggle("is-dark", at < index + 0.2);
		// The Steps run across the third stage, one after another.
		for (const [index, step] of steps.entries()) {
			const start = 2 + index / steps.length;
			set(
				step,
				at >= start + 1 / steps.length ? "done" : at >= start ? "cur" : "pend",
			);
		}
		set(ticket, at >= 3 ? "done" : at >= 1.2 ? "cur" : "pend");
		set(landed, at >= 3.1 ? "done" : "pend");
		set(pr, at >= 4.1 ? "done" : "pend");
	};

	let queued = false;
	addEventListener(
		"scroll",
		() => {
			if (queued) return;
			queued = true;
			requestAnimationFrame(() => {
				queued = false;
				frame();
			});
		},
		{ passive: true },
	);
	frame();
}

type PipelineState = "pend" | "cur" | "done";

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}
