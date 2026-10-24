// The site `bun run build` wrote to dist/, read the way a static host serves it. This module owns how a
// site path such as `/docs/install/` maps to a file under dist/; every test that reads the build asks it.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dir, "..", "dist");

/** A built HTML document: its site path (`/` for the landing, `/docs/install/`, `/404.html`) and its HTML. */
export type BuiltDocument = { path: string; html: string };

/** Every HTML file in the build. Throws when there is no build, since every check would pass on nothing. */
export function builtDocuments(): BuiltDocument[] {
	if (!existsSync(join(dist, "index.html")))
		throw new Error(`No build in ${dist}: run bun run build first`);
	const documents: BuiltDocument[] = [];
	for (const file of readdirSync(dist, { recursive: true, encoding: "utf8" })) {
		if (!file.endsWith(".html")) continue;
		const path = `/${file}`.replace(/(^|\/)index\.html$/, "$1");
		documents.push({ path, html: readFileSync(join(dist, file), "utf8") });
	}
	return documents;
}

/** The text of the file the host serves at a decoded site path with no query or fragment, or undefined when
 *  nothing is served there. A path ending in `/`, or naming a folder, is served its index.html. */
export function servedAt(path: string): string | undefined {
	const file = join(dist, path);
	if (existsSync(file) && statSync(file).isFile())
		return readFileSync(file, "utf8");
	const index = join(file, "index.html");
	return existsSync(index) ? readFileSync(index, "utf8") : undefined;
}

// The part of Pagefind's search API searchBuiltSite uses.
type Pagefind = {
	options: (options: { basePath: string; baseUrl: string }) => Promise<void>;
	search: (
		term: string,
	) => Promise<{ results: { data: () => Promise<{ url: string }> }[] }>;
};

/** The site path of every page the build's search index returns for `term`, best match first. */
export async function searchBuiltSite(term: string): Promise<string[]> {
	const pagefind: Pagefind = await import(
		join(dist, "pagefind", "pagefind.js")
	);
	await pagefind.options({
		basePath: `file://${join(dist, "pagefind")}/`,
		baseUrl: "/",
	});
	const { results } = await pagefind.search(term);
	return Promise.all(results.map(async (result) => (await result.data()).url));
}
