import { expect, test } from "bun:test";
import { join } from "node:path";
import { findHarness, type RunActivity } from "../src/harness/registry.ts";

// Recorded Claude Code streams, their paths replaced. The tool-call, Skill
// and max-turns sessions ran in a Goal's worktree under
// /home/user/.vago/worktrees/project-1a2b3c4d/hello.
async function fixtureLines(name: string): Promise<string[]> {
	const text = await Bun.file(join(import.meta.dir, "fixtures", name)).text();
	return text.split("\n");
}

async function activityOf(name: string): Promise<RunActivity> {
	return findHarness("claude-code").runActivity(await fixtureLines(name));
}

test("a session gives its start, the tools it called, its prose and its end", async () => {
	expect(await activityOf("claude-code-skill.jsonl")).toEqual({
		items: [
			{ kind: "session-start", model: "claude-haiku-4-5-20251001" },
			{ kind: "tool-calls", verb: "Skill", calls: [{ subject: "say-hi" }] },
			{ kind: "prose", lines: [{ text: "hi there", heading: false }] },
			{
				kind: "session-end",
				durationMs: 3443,
				turns: 3,
				tokens: 18 + 199 + 8814 + 36582,
				costUsd: 0.0222992,
			},
		],
		working: false,
	});
});

test("each tool call shows by a short verb, with paths relative to the worktree", async () => {
	const { items } = await activityOf("claude-code-tool-calls.jsonl");
	const calls = items.filter((item) => item.kind === "tool-calls");

	expect(calls).toEqual([
		{ kind: "tool-calls", verb: "ToolSearch", calls: [{ subject: "" }] },
		{ kind: "tool-calls", verb: "TaskCreate", calls: [{ subject: "" }] },
		{ kind: "tool-calls", verb: "Find", calls: [{ subject: "*.ts" }] },
		{ kind: "tool-calls", verb: "Search", calls: [{ subject: "greet" }] },
		{
			kind: "tool-calls",
			verb: "Read",
			calls: [{ subject: "greet.ts", size: "3 lines" }],
		},
		{
			kind: "tool-calls",
			verb: "Read",
			calls: [{ subject: "notes.md", size: "3 lines" }],
		},
		{
			kind: "tool-calls",
			verb: "Edit",
			calls: [{ subject: "greet.ts", size: "+1 −1" }],
		},
		{
			kind: "tool-calls",
			verb: "Write",
			calls: [{ subject: "bye.ts", size: "3 lines" }],
		},
		{
			kind: "tool-calls",
			verb: "Execute",
			calls: [{ subject: "List the files" }],
		},
		// A Bash call with no description shows by its command.
		{
			kind: "tool-calls",
			verb: "Execute",
			calls: [{ subject: "cat missing.txt" }],
		},
		{
			kind: "tool-calls",
			verb: "Execute",
			calls: [{ subject: "Show changes" }],
		},
		{ kind: "tool-calls", verb: "ToolSearch", calls: [{ subject: "" }] },
		{
			kind: "tool-calls",
			verb: "Fetch",
			calls: [{ subject: "https://example.com" }],
		},
		// The subagent's own Read is part of this call, not a call of its own.
		{ kind: "tool-calls", verb: "Agent", calls: [{ subject: "Count lines" }] },
	]);
});

test("thinking, hooks, rate limits, task events and user text give nothing", async () => {
	const { items, working } = await activityOf("claude-code-tool-calls.jsonl");

	expect(items.map((item) => item.kind)).toEqual([
		"session-start",
		...Array(10).fill(["prose", "tool-calls"]).flat(),
		"failed-result",
		...Array(4).fill(["prose", "tool-calls"]).flat(),
		"prose",
		"session-end",
	]);
	expect(working).toBe(false);
});

test("a failed result follows its call with its first line, and a successful one shows nothing", async () => {
	const { items } = await activityOf("claude-code-tool-calls.jsonl");
	const failed = items.findIndex((item) => item.kind === "failed-result");

	expect(items[failed - 1]).toEqual({
		kind: "tool-calls",
		verb: "Execute",
		calls: [{ subject: "cat missing.txt" }],
	});
	expect(items.filter((item) => item.kind === "failed-result")).toEqual([
		{ kind: "failed-result", firstLine: "Exit code 1" },
	]);
});

test("prose keeps its line breaks, marks its headings and drops bold and code marks", async () => {
	const { items } = await activityOf("claude-code-tool-calls.jsonl");

	expect(items.at(-2)).toEqual({
		kind: "prose",
		lines: [
			{ text: "Done", heading: true },
			{ text: "", heading: false },
			{
				text: 'All steps completed successfully. The greet.ts file was modified from "hello" to "hi", and a new bye.ts file was created with three lines of code. The Agent confirmed that greet.ts contains 4 total lines, including the empty line at the end.',
				heading: false,
			},
		],
	});
});

test("consecutive calls of one verb fold into one item", async () => {
	expect(await activityOf("claude-code-parallel-calls.jsonl")).toEqual({
		items: [
			{ kind: "session-start", model: "claude-sonnet-5-5" },
			{
				kind: "tool-calls",
				verb: "Read",
				calls: [
					{ subject: "greet.ts", size: "3 lines" },
					{ subject: "notes.md", size: "3 lines" },
					{ subject: "bye.ts", size: "3 lines" },
				],
			},
			{
				kind: "tool-calls",
				verb: "Execute",
				calls: [
					{ subject: "Count greet lines" },
					{ subject: "Count notes lines" },
					{ subject: "Count bye lines" },
					{ subject: "Force-push main" },
				],
			},
			{ kind: "failed-result", firstLine: "Exit code 128" },
			{
				kind: "prose",
				lines: [
					{
						text: "Read and line counts all succeeded (3 lines each for greet.ts, notes.md and bye.ts), but the force-push failed because the repo has no origin remote, so I didn't retry.",
						heading: false,
					},
				],
			},
			{
				kind: "session-end",
				durationMs: 14062,
				turns: 8,
				tokens: 8 + 567 + 15631 + 88041,
				costUsd: 0.0858182,
			},
		],
		working: false,
	});
});

test("a refused call shows the tool and the reason, and not its result", async () => {
	const { items } = await activityOf("claude-code-safety-check.jsonl");

	expect(items.slice(1, -1)).toEqual([
		{
			kind: "tool-calls",
			verb: "Execute",
			calls: [
				{ subject: "Retry skip-worktree experiment under bash in temp dir" },
			],
		},
		{
			kind: "denied",
			tool: "Bash",
			reason: "This shell -c script runs rm and could not be checked",
		},
	]);
});

test("a refusal with no reason shows Claude Code's message", async () => {
	const { items } = await activityOf("claude-code-permission-denied.jsonl");

	expect(items).toContainEqual({
		kind: "denied",
		tool: "Bash",
		reason:
			"Permission to use Bash with command git push origin main has been denied.",
	});
	expect(items.some((item) => item.kind === "failed-result")).toBe(false);
});

test("a session that ended in an error says how", async () => {
	const { items } = await activityOf("claude-code-max-turns.jsonl");

	expect(items.at(-1)).toEqual({
		kind: "session-end",
		failure: "error_max_turns",
		durationMs: 3226,
		turns: 2,
		tokens: 9 + 192 + 4665 + 18007,
		costUsd: 0.0120997,
	});
});

test("a stream with no end yet is the activity of an open Run", async () => {
	const lines = await fixtureLines("claude-code-parallel-calls.jsonl");
	const harness = findHarness("claude-code");

	// Cut after the three Bash calls, before their results: a tool runs.
	const running = harness.runActivity(lines.slice(0, 17));
	expect(running.items.at(-1)).toEqual({
		kind: "tool-calls",
		verb: "Execute",
		calls: [
			{ subject: "Count greet lines" },
			{ subject: "Count notes lines" },
			{ subject: "Count bye lines" },
		],
	});
	expect(running.working).toBe(false);

	// Cut after their results, half way through the next line: the agent's turn.
	const thinking = harness.runActivity([
		...lines.slice(0, 20),
		(lines[20] ?? "").slice(0, 40),
	]);
	expect(thinking.items.some((item) => item.kind === "session-end")).toBe(
		false,
	);
	expect(thinking.working).toBe(true);
});
