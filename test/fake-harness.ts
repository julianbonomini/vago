// Test helper: a fake `claude` or `codex` that replays a stream fixture
// recorded from a real session of that Harness and records what Vago handed
// it.

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

// Each Codex fixture was recorded from `codex exec --json --approve-for-me
// --model <model> -` in a Goal's worktree, with the recording's paths
// replaced.

/** A gpt-6-luna session that answers without any tool call. */
export const codexSessionFixture = fixture("codex-session.jsonl");

/**
 * A gpt-6-sol session whose upload of a secrets file Codex's automatic
 * review declined.
 */
export const codexRefusedFixture = fixture("codex-refused.jsonl");

function fixture(name: string): string {
	return join(import.meta.dir, "fixtures", name);
}

/** What one call of the fake received: its argv without the program name, and its stdin. */
export type FakeHarnessCall = { argv: string[]; stdin: string };

/** A fake Harness CLI, ready to put on the `PATH` of a `vago` child. */
export type FakeHarness = {
	/** Environment for `runVago` that puts the fake first on `PATH`. */
	env: Record<string, string>;
	/** The folder the fake is in, to put before another fake's `PATH`. */
	folder: string;
	/** Every call so far, first call first. */
	calls(): Promise<FakeHarnessCall[]>;
};

/**
 * Writes a fake `claude` into a fresh temp directory. Each call replays
 * `fixturePath`, one of the fixtures above, then runs the shell command
 * `afterFixture`, such as `exit 3` or `sleep 30`. With `resume` set to
 * `refused`, a call that resumes a session fails as `claude` does when it
 * can't find the session: an error on stderr, exit 1 and no stream.
 */
export async function makeFakeClaude(
	afterFixture = "exit 0",
	fixturePath = sessionFixture,
	resume: "accepted" | "refused" = "accepted",
): Promise<FakeHarness> {
	const refusal =
		resume === "refused"
			? `case " $* " in *" --resume "*) echo "No conversation found with session ID" >&2; exit 1;; esac`
			: "";
	return makeFake("claude", afterFixture, fixturePath, refusal);
}

/**
 * A fake `codex`, otherwise as `makeFakeClaude`. A refused resume fails as
 * `codex exec resume` does when it finds no session: an error on stderr,
 * exit 1 and no stream.
 */
export async function makeFakeCodex(
	afterFixture = "exit 0",
	fixturePath = codexSessionFixture,
	resume: "accepted" | "refused" = "accepted",
): Promise<FakeHarness> {
	const refusal =
		resume === "refused"
			? `case " $* " in *" resume "*) echo "Error: thread/resume: thread/resume failed: no rollout found" >&2; exit 1;; esac`
			: "";
	return makeFake("codex", afterFixture, fixturePath, refusal);
}

async function makeFake(
	name: string,
	afterFixture: string,
	fixturePath: string,
	beforeFixture = "",
): Promise<FakeHarness> {
	const dir = await mkdtemp(join(tmpdir(), `vago-fake-${name}-`));
	const program = join(dir, name);
	// Plain sh so the fake starts as fast as the real CLI would, and one
	// argument per line is enough since no flag Vago passes holds a newline.
	// Each call gets the next numbered folder, so calls never overwrite each
	// other. The count is safe because Vago runs one Step at a time. Its
	// folders are written into the script, so two fakes share one PATH.
	const script = `#!/bin/sh
call="${dir}/calls/$(ls "${dir}/calls" | wc -l | tr -d ' ')"
mkdir "$call"
printf '%s\\n' "$@" > "$call/argv"
cat > "$call/stdin"
${beforeFixture}
cat "${fixturePath}"
${afterFixture}
`;
	await Bun.write(program, script);
	await chmod(program, 0o755);
	const callsDir = join(dir, "calls");
	await mkdir(callsDir);
	return {
		env: { PATH: `${dir}:${process.env.PATH}` },
		folder: dir,
		async calls() {
			const names = await readdir(callsDir);
			names.sort((a, b) => Number(a) - Number(b));
			const calls: FakeHarnessCall[] = [];
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
