// The repo's README points to the site's docs, cookbook and agents pages, and every page it links exists.
import { expect, test } from "bun:test";
import { servedAt, siteLinksIn } from "./built-site.ts";

const readme = await Bun.file(
	new URL("../../README.md", import.meta.url),
).text();

const siteLinks = siteLinksIn(readme);

test("the README links the site's docs, cookbook and agents sections", () => {
	for (const section of ["/docs/", "/cookbook/", "/agents/"])
		expect(siteLinks.some((path) => path.startsWith(section))).toBe(true);
});

test("every site page the README links exists", () => {
	const missing = siteLinks.filter((path) => servedAt(path) === undefined);
	expect(missing).toEqual([]);
});
