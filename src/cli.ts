#!/usr/bin/env bun
// The `punt` command: parses arguments, runs the command, prints errors and
// picks the exit code. Exit 0 means the command succeeded or the Goal is done.

import { resetTicket, runGoal } from "./goal-runner.ts";
import { initProject } from "./init.ts";
import { addTicket, createGoal } from "./tickets.ts";

const usage = `usage: punt init
       punt run <goal>
       punt goal new <goal>
       punt ticket add <goal> <slug> [--blocked-by <NN>]...
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
		if (action === "new" && goal !== undefined && extra.length === 0) {
			console.log(await createGoal(root, goal));
			return 0;
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
			const blockedBy = blockersFrom(flags);
			if (slug !== undefined && blockedBy !== undefined) {
				console.log(await addTicket(root, goal, slug, blockedBy));
				return 0;
			}
		}
	}
	console.error(usage);
	return 1;
}

// Reads `--blocked-by <NN>`, given once per blocker. Returns undefined when
// `flags` holds anything else, so the caller prints the usage.
function blockersFrom(flags: string[]): number[] | undefined {
	const blockers: number[] = [];
	for (let index = 0; index < flags.length; index += 2) {
		const number = flags[index + 1];
		const isBlocker =
			flags[index] === "--blocked-by" &&
			number !== undefined &&
			/^\d+$/.test(number);
		if (!isBlocker) return undefined;
		blockers.push(Number(number));
	}
	return blockers;
}

try {
	process.exit(await main(process.argv.slice(2)));
} catch (error) {
	console.error(`punt: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
