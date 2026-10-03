// Test helper: a fake `claude` that replays a stream-json fixture recorded
// from a real Claude Code session and records what Vago handed it.

import { chmod, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each fixture was recorded from `claude -p --output-format stream-json
// --verbose --permission-mode auto`, with the recording's paths replaced.

/** A Sonnet session in `auto` mode that answers without any tool call. */
export const sessionFixture = fixture("claude-code-session.jsonl");

/**
 * A Haiku session, which Claude Code can't run in `auto` mode: it falls back
 * to `default` and denies the agent's `Write`.
 */
export const permissionModeFallbackFixture = fixture(
	"claude-code-permission-mode-fallback.jsonl",
);

/**
 * A Sonnet session in `auto` mode whose `git push` was denied, by a
 * `--disallowedTools` rule since the classifier won't deny on cue.
 */
export const permissionDeniedFixture = fixture(
	"claude-code-permission-denied.jsonl",
);

/**
 * A Sonnet session started as Vago starts one whose Workflow has
 * `args = ["--permission-mode", "acceptEdits"]`.
 */
export const acceptEditsFixture = fixture("claude-code-accept-edits.jsonl");

function fixture(name: string): string {
	return join(import.meta.dir, "fixtures", name);
}

/** What one call of the fake received: its argv without the program name, and its stdin. */
export type FakeClaudeCall = { argv: string[]; stdin: string };

/** A fake `claude`, ready to put on the `PATH` of a `vago` child. */
export type FakeClaude = {
	/** Environment for `runVago` that puts the fake first on `PATH`. */
	env: Record<string, string>;
	/** Every call so far, first call first. */
	calls(): Promise<FakeClaudeCall[]>;
};

/**
 * Writes a fake `claude` into a fresh temp directory. Each call replays
 * `fixturePath`, one of the fixtures above, then runs the shell command
 * `afterFixture`, such as `exit 3` or `sleep 30`.
 */
export async function makeFakeClaude(
	afterFixture = "exit 0",
	fixturePath = sessionFixture,
): Promise<FakeClaude> {
	const dir = await mkdtemp(join(tmpdir(), "vago-fake-claude-"));
	const program = join(dir, "claude");
	// Plain sh so the fake starts as fast as the real CLI would, and one
	// argument per line is enough since no flag Vago passes holds a newline.
	// Each call gets the next numbered folder, so calls never overwrite each
	// other. The count is safe because Vago runs one Step at a time.
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
			FAKE_CLAUDE_FIXTURE: fixturePath,
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
