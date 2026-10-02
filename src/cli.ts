#!/usr/bin/env bun
// The `punt` command: parses arguments, runs the command, prints help and
// errors, and picks the exit code. Exit 0 means the command succeeded, help
// was printed, or the Goal is done. Each command's help, usage line and
// argument parsing all come from its one entry in `commands`.

import { newGoal, resetTicket, runGoal } from "./goal-runner.ts";
import { initProject } from "./init.ts";
import { printGoalReport } from "./progress.ts";
import { addTicket, readGoal, readGoalBody } from "./tickets.ts";

/** One positional argument, such as `<goal>`. */
type Operand = {
	name: string;
	meaning: string;
	/** Only digits are accepted, as for a Ticket number. */
	digits?: true;
};

/** A `--name <value>` flag, given after the operands. */
type Flag = {
	name: string;
	/** The placeholder for the flag's value in the usage, such as `<path>`. */
	value: string;
	times: "once" | "at most once" | "any number of times";
	meaning: string;
	digits?: true;
};

type Command = {
	/** The words that select it, such as `goal new`. */
	name: string;
	/** One line for `punt --help`. */
	summary: string;
	/** What it does, for its own `--help`. */
	description: string;
	operands: Operand[];
	flags: Flag[];
	example: string;
	/**
	 * Runs the command in the Project at `root` and returns the exit code.
	 * `values` maps each operand and flag name to what was given for it, in
	 * the counts its `times` allows, so an operand or a `once` flag is there.
	 */
	run(root: string, values: Map<string, string[]>): Promise<number>;
};

const bodyFileFlag: Flag = {
	name: "--body-file",
	value: "<path>",
	times: "at most once",
	meaning:
		"Takes the body from this file, or from stdin when <path> is -. Without it, the body is a title to fill in.",
};

const commands: Command[] = [
	{
		name: "init",
		summary: "Copy the starter Workflows into .punt/ of this repo",
		description: `Copies the starter Workflows, prompts, rules and scripts into .punt/. It first asks
whether you will commit the Workflow: yes leaves .punt/ to git, anything else
adds .punt/ to .git/info/exclude. Goals stay out of git either way. It refuses,
changing nothing, when a file it would write already exists or this is not the
root of a git repo.`,
		operands: [],
		flags: [],
		example: "punt init",
		run: async (root) => {
			await initProject(root);
			return 0;
		},
	},
	{
		name: "run",
		summary: "Take a Goal's ready Tickets through its Workflow",
		description: `Runs each ready Ticket of the Goal through every Step of the Workflow the Goal
names, one Ticket at a time, until no Ticket is ready or one goes stuck. It
prints a line per Step and a summary at the end. While any Ticket of the Goal
is stuck it runs nothing and says which. Exits 0 only when every Ticket is
done.`,
		operands: [{ name: "<goal>", meaning: "The Goal to run." }],
		flags: [],
		example: "punt run search",
		run: async (root, values) =>
			(await runGoal(root, first(values, "<goal>"))) === "done" ? 0 : 1,
	},
	{
		name: "goal new",
		summary: "Create a Goal with no Tickets",
		description: `Creates the Goal with no Tickets and prints the path of its goal.md. It refuses,
creating nothing, when the Goal exists or punt run would refuse the Workflow.`,
		operands: [
			{
				name: "<goal>",
				meaning: "The new Goal's name, used for its folder.",
			},
		],
		flags: [
			{
				name: "--workflow",
				value: "<name>",
				times: "once",
				meaning:
					"The Workflow the Goal's Tickets go through, from .punt/workflows/<name>.toml.",
			},
			bodyFileFlag,
		],
		example: "punt goal new search --workflow small --body-file goal.md",
		run: async (root, values) => {
			const body = await readBodyFile(values.get("--body-file")?.[0]);
			console.log(
				await newGoal(
					root,
					first(values, "<goal>"),
					first(values, "--workflow"),
					body,
				),
			);
			return 0;
		},
	},
	{
		name: "goal report",
		summary: "Print a Markdown report of a Goal's Tickets and Runs",
		description: `Prints the Goal's body, then a table of its Tickets with the Runs each took,
how long they took and what they cost, ready to paste into a PR description.`,
		operands: [{ name: "<goal>", meaning: "The Goal to report on." }],
		flags: [],
		example: "punt goal report search",
		run: async (root, values) => {
			const goal = first(values, "<goal>");
			// readGoal first, since it names a missing Goal as such.
			const state = await readGoal(root, goal);
			printGoalReport(await readGoalBody(root, goal), state);
			return 0;
		},
	},
	{
		name: "ticket add",
		summary: "Add a ready Ticket to a Goal",
		description: `Adds a Ticket to the Goal, numbered one past its highest Ticket, with status
ready, and prints the path of the Ticket file.`,
		operands: [
			{ name: "<goal>", meaning: "The Goal the Ticket belongs to." },
			{
				name: "<slug>",
				meaning: "The Ticket's name, used in its file name after the number.",
			},
		],
		flags: [
			{
				name: "--blocked-by",
				value: "<NN>",
				times: "any number of times",
				meaning:
					"The number of a Ticket that must be done before this one runs. Repeat it for each blocker.",
				digits: true,
			},
			bodyFileFlag,
		],
		example:
			"punt ticket add search ranking --blocked-by 1 --body-file ticket.md",
		run: async (root, values) => {
			const body = await readBodyFile(values.get("--body-file")?.[0]);
			const blockedBy = (values.get("--blocked-by") ?? []).map(Number);
			console.log(
				await addTicket(
					root,
					first(values, "<goal>"),
					first(values, "<slug>"),
					blockedBy,
					body,
				),
			);
			return 0;
		},
	},
	{
		name: "ticket reset",
		summary: "Make a stuck Ticket ready to run again",
		description: `Sets a stuck Ticket back to ready, so the next punt run takes it again. Its Runs
stay in the Ticket file. It refuses a Ticket that isn't stuck.`,
		operands: [
			{ name: "<goal>", meaning: "The Goal the Ticket belongs to." },
			{
				name: "<NN>",
				meaning: "The Ticket's number, the digits its file name starts with.",
				digits: true,
			},
		],
		flags: [],
		example: "punt ticket reset search 2",
		run: async (root, values) => {
			await resetTicket(
				root,
				first(values, "<goal>"),
				Number(first(values, "<NN>")),
			);
			return 0;
		},
	},
];

const helpPointer = "Run `punt --help` for what each command does.";

async function main(args: string[]): Promise<number> {
	const helpAsked =
		args[0] === "help" || args.includes("--help") || args.includes("-h");
	const words = args
		.slice(args[0] === "help" ? 1 : 0)
		.filter((arg) => arg !== "--help" && arg !== "-h");
	const command = commands.find((candidate) =>
		startsWith(words, candidate.name.split(" ")),
	);
	if (helpAsked) {
		if (command !== undefined) {
			console.log(commandHelp(command));
			return 0;
		}
		// `punt help` lists every command, and `punt goal --help` the goal ones.
		const matching = commands.filter((candidate) =>
			startsWith(candidate.name.split(" "), words),
		);
		if (matching.length > 0) {
			console.log(listing(matching));
			return 0;
		}
	}
	if (command === undefined) {
		console.error(`${allUsage()}\n${helpPointer}`);
		return 1;
	}
	const given = words.slice(command.name.split(" ").length);
	const values = parseArguments(command, given);
	if (values === undefined) {
		console.error(
			`${usage(command)}\nRun \`punt ${command.name} --help\` for what it does and what each argument means.`,
		);
		return 1;
	}
	return command.run(process.cwd(), values);
}

function startsWith(words: string[], prefix: string[]): boolean {
	return prefix.every((word, index) => words[index] === word);
}

// Parsing gives each operand and `once` flag its one value, so a name with
// none is a typo in `commands`.
function first(values: Map<string, string[]>, name: string): string {
	const value = values.get(name)?.[0];
	if (value === undefined)
		throw new Error(`cli.ts reads ${name}, which the command doesn't take`);
	return value;
}

// Maps each operand of `command` to the one value given for it, and each flag
// to its values in the order given, read as `--name value` pairs after the
// operands. A flag's value is taken as given, even `-` or one starting with
// `--`. Returns undefined, so the caller prints the usage, when the count of
// operands is wrong, a flag isn't the command's or is given more or fewer
// times than it allows, or a value that must be digits isn't.
function parseArguments(
	command: Command,
	given: string[],
): Map<string, string[]> | undefined {
	const operandCount = command.operands.length;
	const flags = given.slice(operandCount);
	if (given.length < operandCount || flags.length % 2 !== 0) return undefined;
	const values = new Map<string, string[]>();
	command.operands.forEach((operand, index) => {
		values.set(operand.name, [given[index] ?? ""]);
	});
	for (const flag of command.flags) values.set(flag.name, []);
	for (let index = 0; index < flags.length; index += 2) {
		const flag = command.flags.find(({ name }) => name === flags[index]);
		if (flag === undefined) return undefined;
		values.get(flag.name)?.push(flags[index + 1] ?? "");
	}
	for (const flag of command.flags) {
		const count = values.get(flag.name)?.length ?? 0;
		if (flag.times === "once" && count !== 1) return undefined;
		if (flag.times === "at most once" && count > 1) return undefined;
	}
	for (const argument of [...command.operands, ...command.flags]) {
		if (!argument.digits) continue;
		const all = values.get(argument.name) ?? [];
		if (!all.every((value) => /^\d+$/.test(value))) return undefined;
	}
	return values;
}

function usage(command: Command): string {
	const parts = [`usage: punt ${command.name}`];
	for (const operand of command.operands) parts.push(operand.name);
	for (const flag of command.flags) {
		const spelled = `${flag.name} ${flag.value}`;
		if (flag.times === "once") parts.push(spelled);
		if (flag.times === "at most once") parts.push(`[${spelled}]`);
		if (flag.times === "any number of times") parts.push(`[${spelled}]...`);
	}
	return parts.join(" ");
}

function allUsage(): string {
	return commands
		.map((command, index) =>
			index === 0 ? usage(command) : usage(command).replace("usage:", "      "),
		)
		.join("\n");
}

function listing(listed: Command[]): string {
	const width = Math.max(...listed.map(({ name }) => name.length)) + 2;
	const rows = listed.map(
		({ name, summary }) => `  ${name.padEnd(width)}${summary}`,
	);
	return `usage: punt <command> [arguments]

punt takes a Goal's Tickets through the Workflow the Goal names, with a coding
agent doing each agent Step.

commands:
${rows.join("\n")}

Run \`punt <command> --help\` for a command's arguments, flags and an example.`;
}

function commandHelp(command: Command): string {
	const operandRows = command.operands.map(({ name, meaning }) => ({
		label: name,
		meaning,
	}));
	const flagRows = command.flags.map(({ name, value, meaning }) => ({
		label: `${name} ${value}`,
		meaning,
	}));
	const labels = [...operandRows, ...flagRows].map(({ label }) => label);
	const width = Math.max(0, ...labels.map((label) => label.length)) + 2;
	const table = (rows: { label: string; meaning: string }[]) =>
		rows.map(({ label, meaning }) => `  ${label.padEnd(width)}${meaning}`);
	const sections = [usage(command), command.description];
	if (operandRows.length > 0) {
		sections.push(["arguments:", ...table(operandRows)].join("\n"));
	}
	if (flagRows.length > 0) {
		sections.push(["flags:", ...table(flagRows)].join("\n"));
	}
	sections.push(`example:\n  ${command.example}`);
	return sections.join("\n\n");
}

// `-` means stdin, as it does for `cat`. A relative path resolves from the
// working directory, the Project root `main` works in. No path, no body.
async function readBodyFile(
	path: string | undefined,
): Promise<string | undefined> {
	if (path === undefined) return undefined;
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
