import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	codexFixtureAnswering,
	type FakeHarness,
	makeFakeClaude,
	makeFakeCodex,
	planningFixture,
} from "./fake-harness.ts";
import {
	gitIdentity,
	makeProject,
	readTicketFile,
	runVago,
	type VagoExit,
} from "./project.ts";

// Each test runs several vago processes.
setDefaultTimeout(20_000);

const planningPrompt = "You help plan a Goal.\n";

// The thread id `codexFixtureAnswering`'s fixtures report.
const codexThreadId = "01a10e32-3816-7022-9ae8-c718d8802ffe";

// A Project with a planning prompt and Workflow `small`, whose one agent
// Step runs on Claude Code.
function planningProject(files: Record<string, string> = {}): Promise<string> {
	return makeProject({
		".vago/prompts/planning.md": planningPrompt,
		".vago/workflows/small.toml": `
harness = "claude-code"
model   = "claude-opus-5-5"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`,
		".vago/prompts/implement.md": "Build it.\n",
		...files,
	});
}

function say(
	root: string,
	message: string,
	env: Record<string, string>,
): Promise<VagoExit> {
	return runVago(
		root,
		["plan", "say", "search", "--body-file", "-"],
		env,
		message,
	);
}

function chatToml(root: string): Promise<string> {
	return Bun.file(join(root, ".vago-goals/search/planning/chat.toml")).text();
}

// Both fakes on PATH, so a test sees which one a planning item runs.
async function bothFakes(codexAnswer = "Rank by relevance."): Promise<{
	claude: FakeHarness;
	codex: FakeHarness;
	env: Record<string, string>;
}> {
	const claude = await makeFakeClaude("exit 0", planningFixture);
	const codex = await makeFakeCodex(
		"exit 0",
		await codexFixtureAnswering(codexAnswer),
	);
	return {
		claude,
		codex,
		env: { PATH: `${codex.folder}:${claude.env.PATH}` },
	};
}

test("a Codex planning item plans on Codex, read-only, and saves its session", async () => {
	const root = await planningProject();
	const { claude, codex, env } = await bothFakes();
	await runVago(root, ["plan", "new", "search", "--harness", "codex"]);

	const first = await say(root, "What should search rank by?", env);
	const second = await say(root, "And ties?", env);

	expect(first.stderr).toBe("");
	expect(first.exitCode).toBe(0);
	expect(first.stdout).toBe("Rank by relevance.\n");
	expect(second.exitCode).toBe(0);
	expect(await claude.calls()).toEqual([]);
	const calls = await codex.calls();
	expect(calls).toHaveLength(2);
	expect(calls[0]?.argv.join(" ")).toContain("--sandbox read-only");
	expect(calls[0]?.stdin).toBe(
		`${planningPrompt}\nWhat should search rank by?`,
	);
	expect(calls[1]?.argv.join(" ")).toContain(`resume ${codexThreadId} -`);
	expect(calls[1]?.stdin).toBe("And ties?");
	const chat = await chatToml(root);
	expect(chat).toContain('harness = "codex"');
	expect(chat).toContain(`session_id = "${codexThreadId}"`);
	expect(chat).toContain('outcome = "ok"');
});

test("plan new plans on Claude Code when the human doesn't choose", async () => {
	const root = await planningProject();
	const { claude, codex, env } = await bothFakes();
	await runVago(root, ["plan", "new", "search"]);

	const said = await say(root, "Hi", env);

	expect(said.exitCode).toBe(0);
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

test("a Codex agent can't change a tracked or untracked file, or add one", async () => {
	const root = await planningProject({ "notes.txt": "untracked notes\n" });
	await Bun.write(join(root, "tracked.txt"), "tracked text\n");
	git(root, "add", "tracked.txt");
	git(root, ...gitIdentity, "commit", "--quiet", "-m", "tracked");
	const codex = await makeFakeCodex(
		"cat notes.txt >&2; printf x > tracked.txt; printf x > notes.txt; printf x > new.txt; exit 0",
		await codexFixtureAnswering("Done."),
	);
	await runVago(root, ["plan", "new", "search", "--harness", "codex"]);
	const status = git(root, "status", "--porcelain");

	await say(root, "Write something", codex.env);

	expect(await Bun.file(join(root, "tracked.txt")).text()).toBe(
		"tracked text\n",
	);
	expect(await Bun.file(join(root, "notes.txt")).text()).toBe(
		"untracked notes\n",
	);
	expect(existsSync(join(root, "new.txt"))).toBe(false);
	expect(git(root, "status", "--porcelain")).toBe(status);
	const log = await Bun.file(
		join(root, ".vago-goals/search/planning/logs/turn-01.jsonl"),
	).text();
	expect(log).toContain("untracked notes");
});

// What `git <args>` printed in the repo at `root`.
function git(root: string, ...args: string[]): string {
	return Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString();
}

test("a missing Harness fails the turn with what to install, and the item stays", async () => {
	const root = await planningProject();
	await runVago(root, ["plan", "new", "search", "--harness", "codex"]);

	// No `codex` on this PATH; git and the sandbox are in these folders.
	const said = await say(root, "Hi", { PATH: "/usr/bin:/bin" });

	expect(said.exitCode).toBe(1);
	expect(said.stderr).toContain("codex isn't on PATH");
	const chat = await chatToml(root);
	expect(chat).toContain('message = "Hi"');
	expect(chat).toContain('outcome = "error"');
	expect(chat).toContain("codex isn't on PATH");
	const renamed = await runVago(root, ["plan", "rename", "search", "ranked"]);
	expect(renamed.exitCode).toBe(0);
});

test("a Goal planned on Codex runs its Workflow's Harness", async () => {
	const root = await planningProject();
	const { codex, env } = await bothFakes(`Here is the plan.

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
</vago-plan>`);
	await runVago(root, ["plan", "new", "search", "--harness", "codex"]);
	await say(root, "Plan search", env);

	// A Step's session runs in `auto` mode, which the planning fixture's
	// doesn't report.
	const claude = await makeFakeClaude();
	const accepted = await runVago(root, ["plan", "accept", "search"]);
	const run = await runVago(root, ["run", "search"], {
		PATH: `${codex.folder}:${claude.env.PATH}`,
	});

	expect(accepted.exitCode).toBe(0);
	const goal = await readTicketFile(root, ".vago-goals/search/goal.md");
	expect(goal.header.workflow).toBe("small");
	expect(run.exitCode).toBe(0);
	expect(await codex.calls()).toHaveLength(1);
	const [step] = await claude.calls();
	expect(step?.argv).toContain("claude-opus-5-5");
	expect(step?.stdin).toContain("Build it.");
});
