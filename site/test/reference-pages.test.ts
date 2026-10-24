// The CLI reference and the glossary are generated: from each command's `--help` and from CONTEXT.md. The
// committed pages are what the capture writes today, so a change to either source fails the check until
// they are captured again.
import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	cliReferencePage,
	glossaryPage,
	glossaryTerms,
	listedCommands,
	vagoHelp,
} from "../capture/reference-pages.ts";
import { servedAt } from "./built-site.ts";

const docs = join(import.meta.dir, "..", "src", "content", "docs");

test("the committed CLI reference and glossary equal a fresh capture", async () => {
	const fresh = [
		{ page: "cli-reference.md", text: cliReferencePage() },
		{ page: "glossary.md", text: await glossaryPage() },
	];
	for (const { page, text } of fresh) {
		const committed = await Bun.file(join(docs, page))
			.text()
			.catch(() => "");
		expect(
			text === committed
				? `${page} current`
				: `${page} stale: run \`bun run capture\` in site/`,
		).toBe(`${page} current`);
	}
}, 60_000);

test("the CLI reference has a section per command, holding its --help", () => {
	const reference = servedAt("/docs/cli-reference/") ?? "";
	const copy = servedAt("/docs/cli-reference.md") ?? "";
	const commands = listedCommands().map(({ name }) => name);
	expect(commands).toContain("goal new");
	for (const command of commands) {
		expect(reference).toContain(`id="vago-${command.replace(" ", "-")}"`);
		expect(copy).toContain(vagoHelp([...command.split(" "), "--help"]));
	}
}, 60_000);

test("the glossary has every term in CONTEXT.md, linkable by its name, with its definition", async () => {
	const glossary = servedAt("/docs/glossary/") ?? "";
	const copy = servedAt("/docs/glossary.md") ?? "";
	const terms = await glossaryTerms();
	expect(terms.length).toBeGreaterThan(20);
	for (const { term, definition } of terms) {
		const id = term.replaceAll("`", "").toLowerCase().replaceAll(" ", "-");
		expect(glossary).toContain(`id="${id}"`);
		expect(copy).toContain(definition);
	}
});
