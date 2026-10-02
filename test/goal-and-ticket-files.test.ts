import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { makeProject, readTicketFile, runPunt } from "./project.ts";

const workflow = `
[[steps]]
id   = "build"
type = "shell"
run  = "true"
`;

const goalDir = ".punt/goals/hello";

test("goal new creates a Goal with no Tickets that punt run accepts", async () => {
	const root = await makeProject({ ".punt/workflow.toml": workflow });

	const created = await runPunt(root, ["goal", "new", "hello"]);

	expect(created.stderr).toBe("");
	expect(created.exitCode).toBe(0);
	expect(created.stdout).toEndWith(`${goalDir}/goal.md\n`);
	expect(await Bun.file(join(root, goalDir, "goal.md")).text()).toBe(
		"# hello\n",
	);
	expect(await readdir(join(root, goalDir, "tickets"))).toEqual([]);

	const run = await runPunt(root, ["run", "hello"]);

	expect(run.stderr).toBe("");
	expect(run.exitCode).toBe(0);
	expect(run.stdout).toBe("hello: 0 of 0 Tickets done\n");
});

test("goal new refuses a Goal that exists and leaves it as it was", async () => {
	const root = await makeProject({
		".punt/workflow.toml": workflow,
		[`${goalDir}/goal.md`]: "# Hello\n\nSay hello to everyone.\n",
	});

	const result = await runPunt(root, ["goal", "new", "hello"]);

	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toMatch(/Goal hello already exists: \S*goals\/hello/);
	expect(result.stdout).toBe("");
	expect(await Bun.file(join(root, goalDir, "goal.md")).text()).toBe(
		"# Hello\n\nSay hello to everyone.\n",
	);
});

test("ticket add numbers Tickets in order with a ready header punt run takes", async () => {
	const root = await makeProject({
		".punt/workflow.toml": workflow,
		[`${goalDir}/goal.md`]: "# Hello\n",
	});

	const greet = await runPunt(root, ["ticket", "add", "hello", "greet"]);
	const wave = await runPunt(root, ["ticket", "add", "hello", "wave"]);

	expect(greet.stderr).toBe("");
	expect(greet.exitCode).toBe(0);
	expect(greet.stdout).toEndWith(`${goalDir}/tickets/01-greet.md\n`);
	expect(wave.stdout).toEndWith(`${goalDir}/tickets/02-wave.md\n`);
	expect(await readTicketFile(root, `${goalDir}/tickets/01-greet.md`)).toEqual({
		header: { status: "ready" },
		body: "\n# greet\n",
	});
	expect(await readTicketFile(root, `${goalDir}/tickets/02-wave.md`)).toEqual({
		header: { status: "ready" },
		body: "\n# wave\n",
	});

	const run = await runPunt(root, ["run", "hello"]);

	expect(run.exitCode).toBe(0);
	expect(run.stdout).toEndWith(
		"hello: 2 of 2 Tickets done\n  01-greet done\n  02-wave done\n",
	);
});

test("ticket add numbers past the highest Ticket and writes its blockers", async () => {
	const root = await makeProject({
		".punt/workflow.toml": workflow,
		[`${goalDir}/goal.md`]: "# Hello\n",
		[`${goalDir}/tickets/01-greet.md`]: `+++\nstatus = "ready"\n+++\n`,
		[`${goalDir}/tickets/03-wave.md`]: `+++\nstatus = "ready"\n+++\n`,
	});

	const result = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"bow",
		"--blocked-by",
		"3",
		"--blocked-by",
		"1",
	]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	const bow = await readTicketFile(root, `${goalDir}/tickets/04-bow.md`);
	expect(bow.header).toEqual({ status: "ready", blocked_by: [3, 1] });
});

test("ticket add refuses an unknown blocker and writes no Ticket", async () => {
	const root = await makeProject({
		".punt/workflow.toml": workflow,
		[`${goalDir}/goal.md`]: "# Hello\n",
		[`${goalDir}/tickets/01-greet.md`]: `+++\nstatus = "ready"\n+++\n`,
	});

	const result = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"wave",
		"--blocked-by",
		"7",
	]);

	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toMatch(
		/wave can.t be blocked by Ticket 7, which isn.t in Goal hello/,
	);
	expect(result.stdout).toBe("");
	expect(await readdir(join(root, goalDir, "tickets"))).toEqual([
		"01-greet.md",
	]);
});

for (const name of ["../escape", "a/b", ""]) {
	test(`goal new and ticket add refuse the name "${name}"`, async () => {
		const root = await makeProject({
			".punt/workflow.toml": workflow,
			[`${goalDir}/goal.md`]: "# Hello\n",
		});

		const goal = await runPunt(root, ["goal", "new", name]);
		const ticket = await runPunt(root, ["ticket", "add", "hello", name]);

		expect(goal.exitCode).not.toBe(0);
		expect(goal.stderr).toMatch(/may hold only letters, digits, - and _/);
		expect(ticket.exitCode).not.toBe(0);
		expect(ticket.stderr).toMatch(/may hold only letters, digits, - and _/);
		const files = await readdir(join(root, ".punt"), { recursive: true });
		expect(files.sort()).toEqual([
			"goals",
			"goals/hello",
			"goals/hello/goal.md",
			"workflow.toml",
		]);
	});
}

test("ticket add takes no status and prints the usage when given one", async () => {
	const root = await makeProject({
		".punt/workflow.toml": workflow,
		[`${goalDir}/goal.md`]: "# Hello\n",
	});

	const result = await runPunt(root, [
		"ticket",
		"add",
		"hello",
		"wave",
		"--status",
		"done",
	]);

	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toMatch(/^usage: punt run <goal>/);
	expect(existsSync(join(root, goalDir, "tickets"))).toBe(false);
});
