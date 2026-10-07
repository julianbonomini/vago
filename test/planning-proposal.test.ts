import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { answerInSession } from "./fake-harness.ts";
import { makeProject, runVago } from "./project.ts";

// A Project with a planning prompt, Workflows `small` and `try-hard`, and
// planning item `search`.
function planningProject(): Promise<string> {
	return makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago/workflows/small.toml": "",
		".vago/workflows/try-hard.toml": "",
		".vago-goals/search/planning/.keep": "",
	});
}

// An answer ending in a proposal block whose `tickets` part is `tickets`.
function answerProposing(tickets: string): string {
	return `Here is a first draft.

<vago-plan>
workflow = "small"
workflow_reason = '''One module and its tests.'''
open_decisions = ["Should ties break by name?"]
goal = '''
# Search ranks by relevance

Results come back best first.
'''
${tickets}
</vago-plan>`;
}

const twoTickets = `
[[tickets]]
slug = "score"
body = '''
# Score each result
Give each result a score.
'''

[[tickets]]
slug = "rank-by-score"
blocked_by = [1]
body = '''
# Rank results by score
Sort by the score.
'''`;

// Runs a session of planning item `search` of the Project at `root` in
// which the agent answers `answer`.
async function say(root: string, answer: string): Promise<void> {
	const { exit } = await answerInSession(root, [answer]);
	expect(exit.stderr).toBe("");
	expect(exit.exitCode).toBe(0);
}

// The parsed `planning/<file>` of planning item `search`.
async function planningToml(
	root: string,
	file: string,
): Promise<Record<string, unknown>> {
	return parse(
		await Bun.file(join(root, ".vago-goals/search/planning", file)).text(),
	);
}

test("a first draft is saved as the item's Proposal and no Goal file is written", async () => {
	const root = await planningProject();
	const answer = answerProposing(twoTickets);

	await say(root, answer);

	expect(await planningToml(root, "proposal.toml")).toEqual({
		workflow: "small",
		workflow_reason: "One module and its tests.",
		open_decisions: ["Should ties break by name?"],
		goal: "# Search ranks by relevance\n\nResults come back best first.\n",
		tickets: [
			{
				slug: "score",
				blocked_by: [],
				body: "# Score each result\nGive each result a score.\n",
			},
			{
				slug: "rank-by-score",
				blocked_by: [1],
				body: "# Rank results by score\nSort by the score.\n",
			},
		],
	});
	expect(existsSync(join(root, ".vago-goals/search/goal.md"))).toBe(false);
	expect(existsSync(join(root, ".vago-goals/search/tickets"))).toBe(false);
	expect((await runVago(root, ["run", "search"])).exitCode).toBe(1);
});

test("a revision in a later session replaces the Proposal", async () => {
	const root = await planningProject();
	await say(root, answerProposing(twoTickets));

	await say(
		root,
		answerProposing(`
[[tickets]]
slug = "rank-by-score"
body = '''
# Rank results by score
'''`),
	);

	const proposal = await planningToml(root, "proposal.toml");
	expect(proposal.tickets).toEqual([
		{
			slug: "rank-by-score",
			blocked_by: [],
			body: "# Rank results by score\n",
		},
	]);
	expect(existsSync(join(root, ".vago-goals/search/goal.md"))).toBe(false);
});

test("an answer without a block leaves the Proposal as it was", async () => {
	const root = await planningProject();
	await say(root, answerProposing(twoTickets));
	const before = await planningToml(root, "proposal.toml");

	await say(root, "Which ranking do you prefer?");

	expect(await planningToml(root, "proposal.toml")).toEqual(before);
});

test("plan workflow records the human's choice, which a revision keeps", async () => {
	const root = await planningProject();
	await say(root, answerProposing(twoTickets));

	const chosen = await runVago(root, [
		"plan",
		"workflow",
		"search",
		"try-hard",
	]);
	await say(root, answerProposing(twoTickets));

	expect(chosen.stderr).toBe("");
	expect(chosen.exitCode).toBe(0);
	expect(await planningToml(root, "workflow.toml")).toEqual({
		workflow: "try-hard",
	});
});

test("plan workflow refuses a Workflow the Project doesn't have, naming those it has", async () => {
	const root = await planningProject();

	const refused = await runVago(root, ["plan", "workflow", "search", "nope"]);

	expect(refused.exitCode).toBe(1);
	expect(refused.stderr).toContain("nope");
	expect(refused.stderr).toContain("small, try-hard");
	expect(
		existsSync(join(root, ".vago-goals/search/planning/workflow.toml")),
	).toBe(false);
});
