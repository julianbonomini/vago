// Test helper: a fake `claude` that replays a stream-json fixture recorded
// from a real Claude Code session and records what Punt handed it.

import { chmod, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The fixture the fake replays, recorded from `claude -p --output-format stream-json --verbose`. */
export const sessionFixture = join(
	import.meta.dir,
	"fixtures",
	"claude-code-session.jsonl",
);

/** What one call of the fake received: its argv without the program name, and its stdin. */
export type FakeClaudeCall = { argv: string[]; stdin: string };

/** A fake `claude`, ready to put on the `PATH` of a `punt` child. */
export type FakeClaude = {
	/** Environment for `runPunt` that puts the fake first on `PATH`. */
	env: Record<string, string>;
	/** Every call so far, first call first. */
	calls(): Promise<FakeClaudeCall[]>;
};

/**
 * Writes a fake `claude` into a fresh temp directory. Each call replays the
 * fixture, then runs the shell command `afterFixture`, such as `exit 3` or
 * `sleep 30`.
 */
export async function makeFakeClaude(
	afterFixture = "exit 0",
): Promise<FakeClaude> {
	const dir = await mkdtemp(join(tmpdir(), "punt-fake-claude-"));
	const program = join(dir, "claude");
	// Plain sh so the fake starts as fast as the real CLI would, and one
	// argument per line is enough since no flag Punt passes holds a newline.
	// Each call gets the next numbered folder, so calls never overwrite each
	// other. The count is safe because Punt runs one Step at a time.
	const script = `#!/bin/sh
call="$FAKE_CLAUDE_DIR/calls/$(ls "$FAKE_CLAUDE_DIR/calls" | wc -l | tr -d ' ')"
mkdir "$call"
printf '%s\\n' "$@" > "$call/argv"
cat > "$call/stdin"
cat "$FAKE_CLAUDE_FIXTURE"
${afterFixture}
`;
	await Bun.write(program, script);
	await chmod(program, 0o755);
	const callsDir = join(dir, "calls");
	await mkdir(callsDir);
	return {
		env: {
			PATH: `${dir}:${process.env.PATH}`,
			FAKE_CLAUDE_DIR: dir,
			FAKE_CLAUDE_FIXTURE: sessionFixture,
		},
		async calls() {
			const names = await readdir(callsDir);
			names.sort((a, b) => Number(a) - Number(b));
			const calls: FakeClaudeCall[] = [];
			for (const name of names) {
				const argv = await Bun.file(join(callsDir, name, "argv")).text();
				calls.push({
					argv: argv.split("\n").slice(0, -1),
					stdin: await Bun.file(join(callsDir, name, "stdin")).text(),
				});
			}
			return calls;
		},
	};
}
