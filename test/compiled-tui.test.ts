// The compiled `vago`, built by the same script as `bun run reinstall`, run
// in a pseudo-terminal: the TUI draws, moves and gives the terminal back.

import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	type FakeInteractiveHarness,
	makeFakeInteractiveClaude,
} from "./fake-harness.ts";
import {
	goalText,
	heldLock,
	makeProject,
	oneStep,
	projectWithGoals,
	ticketText,
	vagoHome,
} from "./project.ts";
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

// The compiled `vago`, started with no command in an 80×24 terminal in
// folder `cwd`, with `env` added to its environment.
type TerminalVago = {
	screen: TerminalScreen;
	press(keys: string): void;
	kill(signal: NodeJS.Signals): void;
	/** Closes the pseudo-terminal, as closing the human's terminal window does. */
	closeTerminal(): void;
	exited: Promise<number>;
};

function openVago(cwd: string, env: Record<string, string> = {}): TerminalVago {
	const screen = terminalScreen(24, 80);
	const child = Bun.spawn([vago], {
		cwd,
		env: {
			...process.env,
			VAGO_HOME: vagoHome,
			TERM: "xterm-256color",
			// Without it OpenTUI asks a 256-colour terminal for its palette, and
			// this pseudo-terminal never answers, so it repaints once it gives up.
			COLORTERM: "truecolor",
			...env,
		},
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
		closeTerminal: () => child.terminal?.close(),
		exited: child.exited.finally(() => clearTimeout(timer)),
	};
}

const rowOf = (lines: string[], text: string) =>
	lines.findIndex((line) => line.includes(text));

// The row of the Goals box's title with the selected Goal's `position` on its
// right, like `2/3`.
const goalsAt = (lines: string[], position: string) =>
	lines.findIndex(
		(line) => line.startsWith("  Goals ") && line.endsWith(` ${position}`),
	);

test("↓ moves the selection and no row shifts", async () => {
	const tui = openVago(await projectWithGoals(["alpha", "beta", "gamma"]));
	const first = await tui.screen.frameWhere(
		(lines) =>
			["alpha", "beta", "gamma"].every((text) => rowOf(lines, text) !== -1) &&
			goalsAt(lines, "1/3") !== -1,
	);

	tui.press("\x1b[B");
	const second = await tui.screen.frameWhere(
		(lines) => lines.join("\n") !== first.join("\n"),
	);

	expect(goalsAt(second, "2/3")).not.toBe(-1);
	for (const name of ["alpha", "beta", "gamma"]) {
		expect(rowOf(second, name)).toBe(rowOf(first, name));
	}
	expect(tui.screen.scrolls()).toBe(0);
	tui.kill("SIGKILL");
});

// Opens `vago` on a Project of three Goals and waits for its first frame.
async function openOnGoals(): Promise<TerminalVago> {
	const tui = openVago(await projectWithGoals(["alpha", "beta", "gamma"]));
	await tui.screen.frameWhere((lines) => goalsAt(lines, "1/3") !== -1);
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

test("q types in a name's field, and quits again once the field closes", async () => {
	const tui = await openOnGoals();

	tui.press("n");
	await tui.screen.frameWhere((lines) => rowOf(lines, "New Goal name:") !== -1);
	tui.press("quick");
	await tui.screen.frameWhere(
		(lines) => rowOf(lines, "New Goal name: quick") !== -1,
	);
	tui.press("\x1b");
	await tui.screen.frameWhere((lines) => rowOf(lines, "New Goal name:") === -1);
	tui.press("q");

	expect(await tui.exited).toBe(0);
});

test("Ctrl-C quits and gives the terminal back", async () => {
	const tui = await openOnGoals();
	const drawn = tui.screen.printed().length;

	tui.press("\x03");

	expect(await tui.exited).toBe(0);
	expect(restoresTerminal(tui.screen.printed(), drawn)).toBe(true);
});

// Opens `vago` on a Project whose one planning item, `search`, plans with
// `fake`, and waits for the item's session to start.
async function openOnSession(
	fake: FakeInteractiveHarness,
): Promise<TerminalVago> {
	const root = await makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago-goals/search/planning/chat.toml": 'harness = "claude-code"\n',
	});
	const tui = openVago(root, fake.env);
	await tui.screen.frameWhere((lines) => goalsAt(lines, "1/1") !== -1);
	tui.press("\r");
	await tui.screen.frameWhere(
		(lines) => rowOf(lines, "fake claude fresh") !== -1,
	);
	return tui;
}

test("q and Ctrl-C type into a planning item's session, and q quits from the Preview", async () => {
	const fake = await makeFakeInteractiveClaude();
	const tui = await openOnSession(fake);

	tui.press("q");
	await tui.screen.frameWhere((lines) => rowOf(lines, "key q") !== -1);
	tui.press("\x03");
	await tui.screen.frameWhere((lines) => rowOf(lines, "key ctrl+c") !== -1);
	tui.press("\x1d");
	await tui.screen.frameWhere((lines) => rowOf(lines, "q Quit") !== -1);
	tui.press("q");

	expect(await tui.exited).toBe(0);
	await fake.allEnded();
});

test("SIGTERM ends vago and its planning session", async () => {
	const fake = await makeFakeInteractiveClaude();
	const tui = await openOnSession(fake);

	tui.kill("SIGTERM");

	expect(await tui.exited).toBe(0);
	await fake.allEnded();
});

test("closing the terminal ends the planning session", async () => {
	const fake = await makeFakeInteractiveClaude();
	const tui = await openOnSession(fake);

	tui.closeTerminal();

	await tui.exited;
	await fake.allEnded();
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

test("a Ticket changed on disk shows in the next frame, redrawing only its row", async () => {
	const root = await projectWithGoals(["alpha", "beta", "gamma"]);
	const ticket = join(root, ".vago-goals/gamma/tickets/01-first.md");
	await Bun.write(ticket, ticketText("ready"));
	const tui = openVago(root);
	const first = await tui.screen.frameWhere(
		(lines) => goalsAt(lines, "1/3") !== -1 && rowOf(lines, "gamma") !== -1,
	);
	const noted = tui.screen.printed().length;

	await Bun.write(ticket, ticketText("done"));
	const second = await tui.screen.frameWhere((lines) =>
		(lines[rowOf(lines, "gamma")] ?? "").includes("1/1"),
	);

	for (const name of ["alpha", "beta", "gamma"]) {
		expect(rowOf(second, name)).toBe(rowOf(first, name));
	}
	expect(tui.screen.scrolls()).toBe(0);
	const redrawn = tui.screen.printed().slice(noted);
	expect(redrawn).not.toContain("alpha");
	expect(redrawn).not.toContain("beta");
	tui.kill("SIGKILL");
});

test("with nothing changing vago writes nothing, and a key lands at once", async () => {
	const tui = await openOnGoals();
	const drawn = tui.screen.printed().length;

	await Bun.sleep(2500);
	expect(tui.screen.printed().length).toBe(drawn);

	tui.press("\x1b[B");
	// The quiet window of `frameWhere` and less than a quarter of a re-read.
	await tui.screen.frameWhere((lines) => goalsAt(lines, "2/3") !== -1, 200);
	tui.kill("SIGKILL");
});

test("under NO_COLOR vago prints no RGB colour, scrollbar and keys included", async () => {
	const names = Array.from({ length: 20 }, (_, index) => `goal-${index}`);
	const tui = openVago(await projectWithGoals(names), { NO_COLOR: "1" });
	await tui.screen.frameWhere((lines) => goalsAt(lines, "1/20") !== -1);

	tui.press("G");
	await tui.screen.frameWhere((lines) => goalsAt(lines, "20/20") !== -1);
	tui.press("?");
	await tui.screen.frameWhere((lines) => rowOf(lines, " Keys ") !== -1);

	expect(tui.screen.printed()).not.toMatch(/\[[\d;]*[34]8;2;/);
	tui.kill("SIGKILL");
});

test("vago started in a Goal's worktree shows the main checkout's Goals", async () => {
	const root = await projectWithGoals(["alpha", "beta"]);
	const worktree = join(vagoHome, "worktrees", `${basename(root)}-alpha`);
	Bun.spawnSync(
		["git", "worktree", "add", "--quiet", worktree, "-b", "alpha"],
		{
			cwd: root,
		},
	);

	const tui = openVago(worktree);

	const frame = await tui.screen.frameWhere(
		(lines) => goalsAt(lines, "1/2") !== -1,
	);
	expect(rowOf(frame, " alpha ")).not.toBe(-1);
	expect(rowOf(frame, " beta ")).not.toBe(-1);
	tui.kill("SIGKILL");
});

// A Project whose one Goal, `live`, has its only Ticket on an open `check`
// Run that has logged one line, and that Run's log.
async function goalOnOpenRun(): Promise<{ root: string; log: string }> {
	const root = await makeProject({
		".vago-goals/live/goal.md": goalText("w"),
		".vago-goals/live/tickets/01-only.md": ticketText("running", {
			runs: [{ step: "check", started: new Date() }],
		}),
		".vago-goals/live/logs/check-1.log": "first line\n",
	});
	return { root, log: join(root, ".vago-goals/live/logs/check-1.log") };
}

test("an open Goal shows what its open Run's log adds in the next frame", async () => {
	const { root, log } = await goalOnOpenRun();
	await heldLock(root, "live");
	const tui = openVago(root);
	await tui.screen.frameWhere((lines) => goalsAt(lines, "1/1") !== -1);
	tui.press("\r");
	await tui.screen.frameWhere((lines) => rowOf(lines, "  first line") !== -1);

	await Bun.write(log, "first line\nsecond line\n");

	await tui.screen.frameWhere((lines) => rowOf(lines, "  second line") !== -1);
	expect(tui.screen.scrolls()).toBe(0);
	tui.kill("SIGKILL");
});

test("with nothing changing the Goal view writes nothing", async () => {
	// No `vago run` holds the Goal, so its open Run is lost and no clock runs.
	const { root } = await goalOnOpenRun();
	const tui = openVago(root);
	await tui.screen.frameWhere((lines) => goalsAt(lines, "1/1") !== -1);
	tui.press("\r");
	await tui.screen.frameWhere((lines) => rowOf(lines, "  first line") !== -1);
	const drawn = tui.screen.printed().length;

	await Bun.sleep(2500);

	expect(tui.screen.printed().length).toBe(drawn);
	tui.kill("SIGKILL");
});

test("a Goal started with s keeps running after q, and its output stays off the screen", async () => {
	const root = await makeProject({
		".vago/workflows/w.toml": oneStep("sleep 2"),
		".vago-goals/a/goal.md": goalText("w"),
		".vago-goals/a/tickets/01-t.md": ticketText("ready"),
	});
	const tui = openVago(root);
	await tui.screen.frameWhere((lines) => goalsAt(lines, "1/1") !== -1);

	tui.press("s");
	await tui.screen.frameWhere((lines) => rowOf(lines, "01 work") !== -1);
	tui.press("q");

	expect(await tui.exited).toBe(0);
	const ticket = join(root, ".vago-goals/a/tickets/01-t.md");
	for (
		let tries = 0;
		!(await Bun.file(ticket).text()).includes('"done"');
		tries++
	) {
		if (tries === 100) throw new Error("The started Goal never finished");
		await Bun.sleep(100);
	}
	// The first line `vago run` prints.
	expect(tui.screen.printed()).not.toContain("Worktree ");
});
