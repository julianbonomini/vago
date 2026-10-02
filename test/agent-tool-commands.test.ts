import { expect, test } from "bun:test";
import { join } from "node:path";
import { makeFakeClaude } from "./fake-claude.ts";
import {
	goalText,
	makeProject,
	readTicketFile,
	runPunt,
	startPunt,
} from "./project.ts";

const goalDir = ".punt-goals/hello";

function project(idleTimeout: string): Promise<string> {
	return makeProject({
		".punt/workflows/test.toml": `idle_timeout = "${idleTimeout}"
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`,
		".punt/prompts/implement.md": "Implement it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: `+++\nstatus = "ready"\n+++\n\n# Greet\n`,
	});
}

async function outcomesOf(root: string): Promise<unknown[]> {
	const { header } = await readTicketFile(
		root,
		`${goalDir}/tickets/01-greet.md`,
	);
	return ((header.runs ?? []) as Record<string, unknown>[]).map(
		(run) => run.outcome,
	);
}

// Claude Code's Bash tool starts each command in a process group of its own,
// out of reach of a signal to `claude`'s group, and stops it when `claude`
// gets SIGTERM. `set -m` gives the fake's background job its own group, and
// the trap waits for it so it's reaped before the fake exits. The trap is set
// before the pid file appears, since the tests signal as soon as it does.
const startsToolCommand = `set -m
sleep 60 > /dev/null 2>&1 &
trap 'kill $!; wait $!; exit 143' TERM
echo $! > tool.pid
wait`;

async function waitForPid(root: string, file: string): Promise<number> {
	for (;;) {
		const pidFile = Bun.file(join(root, file));
		const text = (await pidFile.exists()) ? await pidFile.text() : "";
		if (/^\d+\n$/.test(text)) return Number(text);
		await Bun.sleep(20);
	}
}

// A negative pid asks after a whole process group.
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

test("after an idle timeout, no command the agent started is alive", async () => {
	const root = await project("1s");
	const claude = await makeFakeClaude(startsToolCommand);

	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	expect(alive(await waitForPid(root, "tool.pid"))).toBe(false);
	expect(await outcomesOf(root)).toEqual(["idle-timeout"]);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	test(`after ${signal} to punt run, no command the agent started is alive`, async () => {
		const root = await project("1h");
		const claude = await makeFakeClaude(startsToolCommand);

		const punt = startPunt(root, ["run", "hello"], claude.env);
		const tool = await waitForPid(root, "tool.pid");
		punt.kill(signal);
		const result = await punt.exited;

		expect(result.exitCode).not.toBe(0);
		expect(alive(tool)).toBe(false);
		expect(await outcomesOf(root)).toEqual(["interrupted"]);
	});
}

test("an agent that ignores SIGTERM still ends within the grace period", async () => {
	const root = await project("1s");
	// `sleep` inherits the ignored SIGTERM and holds the stream open, so only
	// SIGKILL ends the Run.
	const claude = await makeFakeClaude(
		"trap '' TERM; echo $$ > claude.pid; sleep 60",
	);

	// The 1s idle timeout, Punt's 5s grace period, and slack for startup.
	const started = Date.now();
	const result = await runPunt(root, ["run", "hello"], claude.env);

	expect(Date.now() - started).toBeLessThan(9_000);
	expect(result.exitCode).not.toBe(0);
	expect(alive(-(await waitForPid(root, "claude.pid")))).toBe(false);
	expect(await outcomesOf(root)).toEqual(["idle-timeout"]);
}, 15_000);
