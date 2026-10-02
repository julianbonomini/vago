#!/usr/bin/env bun
// The `punt` command: parses arguments, runs the command, prints errors and
// picks the exit code. Exit 0 means the command succeeded or the Goal is done.

import { runGoal } from "./goal-runner.ts";

const usage = "usage: punt run <goal>";

async function main(args: string[]): Promise<number> {
	const [command, goal, ...rest] = args;
	if (command !== "run" || goal === undefined || rest.length > 0) {
		console.error(usage);
		return 1;
	}
	return (await runGoal(process.cwd(), goal)) === "done" ? 0 : 1;
}

try {
	process.exit(await main(process.argv.slice(2)));
} catch (error) {
	console.error(`punt: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
