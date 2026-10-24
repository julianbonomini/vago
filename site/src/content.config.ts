// The docs, cookbook and agents pages: one Markdown file each under src/content/<group>/. doc-pages.ts is
// the one reader of this collection.

import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const pages = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content" }),
	schema: z.object({
		title: z.string(),
		// One line: the page's meta description, and its llms.txt entry.
		description: z.string(),
		// Where the page sits in its group's sidebar, lowest first.
		order: z.number(),
	}),
});

export const collections = { pages };
