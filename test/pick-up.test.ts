import { expect, test } from "bun:test";
import { join } from "node:path";
import { makeFakeClaude } from "./fake-harness.ts";
import {
	goalText,
	goalWorktree,
	makeProject,
	readTicketFile,
	runsOf,
	runVago,
	ticketText,
} from "./project.ts";

const goalDir = ".vago-goals/hello";

async function headerOf(root: string): Promise<Record<string, unknown>> {
	return (await readTicketFile(root, `${goalDir}/tickets/01-greet.md`)).header;
}

test("a Ticket stuck at a later shell Step continues there, and the Steps before it don't run again", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"

[[steps]]
id   = "check"
type = "shell"
run  = "test -f fixed"
`,
		".vago/prompts/implement.md": "Implement it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: `+++\nstatus = "ready"\n+++\n\n# Greet\n`,
	});
	const claude = await makeFakeClaude();
	await runVago(root, ["run", "hello"], claude.env);
	expect((await headerOf(root)).status).toBe("stuck");
	await Bun.write(join(await goalWorktree(root, "hello"), "fixed"), "");

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(0);
	expect(await claude.calls()).toHaveLength(1);
	const greet = await headerOf(root);
	expect(greet.status).toBe("done");
	expect(runsOf(greet).map((run) => [run.step, run.outcome])).toEqual([
		["implement", "ok"],
		["check", "exit 1"],
		["check", "ok"],
	]);
});

// An agent Run's log holding only the line its session ends with, whose
// answer is `result`.
function agentLog(result: string): string {
	return `${JSON.stringify({
		type: "result",
		subtype: "success",
		result,
		usage: { input_tokens: 1, output_tokens: 1 },
	})}\n`;
}

const implementAndReview = `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"

[[steps]]
id     = "review"
type   = "agent"
prompt = "prompts/review.md"
`;

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 9, minute));

test("a Ticket whose Run was interrupted continues at the interrupted Step", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": implementAndReview,
		".vago/prompts/implement.md": "Implement it.\n",
		".vago/prompts/review.md": "Review it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: ticketText("stuck", {
			runs: [
				{
					step: "implement",
					model: "opus",
					started: at(0),
					ended: at(1),
					outcome: "ok",
				},
				{
					step: "review",
					model: "opus",
					started: at(2),
					ended: at(3),
					outcome: "interrupted",
				},
			],
		}),
		[`${goalDir}/logs/implement-1.jsonl`]: agentLog("implemented"),
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(0);
	const calls = await claude.calls();
	expect(calls.map(({ stdin }) => stdin)).toEqual(["Review it.\n"]);
	const greet = await headerOf(root);
	expect(greet.status).toBe("done");
	expect(runsOf(greet).map((run) => [run.step, run.outcome])).toEqual([
		["implement", "ok"],
		["review", "interrupted"],
		["review", "ok"],
	]);
});

test("a lost Ticket continues at the Step it was on, and says it was picked up there", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": implementAndReview,
		".vago/prompts/implement.md": "Implement it.\n",
		".vago/prompts/review.md": "Review it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		// What a `vago run` killed mid-Step leaves: the Run's entry opened
		// and never closed.
		[`${goalDir}/tickets/01-greet.md`]: ticketText("running", {
			runs: [
				{
					step: "implement",
					model: "opus",
					started: at(0),
					ended: at(1),
					outcome: "ok",
				},
				{ step: "review", model: "opus", started: at(2) },
			],
		}),
		[`${goalDir}/logs/implement-1.jsonl`]: agentLog("implemented"),
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain("\n01-greet, picked up at review\n");
	expect((await claude.calls()).map(({ stdin }) => stdin)).toEqual([
		"Review it.\n",
	]);
	const greet = await headerOf(root);
	expect(greet.status).toBe("done");
	expect(runsOf(greet).map((run) => [run.step, run.outcome])).toEqual([
		["implement", "ok"],
		["review", "lost"],
		["review", "ok"],
	]);
});

// implement, then a shell check, then a review whose prompt reads both.
const implementCheckReview = (checkOnFail: string) => `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"

[[steps]]
id   = "check"
type = "shell"
run  = "true"
${checkOnFail}

[[steps]]
id     = "review"
type   = "agent"
prompt = "prompts/review.md"
`;

// A Ticket stuck after its review was interrupted, its implement and check
// Runs ended as given.
function reviewProject(
	checkOutcome: string,
	checkOnFail: string,
): Promise<string> {
	return makeProject({
		".vago/workflows/test.toml": implementCheckReview(checkOnFail),
		".vago/prompts/implement.md": "Implement it.\n",
		".vago/prompts/review.md":
			"Implemented: {{steps.implement.output}}\nChecked: {{steps.check.output}}",
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: ticketText("stuck", {
			runs: [
				{
					step: "implement",
					model: "opus",
					started: at(0),
					ended: at(1),
					outcome: "ok",
				},
				{
					step: "check",
					started: at(2),
					ended: at(3),
					outcome: checkOutcome,
				},
				{
					step: "review",
					model: "opus",
					started: at(4),
					ended: at(5),
					outcome: "interrupted",
				},
			],
		}),
		[`${goalDir}/logs/implement-1.jsonl`]: agentLog("added the greeting"),
		[`${goalDir}/logs/check-2.log`]: "12 tests passed\n",
	});
}

test("a picked-up Step's prompt gets the earlier agent Step's result and shell Step's log and exit code", async () => {
	const root = await reviewProject("ok", "");
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(0);
	expect((await claude.calls()).map(({ stdin }) => stdin)).toEqual([
		"Implemented: added the greeting\nChecked: exit code 0\n12 tests passed\n",
	]);
});

test("an earlier shell Step that failed with on_fail = continue gives the picked-up Step its exit code and log", async () => {
	const root = await reviewProject("exit 4", `on_fail = "continue"`);
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(0);
	expect((await claude.calls()).map(({ stdin }) => stdin)).toEqual([
		"Implemented: added the greeting\nChecked: exit code 4\n12 tests passed\n",
	]);
});

test("when an earlier Step's log is gone, vago run refuses the Ticket, names the Step and leaves the Ticket as it was", async () => {
	const root = await reviewProject("ok", "");
	const ticketFile = Bun.file(join(root, goalDir, "tickets/01-greet.md"));
	const before = await ticketFile.text();
	await Bun.file(join(root, goalDir, "logs/implement-1.jsonl")).delete();
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	expect(result.stdout).toContain(
		"01-greet can't be picked up: implement has no log left to rebuild its output from\n  reset:  vago ticket reset hello 01\n",
	);
	expect(await ticketFile.text()).toBe(before);
	expect(await claude.calls()).toEqual([]);
});

test("when the Step a Ticket stopped on isn't in its Workflow, vago run refuses it, names the Step and leaves it as it was", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": implementAndReview,
		".vago/prompts/implement.md": "Implement it.\n",
		".vago/prompts/review.md": "Review it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: ticketText("stuck", {
			runs: [
				{
					step: "implement",
					model: "opus",
					started: at(0),
					ended: at(1),
					outcome: "ok",
				},
				{
					step: "polish",
					model: "opus",
					started: at(2),
					ended: at(3),
					outcome: "exit 1",
				},
			],
		}),
		[`${goalDir}/logs/implement-1.jsonl`]: agentLog("implemented"),
	});
	const ticketFile = Bun.file(join(root, goalDir, "tickets/01-greet.md"));
	const before = await ticketFile.text();
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	expect(result.stdout).toContain(
		"01-greet can't be picked up: polish isn't in the Ticket's Workflow\n",
	);
	expect(await ticketFile.text()).toBe(before);
	expect(await claude.calls()).toEqual([]);
});

test("a picked-up agent Step runs in a fresh session with its usual prompt", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": implementAndReview,
		".vago/prompts/implement.md": "Implement it.\n",
		".vago/prompts/review.md": "Review it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: `+++
status = "stuck"

[[runs]]
step = "implement"
harness = "claude-code"
model = "opus"
started = 2026-10-01T09:00:00Z
ended = 2026-10-01T09:01:00Z
outcome = "ok"
log = "logs/implement-1.jsonl"

[[runs]]
step = "review"
harness = "claude-code"
model = "opus"
session_id = "f679b9c4-e75a-4f73-affd-0dedfe161e0d"
started = 2026-10-01T09:02:00Z
ended = 2026-10-01T09:03:00Z
outcome = "interrupted"
log = "logs/review-2.jsonl"
+++

# Greet
`,
		[`${goalDir}/logs/implement-1.jsonl`]: agentLog("implemented"),
	});
	const claude = await makeFakeClaude();

	await runVago(root, ["run", "hello"], claude.env);

	const [review, ...more] = await claude.calls();
	expect(more).toEqual([]);
	expect(review?.stdin).toBe("Review it.\n");
	expect(review?.argv).not.toContain("--resume");
});

test("a stuck Ticket with no Runs starts at its first Step", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": implementAndReview,
		".vago/prompts/implement.md": "Implement it.\n",
		".vago/prompts/review.md": "Review it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: ticketText("stuck"),
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain("\n01-greet\n");
	expect(runsOf(await headerOf(root)).map((run) => run.step)).toEqual([
		"implement",
		"review",
	]);
});

test("a picked-up Step gets the outputs of the Ticket's latest pass, not of an earlier one", async () => {
	const ended = (step: string, minute: number, outcome: string) => ({
		step,
		started: at(minute),
		ended: at(minute + 1),
		outcome,
	});
	const root = await makeProject({
		".vago/workflows/test.toml": `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"

[[steps]]
id   = "announce"
type = "shell"
run  = "echo announced"
when = "last-ticket"

[[steps]]
id     = "review"
type   = "agent"
prompt = "prompts/review.md"
`,
		".vago/prompts/implement.md": "Implement it.\n",
		".vago/prompts/review.md":
			"Review: {{steps.implement.output}} {{steps.announce.output}}",
		[`${goalDir}/goal.md`]: goalText("test"),
		// The first pass ran while 01 was the Goal's last Ticket, so it
		// announced; 02 was added before the second, which skipped it.
		[`${goalDir}/tickets/01-greet.md`]: ticketText("stuck", {
			runs: [
				{ ...ended("implement", 0, "ok"), model: "opus" },
				ended("announce", 2, "ok"),
				{ ...ended("review", 4, "exit 1"), model: "opus" },
				{ ...ended("implement", 6, "ok"), model: "opus" },
				{ ...ended("review", 8, "interrupted"), model: "opus" },
			],
		}),
		[`${goalDir}/tickets/02-wave.md`]: ticketText("ready", { blockedBy: [1] }),
		[`${goalDir}/logs/implement-1.jsonl`]: agentLog("old"),
		[`${goalDir}/logs/announce-2.log`]: "announced\n",
		[`${goalDir}/logs/implement-4.jsonl`]: agentLog("new"),
	});
	const claude = await makeFakeClaude();

	await runVago(root, ["run", "hello"], claude.env);

	const [review] = await claude.calls();
	expect(review?.stdin).toBe("Review: new {{steps.announce.output}}");
});
