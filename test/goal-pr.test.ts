import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeGh, makeFakeGh } from "./fake-gh.ts";
import { makeProject, runVago, vagoOnPath } from "./project.ts";

// The starter's own branch and merge scripts around a shell Step that does a
// Ticket's work, failing for the Ticket named in $FAIL_TICKET. Each Ticket
// writes the files it was built on to $VAGO_TICKET.txt.
const workflow = `
[[steps]]
id   = "branch"
type = "shell"
run  = "sh .vago/scripts/branch.sh"

[[steps]]
id   = "work"
type = "shell"
run  = 'test "$VAGO_TICKET" != "$FAIL_TICKET" && ls > "$VAGO_TICKET.txt" && git add . && git commit -qm "$VAGO_TICKET"'

[[steps]]
id   = "merge"
type = "shell"
run  = "sh .vago/scripts/merge.sh"
`;

const ping = "@octo-human";

const git = (cwd: string, ...args: string[]) =>
	Bun.spawnSync(["git", ...args], { cwd }).stdout.toString();

type GoalRepo = {
	root: string;
	/** The bare origin's path. */
	origin: string;
	gh: FakeGh;
	/** Runs `vago <args>` with the fake `gh` and this checkout's `vago` on `PATH`. */
	vago(args: string[], failTicket?: string): ReturnType<typeof runVago>;
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
	const vago = (args: string[], failTicket = "") =>
		runVago(root, args, {
			PATH: `${bin}:${gh.env.PATH}`,
			FAIL_TICKET: failTicket,
		});

	await vago(["goal", "new", "ship", "--workflow", "ship"]);
	await vago(["ticket", "add", "ship", "one"]);
	await vago(["ticket", "add", "ship", "two"]);
	return { root, origin, gh, vago };
}

test("the Goal's PR mentions the human and is labelled ready-for-review once its last Ticket is done", async () => {
	const { gh, vago } = await makeGoalRepo();

	const stuck = await vago(["run", "ship"], "02-two");

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
