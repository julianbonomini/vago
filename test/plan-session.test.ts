import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import {
	answerInSession,
	fakeTranscriptLine,
	makeFakeInteractiveClaude,
	makeFakeInteractiveCodex,
} from "./fake-harness.ts";
import {
	gitIdentity,
	makeProject,
	oneStep,
	readTicketFile,
	runsOf,
	runVago,
	vagoHome,
} from "./project.ts";
import { type TerminalScreen, terminalScreen } from "./terminal-screen.ts";

// Each test runs several vago processes.
setDefaultTimeout(30_000);

const cli = join(import.meta.dir, "..", "src", "cli.ts");

const planningPrompt = "You help plan a Goal.\nAsk before you propose.\n";

// The first message of a fresh session of item `search`.
const kickoff = 'Plan the Goal "search" with me.';

// The flags that keep Claude Code's tools from changing a file.
const readOnlyFlags = [
	"--permission-mode",
	"dontAsk",
	"--strict-mcp-config",
	"--tools",
	"Read,Grep,Glob,Skill",
];

// A Project with a planning prompt, Workflow `small` and planning item
// `search` on `harness`.
async function planningProject(
	env: Record<string, string>,
	harness = "claude-code",
): Promise<string> {
	const root = await makeProject({
		".vago/prompts/planning.md": planningPrompt,
		".vago/workflows/small.toml": oneStep("true"),
	});
	await runVago(root, ["plan", "new", "search", "--harness", harness], env);
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
		kickoff,
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
	expect(calls[1]?.argv).not.toContain(kickoff);
	expect(await savedSessionId(root)).toBe(id);
	second.close();
	await second.exited;
});

test("a resume Claude Code refuses is followed by one fresh start, whose id is saved", async () => {
	const fake = await makeFakeInteractiveClaude({ resume: "refused" });
	const root = await planningProject(fake.env);
	const first = openSession(root, fake.env);
	const line = await lineStarting(first.screen, "fake claude fresh ");
	first.close();
	await first.exited;
	const id = line.slice("fake claude fresh ".length);

	const second = openSession(root, fake.env);

	const fresh = await lineStarting(second.screen, "fake claude fresh ");
	const freshId = fresh.slice("fake claude fresh ".length);
	expect(freshId).not.toBe(id);
	const calls = await fake.calls();
	expect(calls.map((call) => call.argv.slice(0, 2))).toEqual([
		["--session-id", id],
		["--resume", id],
		["--session-id", freshId],
	]);
	expect(await savedSessionId(root)).toBe(freshId);
	second.close();
	await second.exited;
	expect(await fake.calls()).toHaveLength(3);
});

// Gives planning item `search` of the Project at `root` a ready Proposal of
// one Ticket, through a session of its own whose agent proposes at once.
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
	const { exit } = await answerInSession(root, [answer]);
	expect(exit.stderr).toBe("");
}

test("rename and accept are refused while the session is open, and work once it ends", async () => {
	const fake = await makeFakeInteractiveClaude();
	const root = await planningProject(fake.env);
	await propose(root);
	const session = openSession(root, fake.env);
	// Resumed, since the first session saved its id.
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

// Every file under the folder of item `search`, by its path there, with its
// text.
async function itemFiles(root: string): Promise<Record<string, string>> {
	const folder = join(root, ".vago-goals/search");
	const texts: Record<string, string> = {};
	for (const path of new Bun.Glob("**").scanSync({ cwd: folder })) {
		texts[path] = await Bun.file(join(folder, path)).text();
	}
	return texts;
}

test("an accepted Goal's session resumes, and nothing the agent writes changes the Goal", async () => {
	const fake = await makeFakeInteractiveClaude({ answers: [sessionAnswer] });
	const root = await planningProject(fake.env);
	await propose(root);
	await runVago(root, ["plan", "accept", "search"]);
	const id = await savedSessionId(root);
	const before = await itemFiles(root);

	const session = openSession(root, fake.env);
	await lineStarting(session.screen, `fake claude resumed ${id}`);
	session.press("\r");
	await lineStarting(session.screen, "answered 1");
	session.press("exit");

	expect(await session.exited).toBe(3);
	expect(await itemFiles(root)).toEqual(before);
	expect(before["tickets/01-score.md"]).toBeDefined();
	expect(before["tickets/02-sort.md"]).toBeUndefined();
});

test("an accepted Goal with no saved session, or no item, is refused with nothing recorded", async () => {
	const fake = await makeFakeInteractiveClaude();
	const root = await planningProject(fake.env);
	await Bun.write(
		join(root, ".vago-goals/search/planning/proposal.toml"),
		'workflow = "small"\ngoal = "# Search"\n\n[[tickets]]\nslug = "score"\nbody = "# Score"\n',
	);
	await runVago(root, ["plan", "accept", "search"]);
	const before = await itemFiles(root);

	const accepted = await runVago(root, ["plan", "session", "search"], fake.env);
	const unknown = await runVago(root, ["plan", "session", "nope"], fake.env);

	expect(accepted.exitCode).toBe(1);
	expect(accepted.stderr).toContain("has no planning session to open");
	expect(unknown.exitCode).toBe(1);
	expect(unknown.stderr).toContain("nope");
	expect(await itemFiles(root)).toEqual(before);
	expect(existsSync(join(root, ".vago-goals/nope"))).toBe(false);
	expect(await fake.calls()).toEqual([]);
});

test("discarding an item whose session is open ends the session and leaves no folder", async () => {
	const fake = await makeFakeInteractiveClaude({ answers: [sessionAnswer] });
	const root = await planningProject(fake.env);
	const session = openSession(root, fake.env);
	await lineStarting(session.screen, "fake claude fresh ");
	session.press("\r");
	await lineStarting(session.screen, "answered 1");

	const discarded = await runVago(root, ["plan", "discard", "search"]);

	expect(discarded.stderr).toBe("");
	expect(discarded.exitCode).toBe(0);
	await session.exited;
	const [call] = await fake.calls();
	expect(call?.ended).toBe(true);
	expect(isAlive(call?.pid ?? 0)).toBe(false);
	await Bun.sleep(1200);
	expect(existsSync(join(root, ".vago-goals/search"))).toBe(false);
});

test("each run of a session records when it started and ended and what its session cost", async () => {
	const fake = await makeFakeInteractiveClaude({ answers: [sessionAnswer] });
	const root = await planningProject(fake.env);
	const startedAfter = new Date();

	const session = openSession(root, fake.env);
	await lineStarting(session.screen, "fake claude fresh ");
	session.press("\r");
	await lineStarting(session.screen, "answered 1");
	session.press("exit");
	await session.exited;

	const chat = parse(
		await Bun.file(join(root, ".vago-goals/search/planning/chat.toml")).text(),
	);
	const [run] = chat.sessions as Record<string, unknown>[];
	expect(run?.session_id).toBe(chat.session_id);
	expect(run?.cost_usd).toBe(0.8);
	expect((run?.started as Date) >= startedAfter).toBe(true);
	expect((run?.ended as Date) >= (run?.started as Date)).toBe(true);
});

// An answer ending in a proposal of two Tickets on Workflow `small`, the
// second blocked by the first. Basic TOML strings only, so a shell can quote
// it in single quotes.
const sessionAnswer = `Settled, so here is the plan.

<vago-plan>
workflow = "small"
goal = """
# Search ranks by relevance
"""

[[tickets]]
slug = "score"
body = """
# Score each result
"""

[[tickets]]
slug = "sort"
blocked_by = [1]
body = """
# Sort by score
"""
</vago-plan>`;

// Accepts item `search` of the Project at `root`, and checks it became a
// ready Goal of `sessionAnswer`'s two ready Tickets, with nothing started.
async function expectAcceptedSessionProposal(root: string): Promise<void> {
	const accepted = await runVago(root, ["plan", "accept", "search"]);
	expect(accepted.stderr).toBe("");
	expect(accepted.exitCode).toBe(0);
	const goal = await readTicketFile(root, ".vago-goals/search/goal.md");
	expect(goal.header.workflow).toBe("small");
	expect(goal.body).toContain("# Search ranks by relevance");
	const score = await readTicketFile(
		root,
		".vago-goals/search/tickets/01-score.md",
	);
	const sort = await readTicketFile(
		root,
		".vago-goals/search/tickets/02-sort.md",
	);
	expect(score.header.status).toBe("ready");
	expect(sort.header.status).toBe("ready");
	expect(sort.header.blocked_by).toEqual([1]);
	expect(runsOf(score.header)).toEqual([]);
	expect(runsOf(sort.header)).toEqual([]);
	expect(existsSync(join(root, ".vago-goals/search/running.lock"))).toBe(false);
}

test("a proposal written in the session is accepted as a ready Goal, with nothing started", async () => {
	const fake = await makeFakeInteractiveClaude({ answers: [sessionAnswer] });
	const root = await planningProject(fake.env);
	const session = openSession(root, fake.env);
	await lineStarting(session.screen, "fake claude fresh ");

	session.press("\r");
	await lineStarting(session.screen, "answered 1");
	session.press("exit");

	expect(await session.exited).toBe(3);
	await expectAcceptedSessionProposal(root);
});

test("a proposal written just before the session ends, faster than a read, is still saved", async () => {
	// The fake's SIGTERM handler ends it with exit code 0.
	const fake = await makeFakeInteractiveClaude({
		afterStart: `printf '%s\\n' '${fakeTranscriptLine(sessionAnswer)}' >> "$TRANSCRIPT"; kill $PPID`,
	});
	const root = await planningProject(fake.env);

	const session = openSession(root, fake.env);

	expect(await session.exited).toBe(0);
	await expectAcceptedSessionProposal(root);
});

test("a proposal that couldn't be saved is saved once it can be, with no new message", async () => {
	const fake = await makeFakeInteractiveClaude({ answers: [sessionAnswer] });
	const root = await planningProject(fake.env);
	const planning = join(root, ".vago-goals/search/planning");
	const session = openSession(root, fake.env);
	await lineStarting(session.screen, "fake claude fresh ");
	await chmod(planning, 0o555);

	session.press("\r");
	await lineStarting(session.screen, "answered 1");
	await Bun.sleep(2000);
	await chmod(planning, 0o755);
	session.press("exit");

	expect(await session.exited).toBe(3);
	await expectAcceptedSessionProposal(root);
});

// The flags of Codex's interactive session: no shared server, which would
// run the agent's commands outside the sandbox, Codex's own sandbox off,
// since it can't start inside Vago's, and the planning prompt.
const codexFlags = [
	"--no-daemon",
	"--sandbox",
	"danger-full-access",
	"--ask-for-approval",
	"never",
	"-c",
	`developer_instructions=${JSON.stringify(planningPrompt.trimEnd())}`,
	"--model",
	"gpt-6-sol",
];

// Writes, once the session has started, a transcript of another Codex
// session in the same folder, started before it.
const otherCodexSession = `d="$CODEX_HOME/sessions/2020/01/01"; mkdir -p "$d"; printf '{"type":"session_meta","payload":{"id":"other","timestamp":"2020-01-01T00:00:00.000Z","cwd":"%s"}}\\n' "$(pwd -P)" > "$d/rollout-2020-01-01T00-00-00-other.jsonl"`;

test("a Codex item saves the id Codex picks once it answers, and its proposal is accepted", async () => {
	const fake = await makeFakeInteractiveCodex({
		answers: [sessionAnswer],
		afterStart: otherCodexSession,
	});
	const root = await planningProject(fake.env, "codex");
	const session = openSession(root, fake.env);
	const line = await lineStarting(session.screen, "fake codex fresh ");

	session.press("\r");
	await lineStarting(session.screen, "answered 1");
	session.press("exit");

	expect(await session.exited).toBe(3);
	expect(await savedSessionId(root)).toBe(
		line.slice("fake codex fresh ".length),
	);
	const [call] = await fake.calls();
	expect(call?.argv).toEqual([...codexFlags, kickoff]);
	await expectAcceptedSessionProposal(root);
});

test("a second Codex session resumes the saved id", async () => {
	const fake = await makeFakeInteractiveCodex({ answers: ["A question?"] });
	const root = await planningProject(fake.env, "codex");
	const first = openSession(root, fake.env);
	const line = await lineStarting(first.screen, "fake codex fresh ");
	first.press("\r");
	await lineStarting(first.screen, "answered 1");
	first.close();
	await first.exited;
	const id = line.slice("fake codex fresh ".length);

	const second = openSession(root, fake.env);

	await lineStarting(second.screen, `fake codex resumed ${id}`);
	const calls = await fake.calls();
	expect(calls[1]?.argv).toEqual(["resume", id, ...codexFlags]);
	second.close();
	await second.exited;
	expect(await savedSessionId(root)).toBe(id);
});

test("a Codex session, its own sandbox off, still can't change a Project file", async () => {
	const fake = await makeFakeInteractiveCodex({
		afterStart:
			"cat notes.txt; printf x > notes.txt; printf x > new.txt; echo tried",
	});
	const root = await planningProject(fake.env, "codex");
	await Bun.write(join(root, "notes.txt"), "untracked notes\n");

	const session = openSession(root, fake.env);
	await lineStarting(session.screen, "tried");
	session.close();
	await session.exited;

	expect(await Bun.file(join(root, "notes.txt")).text()).toBe(
		"untracked notes\n",
	);
	expect(existsSync(join(root, "new.txt"))).toBe(false);
	expect(session.screen.printed()).toContain("untracked notes");
});
