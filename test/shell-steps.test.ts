import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	goalText,
	goalWorktree,
	makeProject,
	readTicketFile,
	runVago,
} from "./project.ts";

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

const goalDir = ".vago-goals/hello";
const ticketPath = `${goalDir}/tickets/01-say-hello.md`;

test("a Ticket goes through every shell Step and ends done", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});

	const result = await runVago(root, ["run", "hello"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	const { header, body } = await readTicketFile(root, ticketPath);
	expect(header.status).toBe("done");
	expect(body).toBe(ticketBody);
});

test("a shell Step runs in the Goal's worktree", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": `
[[steps]]
id   = "where"
type = "shell"
run  = "pwd -P > where.txt"
`,
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});

	const result = await runVago(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	const worktree = await goalWorktree(root, "hello");
	expect((await Bun.file(join(worktree, "where.txt")).text()).trim()).toBe(
		worktree,
	);
});

test("a shell Step gets the Goal and Ticket names in VAGO_GOAL and VAGO_TICKET", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": `
[[steps]]
id   = "names"
type = "shell"
run  = 'echo "$VAGO_GOAL $VAGO_TICKET"'
`,
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});

	await runVago(root, ["run", "hello"]);

	expect(
		await Bun.file(join(root, goalDir, "logs", "01-names-1.log")).text(),
	).toBe("hello 01-say-hello\n");
});

test("a shell Step learns in VAGO_LAST_TICKET whether every other Ticket of the Goal is done", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": `
[[steps]]
id   = "last"
type = "shell"
run  = 'echo "$VAGO_LAST_TICKET"'
`,
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
		[`${goalDir}/tickets/02-wave.md`]: ticket,
	});

	await runVago(root, ["run", "hello"]);

	const log = (name: string) =>
		Bun.file(join(root, goalDir, "logs", name)).text();
	expect(await log("01-last-1.log")).toBe("false\n");
	expect(await log("02-last-1.log")).toBe("true\n");
});

test("each Step gets a [[runs]] entry and a log of its stdout and stderr", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});

	await runVago(root, ["run", "hello"]);

	const { header } = await readTicketFile(root, ticketPath);
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
		".vago/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: ticket,
	});

	const result = await runVago(root, ["run", "hello"]);

	const time = String.raw`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ`;
	const lines = result.stdout.trimEnd().split("\n");
	expect(lines[0]).toBe(`Worktree ${await goalWorktree(root, "hello")}`);
	expect(lines[1]).toBe("01-say-hello");
	expect(lines[2]).toMatch(new RegExp(`^  ${time} +greet started$`));
	expect(lines[3]).toMatch(new RegExp(`^  ${time} +\\d+\\.\\ds +greet ok$`));
	expect(lines[4]).toMatch(new RegExp(`^  ${time} +check started$`));
	expect(lines[5]).toMatch(new RegExp(`^  ${time} +\\d+\\.\\ds +check ok$`));
	expect(lines[6]).toBe("");
	expect(lines[7]).toBe("hello: 1 of 1 Tickets done");
});

test("header fields Alpha doesn't know survive its rewrites", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
		[ticketPath]: `+++\nstatus = "ready"\nnote = "kept"\n+++\n${ticketBody}`,
	});

	await runVago(root, ["run", "hello"]);

	const { header } = await readTicketFile(root, ticketPath);
	expect(header.note).toBe("kept");
});
