import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	answerInSession,
	makeFakeClaude,
	makeFakeInteractiveClaude,
	makeFakeInteractiveCodex,
} from "./fake-harness.ts";
import { makeProject, readTicketFile, runVago } from "./project.ts";

// Each test runs several vago processes.
setDefaultTimeout(20_000);

// A Project with a planning prompt and Workflow `small`, whose one agent
// Step runs on Claude Code.
function planningProject(): Promise<string> {
	return makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago/workflows/small.toml": `
harness = "claude-code"
model   = "claude-opus-5-5"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`,
		".vago/prompts/implement.md": "Build it.\n",
	});
}

test("plan new plans on Claude Code when the human doesn't choose", async () => {
	const root = await planningProject();
	const claude = await makeFakeInteractiveClaude({ answerAtOnce: true });
	const codex = await makeFakeInteractiveCodex({ answerAtOnce: true });
	await runVago(root, ["plan", "new", "search"]);

	const ran = await runVago(root, ["plan", "session", "search"], {
		...claude.env,
		...codex.env,
		PATH: `${codex.folder}:${claude.env.PATH}`,
	});

	expect(ran.exitCode).toBe(0);
	expect(await claude.calls()).toHaveLength(1);
	expect(await codex.calls()).toEqual([]);
});

test("plan new refuses a Harness that can't plan, naming those that can", async () => {
	const root = await planningProject();

	const refused = await runVago(root, [
		"plan",
		"new",
		"search",
		"--harness",
		"aider",
	]);

	expect(refused.exitCode).toBe(1);
	expect(refused.stderr).toContain("aider");
	expect(refused.stderr).toContain("claude-code, codex");
	expect(existsSync(join(root, ".vago-goals/search"))).toBe(false);
});

test("a missing Harness fails the session with what to install, and the item stays", async () => {
	const root = await planningProject();
	await runVago(root, ["plan", "new", "search", "--harness", "codex"]);

	// No `codex` on this PATH; git and the sandbox are in these folders.
	const ran = await runVago(root, ["plan", "session", "search"], {
		PATH: "/usr/bin:/bin",
	});

	expect(ran.exitCode).toBe(1);
	expect(ran.stderr).toContain("codex isn't on PATH");
	const renamed = await runVago(root, ["plan", "rename", "search", "ranked"]);
	expect(renamed.exitCode).toBe(0);
});

test("a Goal planned on Codex runs its Workflow's Harness", async () => {
	const root = await planningProject();
	await runVago(root, ["plan", "new", "search", "--harness", "codex"]);
	const { fake: codex } = await answerInSession(
		root,
		[
			`Here is the plan.

<vago-plan>
workflow = "small"
goal = '''
# Search ranks by relevance
'''

[[tickets]]
slug = "score"
body = '''
# Score each result
'''
</vago-plan>`,
		],
		"codex",
	);

	const claude = await makeFakeClaude();
	const accepted = await runVago(root, ["plan", "accept", "search"]);
	const run = await runVago(root, ["run", "search"], claude.env);

	expect(accepted.exitCode).toBe(0);
	const goal = await readTicketFile(root, ".vago-goals/search/goal.md");
	expect(goal.header.workflow).toBe("small");
	expect(run.exitCode).toBe(0);
	expect(await codex.calls()).toHaveLength(1);
	const [step] = await claude.calls();
	expect(step?.argv).toContain("claude-opus-5-5");
	expect(step?.stdin).toContain("Build it.");
});
