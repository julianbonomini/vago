import { expect, test } from "bun:test";
import { join } from "node:path";
import { parse } from "smol-toml";
import { makeProject, runPunt } from "./project.ts";

const workflow = `
[[steps]]
id   = "greet"
type = "shell"
run  = "echo hello from greet; echo complaint from greet >&2"

[[steps]]
id   = "check"
type = "shell"
run  = "echo checked"
`;

const ticketBody = `
# Say hello

The body stays exactly as written.
`;

const ticket = `+++
status = "ready"
+++
${ticketBody}`;

const goalDir = ".punt/goals/hello";
const ticketPath = `${goalDir}/tickets/01-say-hello.md`;

async function readTicket(root: string): Promise<{
	header: Record<string, unknown>;
	body: string;
}> {
	const text = await Bun.file(join(root, ticketPath)).text();
	const end = text.indexOf("\n+++\n");
	return {
		header: parse(text.slice("+++\n".length, end + 1)),
		body: text.slice(end + "\n+++\n".length),
	};
}

test("a Ticket goes through every shell Step and ends done", async () => {
	const root = await makeProject({
		".punt/workflow.toml": workflow,
		[`${goalDir}/goal.md`]: "# Hello\n",
		[ticketPath]: ticket,
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	const { header, body } = await readTicket(root);
	expect(header.status).toBe("done");
	expect(body).toBe(ticketBody);
});

test("each Step gets a [[runs]] entry and a log of its stdout and stderr", async () => {
	const root = await makeProject({
		".punt/workflow.toml": workflow,
		[ticketPath]: ticket,
	});

	await runPunt(root, ["run", "hello"]);

	const { header } = await readTicket(root);
	const runs = header.runs as Record<string, unknown>[];
	expect(runs.map((run) => [run.step, run.outcome, run.log])).toEqual([
		["greet", "ok", "logs/01-greet-1.log"],
		["check", "ok", "logs/01-check-2.log"],
	]);
	for (const run of runs) {
		expect(run.started).toBeInstanceOf(Date);
		expect(run.ended).toBeInstanceOf(Date);
		expect(Number(run.ended)).toBeGreaterThanOrEqual(Number(run.started));
	}
	const log = (name: string) =>
		Bun.file(join(root, goalDir, "logs", name)).text();
	expect(await log("01-greet-1.log")).toBe(
		"hello from greet\ncomplaint from greet\n",
	);
	expect(await log("01-check-2.log")).toBe("checked\n");
});

test("stdout shows a start and an end line for each Step", async () => {
	const root = await makeProject({
		".punt/workflow.toml": workflow,
		[ticketPath]: ticket,
	});

	const result = await runPunt(root, ["run", "hello"]);

	const time = String.raw`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ`;
	const lines = result.stdout.trimEnd().split("\n");
	expect(lines).toHaveLength(4);
	expect(lines[0]).toMatch(new RegExp(`^${time} 01-say-hello greet started$`));
	expect(lines[1]).toMatch(
		new RegExp(`^${time} 01-say-hello greet ok \\d+\\.\\ds$`),
	);
	expect(lines[2]).toMatch(new RegExp(`^${time} 01-say-hello check started$`));
	expect(lines[3]).toMatch(
		new RegExp(`^${time} 01-say-hello check ok \\d+\\.\\ds$`),
	);
});
