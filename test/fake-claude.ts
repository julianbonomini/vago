// Test helper: a fake `claude` that replays a stream-json fixture recorded
// from a real Claude Code session and records what Punt handed it.

import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The fixture the fake replays, recorded from `claude -p --output-format stream-json --verbose`. */
export const sessionFixture = join(
	import.meta.dir,
	"fixtures",
	"claude-code-session.jsonl",
);

/** A fake `claude`, ready to put on the `PATH` of a `punt` child. */
export type FakeClaude = {
	/** Environment for `runPunt` that puts the fake first on `PATH`. */
	env: Record<string, string>;
	/** The argv (without the program name) and stdin of the last call. */
	received(): Promise<{ argv: string[]; stdin: string }>;
};

// Plain sh so the fake starts as fast as the real CLI would, and one argument
// per line is enough since no flag Punt passes holds a newline.
const script = `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_CLAUDE_DIR/argv"
cat > "$FAKE_CLAUDE_DIR/stdin"
cat "$FAKE_CLAUDE_FIXTURE"
`;

/** Writes a fake `claude` into a fresh temp directory. */
export async function makeFakeClaude(): Promise<FakeClaude> {
	const dir = await mkdtemp(join(tmpdir(), "punt-fake-claude-"));
	const program = join(dir, "claude");
	await Bun.write(program, script);
	await chmod(program, 0o755);
	return {
		env: {
			PATH: `${dir}:${process.env.PATH}`,
			FAKE_CLAUDE_DIR: dir,
			FAKE_CLAUDE_FIXTURE: sessionFixture,
		},
		async received() {
			const argv = await Bun.file(join(dir, "argv")).text();
			return {
				argv: argv.split("\n").slice(0, -1),
				stdin: await Bun.file(join(dir, "stdin")).text(),
			};
		},
	};
}
