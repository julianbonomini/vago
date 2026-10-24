// Writes the site's CLI reference and glossary into the docs folder it is given:
// `cd site && bun run capture`.

import { join } from "node:path";
import { cliReferencePage, glossaryPage } from "./reference-pages.ts";

const docsFolder = process.argv[2];
if (docsFolder === undefined)
	throw new Error(
		"usage: bun site/capture/capture-reference-pages.ts <docs folder>",
	);

await Bun.write(join(docsFolder, "cli-reference.md"), cliReferencePage());
await Bun.write(join(docsFolder, "glossary.md"), await glossaryPage());
