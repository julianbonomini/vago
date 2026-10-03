// The compiled `vago`, built by the same script as `bun run reinstall`, run
// in a pseudo-terminal: the TUI draws, moves and gives the terminal back.

import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeProject, oneStep, projectWithGoals, vagoHome } from "./project.ts";
import { type TerminalScreen, terminalScreen } from "./terminal-screen.ts";

setDefaultTimeout(120_000);

const repo = join(import.meta.dir, "..");
let vago = "";

beforeAll(async () => {
	vago = join(await mkdtemp(join(tmpdir(), "vago-build-")), "vago");
	const build = Bun.spawnSync([process.execPath, "build.ts", vago], {
		cwd: repo,
	});
	if (build.exitCode !== 0) {
		throw new Error(`build.ts failed:\n${build.stderr.toString()}`);
	}
});

// The compiled `vago`, started with no command in an 80×24 terminal on the
// Project at `root`.
type TerminalVago = {
	screen: TerminalScreen;
	press(keys: string): void;
	kill(signal: NodeJS.Signals): void;
	exited: Promise<number>;
};

function openVago(root: string): TerminalVago {
	const screen = terminalScreen(24, 80);
	const child = Bun.spawn([vago], {
		cwd: root,
		env: { ...process.env, VAGO_HOME: vagoHome, TERM: "xterm-256color" },
		terminal: {
			cols: 80,
			rows: 24,
			data: (_terminal, bytes) => screen.write(bytes),
		},
	});
	// A `vago` that doesn't quit fails its test fast, with exit code 137.
	const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
	return {
		screen,
		press: (keys) => child.terminal?.write(keys),
		kill: (signal) => child.kill(signal),
		exited: child.exited.finally(() => clearTimeout(timer)),
	};
}

const rowOf = (lines: string[], text: string) =>
	lines.findIndex((line) => line.includes(text));

test("↓ moves the selection and no row shifts", async () => {
	const tui = openVago(await projectWithGoals(["alpha", "beta", "gamma"]));
	const first = await tui.screen.frameWhere((lines) =>
		["alpha", "beta", "gamma", " 1/3 "].every(
			(text) => rowOf(lines, text) !== -1,
		),
	);

	tui.press("\x1b[B");
	const second = await tui.screen.frameWhere(
		(lines) => lines.join("\n") !== first.join("\n"),
	);

	expect(rowOf(second, " 2/3 ")).not.toBe(-1);
	for (const name of ["alpha", "beta", "gamma"]) {
		expect(rowOf(second, name)).toBe(rowOf(first, name));
	}
	expect(tui.screen.scrolls()).toBe(0);
	tui.kill("SIGKILL");
});

// Opens `vago` on a Project of three Goals and waits for its first frame.
async function openOnGoals(): Promise<TerminalVago> {
	const tui = openVago(await projectWithGoals(["alpha", "beta", "gamma"]));
	await tui.screen.frameWhere((lines) => rowOf(lines, " 1/3 ") !== -1);
	return tui;
}

// Whether `printed`, from `from` on, leaves the alternate screen and shows
// the cursor.
function restoresTerminal(printed: string, from: number): boolean {
	const after = printed.slice(from);
	return after.includes("\x1b[?1049l") && after.includes("\x1b[?25h");
}

test("q quits and gives the terminal back", async () => {
	const tui = await openOnGoals();
	const drawn = tui.screen.printed().length;

	tui.press("q");

	expect(await tui.exited).toBe(0);
	expect(restoresTerminal(tui.screen.printed(), drawn)).toBe(true);
});

test("Ctrl-C quits and gives the terminal back", async () => {
	const tui = await openOnGoals();
	const drawn = tui.screen.printed().length;

	tui.press("\x03");

	expect(await tui.exited).toBe(0);
	expect(restoresTerminal(tui.screen.printed(), drawn)).toBe(true);
});

test("SIGTERM ends vago and gives the terminal back", async () => {
	const tui = await openOnGoals();
	const drawn = tui.screen.printed().length;

	tui.kill("SIGTERM");

	expect(await tui.exited).toBe(0);
	expect(restoresTerminal(tui.screen.printed(), drawn)).toBe(true);
});

test("a crash gives the terminal back, then reports the error", async () => {
	const root = await makeProject({ ".vago-goals": "not a folder" });
	const tui = openVago(root);

	expect(await tui.exited).toBe(1);
	const printed = tui.screen.printed();
	const left = printed.lastIndexOf("\x1b[?1049l");
	expect(restoresTerminal(printed, 0)).toBe(true);
	expect(left).toBeGreaterThan(-1);
	const report = printed.slice(left);
	expect(report).toContain("vago: ");
	expect(report).toContain(".vago-goals");
});

test("the compiled vago still runs every command", async () => {
	const root = await makeProject({ ".vago/workflows/w.toml": oneStep("true") });
	const run = (args: string[]) =>
		Bun.spawnSync([vago, ...args], {
			cwd: root,
			env: { ...process.env, VAGO_HOME: vagoHome },
		});

	const help = run(["--help"]);
	expect(help.exitCode).toBe(0);
	expect(help.stdout.toString()).toMatch(/^ {2}goal new +\S/m);

	const goal = run(["goal", "new", "x", "--workflow", "w"]);
	expect(goal.stderr.toString()).toBe("");
	expect(goal.exitCode).toBe(0);
	expect(await Bun.file(join(root, ".vago-goals/x/goal.md")).exists()).toBe(
		true,
	);
});
