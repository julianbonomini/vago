#!/usr/bin/env bun
// The `punt` command: parses arguments, runs the command, prints errors and
// picks the exit code. Exit 0 means the command succeeded or the Goal is done.

import { newGoal, resetTicket, runGoal } from "./goal-runner.ts";
import { initProject } from "./init.ts";
import { printGoalReport } from "./progress.ts";
import { addTicket, readGoal, readGoalBody } from "./tickets.ts";

const usage = `usage: punt init
       punt run <goal>
       punt goal new <goal> --workflow <name> [--body-file <path>]
       punt goal report <goal>
       punt ticket add <goal> <slug> [--blocked-by <NN>]... [--body-file <path>]
       punt ticket reset <goal> <NN>`;

async function main(args: string[]): Promise<number> {
	const root = process.cwd();
	const [command, ...operands] = args;
	if (command === "init" && operands.length === 0) {
		await initProject(root);
		return 0;
	}
	if (command === "run") {
		const [goal, ...extra] = operands;
		if (goal !== undefined && extra.length === 0) {
			return (await runGoal(root, goal)) === "done" ? 0 : 1;
		}
	}
	if (command === "goal") {
		const [action, goal, ...extra] = operands;
		if (action === "report" && goal !== undefined && extra.length === 0) {
			// readGoal first, since it names a missing Goal as such.
			const state = await readGoal(root, goal);
			printGoalReport(await readGoalBody(root, goal), state);
			return 0;
		}
		if (action === "new" && goal !== undefined) {
			const parsed = goalNewFlags(extra);
			if (parsed !== undefined) {
				const body =
					parsed.bodyFile === undefined
						? undefined
						: await readBodyFile(parsed.bodyFile);
				console.log(await newGoal(root, goal, parsed.workflow, body));
				return 0;
			}
		}
	}
	if (command === "ticket") {
		const [action, goal, ...rest] = operands;
		if (action === "reset" && goal !== undefined) {
			const [number, ...extra] = rest;
			if (number !== undefined && /^\d+$/.test(number) && extra.length === 0) {
				await resetTicket(root, goal, Number(number));
				return 0;
			}
		}
		if (action === "add" && goal !== undefined) {
			const [slug, ...flags] = rest;
			const parsed = ticketAddFlags(flags);
			if (slug !== undefined && parsed !== undefined) {
				const body =
					parsed.bodyFile === undefined
						? undefined
						: await readBodyFile(parsed.bodyFile);
				console.log(await addTicket(root, goal, slug, parsed.blockedBy, body));
				return 0;
			}
		}
	}
	console.error(usage);
	return 1;
}

// Groups `flags`, read as `--name value` pairs in order, by name: each name
// maps to its values in the order given, and a name not given maps to none.
// A value is taken as given, even `-` or one starting with `--`. Returns
// undefined when `flags` has an odd count or a name not in `names`, so the
// caller prints the usage.
function flagValues(
	flags: string[],
	names: string[],
): Map<string, string[]> | undefined {
	if (flags.length % 2 !== 0) return undefined;
	const values = new Map<string, string[]>(names.map((name) => [name, []]));
	for (let index = 0; index < flags.length; index += 2) {
		const given = values.get(flags[index] ?? "");
		if (given === undefined) return undefined;
		given.push(flags[index + 1] ?? "");
	}
	return values;
}

// Reads `--workflow <name>`, given exactly once, and `--body-file <path>`,
// given at most once, in either order. Returns undefined when `flags` holds
// anything else, so the caller prints the usage.
function goalNewFlags(
	flags: string[],
): { workflow: string; bodyFile: string | undefined } | undefined {
	const values = flagValues(flags, ["--workflow", "--body-file"]);
	if (values === undefined) return undefined;
	const [workflow, ...moreWorkflows] = values.get("--workflow") ?? [];
	const bodyFile = values.get("--body-file") ?? [];
	if (workflow === undefined || moreWorkflows.length > 0) return undefined;
	if (bodyFile.length > 1) return undefined;
	return { workflow, bodyFile: bodyFile[0] };
}

// Reads `--blocked-by <NN>`, given once per blocker, and `--body-file
// <path>`, given at most once, in any order. The path is taken as given,
// even `-` or one starting with `--`. Returns undefined when `flags` holds
// anything else, so the caller prints the usage.
function ticketAddFlags(
	flags: string[],
): { blockedBy: number[]; bodyFile: string | undefined } | undefined {
	const values = flagValues(flags, ["--blocked-by", "--body-file"]);
	if (values === undefined) return undefined;
	const blockedBy = values.get("--blocked-by") ?? [];
	const bodyFile = values.get("--body-file") ?? [];
	if (!blockedBy.every((number) => /^\d+$/.test(number))) return undefined;
	if (bodyFile.length > 1) return undefined;
	return { blockedBy: blockedBy.map(Number), bodyFile: bodyFile[0] };
}

// `-` means stdin, as it does for `cat`. A relative path resolves from the
// working directory, the Project root `main` works in.
async function readBodyFile(path: string): Promise<string> {
	try {
		return path === "-" ? await Bun.stdin.text() : await Bun.file(path).text();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`--body-file ${path} can't be read: ${message}`);
	}
}

try {
	process.exit(await main(process.argv.slice(2)));
} catch (error) {
	console.error(`punt: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
