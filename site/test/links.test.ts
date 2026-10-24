// No built page links to a file the site doesn't serve, or to a #fragment the target page doesn't have.
import { expect, test } from "bun:test";
import { builtDocuments, servedAt } from "./built-site.ts";

test("every internal link and asset in the build resolves, with its fragment", () => {
	const broken: string[] = [];
	for (const { path, html } of builtDocuments()) {
		for (const [, ref = ""] of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
			// A scheme (https:, mailto:, data:) or a protocol-relative // leaves the site.
			if (/^([a-z][a-z+.-]*:|\/\/)/i.test(ref)) continue;
			const url = new URL(ref.replaceAll("&amp;", "&"), `https://site${path}`);
			const target = servedAt(decodeURIComponent(url.pathname));
			const fragment = decodeURIComponent(url.hash.slice(1));
			if (
				target === undefined ||
				(fragment && !target.includes(`id="${fragment}"`))
			)
				broken.push(`${path} → ${ref}`);
		}
	}
	expect(broken).toEqual([]);
});
