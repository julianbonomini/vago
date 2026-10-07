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

/**
 * An Opus session as a planning turn starts one: read-only tools in
 * `dontAsk` mode, run under the sandbox in a Project with `notes.txt`. It
 * reads the file and answers in one sentence.
 */
export const planningFixture = fixture("claude-code-planning.jsonl");

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

/**
 * A shell command for a fake's `afterFixture` that runs `command` on the
 * fake's first `calls` calls and exits 0 on every later one, so a session can
 * fail and the resumes that retry it succeed.
 */
export function onFirstCalls(calls: number, command: string): string {
	// `$call` is the folder of this call, named by its number from 0.
	return `[ "$(basename "$call")" -lt ${calls} ] && { ${command}; }; exit 0`;
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

/**
 * Writes a temp fixture equal to `planningFixture` but whose final answer,
 * the last assistant text and the `result`, is `answer`, and returns its
 * path.
 */
export async function planningFixtureAnswering(
	answer: string,
): Promise<string> {
	const lines = (await Bun.file(planningFixture).text()).trimEnd().split("\n");
	const events: PlanningFixtureEvent[] = lines.map((line) => JSON.parse(line));
	const lastText = events.findLast(
		(event) =>
			event.type === "assistant" &&
			event.message?.content?.some((block) => block.type === "text"),
	);
	for (const block of lastText?.message?.content ?? []) {
		if (block.type === "text") block.text = answer;
	}
	for (const event of events) {
		if (event.type === "result") event.result = answer;
	}
	const dir = await mkdtemp(join(tmpdir(), "vago-fixture-"));
	const path = join(dir, "planning-answer.jsonl");
	await Bun.write(
		path,
		`${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
	);
	return path;
}

// The fields of a Claude Code stream line `planningFixtureAnswering` edits.
type PlanningFixtureEvent = {
	type: string;
	result?: string;
	message?: { content?: { type: string; text?: string }[] };
};

/**
 * Writes a temp fixture equal to `codexSessionFixture` but whose agent
 * message, its final answer, is `answer`, and returns its path.
 */
export async function codexFixtureAnswering(answer: string): Promise<string> {
	const lines = (await Bun.file(codexSessionFixture).text())
		.trimEnd()
		.split("\n");
	const events: CodexFixtureEvent[] = lines.map((line) => JSON.parse(line));
	for (const event of events) {
		if (event.item?.type === "agent_message") event.item.text = answer;
	}
	const dir = await mkdtemp(join(tmpdir(), "vago-fixture-"));
	const path = join(dir, "codex-answer.jsonl");
	await Bun.write(
		path,
		`${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
	);
	return path;
}

// The fields of a Codex stream line `codexFixtureAnswering` edits.
type CodexFixtureEvent = { item?: { type: string; text?: string } };

/** What one call of the fake interactive `claude` left behind. */
export type FakeInteractiveCall = {
	/** Its argv without the program name. */
	argv: string[];
	pid: number;
	/** Whether a SIGHUP, a SIGTERM or its terminal closing ended it. */
	ended: boolean;
};

/** A fake interactive Harness CLI, ready to put on the `PATH` of a `vago` child. */
export type FakeInteractiveHarness = {
	/** Environment for `runVago` that puts the fake first on `PATH`. */
	env: Record<string, string>;
	/** Every call so far, first call first. */
	calls(): Promise<FakeInteractiveCall[]>;
	/** Waits until there was a call and every call so far has ended. */
	allEnded(): Promise<void>;
};

/**
 * Writes a fake interactive `claude` into a fresh temp directory. Each call
 * prints `fake claude fresh <id>` for `--session-id <id>`, or
 * `fake claude resumed <id>` for `--resume <id>`, then runs the shell command
 * `afterStart`. It then asks for the kitty keyboard protocol, reads its
 * terminal raw, and prints `key <name>` for each key: `key q`,
 * `key escape`, `key ctrl+c`, `key enter`, `key shift+enter`. Typing `exit`
 * ends it with exit code 3. A SIGHUP, a SIGTERM or its terminal closing
 * ends it, recorded as `ended`. With `resume` set to `refused`, a resume
 * fails as `claude` does when it never saved the session: an error on
 * stderr and exit 1.
 */
export async function makeFakeInteractiveClaude(
	options: { resume?: "accepted" | "refused"; afterStart?: string } = {},
): Promise<FakeInteractiveHarness> {
	const dir = await mkdtemp(join(tmpdir(), "vago-fake-interactive-claude-"));
	const callsDir = join(dir, "calls");
	await mkdir(callsDir);
	// A Bun program, since sh can't read a raw terminal key by key. Its argv
	// is JSON because the planning prompt it is handed spans lines. Each call
	// gets the next numbered folder, as `makeFake`'s do.
	const script = `#!${process.execPath}
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
const calls = ${JSON.stringify(callsDir)};
const call = calls + "/" + readdirSync(calls).length;
mkdirSync(call);
const args = process.argv.slice(2);
writeFileSync(call + "/argv", JSON.stringify(args));
writeFileSync(call + "/pid", String(process.pid));
const end = () => {
	writeFileSync(call + "/ended", "");
	process.exit(0);
};
process.on("SIGHUP", end);
process.on("SIGTERM", end);
const resumed = args.indexOf("--resume");
if (resumed !== -1 && ${JSON.stringify(options.resume === "refused")}) {
	process.stderr.write("No conversation found with session ID " + args[resumed + 1] + "\\r\\n");
	process.exit(1);
}
const id = resumed === -1 ? args[args.indexOf("--session-id") + 1] : args[resumed + 1];
process.stdout.write("fake claude " + (resumed === -1 ? "fresh" : "resumed") + " " + id + "\\r\\n");
Bun.spawnSync(["sh", "-c", ${JSON.stringify(options.afterStart ?? "true")}], { stdio: ["ignore", "inherit", "inherit"] });
process.stdout.write("\\x1b[>1u");
process.stdin.setRawMode(true);
// A closed terminal reads as the end of stdin, often before its SIGHUP.
process.stdin.on("end", end);
let typed = "";
const kitty = { "27": "escape", "13": "enter", "13;2": "shift+enter", "99;5": "ctrl+c" };
process.stdin.on("data", (chunk) => {
	let text = chunk.toString();
	while (text !== "") {
		const csi = /^\\x1b\\[([\\d;?]*)([A-Za-z~])/.exec(text);
		let name;
		if (csi !== null) {
			text = text.slice(csi[0].length);
			if (csi[2] === "u") name = kitty[csi[1]] ?? "csi " + csi[1];
		} else {
			const char = text[0];
			text = text.slice(1);
			name = char === "\\x1b" ? "escape" : char === "\\r" ? "enter" : char === "\\x03" ? "ctrl+c" : char;
		}
		if (name === undefined) continue;
		process.stdout.write("key " + name + "\\r\\n");
		typed += name.length === 1 ? name : " ";
		if (typed.endsWith("exit")) process.exit(3);
	}
});
`;
	const program = join(dir, "claude");
	await Bun.write(program, script);
	await chmod(program, 0o755);
	const fake: FakeInteractiveHarness = {
		env: { PATH: `${dir}:${process.env.PATH}` },
		async calls() {
			const names = await readdir(callsDir);
			names.sort((a, b) => Number(a) - Number(b));
			const calls: FakeInteractiveCall[] = [];
			for (const name of names) {
				const call = join(callsDir, name);
				calls.push({
					argv: JSON.parse(await Bun.file(join(call, "argv")).text()),
					pid: Number(await Bun.file(join(call, "pid")).text()),
					ended: await Bun.file(join(call, "ended")).exists(),
				});
			}
			return calls;
		},
		async allEnded() {
			for (let tries = 0; ; tries++) {
				const calls = await fake.calls();
				if (calls.length > 0 && calls.every((call) => call.ended)) return;
				if (tries === 200) throw new Error("A session never ended");
				await Bun.sleep(50);
			}
		},
	};
	return fake;
}
