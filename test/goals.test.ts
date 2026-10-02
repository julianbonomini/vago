import { expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { makeProject, runPunt } from "./project.ts";

const workflow = `
[[steps]]
id   = "build"
type = "shell"
run  = "true"
`;

const goalDir = ".punt/goals/hello";

function ticket(header: string, title: string): string {
	return `+++\n${header}\n+++\n\n# ${title}\n`;
}

function goalProject(tickets: Record<string, string>): Promise<string> {
	const files: Record<string, string> = {
		".punt/workflow.toml": workflow,
		[`${goalDir}/goal.md`]: "# Hello\n",
	};
	for (const [name, text] of Object.entries(tickets)) {
		files[`${goalDir}/tickets/${name}.md`] = text;
	}
	return makeProject(files);
}

async function statusOf(root: string, name: string): Promise<unknown> {
	const text = await Bun.file(
		join(root, goalDir, "tickets", `${name}.md`),
	).text();
	return parse(text.slice("+++\n".length, text.indexOf("\n+++\n") + 1)).status;
}

function startedTickets(stdout: string): string[] {
	return stdout
		.split("\n")
		.filter((line) => line.endsWith(" started"))
		.map((line) => line.split(" ")[1] ?? "");
}

test("a Ticket blocked by another runs after it and both end done", async () => {
	const root = await goalProject({
		"01-greet": ticket(`status = "ready"`, "Greet"),
		"02-wave": ticket(`status = "ready"\nblocked_by = [1]`, "Wave"),
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect(startedTickets(result.stdout)).toEqual(["01-greet", "02-wave"]);
	expect(await statusOf(root, "01-greet")).toBe("done");
	expect(await statusOf(root, "02-wave")).toBe("done");
});

test("a blocker runs first even when it has the higher number", async () => {
	const root = await goalProject({
		"01-wave": ticket(`status = "ready"\nblocked_by = [2]`, "Wave"),
		"02-greet": ticket(`status = "ready"`, "Greet"),
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	expect(startedTickets(result.stdout)).toEqual(["02-greet", "01-wave"]);
});

test("with no blockers the lower-numbered Ticket runs first", async () => {
	const root = await goalProject({
		"10-last": ticket(`status = "ready"`, "Last"),
		"02-second": ticket(`status = "ready"`, "Second"),
		"01-first": ticket(`status = "ready"`, "First"),
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(startedTickets(result.stdout)).toEqual([
		"01-first",
		"02-second",
		"10-last",
	]);
});

test("Tickets already done are skipped and count toward the Goal", async () => {
	const root = await goalProject({
		"01-greet": ticket(`status = "done"`, "Greet"),
		"02-wave": ticket(`status = "ready"\nblocked_by = [1]`, "Wave"),
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	expect(startedTickets(result.stdout)).toEqual(["02-wave"]);
});

test("the Goal summary is printed on exit", async () => {
	const root = await goalProject({
		"01-greet": ticket(`status = "ready"`, "Greet"),
		"02-wave": ticket(`status = "ready"\nblocked_by = [1]`, "Wave"),
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(result.stdout).toEndWith(
		"hello: 2 of 2 Tickets done\n  01-greet done\n  02-wave done\n",
	);
});

test("a Goal left unfinished exits non-zero and its summary says so", async () => {
	const root = await makeProject({
		".punt/workflow.toml": `
[[steps]]
id   = "build"
type = "shell"
run  = "false"
`,
		[`${goalDir}/goal.md`]: "# Hello\n",
		[`${goalDir}/tickets/01-greet.md`]: ticket(`status = "ready"`, "Greet"),
		[`${goalDir}/tickets/02-wave.md`]: ticket(`status = "ready"`, "Wave"),
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(result.exitCode).not.toBe(0);
	expect(startedTickets(result.stdout)).toEqual(["01-greet"]);
	expect(await statusOf(root, "02-wave")).toBe("ready");
	expect(result.stdout).toMatch(/hello: 0 of 2 Tickets done\n/);
	expect(result.stdout).toEndWith("  02-wave ready\n");
});

test("header rewrites leave every Ticket body byte for byte", async () => {
	const bodies = {
		"01-greet": "\n# Greet\n\nA body with +++ in it\n+++\nand no final newline",
		"02-wave": "\r\n# Wave\r\n\r\n\tTabs, CRLF and trailing spaces   \r\n\n\n",
	};
	const root = await goalProject({
		"01-greet": `+++\nstatus = "ready"\n+++\n${bodies["01-greet"]}`,
		"02-wave": `+++\nstatus = "ready"\nblocked_by = [1]\n+++\n${bodies["02-wave"]}`,
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	for (const [name, body] of Object.entries(bodies)) {
		const text = await Bun.file(
			join(root, goalDir, "tickets", `${name}.md`),
		).text();
		expect(text.slice(text.indexOf("\n+++\n") + "\n+++\n".length)).toBe(body);
	}
});

async function snapshot(root: string): Promise<Record<string, string>> {
	const folder = join(root, goalDir, "tickets");
	const files: Record<string, string> = {};
	for (const name of await readdir(folder)) {
		files[name] = await Bun.file(join(folder, name)).text();
	}
	return files;
}

const badGoals: [string, Record<string, string>, RegExp][] = [
	[
		"an unparsable header",
		{
			"01-greet": ticket(`status = "ready"`, "Greet"),
			"02-wave": ticket(`status = "ready`, "Wave"),
		},
		/02-wave\.md has a header that isn't valid TOML/,
	],
	[
		"an unknown status",
		{ "01-greet": ticket(`status = "maybe"`, "Greet") },
		/01-greet\.md.*status/s,
	],
	[
		"an unknown blocker",
		{
			"01-greet": ticket(`status = "ready"`, "Greet"),
			"02-wave": ticket(`status = "ready"\nblocked_by = [7]`, "Wave"),
		},
		/02-wave\.md is blocked by Ticket 7, which isn't in Goal hello/,
	],
	[
		"a cycle",
		{
			"01-greet": ticket(`status = "ready"\nblocked_by = [3]`, "Greet"),
			"02-wave": ticket(`status = "ready"\nblocked_by = [1]`, "Wave"),
			"03-bow": ticket(`status = "ready"\nblocked_by = [2]`, "Bow"),
		},
		/Goal hello has a blocker cycle: 01-greet -> 03-bow -> 02-wave -> 01-greet/,
	],
	[
		"a Ticket blocking itself",
		{ "01-greet": ticket(`status = "ready"\nblocked_by = [1]`, "Greet") },
		/Goal hello has a blocker cycle: 01-greet -> 01-greet/,
	],
	[
		"two Tickets with one number",
		{
			"01-greet": ticket(`status = "ready"`, "Greet"),
			"01-wave": ticket(`status = "ready"`, "Wave"),
		},
		/01-greet\.md and 01-wave\.md share number 1/,
	],
];

for (const [problem, tickets, message] of badGoals) {
	test(`a Goal with ${problem} exits non-zero and no Ticket changes`, async () => {
		const root = await goalProject(tickets);
		const before = await snapshot(root);

		const result = await runPunt(root, ["run", "hello"]);

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toMatch(message);
		expect(result.stdout).toBe("");
		expect(await snapshot(root)).toEqual(before);
	});
}

test("a missing Goal exits non-zero naming it", async () => {
	const root = await makeProject({ ".punt/workflow.toml": workflow });

	const result = await runPunt(root, ["run", "nope"]);

	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toMatch(/Goal nope not found: .*goals\/nope\/goal\.md/);
	expect(result.stdout).toBe("");
});
