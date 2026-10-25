// The landing after the story: the pipeline, the Workflow file beside a second live TUI, install and limits,
// and the page's social preview.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { tuiFrames } from "../src/tui/tui-replay.ts";
import { servedAt } from "./built-site.ts";

const landing = servedAt("/") ?? "";
const starter = join(import.meta.dir, "..", "..", "starter", "workflows");

function text(html: string): string {
	return html
		.replace(/<[^>]+>/g, "")
		.replaceAll("&#34;", '"')
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

// The lines of the Workflow file the page shows under the tab for `file`, blank lines left out.
function shownWorkflow(file: string): string[] {
	const pre =
		landing.match(
			new RegExp(
				`<pre[^>]*data-workflow-file="${file}"[^>]*>([\\s\\S]*?)</pre>`,
			),
		)?.[1] ?? "";
	return pre
		.split(/<span class="wf-line"/)
		.slice(1)
		.map((line) => text(`<span${line}`).trimEnd())
		.filter((line) => line !== "");
}

test("after the story come the pipeline, the Workflow and install, in that order", () => {
	const story = landing.indexOf("Stop babysitting your agents");
	const pipeline = landing.indexOf("What happens after you leave");
	const workflow = landing.indexOf("Your Workflow is a short file");
	const install = landing.indexOf('id="install"');
	expect(story).toBeGreaterThan(-1);
	expect(pipeline).toBeGreaterThan(story);
	expect(workflow).toBeGreaterThan(pipeline);
	expect(install).toBeGreaterThan(workflow);
});

test("the pipeline goes from the Goal to the PR, with its limit beside it", () => {
	const pipeline = landing.match(/<ol[^>]*data-pipeline[\s\S]*?<\/ol>/)?.[0];
	expect(pipeline).toBeDefined();
	const stages = [...(pipeline ?? "").matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map(
		([, name]) => name,
	);
	expect(stages).toEqual(["Goal", "Tickets", "Steps", "Commits", "PR"]);
	expect(landing).toMatch(/data-pipeline[\s\S]*?<\/ol>\s*<p class="[^"]*limit/);
});

test("every time and cost the pipeline shows is in the captured frames", () => {
	const pipeline = text(
		landing.match(/<ol[^>]*data-pipeline[\s\S]*?<\/ol>/)?.[0] ?? "",
	);
	const frameText = tuiFrames.lines.map(({ text }) => text).join("\n");
	const shown = [
		...pipeline.matchAll(/\$\d+\.\d\d|\b\d+m \d+s\b|\b\d+\.\ds\b/g),
	].map(([figure]) => figure.replace(/^(\d+)\.\ds$/, "$1s"));
	expect(shown.length).toBeGreaterThan(5);
	expect(shown.filter((figure) => !frameText.includes(figure))).toEqual([]);
});

test("the Workflow tabs show the starter files without their comments", async () => {
	for (const file of ["small.toml", "try-hard.toml"]) {
		const source = await Bun.file(join(starter, file)).text();
		const lines = source
			.split("\n")
			.filter((line) => !line.startsWith("#"))
			.map((line) => line.replace(/\s+#.*$/, ""))
			.filter((line) => line.trim() !== "");
		expect(shownWorkflow(file), file).toEqual(lines);
	}
});

test("the small file's Steps light from a second live TUI, which can show the stuck Goal", () => {
	expect(landing.match(/data-live-tui/g)?.length).toBe(2);
	const tuiId = landing.match(/data-workflow-tui="([^"]+)"/)?.[1];
	expect(tuiId).toBeDefined();
	expect(landing).toContain(`id="${tuiId}" data-live-tui`);
	const steps = [
		...(
			landing.match(
				/<pre[^>]*data-workflow-file="small.toml"[\s\S]*?<\/pre>/,
			)?.[0] ?? ""
		).matchAll(/data-step="([^"]+)"/g),
	].map(([, name]) => name);
	const replayed = tuiFrames.replay.phases.filter((phase) => phase !== "Done");
	expect(replayed.filter((step) => !steps.includes(step))).toEqual([]);
	const stuck = tuiFrames.goals.find(({ standing }) => standing === "stuck");
	expect(landing).toContain(`data-show-stuck="${stuck?.name}"`);
});

test("install shows its commands, a first Goal's and the limits", () => {
	const install = text(
		landing.match(/id="install"[\s\S]*?<\/section>/)?.[0] ?? "",
	);
	for (const command of [
		"bun run reinstall",
		"vago init",
		"vago goal new",
		"vago ticket add",
		"vago run",
	])
		expect(install).toContain(command);
	expect(install).toContain("Alpha");
	expect(install).toContain("gh");
});

test("every page has a social preview the site serves", () => {
	const image = landing.match(
		/<meta property="og:image" content="([^"]+)"/,
	)?.[1];
	expect(image).toBeDefined();
	expect(servedAt(new URL(image ?? "").pathname)).toBeDefined();
	for (const tag of [
		'property="og:title"',
		'property="og:description"',
		'property="og:url"',
		'name="twitter:card" content="summary_large_image"',
	])
		expect(landing).toContain(tag);
});
