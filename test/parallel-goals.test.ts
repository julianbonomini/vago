import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	checkoutSnapshot,
	gitIdentity,
	goalText,
	goalWorktree,
	makeProject,
	oneStep,
	readTicketFile,
	runsOf,
	runVago,
	startVago,
} from "./project.ts";

const ticket = `+++\nstatus = "ready"\n+++\n# Work\n`;

test("two Goals run at once, each in its own worktree, and each finishes on its own branch", async () => {
	const sync = await mkdtemp(join(tmpdir(), "vago-sync-"));
	// Each Goal's Step waits for the other's to start, so the test fails,
	// rather than hangs, if the Goals run one after the other.
	const step = `
touch "${sync}/$VAGO_GOAL.started"
{ pwd -P; git branch --show-current; } > "${sync}/$VAGO_GOAL.where"
echo "$VAGO_GOAL"
tries=0
until [ -e "${sync}/north.started" ] && [ -e "${sync}/south.started" ]; do
	tries=$((tries + 1))
	[ "$tries" -gt 150 ] && exit 1
	sleep 0.02
done
echo "$VAGO_GOAL" > "$VAGO_GOAL.txt"
git add "$VAGO_GOAL.txt" && git ${gitIdentity.join(" ")} commit -qm "$VAGO_GOAL"
`;
	const root = await makeProject({
		".vago/workflows/test.toml": oneStep(step),
		".vago-goals/north/goal.md": goalText("test"),
		".vago-goals/north/tickets/01-work.md": ticket,
		".vago-goals/south/goal.md": goalText("test"),
		".vago-goals/south/tickets/01-work.md": ticket,
	});
	const git = (...args: string[]) =>
		Bun.spawnSync(["git", ...args], { cwd: root }).stdout.toString();
	const before = await checkoutSnapshot(root);

	const [north, south] = await Promise.all([
		startVago(root, ["run", "north"]).exited,
		startVago(root, ["run", "south"]).exited,
	]);

	expect(north.exitCode).toBe(0);
	expect(south.exitCode).toBe(0);
	// The worktrees outlive the run: their commits are unpushed, with no
	// remote, so goalWorktree finds them.
	const where = async (goal: string) =>
		(await Bun.file(join(sync, `${goal}.where`)).text()).trim().split("\n");
	const worktreeNorth = await goalWorktree(root, "north");
	const worktreeSouth = await goalWorktree(root, "south");
	expect(await where("north")).toEqual([worktreeNorth, "vago/north"]);
	expect(await where("south")).toEqual([worktreeSouth, "vago/south"]);
	expect(worktreeNorth).not.toBe(worktreeSouth);
	expect(git("log", "--name-only", "vago/north")).toContain("north.txt");
	expect(git("log", "--name-only", "vago/north")).not.toContain("south.txt");
	expect(git("log", "--name-only", "vago/south")).toContain("south.txt");
	expect(git("log", "--name-only", "vago/south")).not.toContain("north.txt");
	for (const [goal, other] of [
		["north", "south"],
		["south", "north"],
	] as const) {
		const { header } = await readTicketFile(
			root,
			`.vago-goals/${goal}/tickets/01-work.md`,
		);
		expect(header.status).toBe("done");
		const runs = runsOf(header);
		expect(runs).toHaveLength(1);
		expect(runs[0]?.step).toBe("work");
		expect(runs[0]?.outcome).toBe("ok");
		const log = Bun.file(join(root, ".vago-goals", goal, String(runs[0]?.log)));
		expect(await log.exists()).toBe(true);
		expect(await log.text()).toContain(goal);
		expect(await log.text()).not.toContain(other);
	}
	expect(await checkoutSnapshot(root)).toEqual(before);
}, 15_000);

// A Project whose Goal `hello` has one Ticket and one shell Step that writes
// `started` to `signals`, then waits for the test to write `go` there.
async function waitingProject(signals: string): Promise<string> {
	return makeProject({
		".vago/workflows/test.toml": oneStep(
			`touch "${signals}/started"; until [ -e "${signals}/go" ]; do sleep 0.02; done`,
		),
		".vago-goals/hello/goal.md": goalText("test"),
		".vago-goals/hello/tickets/01-work.md": ticket,
	});
}

async function waitFor(path: string): Promise<void> {
	while (!(await Bun.file(path).exists())) await Bun.sleep(20);
}

const helloTicket = ".vago-goals/hello/tickets/01-work.md";

test("a second vago run of a running Goal is refused, and the first finishes", async () => {
	const signals = await mkdtemp(join(tmpdir(), "vago-signals-"));
	const root = await waitingProject(signals);
	const first = startVago(root, ["run", "hello"]);
	await waitFor(join(signals, "started"));

	const second = await runVago(root, ["run", "hello"]);

	expect(second.exitCode).not.toBe(0);
	expect(second.stderr).toContain("hello");
	expect(second.stderr).toContain("already being run");
	expect(second.stdout).toBe("");
	const running = (await readTicketFile(root, helloTicket)).header;
	expect(running.status).toBe("running");
	const [open, ...more] = runsOf(running);
	expect(more).toEqual([]);
	expect(open?.ended).toBeUndefined();
	expect(open?.outcome).toBeUndefined();

	await Bun.write(join(signals, "go"), "");
	expect((await first.exited).exitCode).toBe(0);
	const done = (await readTicketFile(root, helloTicket)).header;
	expect(done.status).toBe("done");
	expect(runsOf(done).map((run) => run.outcome)).toEqual(["ok"]);
});

test("a vago run killed with SIGKILL doesn't block the next one", async () => {
	const signals = await mkdtemp(join(tmpdir(), "vago-signals-"));
	const root = await waitingProject(signals);
	const killed = startVago(root, ["run", "hello"]);
	await waitFor(join(signals, "started"));
	killed.kill("SIGKILL");
	await killed.exited;
	// Lets the killed run's Step, which outlived it, end, and the next run's
	// own Run of it go straight through.
	await Bun.write(join(signals, "go"), "");

	const next = await runVago(root, ["run", "hello"]);

	expect(next.stderr).not.toContain("already being run");
	expect(next.exitCode).toBe(0);
	const { header } = await readTicketFile(root, helloTicket);
	expect(header.status).toBe("done");
	const [lost, again] = runsOf(header);
	expect(lost?.outcome).toBe("lost");
	expect(lost?.ended).toBeInstanceOf(Date);
	expect(again?.outcome).toBe("ok");
});

test("after a run ends, the Goal can be run again", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": oneStep("exit 1"),
		".vago-goals/hello/goal.md": goalText("test"),
		".vago-goals/hello/tickets/01-work.md": ticket,
	});
	await runVago(root, ["run", "hello"]);
	expect((await readTicketFile(root, helloTicket)).header.status).toBe("stuck");
	expect(
		(await runVago(root, ["ticket", "reset", "hello", "1"])).exitCode,
	).toBe(0);

	const again = await runVago(root, ["run", "hello"]);

	expect(again.stderr).not.toContain("already being run");
	const { header } = await readTicketFile(root, helloTicket);
	expect(runsOf(header)).toHaveLength(2);
});
