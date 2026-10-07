import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { goalText, makeProject, readTicketFile, runVago } from "./project.ts";

const workflow = `
[[steps]]
id   = "build"
type = "shell"
run  = "true"
`;

const commands = [
	"init",
	"update",
	"run",
	"goal new",
	"goal report",
	"plan accept",
	"ticket add",
	"ticket reset",
];

for (const args of [["--help"], ["-h"], ["help"]]) {
	test(`vago ${args[0]} lists every command and how to get help for one`, async () => {
		const root = await makeProject({});

		const result = await runVago(root, args);

		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		for (const command of commands) {
			expect(result.stdout).toMatch(new RegExp(`^  ${command}  +\\S`, "m"));
		}
		expect(result.stdout).toContain("vago <command> --help");
	});
}

test("goal new --help explains its arguments, flags and gives an example", async () => {
	const root = await makeProject({});

	const result = await runVago(root, ["goal", "new", "--help"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toStartWith(
		"usage: vago goal new <goal> --workflow <name> [--body-file <path>]\n",
	);
	expect(result.stdout).toMatch(/^ {2}<goal> +\S/m);
	expect(result.stdout).toMatch(/^ {2}--workflow <name> +\S/m);
	expect(result.stdout).toMatch(/^ {2}--body-file <path> +\S/m);
	expect(result.stdout).toMatch(/^example:\n {2}vago goal new /m);
});

test("ticket add --help names --blocked-by, --workflow and --body-file", async () => {
	const root = await makeProject({});

	const result = await runVago(root, ["ticket", "add", "--help"]);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toStartWith(
		"usage: vago ticket add <goal> <slug> [--blocked-by <NN>]... [--workflow <name>] [--body-file <path>]\n",
	);
	expect(result.stdout).toMatch(/^ {2}--blocked-by <NN> +\S/m);
	expect(result.stdout).toMatch(/^ {2}--workflow <name> +\S/m);
	expect(result.stdout).toMatch(/^ {2}--body-file <path> +\S/m);
});

test("vago help <command> prints what <command> --help prints", async () => {
	const root = await makeProject({});

	const viaHelp = await runVago(root, ["help", "ticket", "reset"]);
	const viaFlag = await runVago(root, ["ticket", "reset", "--help"]);

	expect(viaHelp.exitCode).toBe(0);
	expect(viaHelp.stdout).toStartWith("usage: vago ticket reset <goal> <NN>\n");
	expect(viaHelp.stdout).toBe(viaFlag.stdout);
});

test("vago ticket reset --help says the Ticket starts over from its first Step", async () => {
	const root = await makeProject({});

	const result = await runVago(root, ["ticket", "reset", "--help"]);
	const summary = await runVago(root, ["help"]);

	expect(summary.stdout).toContain(
		"ticket reset   Make a stuck Ticket start over from its first Step\n",
	);
	expect(result.stdout.replace(/\s+/g, " ")).toContain(
		"the next vago run starts it over from its first Step, instead of picking it up at the Step it stopped on",
	);
});

test("--help among a command's arguments writes no file", async () => {
	const root = await makeProject({ ".vago/workflows/test.toml": workflow });

	const created = await runVago(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
		"--help",
	]);
	const initialised = await runVago(root, ["init", "--help"]);

	expect(created.exitCode).toBe(0);
	expect(created.stdout).toStartWith("usage: vago goal new ");
	expect(existsSync(join(root, ".vago-goals"))).toBe(false);
	expect(initialised.exitCode).toBe(0);
	expect(initialised.stdout).toStartWith("usage: vago init\n");
	expect(existsSync(join(root, ".vago/workflows/small.toml"))).toBe(false);
});

test("run --help runs no Ticket", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": workflow,
		".vago-goals/hello/goal.md": goalText("test"),
	});
	await runVago(root, ["ticket", "add", "hello", "wave"]);

	const result = await runVago(root, ["run", "hello", "--help"]);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toStartWith("usage: vago run <goal>\n");
	const wave = await readTicketFile(
		root,
		".vago-goals/hello/tickets/01-wave.md",
	);
	expect(wave.header.status).toBe("ready");
});

for (const args of [[], ["nope"], ["help", "nope"], ["nope", "--help"]]) {
	test(`${["vago", ...args].join(" ")} prints the usage and points at vago --help`, async () => {
		const root = await makeProject({});

		const result = await runVago(root, args);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toStartWith("usage: vago init\n");
		expect(result.stderr).toContain("vago goal new <goal>");
		expect(result.stderr).toEndWith(
			"Run `vago --help` for what each command does.\n",
		);
	});
}

test("a command's words given as one argument name no command", async () => {
	const root = await makeProject({});

	const result = await runVago(root, ["goal report", "x"]);

	expect(result.exitCode).toBe(1);
	expect(result.stdout).toBe("");
	expect(result.stderr).toStartWith("usage: vago init\n");
	expect(result.stderr).toEndWith(
		"Run `vago --help` for what each command does.\n",
	);
});

test("wrong arguments print the command's usage and point at its --help", async () => {
	const root = await makeProject({});

	const result = await runVago(root, ["ticket", "reset", "hello", "x"]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toBe(
		"usage: vago ticket reset <goal> <NN>\nRun `vago ticket reset --help` for what it does and what each argument means.\n",
	);
});

// Help and parsing come from one table in cli.ts. This pins it from outside:
// every command `vago --help` lists answers `--help`, and every flag its help
// names gets past argument parsing.
test("every listed command has help, and takes every flag its help names", async () => {
	const root = await makeProject({});
	const listing = (await runVago(root, ["--help"])).stdout;
	const listed = commands.filter((command) =>
		new RegExp(`^  ${command}  `, "m").test(listing),
	);
	expect(listed).toEqual(commands);

	for (const command of listed) {
		const words = command.split(" ");
		const help = await runVago(root, [...words, "--help"]);
		expect(help.exitCode).toBe(0);
		const usage = help.stdout.split("\n")[0] ?? "";
		expect(usage).toStartWith(`usage: vago ${command}`);

		// The usage with its optional parts dropped and every placeholder a
		// value, which reads as a Goal name, a slug and a Ticket number alike.
		const required = usage
			.slice(`usage: vago ${command}`.length)
			.replace(/\[[^\]]*\](\.\.\.)?/g, "")
			.split(" ")
			.filter((word) => word !== "")
			.map((word) => (word.startsWith("<") ? "1" : word));
		const flags = [...help.stdout.matchAll(/^ {2}(--[a-z-]+) /gm)].map(
			(match) => match[1] ?? "",
		);
		for (const flag of flags) {
			const extra = required.includes(flag) ? [] : [flag, "1"];
			const result = await runVago(root, [...words, ...required, ...extra]);
			expect(result.stderr).not.toContain("usage:");
		}
	}
});

test("goal new --workflow -h takes -h as the Workflow's name", async () => {
	const root = await makeProject({ ".vago/workflows/-h.toml": workflow });

	const result = await runVago(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"-h",
	]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect(
		await Bun.file(join(root, ".vago-goals/hello/goal.md")).text(),
	).toStartWith('+++\nworkflow = "-h"\n');
});

test("--blocked-by --help is a value that isn't digits, not a call for help", async () => {
	const root = await makeProject({
		".vago/workflows/test.toml": workflow,
		".vago-goals/hello/goal.md": goalText("test"),
	});

	const result = await runVago(root, [
		"ticket",
		"add",
		"hello",
		"greet",
		"--blocked-by",
		"--help",
	]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toBe(
		"usage: vago ticket add <goal> <slug> [--blocked-by <NN>]... [--workflow <name>] [--body-file <path>]\nRun `vago ticket add --help` for what it does and what each argument means.\n",
	);
	expect(existsSync(join(root, ".vago-goals/hello/tickets/01-greet.md"))).toBe(
		false,
	);
});

test("--help where an operand or a flag name goes prints the command's help", async () => {
	const root = await makeProject({ ".vago/workflows/test.toml": workflow });

	const created = await runVago(root, [
		"goal",
		"new",
		"hello",
		"--help",
		"--workflow",
		"test",
	]);
	const reset = await runVago(root, [
		"ticket",
		"reset",
		"--help",
		"hello",
		"1",
	]);

	expect(created.exitCode).toBe(0);
	expect(created.stdout).toStartWith("usage: vago goal new ");
	expect(existsSync(join(root, ".vago-goals"))).toBe(false);
	expect(reset.exitCode).toBe(0);
	expect(reset.stdout).toStartWith("usage: vago ticket reset <goal> <NN>\n");
});

for (const [group, members, other] of [
	["goal", ["goal new", "goal report"], "ticket"],
	["ticket", ["ticket add", "ticket reset"], "goal"],
] as const) {
	test(`vago ${group} --help gives the usage of the ${group} commands and lists only them`, async () => {
		const root = await makeProject({});
		const usages = {
			goal: "usage: vago goal new <goal> --workflow <name> [--body-file <path>]\n       vago goal report <goal>\n",
			ticket:
				"usage: vago ticket add <goal> <slug> [--blocked-by <NN>]... [--workflow <name>] [--body-file <path>]\n       vago ticket reset <goal> <NN>\n",
		};

		const result = await runVago(root, [
			group,
			group === "goal" ? "--help" : "-h",
		]);

		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toStartWith(
			`${usages[group]}\nvago takes a Goal's Tickets through the Workflow`,
		);
		for (const member of members) {
			expect(result.stdout).toMatch(new RegExp(`^  ${member}  +\\S`, "m"));
		}
		expect(result.stdout).not.toMatch(new RegExp(`^  ${other} `, "m"));
		expect(result.stdout).not.toContain("usage: vago <command> [arguments]");
	});
}

for (const args of [["--help"], ["-h"], ["help"]]) {
	test(`vago ${args[0]} starts with the generic usage`, async () => {
		const root = await makeProject({});

		const result = await runVago(root, args);

		expect(result.stdout).toStartWith("usage: vago <command> [arguments]\n\n");
	});
}

test("vago nope prints every command's usage, lined up, then points at --help", async () => {
	const root = await makeProject({});

	const result = await runVago(root, ["nope"]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toBe(`usage: vago init
       vago update
       vago run <goal>
       vago goal new <goal> --workflow <name> [--body-file <path>]
       vago goal report <goal>
       vago plan new <name>
       vago plan rename <name> <new-name>
       vago plan say <name> --body-file <path>
       vago plan retry <name>
       vago plan workflow <name> <workflow>
       vago plan accept <name>
       vago plan discard <name>
       vago ticket add <goal> <slug> [--blocked-by <NN>]... [--workflow <name>] [--body-file <path>]
       vago ticket reset <goal> <NN>
Run \`vago --help\` for what each command does.
`);
});
