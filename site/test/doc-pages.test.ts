// The docs, cookbook and agents pages: a sidebar grouping them, search over them, and for each a Markdown copy
// the site serves, linked from its head and listed in llms.txt by that copy's absolute URL.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { siteUrl } from "../src/site.ts";
import { builtDocuments, searchBuiltSite, servedAt } from "./built-site.ts";
import { sidebarLinks, sidebarOf } from "./docs-page.ts";

const docPages = builtDocuments().filter(({ path }) =>
	/^\/(docs|cookbook|agents)(\/|$)/.test(path),
);
const llms = servedAt("/llms.txt") ?? "";
const install = servedAt("/docs/install/") ?? "";
const sidebar = sidebarOf(install);

test("the docs start with Install, written from the README", () => {
	expect(install).toContain("<h1");
	expect(install).toContain("julianbonomini/tap/vago");
	expect(install).toContain("bun run reinstall");
	expect(install).toContain("vago --help");
});

test("every docs, cookbook and agents page has its Markdown copy and an llms.txt entry", () => {
	expect(docPages.map(({ path }) => path)).toContain("/docs/install/");
	const missing: string[] = [];
	for (const { path, html } of docPages) {
		const copy = html.match(
			/<link rel="alternate" type="text\/markdown" href="([^"]+)"/,
		)?.[1];
		if (copy === undefined) missing.push(`${path}: no alternate link`);
		else if (!servedAt(copy)?.startsWith("# "))
			missing.push(`${path}: no Markdown copy at ${copy}`);
		else if (!llms.includes(`](${siteUrl}${copy})`))
			missing.push(`${path}: no llms.txt entry for ${copy}`);
	}
	expect(missing).toEqual([]);
});

test("the sidebar groups the pages under Docs, Cookbook and Agents", () => {
	const groups = [
		...sidebar.matchAll(/class="group-label"[^>]*>([^<]+)</g),
	].map(([, label]) => label);
	expect(groups).toEqual(["Docs", "Cookbook", "Agents"]);
	expect(sidebar).toMatch(/href="\/docs\/install\/"[^>]*aria-current="page"/);
});

test("search finds a page by a word on it, and leaves the landing page out", async () => {
	expect(await searchBuiltSite("reinstall")).toContain("/docs/install/");
	expect(await searchBuiltSite("babysitting")).toEqual([]);
});

test("the first-Project pages follow Install, linking commands to the CLI reference and terms to the glossary", () => {
	const docsPaths = sidebarLinks(install, "/docs/");
	const firstProject = [
		"/docs/set-up-a-project/",
		"/docs/your-first-goal/",
		"/docs/goals-and-tickets/",
	];
	expect(docsPaths.slice(0, 4)).toEqual(["/docs/install/", ...firstProject]);
	for (const path of firstProject) {
		const html = servedAt(path) ?? "";
		expect(html).toContain('href="/docs/cli-reference/#');
		expect(html).toContain('href="/docs/glossary/#');
	}
});

test("the Workflows page follows Goals and Tickets and shows every Workflow key in a TOML example", async () => {
	const docsPaths = sidebarLinks(install, "/docs/");
	expect(docsPaths[4]).toBe("/docs/workflows/");
	// Every key src/workflow.ts takes, at the top of the file and on a Step.
	const keys = [
		"harness",
		"model",
		"args",
		"idle_timeout",
		"include",
		"before_all",
		"steps",
		"after_all",
		"id",
		"name",
		"type",
		"run",
		"on_fail",
		"when",
		"prompt",
		"goal_report",
	];
	const starterKeys = new Set<string>();
	for (const workflow of ["small", "try-hard"]) {
		const toml = Bun.TOML.parse(
			await Bun.file(
				join(
					import.meta.dir,
					"..",
					"..",
					"starter",
					"workflows",
					`${workflow}.toml`,
				),
			).text(),
		);
		for (const [key, value] of Object.entries(toml)) {
			starterKeys.add(key);
			if (Array.isArray(value))
				for (const step of value)
					for (const stepKey of Object.keys(step)) starterKeys.add(stepKey);
		}
	}
	expect(keys).toEqual(expect.arrayContaining([...starterKeys]));
	const copy = servedAt("/docs/workflows.md") ?? "";
	const examples = [...copy.matchAll(/```toml\n([\s\S]*?)```/g)]
		.map(([, toml]) => toml)
		.join("\n");
	// A key as an example writes it: `key = …`, a dotted `key.slot = …`, a `[key]` table or a `[[key]]` list.
	const missing = keys.filter(
		(key) =>
			!new RegExp(
				`^(${key}\\s*=|${key}\\.|\\[${key}\\]|\\[\\[${key}\\]\\])`,
				"m",
			).test(examples),
	);
	expect(missing).toEqual([]);
	const html = servedAt("/docs/workflows/") ?? "";
	expect(html).toContain('href="/docs/cli-reference/#');
	expect(html).toContain('href="/docs/glossary/#');
});
