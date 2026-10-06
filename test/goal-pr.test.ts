import { expect, setDefaultTimeout, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeGh, makeFakeGh } from "./fake-gh.ts";
import { makeProject, runVago, vagoOnPath } from "./project.ts";

// The starter's own branch and merge scripts around shell Steps that do a
// Ticket's work. Each Ticket writes the files it was built on to
// $VAGO_TICKET.txt and commits, an empty commit when run again on work
// already merged, as an agent finding its work done would. The Ticket named
// in $FAIL_TICKET fails; the one in $CLASH_TICKET writes clash.txt, which
// vago/<goal> gets too after the Ticket's branch was cut; the one in
// $LEFTOVER_TICKET leaves left.txt uncommitted. The one in $PICKED_UP skips
// straight to the merge, as a Ticket picked up at its merge Step does.
const workflow = `
[[steps]]
id   = "branch"
type = "shell"
run  = 'test "$VAGO_TICKET" = "$PICKED_UP" || sh .vago/scripts/branch.sh'

[[steps]]
id   = "clash"
type = "shell"
run  = 'test "$VAGO_TICKET" != "$CLASH_TICKET" || { git switch -q "vago/$VAGO_GOAL" && echo goal > clash.txt && git add . && git commit -qm clash && git switch -q - && echo ticket > clash.txt; }'

[[steps]]
id   = "work"
type = "shell"
run  = 'test "$VAGO_TICKET" = "$PICKED_UP" || { test "$VAGO_TICKET" != "$FAIL_TICKET" && ls > "$VAGO_TICKET.txt" && git add . && git commit -qm "$VAGO_TICKET" --allow-empty && { test "$VAGO_TICKET" != "$LEFTOVER_TICKET" || echo left > left.txt; }; }'

[[steps]]
id   = "merge"
type = "shell"
run  = "sh .vago/scripts/merge.sh"
`;

// Each test runs whole Goals, each Step a child process, past bun's 5s.
setDefaultTimeout(20_000);

const ping = "@octo-human";

const git = (cwd: string, ...args: string[]) =>
	Bun.spawnSync(["git", ...args], { cwd }).stdout.toString();

type GoalRepo = {
	root: string;
	/** The bare origin's path. */
	origin: string;
	gh: FakeGh;
	/**
	 * Runs `vago <args>` with the fake `gh` and this checkout's `vago` on
	 * `PATH`, and `env`, which names the Tickets the Workflow treats apart.
	 */
	vago(
		args: string[],
		env?: Record<string, string>,
	): ReturnType<typeof runVago>;
	/** The last line the latest Run of Step `merge` wrote to its log. */
	lastMergeLine(): Promise<string>;
};

// A Project initialised from the starter, with its default branch, `main`
// unless named, pushed to a local origin whose HEAD points to it, Goal `ship`
// on the Workflow above and Tickets `01-one` and `02-two`.
async function makeGoalRepo(defaultBranch = "main"): Promise<GoalRepo> {
	const root = await makeProject({});
	const origin = await mkdtemp(join(tmpdir(), "vago-origin-"));
	git(origin, "init", "--quiet", "--bare");
	git(root, "symbolic-ref", "HEAD", "refs/heads/main");
	git(root, "config", "user.name", "Test");
	git(root, "config", "user.email", "test@example.com");
	git(root, "remote", "add", "origin", origin);
	git(root, "commit", "--quiet", "--allow-empty", "-m", "start");
	if (defaultBranch !== "main")
		git(root, "branch", "-m", "main", defaultBranch);
	git(root, "push", "--quiet", "origin", defaultBranch);
	git(origin, "symbolic-ref", "HEAD", `refs/heads/${defaultBranch}`);
	git(root, "remote", "set-head", "origin", defaultBranch);
	await runVago(root, ["init"], {}, "n\n");
	await Bun.write(join(root, ".vago/workflows/ship.toml"), workflow);

	// merge.sh calls `vago goal report`, so `vago` is this checkout's CLI.
	const bin = await vagoOnPath();
	const gh = await makeFakeGh("octo-human");
	const vago = (args: string[], env: Record<string, string> = {}) =>
		runVago(root, args, { PATH: `${bin}:${gh.env.PATH}`, ...env });
	const logs = join(root, ".vago-goals/ship/logs");
	const lastMergeLine = async () => {
		const runNumber = (log: string) => Number(log.match(/(\d+)\.log$/)?.[1]);
		const [latest = ""] = [
			...new Bun.Glob("*-merge-*.log").scanSync(logs),
		].sort((a, b) => runNumber(b) - runNumber(a));
		const text = await Bun.file(join(logs, latest)).text();
		return text.trimEnd().split("\n").at(-1) ?? "";
	};

	await vago(["goal", "new", "ship", "--workflow", "ship"]);
	await vago(["ticket", "add", "ship", "one"]);
	await vago(["ticket", "add", "ship", "two"]);
	return { root, origin, gh, vago, lastMergeLine };
}

test("the Goal's PR mentions the human and is labelled ready-for-review once its last Ticket is done", async () => {
	const { gh, vago } = await makeGoalRepo();

	const stuck = await vago(["run", "ship"], { FAIL_TICKET: "02-two" });

	expect(stuck.exitCode).not.toBe(0);
	const before = (await gh.state()).pullRequests["vago/ship"];
	expect(before?.body).toContain("01-one");
	expect(before?.comments).toEqual([]);
	expect(before?.labels).toEqual([]);

	await vago(["ticket", "reset", "ship", "2"]);
	const done = await vago(["run", "ship"]);

	expect(done.stderr).toBe("");
	expect(done.exitCode).toBe(0);
	const after = (await gh.state()).pullRequests["vago/ship"];
	expect(after?.comments).toHaveLength(1);
	expect(after?.comments[0]).toContain(ping);
	expect(after?.body).not.toContain(ping);
	expect(after?.labels).toEqual(["ready-for-review"]);
});

test("a later last merge rewrites the PR body but keeps the one mention and label", async () => {
	const { gh, vago } = await makeGoalRepo();
	await vago(["run", "ship"]);

	await vago(["ticket", "add", "ship", "three"]);
	const again = await vago(["run", "ship"]);

	expect(again.exitCode).toBe(0);
	const pullRequest = (await gh.state()).pullRequests["vago/ship"];
	expect(pullRequest?.body).toContain("03-three");
	expect(pullRequest?.comments).toHaveLength(1);
	expect(pullRequest?.comments[0]).toContain(ping);
	expect(pullRequest?.labels).toEqual(["ready-for-review"]);
});

test("the Goal's PR is opened from vago/<goal> against the repo's default branch, even when that isn't main", async () => {
	const { root, gh, vago } = await makeGoalRepo("trunk");

	const run = await vago(["run", "ship"]);

	expect(run.exitCode).toBe(0);
	const { pullRequests } = await gh.state();
	expect(pullRequests["vago/ship"]?.base).toBe("trunk");
	expect(pullRequests["goal/ship"]).toBeUndefined();
	expect(git(root, "branch", "--list", "goal/*")).toBe("");
});

test("each Ticket is built on vago/<goal> and lands there on origin as one commit", async () => {
	const { origin, vago } = await makeGoalRepo();

	const run = await vago(["run", "ship"]);

	expect(run.exitCode).toBe(0);
	expect(git(origin, "log", "--format=%s", "main..vago/ship")).toBe(
		"02 two\n01 one\n",
	);
	expect(git(origin, "show", "vago/ship:02-two.txt")).toContain("01-one.txt");
});

test("a gh call GitHub answers with a 503 is tried again and the merge goes through", async () => {
	const { gh, vago } = await makeGoalRepo();
	await gh.failNext(
		"pr create",
		"HTTP 503: Service Unavailable (https://api.github.com/graphql)",
	);

	const run = await vago(["run", "ship"]);

	expect(run.exitCode).toBe(0);
	expect((await gh.state()).pullRequests["vago/ship"]?.body).toContain(
		"02-two",
	);
});

test("a merge picked up after its push failed pushes the one squashed commit and finishes", async () => {
	const { origin, gh, vago, lastMergeLine } = await makeGoalRepo();
	const hook = join(origin, "hooks/pre-receive");
	await Bun.write(hook, "#!/bin/sh\necho no pushes today >&2\nexit 1\n");
	await chmod(hook, 0o755);

	const stuck = await vago(["run", "ship"]);

	expect(stuck.exitCode).not.toBe(0);
	expect(await lastMergeLine()).toBe(
		"The merge failed pushing vago/ship to origin.",
	);

	await rm(hook);
	await vago(["ticket", "reset", "ship", "1"]);
	const done = await vago(["run", "ship"], { PICKED_UP: "01-one" });

	expect(done.stderr).toBe("");
	expect(done.exitCode).toBe(0);
	expect(git(origin, "log", "--format=%s", "main..vago/ship")).toBe(
		"02 two\n01 one\n",
	);
	expect((await gh.state()).pullRequests["vago/ship"]?.body).toContain(
		"02-two",
	);
});

test("a merge picked up after gh failed past the push opens the Goal's one PR", async () => {
	const { origin, gh, vago, lastMergeLine } = await makeGoalRepo();
	await gh.failNext(
		"pr view",
		"HTTP 401: Bad credentials (https://api.github.com/graphql)",
	);

	const stuck = await vago(["run", "ship"]);

	expect(stuck.exitCode).not.toBe(0);
	expect(git(origin, "log", "--format=%s", "main..vago/ship")).toBe("01 one\n");
	expect(await lastMergeLine()).toBe(
		"The merge failed looking up the PR of vago/ship.",
	);
	expect((await gh.state()).pullRequests).toEqual({});

	await vago(["ticket", "reset", "ship", "1"]);
	const done = await vago(["run", "ship"], { PICKED_UP: "01-one" });

	expect(done.exitCode).toBe(0);
	expect(git(origin, "log", "--format=%s", "main..vago/ship")).toBe(
		"02 two\n01 one\n",
	);
	expect(Object.keys((await gh.state()).pullRequests)).toEqual(["vago/ship"]);
});

test("a merge picked up after it already finished succeeds and adds no commit, PR or comment", async () => {
	const { root, origin, gh, vago } = await makeGoalRepo();
	await vago(["run", "ship"]);
	const before = await gh.state();

	// Stuck as if the merge had failed at its very end, so it can be reset.
	const two = Bun.file(join(root, ".vago-goals/ship/tickets/02-two.md"));
	await Bun.write(
		two,
		(await two.text()).replace('status = "done"', 'status = "stuck"'),
	);
	await vago(["ticket", "reset", "ship", "2"]);
	const again = await vago(["run", "ship"], { PICKED_UP: "02-two" });

	expect(again.stderr).toBe("");
	expect(again.exitCode).toBe(0);
	expect(git(origin, "log", "--format=%s", "main..vago/ship")).toBe(
		"02 two\n01 one\n",
	);
	const after = await gh.state();
	expect(Object.keys(after.pullRequests)).toEqual(["vago/ship"]);
	expect(before.pullRequests["vago/ship"]?.comments).toHaveLength(1);
	expect(after.pullRequests["vago/ship"]?.comments).toEqual(
		before.pullRequests["vago/ship"]?.comments,
	);
	expect(after.pullRequests["vago/ship"]?.labels).toEqual(["ready-for-review"]);
});

test("changes a Step left uncommitted land with the Ticket's work", async () => {
	const { origin, vago } = await makeGoalRepo();

	const run = await vago(["run", "ship"], { LEFTOVER_TICKET: "01-one" });

	expect(run.exitCode).toBe(0);
	expect(git(origin, "log", "--format=%s", "main..vago/ship")).toBe(
		"02 two\n01 one\n",
	);
	expect(git(origin, "show", "vago/ship:left.txt")).toBe("left\n");
});

test("a Ticket that conflicts with the Goal's branch goes stuck, its branch kept, and the merge says where", async () => {
	const { root, vago, lastMergeLine } = await makeGoalRepo();

	const run = await vago(["run", "ship"], { CLASH_TICKET: "01-one" });

	expect(run.exitCode).not.toBe(0);
	expect(await lastMergeLine()).toBe(
		"ship/01-one conflicts with vago/ship in clash.txt.",
	);
	expect(git(root, "branch", "--list", "ship/01-one")).toContain("ship/01-one");
});

test("a Goal's branch origin refuses goes stuck, and the merge says so", async () => {
	const { origin, gh, vago, lastMergeLine } = await makeGoalRepo();
	const hook = join(origin, "hooks/pre-receive");
	await Bun.write(hook, "#!/bin/sh\necho no pushes today >&2\nexit 1\n");
	await chmod(hook, 0o755);

	const run = await vago(["run", "ship"]);

	expect(run.exitCode).not.toBe(0);
	expect(await lastMergeLine()).toBe(
		"The merge failed pushing vago/ship to origin.",
	);
	expect((await gh.state()).pullRequests).toEqual({});
});
