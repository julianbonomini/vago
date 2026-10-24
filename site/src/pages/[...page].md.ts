// The Markdown copy of every docs, cookbook and agents page, served beside it: /docs/install.md.
import type { APIRoute, GetStaticPaths } from "astro";
import {
	type DocPage,
	docPageRoutes,
	pageMarkdown,
} from "../docs/doc-pages.ts";

export const getStaticPaths = docPageRoutes satisfies GetStaticPaths;

export const GET: APIRoute<{ page: DocPage }> = ({ props }) =>
	new Response(pageMarkdown(props.page), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
