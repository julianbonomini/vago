import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { goalText, makeProject, runVago, ticketText } from "./project.ts";

test("plan new makes a planning item, and no Goal or Ticket", async () => {
	const root = await makeProject({});

	const made = await runVago(root, ["plan", "new", "search"]);

	expect(made.stderr).toBe("");
	expect(made.exitCode).toBe(0);
	expect(made.stdout).toEndWith(".vago-goals/search\n");
	expect(await readdir(join(root, ".vago-goals", "search"))).toEqual([
		"planning",
	]);
	const run = await runVago(root, ["run", "search"]);
	expect(run.exitCode).toBe(1);
	expect(run.stderr).toContain("Goal search not found");
});

test("plan new refuses a name a Goal or another planning item has", async () => {
	const root = await makeProject({
		".vago-goals/search/goal.md": goalText("w"),
	});
	await runVago(root, ["plan", "new", "ideas"]);

	for (const name of ["search", "ideas"]) {
		const refused = await runVago(root, ["plan", "new", name]);

		expect(refused.exitCode).toBe(1);
		expect(refused.stderr).toContain(`${name} already exists`);
	}
	expect(existsSync(join(root, ".vago-goals/search/planning"))).toBe(false);
});

test("plan new refuses a name that isn't letters, digits, - and _", async () => {
	const root = await makeProject({});

	const refused = await runVago(root, ["plan", "new", "../x"]);

	expect(refused.exitCode).toBe(1);
	expect(refused.stderr).toContain("may hold only letters, digits, - and _");
	expect(existsSync(join(root, ".vago-goals"))).toBe(false);
});

test("plan rename gives a planning item a new name, keeping what it holds", async () => {
	const root = await makeProject({});
	await runVago(root, ["plan", "new", "search"]);
	await runVago(root, ["plan", "new", "ideas"]);
	await Bun.write(join(root, ".vago-goals/search/planning/notes"), "kept");

	const renamed = await runVago(root, ["plan", "rename", "search", "find"]);

	expect(renamed.stderr).toBe("");
	expect(renamed.exitCode).toBe(0);
	expect((await readdir(join(root, ".vago-goals"))).sort()).toEqual([
		"find",
		"ideas",
	]);
	expect(
		await Bun.file(join(root, ".vago-goals/find/planning/notes")).text(),
	).toBe("kept");
});

test("plan rename refuses a taken name, a Goal, and a name it can't find", async () => {
	const root = await makeProject({
		".vago-goals/ready/goal.md": goalText("w"),
	});
	await runVago(root, ["plan", "new", "search"]);
	await runVago(root, ["plan", "new", "ideas"]);

	for (const [args, message] of [
		[["search", "ideas"], "ideas already exists"],
		[["search", "ready"], "ready already exists"],
		[["ready", "other"], "ready is a Goal, not a planning item"],
		[["nope", "other"], "No planning item nope"],
	] as const) {
		const refused = await runVago(root, ["plan", "rename", ...args]);

		expect(refused.exitCode).toBe(1);
		expect(refused.stderr).toContain(message);
	}
	expect((await readdir(join(root, ".vago-goals"))).sort()).toEqual([
		"ideas",
		"ready",
		"search",
	]);
});

test("plan discard removes one planning item and what it holds, and nothing else", async () => {
	const root = await makeProject({
		".vago-goals/ready/goal.md": goalText("w"),
		".vago-goals/ready/tickets/01-t.md": ticketText("ready"),
	});
	await runVago(root, ["plan", "new", "search"]);
	await runVago(root, ["plan", "new", "ideas"]);
	await Bun.write(join(root, ".vago-goals/search/planning/notes"), "gone");

	const discarded = await runVago(root, ["plan", "discard", "search"]);

	expect(discarded.stderr).toBe("");
	expect(discarded.exitCode).toBe(0);
	expect((await readdir(join(root, ".vago-goals"))).sort()).toEqual([
		"ideas",
		"ready",
	]);
	expect(await readdir(join(root, ".vago-goals/ideas"))).toEqual(["planning"]);
});

test("plan discard refuses a Goal, which stays as it was", async () => {
	const root = await makeProject({
		".vago-goals/ready/goal.md": goalText("w"),
		".vago-goals/ready/tickets/01-t.md": ticketText("ready"),
	});

	const refused = await runVago(root, ["plan", "discard", "ready"]);

	expect(refused.exitCode).toBe(1);
	expect(refused.stderr).toContain("ready is a Goal, not a planning item");
	expect(existsSync(join(root, ".vago-goals/ready/tickets/01-t.md"))).toBe(
		true,
	);
});
