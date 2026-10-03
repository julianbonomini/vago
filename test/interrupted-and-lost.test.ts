import { expect, test } from "bun:test";
import { join } from "node:path";
import { makeFakeClaude } from "./fake-claude.ts";
import {
	goalText,
	goalWorktree,
	makeProject,
	readTicketFile,
	runVago,
	startVago,
} from "./project.ts";

const goalDir = ".vago-goals/hello";

function ticket(header: string, title: string): string {
	return `+++\n${header}\n+++\n\n# ${title}\n`;
}

async function headerOf(
	root: string,
	name: string,
): Promise<Record<string, unknown>> {
	return (await readTicketFile(root, `${goalDir}/tickets/${name}.md`)).header;
}

function runsOf(header: Record<string, unknown>): Record<string, unknown>[] {
	return (header.runs ?? []) as Record<string, unknown>[];
}

const agentWorkflow = `
harness = "claude-code"
model   = "opus"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`;

test("a Ticket left running goes stuck with outcome lost, and nothing runs", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": agentWorkflow,
		".vago/prompts/implement.md": "Implement it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		// What a `vago run` killed mid-Step leaves: the Run's entry opened
		// and never closed.
		[`${goalDir}/tickets/01-greet.md`]: ticket(
			`status = "running"

[[runs]]
step = "implement"
harness = "claude-code"
model = "opus"
started = 2026-10-01T09:12:03Z
log = "logs/01-implement-1.jsonl"`,
			"Greet",
		),
		// Not blocked by the lost Ticket, so only the stop keeps it unrun.
		[`${goalDir}/tickets/02-wave.md`]: ticket(`status = "ready"`, "Wave"),
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	const greet = await headerOf(root, "01-greet");
	expect(greet.status).toBe("stuck");
	const [lost] = runsOf(greet);
	expect(lost?.outcome).toBe("lost");
	expect(lost?.ended).toBeInstanceOf(Date);
	expect(result.stdout).toContain("01-greet: vago ticket reset hello 01");
	expect(await claude.calls()).toEqual([]);
	expect(runsOf(await headerOf(root, "02-wave"))).toEqual([]);
});

// Two Tickets, the second not blocked by the first, so only the interrupt
// keeps the second one unrun.
function twoTickets(workflow: string): Promise<string> {
	return makeProject({
		".vago/workflows/test.toml": workflow,
		".vago/prompts/implement.md": "Implement it.\n",
		".vago/prompts/review.md": "Review it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: ticket(`status = "ready"`, "Greet"),
		[`${goalDir}/tickets/02-wave.md`]: ticket(`status = "ready"`, "Wave"),
	});
}

// The Step under test writes `echo $$` to `file` in the Goal's worktree once
// it runs. A Step leads its own process group, so its pid is the group's id.
async function waitForProcessGroup(
	root: string,
	file: string,
): Promise<number> {
	const worktree = await goalWorktree(root, "hello");
	for (;;) {
		const pidFile = Bun.file(join(worktree, file));
		const text = (await pidFile.exists()) ? await pidFile.text() : "";
		if (/^\d+\n$/.test(text)) return Number(text);
		await Bun.sleep(20);
	}
}

function processGroupAlive(group: number): boolean {
	try {
		process.kill(-group, 0);
		return true;
	} catch {
		return false;
	}
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	test(`${signal} during an agent Step kills its process group and leaves the Ticket stuck`, async () => {
		const root = await twoTickets(agentWorkflow);
		// `sleep` is a child of the fake, so only a kill of the whole process
		// group ends it before the test's own timeout.
		const claude = await makeFakeClaude("echo $$ > claude.pid; sleep 60");

		const vago = startVago(root, ["run", "hello"], claude.env);
		const group = await waitForProcessGroup(root, "claude.pid");
		vago.kill(signal);
		const result = await vago.exited;

		expect(processGroupAlive(group)).toBe(false);
		expect(result.exitCode).not.toBe(0);
		const greet = await headerOf(root, "01-greet");
		expect(greet.status).toBe("stuck");
		const [interrupted] = runsOf(greet);
		expect(interrupted?.outcome).toBe("interrupted");
		expect(interrupted?.ended).toBeInstanceOf(Date);
		expect(result.stdout).toContain(
			"01-greet is stuck after implement: interrupted",
		);
		expect(runsOf(await headerOf(root, "02-wave"))).toEqual([]);
	});
}

test("SIGINT during a shell Step with on_fail = continue stops the Ticket", async () => {
	const root = await twoTickets(`
harness = "claude-code"
model   = "opus"

[[steps]]
id      = "check"
type    = "shell"
run     = "echo $$ > check.pid; sleep 60"
on_fail = "continue"

[[steps]]
id     = "review"
type   = "agent"
prompt = "prompts/review.md"
`);
	const claude = await makeFakeClaude();

	const vago = startVago(root, ["run", "hello"], claude.env);
	const group = await waitForProcessGroup(root, "check.pid");
	vago.kill("SIGINT");
	const result = await vago.exited;

	expect(processGroupAlive(group)).toBe(false);
	expect(result.exitCode).not.toBe(0);
	const greet = await headerOf(root, "01-greet");
	expect(greet.status).toBe("stuck");
	expect(runsOf(greet).map((run) => [run.step, run.outcome])).toEqual([
		["check", "interrupted"],
	]);
	expect(await claude.calls()).toEqual([]);
});
