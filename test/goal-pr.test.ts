import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeGh, makeFakeGh } from "./fake-gh.ts";
import { makeProject, runVago, vagoOnPath } from "./project.ts";

// The starter's own branch and merge scripts around a shell Step that does a
// Ticket's work, failing for the Ticket named in $FAIL_TICKET.
const workflow = `
[[steps]]
id   = "branch"
type = "shell"
run  = "sh .vago/scripts/branch.sh"

[[steps]]
id   = "work"
type = "shell"
run  = 'test "$VAGO_TICKET" != "$FAIL_TICKET" && echo done > "$VAGO_TICKET.txt" && git add . && git commit -qm "$VAGO_TICKET"'

[[steps]]
id   = "merge"
type = "shell"
run  = "sh .vago/scripts/merge.sh"
`;

const ping = "@octo-human";

type GoalRepo = {
	root: string;
	gh: FakeGh;
	/** Runs `vago <args>` with the fake `gh` and this checkout's `vago` on `PATH`. */
	vago(args: string[], failTicket?: string): ReturnType<typeof runVago>;
};

// A Project initialised from the starter, with a main branch pushed to a
// local origin, Goal `ship` on the Workflow above and Tickets `01-one` and
// `02-two`.
async function makeGoalRepo(): Promise<GoalRepo> {
	const root = await makeProject({});
	const origin = await mkdtemp(join(tmpdir(), "vago-origin-"));
	const git = (cwd: string, ...args: string[]) =>
		Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore" });
	git(origin, "init", "--quiet", "--bare");
	git(root, "symbolic-ref", "HEAD", "refs/heads/main");
	git(root, "config", "user.name", "Test");
	git(root, "config", "user.email", "test@example.com");
	git(root, "remote", "add", "origin", origin);
	git(root, "commit", "--quiet", "--allow-empty", "-m", "start");
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
	return { root, gh, vago };
}

test("the Goal's PR mentions the human and is labelled ready-for-review once its last Ticket is done", async () => {
	const { gh, vago } = await makeGoalRepo();

	const stuck = await vago(["run", "ship"], "02-two");

	expect(stuck.exitCode).not.toBe(0);
	const before = (await gh.state()).pullRequests["goal/ship"];
	expect(before?.body).toContain("01-one");
	expect(before?.comments).toEqual([]);
	expect(before?.labels).toEqual([]);

	await vago(["ticket", "reset", "ship", "2"]);
	const done = await vago(["run", "ship"]);

	expect(done.stderr).toBe("");
	expect(done.exitCode).toBe(0);
	const after = (await gh.state()).pullRequests["goal/ship"];
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
	const pullRequest = (await gh.state()).pullRequests["goal/ship"];
	expect(pullRequest?.body).toContain("03-three");
	expect(pullRequest?.comments).toHaveLength(1);
	expect(pullRequest?.comments[0]).toContain(ping);
	expect(pullRequest?.labels).toEqual(["ready-for-review"]);
});
