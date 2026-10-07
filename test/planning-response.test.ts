import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type FakeHarness,
	makeFakeClaude,
	makeFakeCodex,
	planningFixture,
} from "./fake-harness.ts";
import {
	goalText,
	heldLock,
	makeProject,
	oneStep,
	type RunningVago,
	readTicketFile,
	runVago,
	startVago,
	ticketText,
	type VagoExit,
} from "./project.ts";

const planningPrompt = "You help plan a Goal.\n";

// The session id `planningFixture` reports.
const fixtureSessionId = "77544455-7842-4de0-80a3-d8fc7dbb33f6";

// The session id `codexSessionFixture` reports.
const codexSessionId = "01a10e32-3816-7022-9ae8-c718d8802ffe";

// A Project with a planning prompt and planning item `a`, holding `files`
// too.
function planningProject(files: Record<string, string> = {}): Promise<string> {
	return makeProject({
		".vago/prompts/planning.md": planningPrompt,
		".vago-goals/a/planning/.keep": "",
		...files,
	});
}

// Starts `vago plan say <item>` with `message`, with `fake` as the agent.
function startSay(
	root: string,
	item: string,
	message: string,
	fake: FakeHarness,
): RunningVago {
	return startVago(
		root,
		["plan", "say", item, "--body-file", "-"],
		fake.env,
		message,
	);
}

// Sends `message` to `item` through `vago plan say` and waits for it.
function say(
	root: string,
	item: string,
	message: string,
	fake: FakeHarness,
): Promise<VagoExit> {
	return startSay(root, item, message, fake).exited;
}

// The text of planning item `item`'s `chat.toml`, empty while there is none.
function chatText(root: string, item: string): Promise<string> {
	return Bun.file(join(root, ".vago-goals", item, "planning/chat.toml"))
		.text()
		.catch(() => "");
}

// Waits until `item`'s `chat.toml` contains `text`.
async function chatWith(
	root: string,
	item: string,
	text: string,
): Promise<string> {
	for (let tries = 0; ; tries++) {
		const chat = await chatText(root, item);
		if (chat.includes(text)) return chat;
		if (tries === 300) throw new Error(`No chat.toml has ${text}:\n${chat}`);
		await Bun.sleep(20);
	}
}

test("a second message is refused while the first response is being written", async () => {
	const root = await planningProject();
	const fake = await makeFakeClaude("sleep 30", planningFixture);
	const first = startSay(root, "a", "What should search rank by?", fake);
	await chatWith(root, "a", fixtureSessionId);

	const second = await say(root, "a", "And ties?", fake);

	expect(second.exitCode).toBe(1);
	expect(second.stderr).toContain("a response is still being written");
	expect(await fake.calls()).toHaveLength(1);
	first.kill("SIGTERM");
	await first.exited;
});

// The answer `planningFixture` ends with.
const fixtureAnswer =
	"It says that search results are sorted by recency, so the newest ones come first.";

// The `[[turns]]` of `item`'s `chat.toml`.
async function turnsOf(
	root: string,
	item: string,
): Promise<Record<string, unknown>[]> {
	const chat = Bun.TOML.parse(await chatText(root, item)) as {
		turns?: Record<string, unknown>[];
	};
	return chat.turns ?? [];
}

test("a stopped worker records its response interrupted, and plan retry answers it", async () => {
	const root = await planningProject();
	const sleeps = await makeFakeClaude("sleep 30", planningFixture);
	const worker = startSay(root, "a", "What should search rank by?", sleeps);
	await chatWith(root, "a", fixtureSessionId);

	worker.kill("SIGTERM");
	await worker.exited;

	await chatWith(root, "a", 'outcome = "interrupted"');
	const askedAt = (await turnsOf(root, "a"))[0]?.started;
	const answers = await makeFakeClaude("exit 0", planningFixture);
	const retried = await runVago(root, ["plan", "retry", "a"], answers.env);
	expect(retried.stderr).toBe("");
	expect(retried.exitCode).toBe(0);
	expect(retried.stdout).toBe(`${fixtureAnswer}\n`);
	const turns = await turnsOf(root, "a");
	expect(turns).toHaveLength(1);
	expect(turns[0]?.outcome).toBe("ok");
	// The interrupted attempt's time isn't the agent's: the turn's starts again.
	expect(Date.parse(`${turns[0]?.started}`)).toBeGreaterThan(
		Date.parse(`${askedAt}`),
	);
});

test("each response records what its session cost on its turn", async () => {
	const root = await planningProject();
	const answers = await makeFakeClaude("exit 0", planningFixture);

	await say(root, "a", "What should search rank by?", answers);
	await say(root, "a", "And ties?", answers);

	const turns = await turnsOf(root, "a");
	expect(turns.map(({ cost_usd }) => cost_usd)).toEqual([
		fixtureCostUsd,
		fixtureCostUsd,
	]);
});

// The cost `planningFixture`'s session reports.
const fixtureCostUsd = 0.10768140000000001;

// Answers turn 1 of item `a`, then SIGKILLs the `vago plan say` of turn 2
// once its session has reported, leaving the response open with no live
// vago. Gives back the fake whose call was cut off.
async function killedMidResponse(root: string): Promise<FakeHarness> {
	const answers = await makeFakeClaude("exit 0", planningFixture);
	await say(root, "a", "What should search rank by?", answers);
	const sleeps = await makeFakeClaude("sleep 30", planningFixture);
	const worker = startSay(root, "a", "And ties?", sleeps);
	for (
		let tries = 0;
		(await turnsOf(root, "a"))[1]?.session_id === undefined;
		tries++
	) {
		if (tries === 300) throw new Error("Turn 2's session never reported");
		await Bun.sleep(20);
	}
	worker.kill("SIGKILL");
	await worker.exited;
	return sleeps;
}

test("plan retry resumes the session the interrupted response reported", async () => {
	const root = await planningProject();
	await killedMidResponse(root);
	const answers = await makeFakeClaude("exit 0", planningFixture);

	const retried = await runVago(root, ["plan", "retry", "a"], answers.env);

	expect(retried.stderr).toBe("");
	expect(retried.exitCode).toBe(0);
	expect(retried.stdout).toBe(`${fixtureAnswer}\n`);
	const calls = await answers.calls();
	expect(calls).toHaveLength(1);
	const argv = calls[0]?.argv ?? [];
	expect(argv[argv.indexOf("--resume") + 1]).toBe(fixtureSessionId);
	expect(calls[0]?.stdin).toBe(
		"You were interrupted. Continue your answer from where you stopped.\n",
	);
	const turns = await turnsOf(root, "a");
	expect(turns.map((turn) => turn.message)).toEqual([
		"What should search rank by?",
		"And ties?",
	]);
	expect(turns[1]?.outcome).toBe("ok");
	expect(turns[1]?.interrupted_logs).toEqual(["logs/turn-02.jsonl"]);
});

test("plan retry sends a message that never reached the agent once, as the first turn would", async () => {
	const root = await planningProject({
		".vago-goals/a/planning/chat.toml": `harness = "claude-code"

[[turns]]
message = "What should search rank by?"
started = 2026-10-06T10:00:00.000Z
log = "logs/turn-01.jsonl"
`,
	});
	const answers = await makeFakeClaude("exit 0", planningFixture);

	const retried = await runVago(root, ["plan", "retry", "a"], answers.env);

	expect(retried.stderr).toBe("");
	expect(retried.exitCode).toBe(0);
	const calls = await answers.calls();
	expect(calls).toHaveLength(1);
	expect(calls[0]?.argv).not.toContain("--resume");
	expect(calls[0]?.stdin).toBe(
		`${planningPrompt}\nWhat should search rank by?`,
	);
	const turns = await turnsOf(root, "a");
	expect(turns.map((turn) => turn.message)).toEqual([
		"What should search rank by?",
	]);
	expect(turns[0]?.outcome).toBe("ok");
});

// A `chat.toml` of one turn, open, or ended with `outcome` when given.
function oneTurnChat(outcome?: string): string {
	const ended =
		outcome === undefined
			? ""
			: `ended = 2026-10-06T10:01:00.000Z\noutcome = "${outcome}"\n`;
	return `harness = "claude-code"

[[turns]]
message = "What should search rank by?"
started = 2026-10-06T10:00:00.000Z
log = "logs/turn-01.jsonl"
${ended}`;
}

test("plan retry refuses an answered response, a held item and an accepted Goal", async () => {
	const root = await planningProject({
		".vago-goals/a/planning/chat.toml": oneTurnChat("ok"),
		".vago-goals/busy/planning/chat.toml": oneTurnChat(),
		".vago-goals/done/goal.md": goalText("w"),
		".vago-goals/done/planning/chat.toml": oneTurnChat("interrupted"),
	});
	await heldLock(root, "busy");
	const fake = await makeFakeClaude("exit 0", planningFixture);

	for (const [item, refusal] of [
		["a", "a has no interrupted response to retry"],
		[
			"busy",
			"busy: a response is still being written, or another vago is changing the item",
		],
		["done", "done was accepted as a Goal; its planning chat is read-only"],
	] as const) {
		const refused = await runVago(root, ["plan", "retry", item], fake.env);

		expect(refused.exitCode).toBe(1);
		expect(refused.stderr).toContain(refusal);
	}
	expect(await fake.calls()).toEqual([]);
});

test("two planning items and a ready Goal all progress while a response is written", async () => {
	const root = await planningProject({
		".vago-goals/b/planning/.keep": "",
		".vago/workflows/w.toml": oneStep("true"),
		".vago-goals/g/goal.md": goalText("w"),
		".vago-goals/g/tickets/01-t.md": ticketText("ready"),
	});
	const forA = await makeFakeClaude("sleep 4; exit 0", planningFixture);
	const forB = await makeFakeClaude("sleep 4; exit 0", planningFixture);
	const sayA = startSay(root, "a", "First item", forA);
	const sayB = startSay(root, "b", "Second item", forB);
	await chatWith(root, "a", fixtureSessionId);
	await chatWith(root, "b", fixtureSessionId);

	const run = await runVago(root, ["run", "g"]);

	expect(run.exitCode).toBe(0);
	const ticket = await readTicketFile(root, ".vago-goals/g/tickets/01-t.md");
	expect(ticket.header.status).toBe("done");
	expect(await chatText(root, "a")).not.toContain("outcome");
	expect(await chatText(root, "b")).not.toContain("outcome");
	expect((await sayA.exited).exitCode).toBe(0);
	expect((await sayB.exited).exitCode).toBe(0);
	expect((await turnsOf(root, "a"))[0]?.outcome).toBe("ok");
	expect((await turnsOf(root, "b"))[0]?.outcome).toBe("ok");
});

test("plan discard stops the response being written, and the item stays gone", async () => {
	const root = await planningProject();
	const sleeps = await makeFakeClaude("sleep 30", planningFixture);
	const worker = startSay(root, "a", "What should search rank by?", sleeps);
	await chatWith(root, "a", fixtureSessionId);

	const discarded = await runVago(root, ["plan", "discard", "a"]);

	expect(discarded.stderr).toBe("");
	expect(discarded.exitCode).toBe(0);
	const stopped = await Promise.race([
		worker.exited.then(() => true),
		Bun.sleep(1000).then(() => false),
	]);
	expect(stopped).toBe(true);
	expect(existsSync(join(root, ".vago-goals/a"))).toBe(false);
	await Bun.sleep(500);
	expect(existsSync(join(root, ".vago-goals/a"))).toBe(false);
});

test("plan retry on a Codex chat resumes the interrupted session with codex exec resume", async () => {
	const root = await planningProject({
		".vago-goals/a/planning/chat.toml": 'harness = "codex"\n',
	});
	const sleeps = await makeFakeCodex("sleep 30");
	const worker = startSay(root, "a", "What should search rank by?", sleeps);
	await chatWith(root, "a", codexSessionId);
	worker.kill("SIGKILL");
	await worker.exited;
	const answers = await makeFakeCodex("exit 0");

	const retried = await runVago(root, ["plan", "retry", "a"], answers.env);

	expect(retried.stderr).toBe("");
	expect(retried.exitCode).toBe(0);
	const argv = (await answers.calls())[0]?.argv ?? [];
	expect(argv.slice(argv.indexOf("resume"))).toEqual([
		"resume",
		codexSessionId,
		"-",
	]);
	expect((await turnsOf(root, "a"))[0]?.outcome).toBe("ok");
});

test("a message after an interrupted response closes it interrupted and starts a turn of its own", async () => {
	const root = await planningProject();
	await killedMidResponse(root);
	const answers = await makeFakeClaude("exit 0", planningFixture);

	const sent = await say(root, "a", "Then rank by score.", answers);

	expect(sent.stderr).toBe("");
	expect(sent.exitCode).toBe(0);
	const turns = await turnsOf(root, "a");
	expect(turns.map((turn) => turn.message)).toEqual([
		"What should search rank by?",
		"And ties?",
		"Then rank by score.",
	]);
	expect(turns.map((turn) => turn.outcome)).toEqual([
		"ok",
		"interrupted",
		"ok",
	]);
	expect(await answers.calls()).toHaveLength(1);
});
