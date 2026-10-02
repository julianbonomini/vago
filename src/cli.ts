#!/usr/bin/env bun
// The `punt` command: parses arguments, runs the command, prints errors and
// picks the exit code. Exit 0 means the command succeeded or the Goal is done.

import { resetTicket, runGoal } from "./goal-runner.ts";

const usage = `usage: punt run <goal>
       punt ticket reset <goal> <NN>`;

async function main(args: string[]): Promise<number> {
	const root = process.cwd();
	const [command, ...operands] = args;
	if (command === "run") {
		const [goal, ...extra] = operands;
		if (goal !== undefined && extra.length === 0) {
			return (await runGoal(root, goal)) === "done" ? 0 : 1;
		}
	}
	if (command === "ticket") {
		const [action, goal, number, ...extra] = operands;
		if (
			action === "reset" &&
			goal !== undefined &&
			number !== undefined &&
			/^\d+$/.test(number) &&
			extra.length === 0
		) {
			await resetTicket(root, goal, Number(number));
			return 0;
		}
	}
	console.error(usage);
	return 1;
}

try {
	process.exit(await main(process.argv.slice(2)));
} catch (error) {
	console.error(`punt: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
