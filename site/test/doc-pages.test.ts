// The docs, cookbook and agents pages: a sidebar grouping them, search over them, and for each a Markdown copy
// the site serves, linked from its head and listed in llms.txt by that copy's absolute URL.
import { expect, test } from "bun:test";
import { siteUrl } from "../src/site.ts";
import { builtDocuments, searchBuiltSite, servedAt } from "./built-site.ts";

const docPages = builtDocuments().filter(({ path }) =>
	/^\/(docs|cookbook|agents)(\/|$)/.test(path),
);
const llms = servedAt("/llms.txt") ?? "";
const install = servedAt("/docs/install/") ?? "";
const sidebar =
	install.match(/<nav[^>]*aria-label="Docs"[\s\S]*?<\/nav>/)?.[0] ?? "";

test("the docs start with Install, written from the README", () => {
	expect(install).toContain("<h1");
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
	const docsPaths = [...sidebar.matchAll(/href="(\/docs\/[^"]+)"/g)].map(
		([, path]) => path,
	);
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
