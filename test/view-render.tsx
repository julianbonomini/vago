// Test helper: the Project view rendered through OpenTUI's test renderer, the
// seam the TUI's tests go through, and waiting for the frame a test expects.

import { onTestFinished } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { ProjectView } from "../src/tui/project-view.tsx";

// Each test cleans up after itself through `onTestFinished`, not a shared
// `afterEach`: a hook here would run only for the first test file that
// imports this one.

/** Sets the environment variables in `variables` for the rest of the test. */
export function setEnv(variables: Record<string, string>): void {
	for (const [name, value] of Object.entries(variables)) {
		process.env[name] = value;
		onTestFinished(() => {
			delete process.env[name];
		});
	}
}

/** A frame of printable ASCII only, as `VAGO_ASCII=1` draws. */
export const onlyAscii = /^[\x20-\x7e\n]*$/;

/**
 * The Project view of the Project at `root` in a test terminal of `size`,
 * destroyed after the test.
 */
export async function renderView(
	root: string,
	size = { width: 80, height: 24 },
): Promise<TestRendererSetup> {
	const view = await testRender(() => <ProjectView root={root} />, size);
	// Destroyed, so it doesn't keep drawing while the rest of the suite runs
	// in the same process.
	onTestFinished(() => view.renderer.destroy());
	return view;
}

/**
 * Draws frames until one contains `text`, and returns it. The view reads its
 * Goals from disk, so the first frames can come before the read is done, and
 * a change on disk shows within one second's re-read. Throws, showing the
 * last frame, after about three seconds.
 */
export async function frameWith(
	view: TestRendererSetup,
	text: string,
): Promise<string> {
	for (let tries = 0; ; tries++) {
		await view.renderOnce();
		const frame = view.captureCharFrame();
		if (frame.includes(text)) return frame;
		if (tries === 300) throw new Error(`No frame shows ${text}:\n${frame}`);
		await Bun.sleep(10);
	}
}

/** Draws frames until none contains `text`, and returns the last. */
export async function frameWithout(
	view: TestRendererSetup,
	text: string,
): Promise<string> {
	for (let tries = 0; ; tries++) {
		await view.renderOnce();
		const frame = view.captureCharFrame();
		if (!frame.includes(text)) return frame;
		if (tries === 300) throw new Error(`Every frame shows ${text}:\n${frame}`);
		await Bun.sleep(10);
	}
}
