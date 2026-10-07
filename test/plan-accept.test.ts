import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
	type FakeHarness,
	makeFakeClaude,
	planningFixture,
	planningFixtureAnswering,
} from "./fake-harness.ts";
import {
	makeProject,
	oneStep,
	readTicketFile,
	runVago,
	startVago,
	type VagoExit,
} from "./project.ts";

const item = ".vago-goals/search";

// Each test runs several vago processes, and one test four rounds of them,
// which a loaded machine takes past bun's 5s.
setDefaultTimeout(20_000);

// A Project with a planning prompt, Workflows `small` and `try-hard`, and
// planning item `search`.
function planningProject(): Promise<string> {
	return makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago/workflows/small.toml": oneStep("true"),
		".vago/workflows/try-hard.toml": oneStep("true"),
		[`${item}/planning/.keep`]: "",
	});
}

const proposedGoal =
	"# Search ranks by relevance\n\nResults come back best first.\n";
const scoreBody = "# Score each result\nGive each result a score.\n";
const rankBody = "# Rank results by score\nSort by the score.\n";

const twoTickets = `
[[tickets]]
slug = "score"
body = '''
${scoreBody}'''

[[tickets]]
slug = "rank-by-score"
blocked_by = [1]
body = '''
${rankBody}'''`;

// An answer ending in a proposal block whose `tickets` part is `tickets`,
// recommending a Workflow with `recommendation`, a line of the block.
function answerProposing(
	tickets: string,
	recommendation = 'workflow = "small"',
): string {
	return `Here is a first draft.

<vago-plan>
${recommendation}
goal = '''
${proposedGoal}'''
${tickets}
</vago-plan>`;
}

// Sends a message to planning item `search` of the Project at `root`, with
// an agent that answers `answer`, and gives back the fake Harness it ran.
async function say(root: string, answer: string): Promise<FakeHarness> {
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
	return fake;
}

// A Project whose item `search` has a ready two-Ticket Proposal.
async function readyProject(): Promise<{ root: string; fake: FakeHarness }> {
	const root = await planningProject();
	const fake = await say(root, answerProposing(twoTickets));
	return { root, fake };
}

function accept(root: string): Promise<VagoExit> {
	return runVago(root, ["plan", "accept", "search"]);
}

function file(root: string, path: string): Promise<string> {
	return Bun.file(join(root, item, path)).text();
}

test("plan accept turns a ready Proposal into a ready Goal and its Tickets", async () => {
	const { root } = await readyProject();

	const accepted = await accept(root);

	expect(accepted.stderr).toBe("");
	expect(accepted.exitCode).toBe(0);
	expect(accepted.stdout).toEndWith(`${item}/goal.md\n`);
	const goal = await readTicketFile(root, `${item}/goal.md`);
	expect(goal.header.workflow).toBe("small");
	expect(goal.body).toBe(proposedGoal);
	const score = await readTicketFile(root, `${item}/tickets/01-score.md`);
	const rank = await readTicketFile(
		root,
		`${item}/tickets/02-rank-by-score.md`,
	);
	expect(score.header.status).toBe("ready");
	expect(score.header.blocked_by).toBeUndefined();
	expect(score.body).toBe(scoreBody);
	expect(rank.header.status).toBe("ready");
	expect(rank.header.blocked_by).toEqual([1]);
	expect(rank.body).toBe(rankBody);
	for (const kept of [
		"planning/chat.toml",
		"planning/proposal.toml",
		"planning/logs/turn-01.jsonl",
	]) {
		expect(existsSync(join(root, item, kept))).toBe(true);
	}
	expect(existsSync(join(root, item, "planning/accepting"))).toBe(false);
});

test("plan accept uses the Workflow the human chose over the recommended one", async () => {
	const { root } = await readyProject();
	await runVago(root, ["plan", "workflow", "search", "try-hard"]);

	const accepted = await accept(root);

	expect(accepted.exitCode).toBe(0);
	const goal = await readTicketFile(root, `${item}/goal.md`);
	expect(goal.header.workflow).toBe("try-hard");
});

// An open turn appended to the chat of `search`, as a `vago plan say` leaves
// it while answering. With no live vago holding the item, it is interrupted.
const openTurn = `
[[turns]]
message = "One more thing"
started = 2026-10-06T10:00:00.000Z
log = "logs/turn-02.jsonl"
`;

const refusals: {
	name: string;
	answer?: string;
	change?: (root: string) => Promise<unknown>;
	reason: string;
}[] = [
	{ name: "no Proposal yet", reason: "has no proposal to accept yet" },
	{
		name: "no Workflow recommended or chosen",
		answer: answerProposing(twoTickets, ""),
		reason: "No Workflow is recommended or chosen",
	},
	{
		name: "no Tickets",
		answer: answerProposing("tickets = []"),
		reason: "no Tickets",
	},
	{
		name: "a blocker on a later Ticket",
		answer: answerProposing(
			twoTickets.replace('slug = "score"', 'slug = "score"\nblocked_by = [2]'),
		),
		reason: "is blocked by 2, which isn't an earlier Ticket",
	},
	{
		name: "a bad slug",
		answer: answerProposing(twoTickets.replace('"score"', '"no/slash"')),
		reason: "may hold only letters, digits, - and _",
	},
	{
		name: "the recommended Workflow removed",
		change: (root) => rm(join(root, ".vago/workflows/small.toml")),
		reason: `Workflow "small" isn't one of the Project's`,
	},
	{
		name: "the Workflow not valid TOML",
		change: (root) =>
			Bun.write(join(root, ".vago/workflows/small.toml"), "steps = ["),
		reason: "small.toml",
	},
	{
		name: "an open last response whose vago died",
		change: async (root) =>
			Bun.write(
				join(root, item, "planning/chat.toml"),
				`${await file(root, "planning/chat.toml")}${openTurn}`,
			),
		reason: "search: its last response was interrupted",
	},
	{
		name: "a last response recorded interrupted",
		change: async (root) =>
			Bun.write(
				join(root, item, "planning/chat.toml"),
				`${await file(root, "planning/chat.toml")}${openTurn}ended = 2026-10-06T10:01:00.000Z\noutcome = "interrupted"\n`,
			),
		reason: "search: its last response was interrupted",
	},
];

for (const { name, answer, change, reason } of refusals) {
	test(`plan accept refuses ${name} and creates nothing`, async () => {
		const root = await planningProject();
		if (name !== "no Proposal yet") {
			await say(root, answer ?? answerProposing(twoTickets));
		}
		await change?.(root);
		const proposalBefore = await file(root, "planning/proposal.toml").catch(
			() => undefined,
		);

		const refused = await accept(root);

		expect(refused.stderr).toContain(reason);
		expect(refused.exitCode).toBe(1);
		for (const absent of ["goal.md", "tickets", "running.lock"]) {
			expect(existsSync(join(root, item, absent))).toBe(false);
		}
		expect(
			await file(root, "planning/proposal.toml").catch(() => undefined),
		).toBe(proposalBefore);
	});
}

// Every file in the `tickets/` of `search`, by name, with its text.
async function ticketFiles(root: string): Promise<Record<string, string>> {
	const texts: Record<string, string> = {};
	for (const name of (await readdir(join(root, item, "tickets"))).sort()) {
		texts[name] = await file(root, `tickets/${name}`);
	}
	return texts;
}

test("a second plan accept is refused and leaves the Goal's Tickets as they were", async () => {
	const { root } = await readyProject();
	await accept(root);
	const before = await ticketFiles(root);

	const again = await accept(root);

	expect(again.stderr).toContain("was accepted as a Goal");
	expect(again.exitCode).toBe(1);
	expect(await ticketFiles(root)).toEqual(before);
	expect(Object.keys(before)).toEqual(["01-score.md", "02-rank-by-score.md"]);
});

test("of two plan accepts at once, one creates the Goal and the other is refused", async () => {
	// A few rounds, since two processes interleave differently each time.
	for (let round = 0; round < 4; round++) {
		const { root } = await readyProject();

		const ends = await Promise.all([accept(root), accept(root)]);

		const accepted = ends.filter(({ exitCode }) => exitCode === 0);
		const refused = ends.filter(({ exitCode }) => exitCode !== 0);
		expect(accepted).toHaveLength(1);
		expect(refused).toHaveLength(1);
		expect(refused[0]?.exitCode).toBe(1);
		expect(refused[0]?.stderr).toMatch(
			/was accepted as a Goal|another vago is changing the item/,
		);
		expect(Object.keys(await ticketFiles(root))).toEqual([
			"01-score.md",
			"02-rank-by-score.md",
		]);
		const rank = await readTicketFile(
			root,
			`${item}/tickets/02-rank-by-score.md`,
		);
		expect(rank.body).toBe(rankBody);
		expect(existsSync(join(root, item, "running.lock"))).toBe(false);
	}
});

test("a plan accept whose write fails leaves no Goal, and a retry succeeds", async () => {
	const { root } = await readyProject();
	const planning = join(root, item, "planning");
	const chatBefore = await file(root, "planning/chat.toml");
	const proposalBefore = await file(root, "planning/proposal.toml");
	await chmod(planning, 0o555);
	let failed: VagoExit;
	try {
		failed = await accept(root);
	} finally {
		await chmod(planning, 0o755);
	}

	expect(failed.exitCode).toBe(1);
	for (const absent of ["goal.md", "tickets", "running.lock"]) {
		expect(existsSync(join(root, item, absent))).toBe(false);
	}
	expect(await file(root, "planning/chat.toml")).toBe(chatBefore);
	expect(await file(root, "planning/proposal.toml")).toBe(proposalBefore);
	expect((await accept(root)).exitCode).toBe(0);
});

test("plan accept replaces what a crashed acceptance left", async () => {
	const { root } = await readyProject();
	await Bun.write(join(root, item, "tickets/01-stale.md"), "stale\n");
	await Bun.write(join(root, item, "planning/accepting/goal.md"), "stale\n");

	const renamed = await runVago(root, ["plan", "rename", "search", "found"]);
	const back = await runVago(root, ["plan", "rename", "found", "search"]);
	const run = await runVago(root, ["run", "search"]);

	expect(renamed.exitCode).toBe(0);
	expect(back.exitCode).toBe(0);
	expect(run.stderr).toContain("not found");
	const accepted = await accept(root);
	expect(accepted.stderr).toBe("");
	expect(accepted.exitCode).toBe(0);
	expect(Object.keys(await ticketFiles(root))).toEqual([
		"01-score.md",
		"02-rank-by-score.md",
	]);
	expect(existsSync(join(root, item, "planning/accepting"))).toBe(false);
});

test("plan accept starts nothing", async () => {
	const { root, fake } = await readyProject();
	const callsBefore = await fake.calls();
	const worktrees = () =>
		Bun.spawnSync(["git", "worktree", "list"], { cwd: root }).stdout.toString();
	const worktreesBefore = worktrees();

	expect((await accept(root)).exitCode).toBe(0);

	expect(existsSync(join(root, item, "running.lock"))).toBe(false);
	expect(await fake.calls()).toEqual(callsBefore);
	expect(worktrees()).toBe(worktreesBefore);
	const goal = await readTicketFile(root, `${item}/goal.md`);
	expect(goal.header.runs).toBeUndefined();
	for (const name of Object.keys(await ticketFiles(root))) {
		const ticket = await readTicketFile(root, `${item}/tickets/${name}`);
		expect(ticket.header.status).toBe("ready");
		expect(ticket.header.runs).toBeUndefined();
	}
});

test("the accepted Goal's report counts its build Runs, not its planning", async () => {
	const { root } = await readyProject();
	expect((await accept(root)).exitCode).toBe(0);

	const report = await runVago(root, ["goal", "report", "search"]);

	expect(report.exitCode).toBe(0);
	expect(report.stdout).toContain("| **Total** | **0** | **0.0s** | **** |");
	// What `planningFixture`'s session cost.
	expect(report.stdout).not.toContain("$0.11");
	const chat = Bun.TOML.parse(await file(root, "planning/chat.toml")) as {
		turns: { cost_usd?: number }[];
	};
	expect(chat.turns[0]?.cost_usd).toBeGreaterThan(0);
});

test("an accepted Goal's planning chat is read-only", async () => {
	const { root } = await readyProject();
	await accept(root);
	const chatBefore = await file(root, "planning/chat.toml");
	const fake = await makeFakeClaude(
		"exit 0",
		await planningFixtureAnswering("More"),
	);

	const said = await runVago(
		root,
		["plan", "say", "search", "--body-file", "-"],
		fake.env,
		"Change the Goal",
	);
	const changes = await Promise.all([
		runVago(root, ["plan", "workflow", "search", "try-hard"]),
		runVago(root, ["plan", "rename", "search", "other"]),
		runVago(root, ["plan", "discard", "search"]),
	]);

	expect(said.stderr).toContain("its planning chat is read-only");
	expect(said.exitCode).toBe(1);
	expect(await fake.calls()).toEqual([]);
	expect(await file(root, "planning/chat.toml")).toBe(chatBefore);
	for (const changed of changes) {
		expect(changed.stderr).toContain("its planning chat is read-only");
		expect(changed.exitCode).toBe(1);
	}
	expect(existsSync(join(root, item, "planning/workflow.toml"))).toBe(false);
	expect(Object.keys(await ticketFiles(root))).toHaveLength(2);
	expect(existsSync(join(root, item, "goal.md"))).toBe(true);
});

test("an accepted Goal takes Tickets from the CLI and Goals are still made there", async () => {
	const { root } = await readyProject();
	await accept(root);

	const added = await runVago(
		root,
		["ticket", "add", "search", "extra", "--body-file", "-"],
		{},
		"# Extra\n",
	);
	const made = await runVago(root, [
		"goal",
		"new",
		"other",
		"--workflow",
		"small",
	]);

	expect(added.stderr).toBe("");
	expect(added.stdout).toEndWith(`${item}/tickets/03-extra.md\n`);
	expect(made.stderr).toBe("");
	expect(made.exitCode).toBe(0);
});

test("plan accept is refused while a response is being written", async () => {
	const { root } = await readyProject();
	const sleeps = await makeFakeClaude("sleep 30", planningFixture);
	const worker = startVago(
		root,
		["plan", "say", "search", "--body-file", "-"],
		sleeps.env,
		"One more thing",
	);
	for (
		let tries = 0;
		!(await file(root, "planning/chat.toml")).includes("One more thing");
		tries++
	) {
		if (tries === 300) throw new Error("The turn was never recorded");
		await Bun.sleep(20);
	}

	const refused = await accept(root);

	expect(refused.exitCode).toBe(1);
	expect(refused.stderr).toContain(
		"search: a response is still being written, or another vago is changing the item",
	);
	expect(existsSync(join(root, item, "goal.md"))).toBe(false);
	worker.kill("SIGTERM");
	await worker.exited;
});
