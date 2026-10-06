#!/usr/bin/env bun
// The `vago` command: parses arguments, runs the command, prints help and
// errors, and picks the exit code. Exit 0 means the command succeeded, help
// was printed, or the Goal is done. Each command's help, usage line and
// argument parsing all come from its one entry in `commands`, and its `run`
// reads what was given through that same entry's declarations.

import { newGoal, newTicket, resetTicket, runGoal } from "./goal-runner.ts";
import { initProject, updateProject } from "./init.ts";
import { printGoalReport } from "./progress.ts";
import { readRunOutput } from "./step-runner.ts";
import {
	createPlanningItem,
	discardPlanningItem,
	readGoal,
	readGoalBody,
	renamePlanningItem,
} from "./tickets/tickets.ts";
import { projectRoot } from "./worktree.ts";

/** One positional argument, such as `<goal>`. */
type Operand = {
	name: string;
	meaning: string;
	/** Only digits are accepted, as for a Ticket number. */
	digits?: true;
};

/** A `--name <value>` flag given exactly once, after the operands. */
type RequiredFlag = {
	name: string;
	/** The placeholder for the flag's value in the usage, such as `<path>`. */
	value: string;
	times: "once";
	meaning: string;
	digits?: true;
};

/** A `--name <value>` flag given zero or one time, after the operands. */
type OptionalFlag = {
	name: string;
	/** The placeholder for the flag's value in the usage, such as `<path>`. */
	value: string;
	times: "at most once";
	meaning: string;
	digits?: true;
};

/** A `--name <value>` flag given any number of times, after the operands. */
type RepeatedFlag = {
	name: string;
	/** The placeholder for the flag's value in the usage, such as `<path>`. */
	value: string;
	times: "any number of times";
	meaning: string;
	digits?: true;
};

type Flag = RequiredFlag | OptionalFlag | RepeatedFlag;

/**
 * What a command was given, read through the declarations in its own entry.
 * Reading an operand or required flag the command doesn't declare throws:
 * that is a mistake in `commands`, not bad input.
 */
type GivenArguments = {
	operand(operand: Operand): string;
	requiredFlag(flag: RequiredFlag): string;
	/** Undefined when the flag wasn't given. */
	optionalFlag(flag: OptionalFlag): string | undefined;
	/** The values in the order given, none when the flag wasn't given. */
	repeatedFlag(flag: RepeatedFlag): string[];
};

type Command = {
	/** The words that select it, such as `goal new`. */
	name: string;
	/** One line for `vago --help`. */
	summary: string;
	/** What it does, for its own `--help`. */
	description: string;
	operands: Operand[];
	flags: Flag[];
	example: string;
	/**
	 * Runs the command in the Project at `root` and returns the exit code.
	 * `given` holds exactly what `operands` and `flags` declare.
	 */
	run(root: string, given: GivenArguments): Promise<number>;
};

const goalToRun: Operand = { name: "<goal>", meaning: "The Goal to run." };

const newGoalName: Operand = {
	name: "<goal>",
	meaning: "The new Goal's name, used for its folder.",
};

const goalToReport: Operand = {
	name: "<goal>",
	meaning: "The Goal to report on.",
};

const ticketGoal: Operand = {
	name: "<goal>",
	meaning: "The Goal the Ticket belongs to.",
};

const ticketSlug: Operand = {
	name: "<slug>",
	meaning: "The Ticket's name, used in its file name after the number.",
};

const ticketNumber: Operand = {
	name: "<NN>",
	meaning: "The Ticket's number, the digits its file name starts with.",
	digits: true,
};

const newPlanningName: Operand = {
	name: "<name>",
	meaning:
		"The planning item's name, which the Goal keeps unless it is renamed.",
};

const planningName: Operand = {
	name: "<name>",
	meaning: "The planning item's name.",
};

const planningNewName: Operand = {
	name: "<new-name>",
	meaning: "The name it takes.",
};

const workflowFlag: RequiredFlag = {
	name: "--workflow",
	value: "<name>",
	times: "once",
	meaning:
		"The Workflow the Goal's Tickets go through, from .vago/workflows/<name>.toml.",
};

const ticketWorkflowFlag: OptionalFlag = {
	name: "--workflow",
	value: "<name>",
	times: "at most once",
	meaning:
		"The Workflow this Ticket goes through in place of the Goal's, from .vago/workflows/<name>.toml.",
};

const blockedByFlag: RepeatedFlag = {
	name: "--blocked-by",
	value: "<NN>",
	times: "any number of times",
	meaning:
		"The number of a Ticket that must be done before this one runs. Repeat it for each blocker.",
	digits: true,
};

const bodyFileFlag: OptionalFlag = {
	name: "--body-file",
	value: "<path>",
	times: "at most once",
	meaning:
		"Takes the body from this file, or from stdin when <path> is -. Without it, the body is a title to fill in.",
};

const commands: Command[] = [
	{
		name: "init",
		summary: "Copy the starter Workflows into .vago/ of this repo",
		description: `Copies the starter Workflows, prompts and scripts into .vago/, and the vago-
skills into .claude/skills/ for Claude Code and .agents/skills/ for Codex. It
first asks whether you will commit the Workflow: yes leaves them to git,
anything else adds .vago/ and each skill to .git/info/exclude. Goals stay out
of git either way. It refuses, changing nothing, when a file it would write
already exists or this is not the root of a git repo. To bring a set-up
Project to a newer starter, run vago update.`,
		operands: [],
		flags: [],
		example: "vago init",
		run: async (root) => {
			await initProject(root);
			return 0;
		},
	},
	{
		name: "update",
		summary: "Bring .vago/ and the vago- skills to this vago's starter",
		description: `Overwrites each starter file in .vago/, .claude/skills/ and .agents/skills/
that differs from the starter this vago ships, writes the ones that are
missing, and prints the path of each file it changed. Files you added, such as
your own Workflow, prompt or skill, and the Goals in .vago-goals/ stay as they
are. It keeps the commit answer you gave vago init, and asks again only when
.git/info/exclude doesn't show it. It refuses when there is no .vago/ yet:
run vago init.`,
		operands: [],
		flags: [],
		example: "vago update",
		run: async (root) => {
			await updateProject(root);
			return 0;
		},
	},
	{
		name: "run",
		summary: "Take a Goal's Tickets through its Workflow",
		description: `Runs the Goal's ready and stuck Tickets through the Steps of the Workflow the
Goal names, one Ticket at a time, until no Ticket is left to run or one goes
stuck. A ready Ticket starts at the first Step, and a stuck, interrupted or
lost one continues at the Step it stopped on. It
prints a line per Step and a summary at the end. Exits 0 only when every
Ticket is done. The Steps run in the Goal's own worktree, outside the repo on
branch vago/<goal>, whose path it prints. It refuses a Goal another vago run
is running.`,
		operands: [goalToRun],
		flags: [],
		example: "vago run search",
		run: async (root, given) =>
			(await runGoal(root, given.operand(goalToRun))) === "done" ? 0 : 1,
	},
	{
		name: "goal new",
		summary: "Create a Goal with no Tickets",
		description: `Creates the Goal with no Tickets and prints the path of its goal.md. It refuses,
creating nothing, when the Goal exists or vago run would refuse the Workflow.`,
		operands: [newGoalName],
		flags: [workflowFlag, bodyFileFlag],
		example: "vago goal new search --workflow small --body-file goal.md",
		run: async (root, given) => {
			const body = await readBodyFile(given.optionalFlag(bodyFileFlag));
			console.log(
				await newGoal(
					root,
					given.operand(newGoalName),
					given.requiredFlag(workflowFlag),
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
		operands: [goalToReport],
		flags: [],
		example: "vago goal report search",
		run: async (root, given) => {
			const goal = given.operand(goalToReport);
			// readGoal first, since it names a missing Goal as such.
			const state = await readGoal(root, goal);
			const outputs = new Map<string, string>();
			for (const run of state.tickets.flatMap(({ runs }) => runs)) {
				if (run.inGoalReport) {
					outputs.set(run.log, (await readRunOutput(run)) ?? "");
				}
			}
			printGoalReport(await readGoalBody(root, goal), state, outputs);
			return 0;
		},
	},
	{
		name: "plan new",
		summary: "Start planning a Goal",
		description: `Makes a planning item, a Goal still being planned, and prints its folder. It
shows in the TUI's Goals list as planning. It makes no Goal and no Ticket, so
vago run doesn't find it. It refuses a name a Goal or planning item has.`,
		operands: [newPlanningName],
		flags: [],
		example: "vago plan new search",
		run: async (root, given) => {
			console.log(
				await createPlanningItem(root, given.operand(newPlanningName)),
			);
			return 0;
		},
	},
	{
		name: "plan rename",
		summary: "Rename a planning item",
		description: `Gives a planning item a new name, keeping everything it holds. It refuses a
Goal, and a name a Goal or planning item has.`,
		operands: [planningName, planningNewName],
		flags: [],
		example: "vago plan rename search ranked-search",
		run: async (root, given) => {
			await renamePlanningItem(
				root,
				given.operand(planningName),
				given.operand(planningNewName),
			);
			return 0;
		},
	},
	{
		name: "plan discard",
		summary: "Remove a planning item and everything it holds",
		description: `Removes a planning item and everything saved with it. It refuses a Goal,
which it never removes.`,
		operands: [planningName],
		flags: [],
		example: "vago plan discard search",
		run: async (root, given) => {
			await discardPlanningItem(root, given.operand(planningName));
			return 0;
		},
	},
	{
		name: "ticket add",
		summary: "Add a ready Ticket to a Goal",
		description: `Adds a Ticket to the Goal, numbered one past its highest Ticket, with status
ready, and prints the path of the Ticket file. The Ticket goes through the
Goal's Workflow unless --workflow names another. It refuses, writing nothing,
when vago run would refuse that Workflow.`,
		operands: [ticketGoal, ticketSlug],
		flags: [blockedByFlag, ticketWorkflowFlag, bodyFileFlag],
		example:
			"vago ticket add search ranking --blocked-by 1 --body-file ticket.md",
		run: async (root, given) => {
			const body = await readBodyFile(given.optionalFlag(bodyFileFlag));
			const blockedBy = given.repeatedFlag(blockedByFlag).map(Number);
			console.log(
				await newTicket(
					root,
					given.operand(ticketGoal),
					given.operand(ticketSlug),
					blockedBy,
					given.optionalFlag(ticketWorkflowFlag),
					body,
				),
			);
			return 0;
		},
	},
	{
		name: "ticket reset",
		summary: "Make a stuck Ticket start over from its first Step",
		description: `Sets a stuck Ticket so the next vago run starts it over from its first Step,
instead of picking it up at the Step it stopped on. Its Runs stay in the
Ticket file. It refuses a Ticket that isn't stuck.`,
		operands: [ticketGoal, ticketNumber],
		flags: [],
		example: "vago ticket reset search 2",
		run: async (root, given) => {
			await resetTicket(
				root,
				given.operand(ticketGoal),
				Number(given.operand(ticketNumber)),
			);
			return 0;
		},
	},
];

// The command that runs this same `vago`, for the TUI to start Goals with:
// the compiled binary alone, or Bun with the script it runs. A compiled
// binary's script sits in Bun's embedded `/$bunfs/`, which no other process
// can read.
function thisVago(): string[] {
	return Bun.main.startsWith("/$bunfs/")
		? [process.execPath]
		: [process.execPath, Bun.main];
}

const helpPointer = "Run `vago --help` for what each command does.";

async function main(args: string[]): Promise<number> {
	const { words, helpAsked, command, rest } = commandWords(args);
	if (command === undefined) {
		// Only a bare `vago` on a terminal opens the TUI. It's loaded here and
		// nowhere else, so no command loads OpenTUI or needs Solid's transform.
		if (args.length === 0 && process.stdin.isTTY && process.stdout.isTTY) {
			const { openTui } = await import("./tui/tui.tsx");
			await openTui(await projectRoot(process.cwd()), thisVago());
			return 0;
		}
		const shown = helpAsked ? listing(words) : undefined;
		if (shown !== undefined) {
			console.log(shown);
			return 0;
		}
		console.error(`${usages(commands)}\n${helpPointer}`);
		return 1;
	}
	if (helpAsked) {
		console.log(commandHelp(command));
		return 0;
	}
	const given = parseArguments(command, rest);
	if (given === "help") {
		console.log(commandHelp(command));
		return 0;
	}
	if (given === undefined) {
		console.error(
			`${usage(command)}\nRun \`vago ${command.name} --help\` for what it does and what each argument means.`,
		);
		return 1;
	}
	return command.run(await projectRoot(process.cwd()), given);
}

function isHelp(token: string): boolean {
	return token === "--help" || token === "-h";
}

// Reads the words that name a command, skipping `--help` and `-h` among them,
// and stops at the command they name or at the first word no command's name
// goes on with. A leading `help` asks for help too. `command` is undefined
// when the words name none, and the tokens after the stop are then ignored.
function commandWords(args: string[]): {
	words: string[];
	helpAsked: boolean;
	command: Command | undefined;
	rest: string[];
} {
	let helpAsked = args[0] === "help";
	const tokens = args.slice(helpAsked ? 1 : 0);
	const words: string[] = [];
	for (const [index, token] of tokens.entries()) {
		if (isHelp(token)) {
			helpAsked = true;
			continue;
		}
		words.push(token);
		const named = commandsStartingWith(words);
		const command = named.find(
			({ name }) => name.split(" ").length === words.length,
		);
		if (command !== undefined) {
			return { words, helpAsked, command, rest: tokens.slice(index + 1) };
		}
		if (named.length === 0) break;
	}
	return { words, helpAsked, command: undefined, rest: [] };
}

function commandsStartingWith(words: string[]): Command[] {
	return commands.filter(({ name }) =>
		words.every((word, index) => name.split(" ")[index] === word),
	);
}

// Fills the operand slots in order, then reads the rest as `--name value`
// pairs. A `--help` or `-h` where an operand or a flag name goes asks for the
// command's help and takes no slot, and it wins over any mistake around it.
// A flag's value is taken as given, even `-`, `-h`, `--help` or one starting
// with `--`. Returns undefined, so the caller prints the usage, when the count
// of operands is wrong, a flag isn't the command's or is given more or fewer
// times than it allows, or a value that must be digits isn't.
function parseArguments(
	command: Command,
	tokens: string[],
): GivenArguments | "help" | undefined {
	const operandValues = new Map<Operand, string>();
	const flagValues = new Map<Flag, string[]>(
		command.flags.map((flag) => [flag, []]),
	);
	let helpAsked = false;
	let unknownFlag = false;
	// Where the next token goes when it is a flag's value.
	let valueGoesTo: string[] | undefined;
	for (const token of tokens) {
		if (valueGoesTo !== undefined) {
			valueGoesTo.push(token);
			valueGoesTo = undefined;
			continue;
		}
		if (isHelp(token)) {
			helpAsked = true;
			continue;
		}
		const operand = command.operands[operandValues.size];
		if (operand !== undefined) {
			operandValues.set(operand, token);
			continue;
		}
		const flag = command.flags.find(({ name }) => name === token);
		if (flag === undefined) unknownFlag = true;
		// An unknown flag still takes the next token as its value.
		valueGoesTo = flag === undefined ? [] : (flagValues.get(flag) ?? []);
	}
	if (helpAsked) return "help";
	if (unknownFlag || valueGoesTo !== undefined) return undefined;
	if (operandValues.size < command.operands.length) return undefined;
	const digits = (value: string) => /^\d+$/.test(value);
	for (const operand of command.operands) {
		if (operand.digits && !digits(operandValues.get(operand) ?? "")) {
			return undefined;
		}
	}
	for (const flag of command.flags) {
		const values = flagValues.get(flag) ?? [];
		if (flag.times === "once" && values.length !== 1) return undefined;
		if (flag.times === "at most once" && values.length > 1) return undefined;
		if (flag.digits && !values.every(digits)) return undefined;
	}
	const declared = (value: string | undefined, name: string): string => {
		if (value === undefined) {
			throw new Error(
				`cli.ts reads ${name}, which \`vago ${command.name}\` doesn't take`,
			);
		}
		return value;
	};
	return {
		operand: (operand) => declared(operandValues.get(operand), operand.name),
		requiredFlag: (flag) => declared(flagValues.get(flag)?.[0], flag.name),
		optionalFlag: (flag) => flagValues.get(flag)?.[0],
		repeatedFlag: (flag) => flagValues.get(flag) ?? [],
	};
}

function usage(command: Command): string {
	return `usage: ${commandLine(command)}`;
}

// The command as typed, such as
// `vago goal new <goal> --workflow <name> [--body-file <path>]`.
function commandLine(command: Command): string {
	const parts = [`vago ${command.name}`];
	for (const operand of command.operands) parts.push(operand.name);
	for (const flag of command.flags) {
		const spelled = `${flag.name} ${flag.value}`;
		if (flag.times === "once") parts.push(spelled);
		if (flag.times === "at most once") parts.push(`[${spelled}]`);
		if (flag.times === "any number of times") parts.push(`[${spelled}]...`);
	}
	return parts.join(" ");
}

// One usage line per command, the later ones lined up under the first.
function usages(listed: Command[]): string {
	return listed
		.map(
			(command, index) =>
				`${index === 0 ? "usage: " : " ".repeat("usage: ".length)}${commandLine(command)}`,
		)
		.join("\n");
}

// What `vago --help` prints, or for `vago goal --help` the same for the
// commands whose name starts with `goal`, headed by their usage lines instead
// of the generic one. Undefined when no command's name starts with `words`.
function listing(words: string[]): string | undefined {
	const listed = commandsStartingWith(words);
	if (listed.length === 0) return undefined;
	const header =
		words.length === 0 ? "usage: vago <command> [arguments]" : usages(listed);
	const width = Math.max(...listed.map(({ name }) => name.length)) + 2;
	const rows = listed.map(
		({ name, summary }) => `  ${name.padEnd(width)}${summary}`,
	);
	return `${header}

vago takes a Goal's Tickets through the Workflow the Goal names, with a coding
agent doing each agent Step.

commands:
${rows.join("\n")}

Run \`vago <command> --help\` for a command's arguments, flags and an example.`;
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
// working directory, the directory `vago` was started in. No path, no body.
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
	console.error(`vago: ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
