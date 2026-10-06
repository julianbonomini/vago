import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
	type FakeHarness,
	makeFakeClaude,
	planningFixture,
} from "./fake-harness.ts";
import {
	gitIdentity,
	goalText,
	makeProject,
	runVago,
	type VagoExit,
} from "./project.ts";

// The answer `planningFixture` ends with.
const fixtureAnswer =
	"It says that search results are sorted by recency, so the newest ones come first.";

// The session id `planningFixture` reports.
const fixtureSessionId = "77544455-7842-4de0-80a3-d8fc7dbb33f6";

const planningPrompt = "You help plan a Goal.\n";

// A Project with a planning prompt and planning item `search`, holding
// `files` too.
async function planningProject(
	files: Record<string, string> = {},
): Promise<string> {
	return makeProject({
		".vago/prompts/planning.md": planningPrompt,
		".vago-goals/search/planning/.keep": "",
		...files,
	});
}

test("a first message starts a session with the planning prompt and prints the answer", async () => {
	const root = await planningProject();
	const fake = await makeFakeClaude("exit 0", planningFixture);

	const said = await runVago(
		root,
		["plan", "say", "search", "--body-file", "-"],
		fake.env,
		"What should search rank by?",
	);

	expect(said.stderr).toBe("");
	expect(said.exitCode).toBe(0);
	expect(said.stdout).toBe(`${fixtureAnswer}\n`);
	const calls = await fake.calls();
	expect(calls).toHaveLength(1);
	expect(calls[0]?.argv).not.toContain("--resume");
	expect(calls[0]?.stdin).toBe(
		`${planningPrompt}\nWhat should search rank by?`,
	);
});

// Sends `message` to planning item `item` of the Project at `root` through
// `vago plan say`, with `fake` as the agent.
function say(
	root: string,
	item: string,
	message: string,
	fake: FakeHarness,
): Promise<VagoExit> {
	return runVago(
		root,
		["plan", "say", item, "--body-file", "-"],
		fake.env,
		message,
	);
}

test("a second message resumes the session with the message alone", async () => {
	const root = await planningProject();
	const fake = await makeFakeClaude("exit 0", planningFixture);
	await say(root, "search", "What should search rank by?", fake);

	const second = await say(root, "search", "And ties?", fake);

	expect(second.stderr).toBe("");
	expect(second.exitCode).toBe(0);
	const calls = await fake.calls();
	expect(calls).toHaveLength(2);
	const argv = calls[1]?.argv ?? [];
	expect(argv[argv.indexOf("--resume") + 1]).toBe(fixtureSessionId);
	expect(calls[1]?.stdin).toBe("And ties?");
});

test("the planning prompt edited in the Project is the one the agent gets", async () => {
	const root = await planningProject({
		".vago/prompts/planning.md": "Plan with care, in this Project's words.\n",
	});
	const fake = await makeFakeClaude("exit 0", planningFixture);

	await say(root, "search", "Hi", fake);

	const calls = await fake.calls();
	expect(calls[0]?.stdin).toStartWith(
		"Plan with care, in this Project's words.\n",
	);
});

test("the agent can't change a tracked or untracked file, or add one", async () => {
	const root = await planningProject({ "notes.txt": "untracked notes\n" });
	await Bun.write(join(root, "tracked.txt"), "tracked text\n");
	git(root, "add", "tracked.txt");
	git(root, ...gitIdentity, "commit", "--quiet", "-m", "tracked");
	const status = git(root, "status", "--porcelain");
	const fake = await makeFakeClaude(
		"printf x > tracked.txt; printf x > notes.txt; printf x > new.txt; exit 0",
		planningFixture,
	);

	await say(root, "search", "Write something", fake);

	expect(await Bun.file(join(root, "tracked.txt")).text()).toBe(
		"tracked text\n",
	);
	expect(await Bun.file(join(root, "notes.txt")).text()).toBe(
		"untracked notes\n",
	);
	expect(existsSync(join(root, "new.txt"))).toBe(false);
	expect(git(root, "status", "--porcelain")).toBe(status);
});

// What `git <args>` printed in the repo at `root`.
function git(root: string, ...args: string[]): string {
	return Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString();
}

test("the agent reads the Project's files and skills with read-only tools", async () => {
	const root = await planningProject({
		"notes.txt": "Search ranks by recency.\n",
		".claude/skills/demo/SKILL.md": "The demo skill's text.\n",
	});
	const fake = await makeFakeClaude(
		"cat notes.txt .claude/skills/demo/SKILL.md >&2; exit 0",
		planningFixture,
	);

	await say(root, "search", "Read the notes", fake);

	const log = await Bun.file(
		join(root, ".vago-goals/search/planning/logs/turn-01.jsonl"),
	).text();
	expect(log).toContain("Search ranks by recency.");
	expect(log).toContain("The demo skill's text.");
	const argv = (await fake.calls())[0]?.argv ?? [];
	const tools = argv[argv.indexOf("--tools") + 1] ?? "";
	expect(tools.split(",").sort()).toEqual(["Glob", "Grep", "Read", "Skill"]);
});

// A `chat.toml` whose one turn, sent `message`, is still being answered.
const openTurnChat = `harness = "claude-code"

[[turns]]
message = "What should search rank by?"
started = 2026-10-06T10:00:00.000Z
log = "logs/turn-01.jsonl"
`;

test("plan say refuses a Goal, no item, a blank message and an open turn", async () => {
	const root = await planningProject({
		".vago-goals/ready/goal.md": goalText("w"),
		".vago-goals/busy/planning/chat.toml": openTurnChat,
	});
	const fake = await makeFakeClaude("exit 0", planningFixture);

	for (const [item, message, refusal] of [
		["ready", "Hi", "ready is a Goal, not a planning item"],
		["nope", "Hi", "No planning item nope"],
		["search", " \n", "The message for search is empty"],
		["busy", "Hi", "busy: a response is still being written"],
	] as const) {
		const refused = await say(root, item, message, fake);

		expect(refused.exitCode).toBe(1);
		expect(refused.stderr).toContain(refusal);
	}
	expect(await fake.calls()).toEqual([]);
});

test("plan rename refuses an item whose response is still being written", async () => {
	const root = await planningProject({
		".vago-goals/busy/planning/chat.toml": openTurnChat,
	});

	const refused = await runVago(root, ["plan", "rename", "busy", "other"]);

	expect(refused.exitCode).toBe(1);
	expect(refused.stderr).toContain("busy: a response is still being written");
	expect(existsSync(join(root, ".vago-goals/busy/planning/chat.toml"))).toBe(
		true,
	);
	expect(existsSync(join(root, ".vago-goals/other"))).toBe(false);
});

test("each planning item keeps a conversation of its own", async () => {
	const root = await planningProject({ ".vago-goals/b/planning/.keep": "" });
	const fake = await makeFakeClaude("exit 0", planningFixture);
	await say(root, "search", "First item", fake);

	const other = await say(root, "b", "Second item", fake);

	expect(other.exitCode).toBe(0);
	const calls = await fake.calls();
	expect(calls[1]?.argv).not.toContain("--resume");
	expect(calls[1]?.stdin).toStartWith(planningPrompt);
});

test("plan say names the missing planning prompt and vago update", async () => {
	const root = await planningProject();
	await rm(join(root, ".vago/prompts/planning.md"));
	const fake = await makeFakeClaude("exit 0", planningFixture);

	const refused = await say(root, "search", "Hi", fake);

	expect(refused.exitCode).toBe(1);
	expect(refused.stderr).toContain(".vago/prompts/planning.md");
	expect(refused.stderr).toContain("vago update");
	expect(await fake.calls()).toEqual([]);
});

test("a failed session names its exit and its log", async () => {
	const root = await planningProject();
	const fake = await makeFakeClaude("exit 3", planningFixture);

	const failed = await say(root, "search", "Hi", fake);

	expect(failed.exitCode).toBe(1);
	expect(failed.stderr).toContain("exit 3");
	expect(failed.stderr).toContain(
		join(root, ".vago-goals/search/planning/logs/turn-01.jsonl"),
	);
});
