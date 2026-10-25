// llms.txt (https://llmstxt.org): the site for an agent, one entry per docs, cookbook and agents page,
// each linking its Markdown copy by absolute URL.
import type { APIRoute } from "astro";
import { docSections } from "../docs/doc-pages.ts";
import { siteDescription, siteUrl } from "../site.ts";

export const GET: APIRoute = async () => {
	const sections = (await docSections()).map(({ label, pages }) => {
		const entries = pages.map(
			(page) =>
				`- [${page.title}](${siteUrl}${page.markdownPath}): ${page.description}`,
		);
		return `## ${label}\n\n${entries.join("\n")}`;
	});
	const text = [
		"# Vago",
		`> ${siteDescription}`,
		"Each link is the Markdown copy of a page on the site.",
		...sections,
	].join("\n\n");
	return new Response(`${text}\n`, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
};
