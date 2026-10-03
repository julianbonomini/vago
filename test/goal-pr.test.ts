import { expect, test } from "bun:test";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeGh, makeFakeGh } from "./fake-gh.ts";
import { makeProject, runPunt } from "./project.ts";

// The starter's own branch and merge scripts around a shell Step that does a
// Ticket's work, failing for the Ticket named in $FAIL_TICKET.
const workflow = `
[[steps]]
id   = "branch"
type = "shell"
run  = "sh .punt/scripts/branch.sh"

[[steps]]
id   = "work"
type = "shell"
run  = 'test "$PUNT_TICKET" != "$FAIL_TICKET" && echo done > "$PUNT_TICKET.txt" && git add . && git commit -qm "$PUNT_TICKET"'

[[steps]]
id   = "merge"
type = "shell"
run  = "sh .punt/scripts/merge.sh"
`;

const ping = "@octo-human";

type GoalRepo = {
	root: string;
	gh: FakeGh;
	/** Runs `punt <args>` with the fake `gh` and this checkout's `punt` on `PATH`. */
	punt(args: string[], failTicket?: string): ReturnType<typeof runPunt>;
};

// A Project initialised from the starter, with a main branch pushed to a
// local origin, Goal `ship` on the Workflow above and Tickets `01-one` and
// `02-two`.
async function makeGoalRepo(): Promise<GoalRepo> {
	const root = await makeProject({});
	const origin = await mkdtemp(join(tmpdir(), "punt-origin-"));
	const git = (cwd: string, ...args: string[]) =>
		Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore" });
	git(origin, "init", "--quiet", "--bare");
	git(root, "symbolic-ref", "HEAD", "refs/heads/main");
	git(root, "config", "user.name", "Test");
	git(root, "config", "user.email", "test@example.com");
	git(root, "remote", "add", "origin", origin);
	git(root, "commit", "--quiet", "--allow-empty", "-m", "start");
	await runPunt(root, ["init"], {}, "n\n");
	await Bun.write(join(root, ".punt/workflows/ship.toml"), workflow);

	// merge.sh calls `punt goal report`, so `punt` is this checkout's CLI.
	const bin = await mkdtemp(join(tmpdir(), "punt-bin-"));
	const cli = join(import.meta.dir, "..", "src", "cli.ts");
	await Bun.write(
		join(bin, "punt"),
		`#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`,
	);
	await chmod(join(bin, "punt"), 0o755);
	const gh = await makeFakeGh("octo-human");
	const punt = (args: string[], failTicket = "") =>
		runPunt(root, args, {
			PATH: `${bin}:${gh.env.PATH}`,
			FAIL_TICKET: failTicket,
		});

	await punt(["goal", "new", "ship", "--workflow", "ship"]);
	await punt(["ticket", "add", "ship", "one"]);
	await punt(["ticket", "add", "ship", "two"]);
	return { root, gh, punt };
}

test("the Goal's PR mentions the human and is labelled ready-for-review once its last Ticket is done", async () => {
	const { gh, punt } = await makeGoalRepo();

	const stuck = await punt(["run", "ship"], "02-two");

	expect(stuck.exitCode).not.toBe(0);
	const before = (await gh.state()).pullRequests["goal/ship"];
	expect(before?.body).toContain("01-one");
	expect(before?.comments).toEqual([]);
	expect(before?.labels).toEqual([]);

	await punt(["ticket", "reset", "ship", "2"]);
	const done = await punt(["run", "ship"]);

	expect(done.stderr).toBe("");
	expect(done.exitCode).toBe(0);
	const after = (await gh.state()).pullRequests["goal/ship"];
	expect(after?.comments).toHaveLength(1);
	expect(after?.comments[0]).toContain(ping);
	expect(after?.body).not.toContain(ping);
	expect(after?.labels).toEqual(["ready-for-review"]);
});

test("a later last merge rewrites the PR body but keeps the one mention and label", async () => {
	const { gh, punt } = await makeGoalRepo();
	await punt(["run", "ship"]);

	await punt(["ticket", "add", "ship", "three"]);
	const again = await punt(["run", "ship"]);

	expect(again.exitCode).toBe(0);
	const pullRequest = (await gh.state()).pullRequests["goal/ship"];
	expect(pullRequest?.body).toContain("03-three");
	expect(pullRequest?.comments).toHaveLength(1);
	expect(pullRequest?.comments[0]).toContain(ping);
	expect(pullRequest?.labels).toEqual(["ready-for-review"]);
});
