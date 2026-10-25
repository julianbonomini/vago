// The committed TUI frames are what the capture draws from today's TUI, so a change to the TUI fails the
// check until the frames are captured again.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..", "..");
const committed = join(repo, "site", "src", "tui", "tui-frames.json");

test("the committed TUI frames equal a fresh capture", async () => {
	const temp = await mkdtemp(join(tmpdir(), "vago-frames-"));
	try {
		const fresh = join(temp, "tui-frames.json");
		// From the repo root, where the product's dependencies and Solid's preload are.
		const capture = Bun.spawn(
			[process.execPath, "site/capture/capture-tui-frames.tsx", fresh],
			{ cwd: repo, stdout: "pipe", stderr: "pipe" },
		);
		const failed = await new Response(capture.stderr).text();
		expect(await capture.exited, failed).toBe(0);
		const same =
			(await Bun.file(fresh).text()) ===
			(await Bun.file(committed)
				.text()
				.catch(() => ""));
		expect(same ? "current" : "stale: run `bun run capture` in site/").toBe(
			"current",
		);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
}, 120_000);
