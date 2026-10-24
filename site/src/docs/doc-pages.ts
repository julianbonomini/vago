// The docs, cookbook and agents pages in sidebar order, and the Markdown copy of each. It owns the groups,
// the path layout (`src/content/docs/install.md` is served at `/docs/install/`, `.../index.md` at its
// folder) and where a page's Markdown copy is served (`/docs/install.md`).
import { type CollectionEntry, getCollection } from "astro:content";

// The groups in sidebar order: the first segment of their pages' paths, and the heading the sidebar shows.
const groups = [
	{ folder: "docs", label: "Docs" },
	{ folder: "cookbook", label: "Cookbook" },
	{ folder: "agents", label: "Agents" },
];

/** One page: where it's served, where its Markdown copy is, and the entry Astro renders. */
export type DocPage = {
	title: string;
	description: string;
	/** The site path, with a trailing slash: `/docs/install/`, `/cookbook/`. */
	path: string;
	/** The site path of its Markdown copy: `/docs/install.md`, `/cookbook.md`. */
	markdownPath: string;
	entry: CollectionEntry<"pages">;
};

/** A sidebar group and its pages, in order. */
export type DocSection = { label: string; pages: DocPage[] };

/** The groups that have pages, in sidebar order, each with its pages by their `order`. Throws naming the
 *  file when a page sits outside the docs, cookbook and agents folders. */
export async function docSections(): Promise<DocSection[]> {
	const entries = await getCollection("pages");
	const folderOf = (entry: CollectionEntry<"pages">) => entry.id.split("/")[0];
	const stray = entries.find(
		(entry) => !groups.some(({ folder }) => folder === folderOf(entry)),
	);
	if (stray)
		throw new Error(
			`${stray.filePath}: a page goes under src/content/docs, cookbook or agents`,
		);
	return groups
		.map(({ folder, label }) => ({
			label,
			pages: entries
				.filter((entry) => folderOf(entry) === folder)
				.sort((a, b) => a.data.order - b.data.order)
				.map((entry) => ({
					title: entry.data.title,
					description: entry.data.description,
					path: `/${entry.id}/`,
					markdownPath: `/${entry.id}.md`,
					entry,
				})),
		}))
		.filter(({ pages }) => pages.length > 0);
}

/** Every page, in sidebar order. */
export async function docPages(): Promise<DocPage[]> {
	return (await docSections()).flatMap(({ pages }) => pages);
}

/** The static paths of both page routes, the rendered page and its Markdown copy: each page under its
 *  `[...page]` parameter (`docs/install`, `cookbook`), with the page as the route's `page` prop. */
export async function docPageRoutes(): Promise<
	{ params: { page: string }; props: { page: DocPage } }[]
> {
	return (await docPages()).map((page) => ({
		params: { page: page.entry.id },
		props: { page },
	}));
}

/** The Markdown copy of a page: its title as the `# ` heading, its description, then its source. */
export function pageMarkdown(page: DocPage): string {
	return `# ${page.title}\n\n${page.description}\n\n${(page.entry.body ?? "").trim()}\n`;
}
