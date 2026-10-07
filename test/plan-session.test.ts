import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import {
	makeFakeClaude,
	makeFakeInteractiveClaude,
	planningFixtureAnswering,
} from "./fake-harness.ts";
import {
	gitIdentity,
	makeProject,
	oneStep,
	runVago,
	vagoHome,
} from "./project.ts";
import { type TerminalScreen, terminalScreen } from "./terminal-screen.ts";

// Each test runs several vago processes.
setDefaultTimeout(30_000);

const cli = join(import.meta.dir, "..", "src", "cli.ts");

const planningPrompt = "You help plan a Goal.\nAsk before you propose.\n";

// The flags that keep Claude Code's tools from changing a file.
const readOnlyFlags = [
	"--permission-mode",
	"dontAsk",
	"--strict-mcp-config",
	"--tools",
	"Read,Grep,Glob,Skill",
];

// A Project with a planning prompt, Workflow `small` and planning item
// `search` on Claude Code.
async function planningProject(env: Record<string, string>): Promise<string> {
	const root = await makeProject({
		".vago/prompts/planning.md": planningPrompt,
		".vago/workflows/small.toml": oneStep("true"),
	});
	await runVago(root, ["plan", "new", "search"], env);
	return root;
}

// `vago plan session search` running in an 80×24 pseudo-terminal.
type SessionTerminal = {
	screen: TerminalScreen;
	press(keys: string): void;
	/** Closes the pseudo-terminal, as closing the human's terminal window does. */
	close(): void;
	exited: Promise<number>;
};

function openSession(
	root: string,
	env: Record<string, string>,
	item = "search",
): SessionTerminal {
	const screen = terminalScreen(24, 80);
	const child = Bun.spawn([process.execPath, cli, "plan", "session", item], {
		cwd: root,
		env: { ...process.env, VAGO_HOME: vagoHome, ...env },
		terminal: {
			cols: 80,
			rows: 24,
			data: (_terminal, bytes) => screen.write(bytes),
		},
	});
	// A session that doesn't end fails its test fast, with exit code 137.
	const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
	return {
		screen,
		press: (keys) => child.terminal?.write(keys),
		close: () => child.terminal?.close(),
		exited: child.exited.finally(() => clearTimeout(timer)),
	};
}

// Waits for the line of `screen` that starts with `start`, and returns it.
async function lineStarting(
	screen: TerminalScreen,
	start: string,
): Promise<string> {
	const lines = await screen.frameWhere((lines) =>
		lines.some((line) => line.startsWith(start)),
	);
	return lines.find((line) => line.startsWith(start)) ?? "";
}

async function savedSessionId(root: string): Promise<unknown> {
	const chat = await Bun.file(
		join(root, ".vago-goals/search/planning/chat.toml"),
	).text();
	return parse(chat).session_id;
}

test("a fresh item starts its Harness's own session, read-only, under an id saved first", async () => {
	const fake = await makeFakeInteractiveClaude();
	const root = await planningProject(fake.env);

	const session = openSession(root, fake.env);
	const line = await lineStarting(session.screen, "fake claude fresh ");

	const id = line.slice("fake claude fresh ".length);
	expect(id).toMatch(/^[0-9a-f-]{36}$/);
	expect(await savedSessionId(root)).toBe(id);
	const [call] = await fake.calls();
	expect(call?.argv).toEqual([
		"--session-id",
		id,
		"--append-system-prompt",
		planningPrompt.trimEnd(),
		...readOnlyFlags,
		"--model",
		"opus",
	]);
	session.close();
	await session.exited;
});

test("a second session resumes the saved id", async () => {
	const fake = await makeFakeInteractiveClaude();
	const root = await planningProject(fake.env);
	const first = openSession(root, fake.env);
	const line = await lineStarting(first.screen, "fake claude fresh ");
	first.close();
	await first.exited;

	const second = openSession(root, fake.env);

	const id = line.slice("fake claude fresh ".length);
	await lineStarting(second.screen, `fake claude resumed ${id}`);
	const calls = await fake.calls();
	expect(calls[1]?.argv.slice(0, 2)).toEqual(["--resume", id]);
	expect(calls[1]?.argv).toContain(planningPrompt.trimEnd());
	expect(await savedSessionId(root)).toBe(id);
	second.close();
	await second.exited;
});

test("a resume Claude Code refuses is followed by one fresh start under the same id", async () => {
	const fake = await makeFakeInteractiveClaude({ resume: "refused" });
	const root = await planningProject(fake.env);
	const first = openSession(root, fake.env);
	const line = await lineStarting(first.screen, "fake claude fresh ");
	first.close();
	await first.exited;
	const id = line.slice("fake claude fresh ".length);

	const second = openSession(root, fake.env);

	await lineStarting(second.screen, `fake claude fresh ${id}`);
	const calls = await fake.calls();
	expect(calls.map((call) => call.argv.slice(0, 2))).toEqual([
		["--session-id", id],
		["--resume", id],
		["--session-id", id],
	]);
	second.close();
	await second.exited;
	expect(await fake.calls()).toHaveLength(3);
});

// Gives planning item `search` of the Project at `root` a ready Proposal of
// one Ticket, through a planning turn.
async function propose(root: string): Promise<void> {
	const answer = `<vago-plan>
workflow = "small"
goal = '''
# Search ranks by relevance
'''

[[tickets]]
slug = "score"
body = '''
# Score each result
'''
</vago-plan>`;
	const fake = await makeFakeClaude(
		"exit 0",
		await planningFixtureAnswering(answer),
	);
	const said = await runVago(
		root,
		["plan", "say", "search", "--body-file", "-"],
		fake.env,
		"Plan search",
	);
	expect(said.stderr).toBe("");
}

test("rename and accept are refused while the session is open, and work once it ends", async () => {
	const fake = await makeFakeInteractiveClaude();
	const root = await planningProject(fake.env);
	await propose(root);
	const session = openSession(root, fake.env);
	// Resumed, since the turn saved its session.
	await lineStarting(session.screen, "fake claude resumed ");

	const renamed = await runVago(root, ["plan", "rename", "search", "ranked"]);
	const accepted = await runVago(root, ["plan", "accept", "search"]);

	for (const refused of [renamed, accepted]) {
		expect(refused.exitCode).toBe(1);
		expect(refused.stderr).toContain("search: its planning session is open");
	}
	session.close();
	await session.exited;
	expect(
		(await runVago(root, ["plan", "rename", "search", "ranked"])).exitCode,
	).toBe(0);
	const later = await runVago(root, ["plan", "accept", "ranked"]);
	expect(later.stderr).toBe("");
	expect(later.exitCode).toBe(0);
});

// Whether process `pid` is alive.
function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

test("closing the terminal ends the session and vago", async () => {
	const fake = await makeFakeInteractiveClaude();
	const root = await planningProject(fake.env);
	const session = openSession(root, fake.env);
	await lineStarting(session.screen, "fake claude fresh ");

	session.close();

	await session.exited;
	const [call] = await fake.calls();
	expect(call?.ended).toBe(true);
	expect(isAlive(call?.pid ?? 0)).toBe(false);
});

// What `git <args>` printed in the repo at `root`.
function git(root: string, ...args: string[]): string {
	return Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString();
}

test("the session can't change a tracked or untracked file, or add one", async () => {
	const fake = await makeFakeInteractiveClaude({
		afterStart:
			"cat notes.txt; printf x > tracked.txt; printf x > notes.txt; printf x > new.txt; echo tried",
	});
	const root = await planningProject(fake.env);
	await Bun.write(join(root, "notes.txt"), "untracked notes\n");
	await Bun.write(join(root, "tracked.txt"), "tracked text\n");
	git(root, "add", "tracked.txt");
	git(root, ...gitIdentity, "commit", "--quiet", "-m", "tracked");
	const status = git(root, "status", "--porcelain");

	const session = openSession(root, fake.env);
	await lineStarting(session.screen, "tried");
	session.close();
	await session.exited;

	expect(await Bun.file(join(root, "tracked.txt")).text()).toBe(
		"tracked text\n",
	);
	expect(await Bun.file(join(root, "notes.txt")).text()).toBe(
		"untracked notes\n",
	);
	expect(existsSync(join(root, "new.txt"))).toBe(false);
	expect(git(root, "status", "--porcelain")).toBe(status);
	// It could read the Project, though.
	expect(session.screen.printed()).toContain("untracked notes");
});

test("a Goal accepted from planning, or no item, is refused with nothing recorded", async () => {
	const fake = await makeFakeInteractiveClaude();
	const root = await planningProject(fake.env);
	await propose(root);
	await runVago(root, ["plan", "accept", "search"]);
	const chat = join(root, ".vago-goals/search/planning/chat.toml");
	const before = await Bun.file(chat).text();

	const accepted = await runVago(root, ["plan", "session", "search"], fake.env);
	const unknown = await runVago(root, ["plan", "session", "nope"], fake.env);

	expect(accepted.exitCode).toBe(1);
	expect(accepted.stderr).toContain("was accepted as a Goal");
	expect(unknown.exitCode).toBe(1);
	expect(unknown.stderr).toContain("nope");
	expect(await Bun.file(chat).text()).toBe(before);
	expect(existsSync(join(root, ".vago-goals/nope"))).toBe(false);
	expect(await fake.calls()).toEqual([]);
});
