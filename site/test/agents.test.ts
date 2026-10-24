// The agents section: its six pages, the snippet its index shows for a Project's own AGENTS.md, which links
// only pages the site serves, and the header link to it on every page.
import { expect, test } from "bun:test";
import { builtDocuments, servedAt, siteLinksIn } from "./built-site.ts";
import { sidebarLinks } from "./docs-page.ts";

const index = servedAt("/agents/") ?? "";
const copy = servedAt("/agents.md") ?? "";

const agentsPages = [
	"/agents/what-vago-is/",
	"/agents/writing-a-goal/",
	"/agents/splitting-into-tickets/",
	"/agents/writing-a-workflow/",
	"/agents/commands/",
	"/agents/limits/",
];

// The site paths the snippet in `text` links, in its order.
function snippetLinks(text: string): string[] {
	const snippet = text.match(/## Vago\n[\s\S]*?(?=```|<\/code>)/)?.[0] ?? "";
	return siteLinksIn(snippet);
}

test("the agents section has its six pages, after its index in the sidebar", () => {
	expect(sidebarLinks(index, "/agents/")).toEqual(["/agents/", ...agentsPages]);
});

test("the agents index shows the snippet with a copy button, and so does its Markdown copy", () => {
	expect(index).toMatch(/<button[^>]*data-copy-snippet/);
	expect(snippetLinks(index).length).toBeGreaterThan(0);
	expect(snippetLinks(copy)).toEqual(snippetLinks(index));
});

test("the snippet links the Markdown copy of each agents page, and every page it links exists", () => {
	const links = snippetLinks(copy);
	expect(links).toEqual(
		expect.arrayContaining(
			agentsPages.map((path) => `${path.slice(0, -1)}.md`),
		),
	);
	const missing = links.filter((path) => servedAt(path) === undefined);
	expect(missing).toEqual([]);
});

test("every page's header links to the agents section", () => {
	const without = builtDocuments()
		.filter(
			({ html }) =>
				!/<a href="\/agents\/"[^>]*>For agents<\/a>/.test(
					html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "",
				),
		)
		.map(({ path }) => path);
	expect(without).toEqual([]);
});
