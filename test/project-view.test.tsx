import { afterEach, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import type { TestRendererSetup } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { ProjectView } from "../src/tui.tsx";
import { makeProject, projectWithGoals } from "./project.ts";

let rendered: TestRendererSetup[] = [];

// Each test renderer is destroyed after its test, so none keeps drawing while
// the rest of the suite runs in the same process.
afterEach(() => {
	for (const view of rendered) view.renderer.destroy();
	rendered = [];
});

async function renderView(root: string): Promise<TestRendererSetup> {
	const view = await testRender(() => <ProjectView root={root} />, {
		width: 80,
		height: 24,
	});
	rendered.push(view);
	return view;
}

// Draws frames until one contains `text`, and returns it. The view reads its
// Goals from disk, so the first frames can come before the read is done.
async function frameWith(
	view: TestRendererSetup,
	text: string,
): Promise<string> {
	for (let tries = 0; ; tries++) {
		await view.renderOnce();
		const frame = view.captureCharFrame();
		if (frame.includes(text)) return frame;
		if (tries === 100) throw new Error(`No frame shows ${text}:\n${frame}`);
		await Bun.sleep(10);
	}
}

test("the Project view lists every Goal by name, in name order", async () => {
	const root = await projectWithGoals(["beta", "alpha", "gamma"]);

	const view = await renderView(root);
	const frame = await frameWith(view, "gamma");

	const lines = frame.split("\n");
	const alpha = lines.findIndex((line) => line.includes("alpha"));
	expect(alpha).toBeGreaterThan(-1);
	expect(lines[alpha + 1]).toContain("beta");
	expect(lines[alpha + 2]).toContain("gamma");
	expect(frame).toContain("1/3");
});

test("↓ and j move the selection down", async () => {
	const root = await projectWithGoals(["alpha", "beta", "gamma"]);
	const view = await renderView(root);
	await frameWith(view, "1/3");

	view.mockInput.pressArrow("down");
	await frameWith(view, "2/3");
	view.mockInput.pressKey("j");
	await frameWith(view, "3/3");
});

test("the selection stops at the first and the last Goal", async () => {
	const root = await projectWithGoals(["alpha", "beta", "gamma"]);
	const view = await renderView(root);
	await frameWith(view, " 1/3 ");

	view.mockInput.pressArrow("up");
	view.mockInput.pressKey("k");
	await frameWith(view, " 1/3 ");

	for (const _ of [1, 2, 3, 4]) view.mockInput.pressArrow("down");
	view.mockInput.pressKey("j");
	await frameWith(view, " 3/3 ");
	view.mockInput.pressArrow("up");
	await frameWith(view, " 2/3 ");
});

const accent = RGBA.fromHex("#ff8a3d");

// Whether the row that shows `name` has the accent colour behind it.
function isAccented(view: TestRendererSetup, name: string): boolean {
	for (const line of view.captureSpans().lines) {
		const span = line.spans.find((span) => span.text.includes(name));
		if (span !== undefined) return span.bg.equals(accent);
	}
	throw new Error(`No row shows ${name}`);
}

test("the selected Goal is drawn in the accent colour", async () => {
	const root = await projectWithGoals(["alpha", "beta"]);
	const view = await renderView(root);
	await frameWith(view, "1/2");

	expect(isAccented(view, "alpha")).toBe(true);
	expect(isAccented(view, "beta")).toBe(false);

	view.mockInput.pressArrow("down");
	await frameWith(view, "2/2");
	expect(isAccented(view, "beta")).toBe(true);
	expect(isAccented(view, "alpha")).toBe(false);
});

for (const [what, files] of [
	["an empty .vago-goals", { ".vago-goals/.keep": "" }],
	["no .vago-goals at all", {}],
] as const) {
	test(`a Project with ${what} shows an empty Goals box`, async () => {
		const root = await makeProject(files);
		const view = await renderView(root);

		const frame = await frameWith(view, " 0/0 ");

		expect(frame).toContain("Goals");
	});
}
