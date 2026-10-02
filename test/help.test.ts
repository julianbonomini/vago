import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { goalText, makeProject, readTicketFile, runPunt } from "./project.ts";

const workflow = `
[[steps]]
id   = "build"
type = "shell"
run  = "true"
`;

const commands = [
	"init",
	"run",
	"goal new",
	"goal report",
	"ticket add",
	"ticket reset",
];

for (const args of [["--help"], ["-h"], ["help"]]) {
	test(`punt ${args[0]} lists every command and how to get help for one`, async () => {
		const root = await makeProject({});

		const result = await runPunt(root, args);

		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		for (const command of commands) {
			expect(result.stdout).toMatch(new RegExp(`^  ${command}  +\\S`, "m"));
		}
		expect(result.stdout).toContain("punt <command> --help");
	});
}

test("goal new --help explains its arguments, flags and gives an example", async () => {
	const root = await makeProject({});

	const result = await runPunt(root, ["goal", "new", "--help"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	expect(result.stdout).toStartWith(
		"usage: punt goal new <goal> --workflow <name> [--body-file <path>]\n",
	);
	expect(result.stdout).toMatch(/^ {2}<goal> +\S/m);
	expect(result.stdout).toMatch(/^ {2}--workflow <name> +\S/m);
	expect(result.stdout).toMatch(/^ {2}--body-file <path> +\S/m);
	expect(result.stdout).toMatch(/^example:\n {2}punt goal new /m);
});

test("ticket add --help names --blocked-by and --body-file", async () => {
	const root = await makeProject({});

	const result = await runPunt(root, ["ticket", "add", "--help"]);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toStartWith(
		"usage: punt ticket add <goal> <slug> [--blocked-by <NN>]... [--body-file <path>]\n",
	);
	expect(result.stdout).toMatch(/^ {2}--blocked-by <NN> +\S/m);
	expect(result.stdout).toMatch(/^ {2}--body-file <path> +\S/m);
});

test("punt help <command> prints what <command> --help prints", async () => {
	const root = await makeProject({});

	const viaHelp = await runPunt(root, ["help", "ticket", "reset"]);
	const viaFlag = await runPunt(root, ["ticket", "reset", "--help"]);

	expect(viaHelp.exitCode).toBe(0);
	expect(viaHelp.stdout).toStartWith("usage: punt ticket reset <goal> <NN>\n");
	expect(viaHelp.stdout).toBe(viaFlag.stdout);
});

test("--help among a command's arguments writes no file", async () => {
	const root = await makeProject({ ".punt/workflows/test.toml": workflow });

	const created = await runPunt(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"test",
		"--help",
	]);
	const initialised = await runPunt(root, ["init", "--help"]);

	expect(created.exitCode).toBe(0);
	expect(created.stdout).toStartWith("usage: punt goal new ");
	expect(existsSync(join(root, ".punt/goals"))).toBe(false);
	expect(initialised.exitCode).toBe(0);
	expect(initialised.stdout).toStartWith("usage: punt init\n");
	expect(existsSync(join(root, ".punt/workflows/small.toml"))).toBe(false);
});

test("run --help runs no Ticket", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		".punt/goals/hello/goal.md": goalText("test"),
	});
	await runPunt(root, ["ticket", "add", "hello", "wave"]);

	const result = await runPunt(root, ["run", "hello", "--help"]);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toStartWith("usage: punt run <goal>\n");
	const wave = await readTicketFile(
		root,
		".punt/goals/hello/tickets/01-wave.md",
	);
	expect(wave.header.status).toBe("ready");
});

for (const args of [[], ["nope"], ["help", "nope"], ["nope", "--help"]]) {
	test(`${["punt", ...args].join(" ")} prints the usage and points at punt --help`, async () => {
		const root = await makeProject({});

		const result = await runPunt(root, args);

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toStartWith("usage: punt init\n");
		expect(result.stderr).toContain("punt goal new <goal>");
		expect(result.stderr).toEndWith(
			"Run `punt --help` for what each command does.\n",
		);
	});
}

test("wrong arguments print the command's usage and point at its --help", async () => {
	const root = await makeProject({});

	const result = await runPunt(root, ["ticket", "reset", "hello", "x"]);

	expect(result.exitCode).toBe(1);
	expect(result.stderr).toBe(
		"usage: punt ticket reset <goal> <NN>\nRun `punt ticket reset --help` for what it does and what each argument means.\n",
	);
});

// Help and parsing come from one table in cli.ts. This pins it from outside:
// every command `punt --help` lists answers `--help`, and every flag its help
// names gets past argument parsing.
test("every listed command has help, and takes every flag its help names", async () => {
	const root = await makeProject({});
	const listing = (await runPunt(root, ["--help"])).stdout;
	const listed = commands.filter((command) =>
		new RegExp(`^  ${command}  `, "m").test(listing),
	);
	expect(listed).toEqual(commands);

	for (const command of listed) {
		const words = command.split(" ");
		const help = await runPunt(root, [...words, "--help"]);
		expect(help.exitCode).toBe(0);
		const usage = help.stdout.split("\n")[0] ?? "";
		expect(usage).toStartWith(`usage: punt ${command}`);

		// The usage with its optional parts dropped and every placeholder a
		// value, which reads as a Goal name, a slug and a Ticket number alike.
		const required = usage
			.slice(`usage: punt ${command}`.length)
			.replace(/\[[^\]]*\](\.\.\.)?/g, "")
			.split(" ")
			.filter((word) => word !== "")
			.map((word) => (word.startsWith("<") ? "1" : word));
		const flags = [...help.stdout.matchAll(/^ {2}(--[a-z-]+) /gm)].map(
			(match) => match[1] ?? "",
		);
		for (const flag of flags) {
			const extra = required.includes(flag) ? [] : [flag, "1"];
			const result = await runPunt(root, [...words, ...required, ...extra]);
			expect(result.stderr).not.toContain("usage:");
		}
	}
});
