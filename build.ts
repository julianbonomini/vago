// Compiles `vago`, with the starter embedded, into one binary: to the path
// given as the first argument, or to `~/.local/bin/vago`. `bun run reinstall`
// runs it, and so does the test of the compiled TUI.
//
// It's `Bun.build` and not `bun build --compile` because only `Bun.build`
// takes Solid's plugin, and without it the TUI draws one frame and never
// updates, with no error. `autoloadBunfig: false` because the binary, run
// inside this repo, would otherwise load `bunfig.toml`'s preload and die with
// `preload not found`.

import { homedir } from "node:os";
import { join } from "node:path";
import solidPlugin from "@opentui/solid/bun-plugin";

const outfile =
	process.argv[2] ??
	join(process.env.HOME ?? homedir(), ".local", "bin", "vago");

const result = await Bun.build({
	entrypoints: [join(import.meta.dir, "src", "cli.ts")],
	target: "bun",
	plugins: [solidPlugin],
	compile: { outfile, autoloadBunfig: false },
});
if (!result.success) {
	console.error(result.logs.join("\n"));
	throw new Error(`vago didn't build to ${outfile}`);
}
