import { expect, test } from "bun:test";
import { join } from "node:path";
import { gitIdentity, makeProject, runVago } from "./project.ts";

// The starter's branch script, run again on a Ticket that already has its
// branch. After the branch Step, Step `seen` writes the worktree's branch, git
// status and latest commit to seen-<ticket>.txt in the main checkout. Step
// `work` commits, leaves wip.txt uncommitted and fails while $FAIL is set.
const workflow = `
[[steps]]
id   = "branch"
type = "shell"
run  = "sh .vago/scripts/branch.sh"

[[steps]]
id   = "seen"
type = "shell"
run  = '{ git branch --show-current; git status --porcelain; git log -1 --format=%s; } > "$VAGO_PROJECT_ROOT/seen-$VAGO_TICKET.txt"'

[[steps]]
id   = "work"
type = "shell"
run  = 'git ${gitIdentity.join(" ")} commit -qm "built $VAGO_TICKET" --allow-empty && echo wip > wip.txt && test -z "$FAIL"'
`;

// A Project initialised from the starter, with Goal `ship` on the Workflow
// above and a Ticket for each of `names`.
async function makeShipProject(names: string[]): Promise<string> {
	const root = await makeProject({});
	await runVago(root, ["init"], {}, "n\n");
	await Bun.write(join(root, ".vago/workflows/ship.toml"), workflow);
	await runVago(root, ["goal", "new", "ship", "--workflow", "ship"]);
	for (const name of names) {
		await runVago(root, ["ticket", "add", "ship", name]);
	}
	return root;
}

const seen = (root: string, ticket: string) =>
	Bun.file(join(root, `seen-${ticket}.txt`)).text();

test("a Ticket's branch Step cuts its branch from the Goal's, then keeps it and its uncommitted work when run again", async () => {
	const root = await makeShipProject(["one"]);

	const stuck = await runVago(root, ["run", "ship"], { FAIL: "1" });

	expect(stuck.exitCode).not.toBe(0);
	expect(await seen(root, "01-one")).toBe("ship/01-one\nstart\n");

	await runVago(root, ["ticket", "reset", "ship", "1"]);
	const again = await runVago(root, ["run", "ship"]);

	expect(again.stderr).toBe("");
	expect(again.exitCode).toBe(0);
	expect(await seen(root, "01-one")).toBe(
		"ship/01-one\n?? wip.txt\nbuilt 01-one\n",
	);
});

test("the branch Step fails, saying why, on changes another Ticket left uncommitted", async () => {
	const root = await makeShipProject(["one", "two"]);

	const run = await runVago(root, ["run", "ship"]);

	expect(run.exitCode).not.toBe(0);
	const log = await Bun.file(
		join(root, ".vago-goals/ship/logs/02-branch-1.log"),
	).text();
	expect(log).toContain("uncommitted changes");
	expect(await Bun.file(join(root, "seen-02-two.txt")).exists()).toBe(false);
});
