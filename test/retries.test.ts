import { expect, test } from "bun:test";
import { makeFakeClaude, onFirstCalls } from "./fake-harness.ts";
import {
	goalText,
	makeProject,
	readTicketFile,
	runsOf,
	runVago,
	startVago,
	ticketText,
} from "./project.ts";

const goalDir = ".vago-goals/hello";

async function headerOf(root: string): Promise<Record<string, unknown>> {
	return (await readTicketFile(root, `${goalDir}/tickets/01-greet.md`)).header;
}

function agentProject(): Promise<string> {
	return makeProject({
		".vago/workflows/test.toml": `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`,
		".vago/prompts/implement.md": "Implement it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: ticketText("ready"),
	});
}

const continueMessage =
	"You were interrupted. Continue the task from where you stopped; check the working tree first.\n";

const sessionId = "f679b9c4-e75a-4f73-affd-0dedfe161e0d";

test("a failed agent Step resumes its session after 1, 1 and 5 minutes, and the Ticket goes on when a retry succeeds", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude(onFirstCalls(3, "exit 1"));

	// A minute of 100ms, so the waits print as 0.1s, 0.1s and 0.5s.
	const result = await runVago(root, ["run", "hello"], {
		...claude.env,
		VAGO_RETRY_MINUTE_MS: "100",
	});

	expect(result.exitCode).toBe(0);
	const retries = [...result.stdout.matchAll(/implement retries in (\S+)/g)];
	expect(retries.map(([, wait]) => wait)).toEqual(["0.1s", "0.1s", "0.5s"]);
	const [first, ...resumes] = await claude.calls();
	expect(first?.stdin).toBe("Implement it.\n");
	expect(resumes.map(({ argv, stdin }) => [argv.slice(0, 3), stdin])).toEqual(
		Array(3).fill([["-p", "--resume", sessionId], continueMessage]),
	);
	const greet = await headerOf(root);
	expect(greet.status).toBe("done");
	expect(runsOf(greet).map((run) => [run.outcome, run.resume])).toEqual([
		["exit 1", undefined],
		["exit 1", "resumed"],
		["exit 1", "resumed"],
		["ok", "resumed"],
	]);
	// Each failed Run says when its retry was due, a wait after it ended, in
	// the test's minutes of 100ms.
	const waitMinutes = runsOf(greet)
		.slice(0, 3)
		.map(({ ended, retry_at }) =>
			retry_at instanceof Date && ended instanceof Date
				? Math.round((retry_at.getTime() - ended.getTime()) / 100)
				: undefined,
		);
	expect(waitMinutes).toEqual([1, 1, 5]);
	expect(runsOf(greet)[3]?.retry_at).toBeUndefined();
});

test("the Ticket goes stuck when the third retry fails too", async () => {
	const root = await agentProject();
	const claude = await makeFakeClaude("exit 1");

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	expect(result.stdout).toContain("01-greet is stuck after implement: exit 1");
	expect(await claude.calls()).toHaveLength(4);
	const greet = await headerOf(root);
	expect(greet.status).toBe("stuck");
	expect(runsOf(greet).map((run) => [run.outcome, run.resume])).toEqual([
		["exit 1", undefined],
		["exit 1", "resumed"],
		["exit 1", "resumed"],
		["exit 1", "resumed"],
	]);
});

test("SIGINT during a retry's wait leaves the Ticket stuck, and the next vago run resumes the failed Step", async () => {
	const root = await agentProject();
	const failing = await makeFakeClaude("exit 1");
	const vago = startVago(root, ["run", "hello"], {
		...failing.env,
		VAGO_RETRY_MINUTE_MS: "60000",
	});
	// The failed Run's end is written just before the wait starts.
	while (runsOf(await headerOf(root))[0]?.outcome === undefined) {
		await Bun.sleep(20);
	}
	await Bun.sleep(200);
	vago.kill("SIGINT");
	const interrupted = await vago.exited;

	expect(interrupted.exitCode).not.toBe(0);
	expect(interrupted.stdout).toContain(
		"01-greet is stuck after implement: exit 1",
	);
	expect((await headerOf(root)).status).toBe("stuck");
	const claude = await makeFakeClaude();

	const again = await runVago(root, ["run", "hello"], claude.env);

	expect(again.exitCode).toBe(0);
	expect(
		(await claude.calls()).map(({ argv, stdin }) => [argv.slice(0, 3), stdin]),
	).toEqual([[["-p", "--resume", sessionId], continueMessage]]);
	expect(runsOf(await headerOf(root)).map((run) => run.outcome)).toEqual([
		"exit 1",
		"ok",
	]);
});
