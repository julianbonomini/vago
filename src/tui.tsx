// The TUI that a bare `vago` opens on a terminal: the Project view, and how
// the terminal is held while it is open and given back on every way out. It
// is read-only (ADR 0005) and drawn with OpenTUI and Solid (ADR 0006). Only
// `cli.ts` imports this file, and only lazily, so no command loads OpenTUI.

import { format } from "node:util";
import { createCliRenderer } from "@opentui/core";
import { type JSX, render, useKeyboard } from "@opentui/solid";
import { createResource, createSignal, ErrorBoundary, For } from "solid-js";
import { listGoals } from "./tickets/tickets.ts";

const bg = "#0c0c0c";
const fg = "#d6d6d6";
const border = "#2e2e2e";
const accent = "#ff8a3d";

/**
 * Shows the Project at `root` full-screen until the human quits with `q` or
 * Ctrl-C, or a signal ends it. Always leaves the terminal as it found it:
 * out of the alternate screen, cursor shown, raw mode off. Holds what is
 * written to stderr and `console` meanwhile and prints it afterwards. Throws,
 * after restoring the terminal, any error the view hit. Needs stdin and
 * stdout to be terminals.
 */
export async function openTui(root: string): Promise<void> {
	return holdTerminal(() => <ProjectView root={root} />);
}

const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
const endSignals = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

// Draws `view` on the alternate screen until a quit key, a signal or an error
// ends it, and gives the terminal back the same way each time. Knows nothing
// of Vago. Never calls `process.exit`, so the caller picks the exit code.
async function holdTerminal(view: () => JSX.Element): Promise<void> {
	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		exitSignals: [],
		screenMode: "alternate-screen",
		consoleMode: "disabled",
		backgroundColor: bg,
	});
	// Past ten listeners Node prints a leak warning to stderr, which would
	// scroll the alternate screen and shift every later frame.
	renderer.setMaxListeners(200);

	// Anything printed now would land on the screen, so it waits until the
	// terminal is given back.
	const held: string[] = [];
	const decoder = new TextDecoder();
	const consoleWas = consoleMethods.map(
		(name) => [name, console[name]] as const,
	);
	for (const name of consoleMethods) {
		console[name] = (...args: unknown[]) => {
			held.push(`${format(...args)}\n`);
		};
	}
	const stderrWrite = process.stderr.write;
	process.stderr.write = (chunk: string | Uint8Array) => {
		held.push(typeof chunk === "string" ? chunk : decoder.decode(chunk));
		return true;
	};

	return new Promise((resolve, reject) => {
		let restored = false;
		// True the first time only, so a second way out changes nothing.
		const restore = (): boolean => {
			if (restored) return false;
			restored = true;
			renderer.destroy();
			for (const signal of endSignals) process.off(signal, quit);
			process.off("uncaughtException", fail);
			process.off("unhandledRejection", fail);
			for (const [name, method] of consoleWas) console[name] = method;
			process.stderr.write = stderrWrite;
			process.stderr.write(held.join(""));
			return true;
		};
		const quit = () => {
			if (restore()) resolve();
		};
		const fail = (error: unknown) => {
			if (restore()) reject(error);
		};
		for (const signal of endSignals) process.on(signal, quit);
		process.on("uncaughtException", fail);
		process.on("unhandledRejection", fail);

		render(
			() => (
				<ErrorBoundary
					fallback={(error: unknown) => {
						fail(error);
						return null;
					}}
				>
					<QuitKeys onQuit={quit}>{view()}</QuitKeys>
				</ErrorBoundary>
			),
			renderer,
		).catch(fail);
	});
}

// A component because `useKeyboard` only works inside the rendered tree.
function QuitKeys(props: {
	onQuit: () => void;
	children: JSX.Element;
}): JSX.Element {
	useKeyboard((key) => {
		if (key.name === "q" || (key.ctrl && key.name === "c")) props.onQuit();
	});
	return props.children;
}

/**
 * The Project view of the Project at `root`: a Goals box listing every Goal
 * by name, the selected one in the accent colour, moved by ↑↓ and j k, with
 * `n/N` on the box's bottom border. Reads the Goals itself.
 */
export function ProjectView(props: { root: string }): JSX.Element {
	const [goals] = createResource(() => listGoals(props.root));
	const [selected, setSelected] = createSignal(0);
	// Clamped, not wrapped, so holding a key stops at the end of the list.
	const move = (by: number) =>
		setSelected((index) =>
			Math.max(0, Math.min((goals()?.length ?? 0) - 1, index + by)),
		);
	useKeyboard((key) => {
		if (key.name === "up" || key.name === "k") move(-1);
		if (key.name === "down" || key.name === "j") move(1);
	});
	// No count until the Goals are read, so an empty Project and a slow read
	// never look alike.
	const position = () => {
		const list = goals();
		if (list === undefined) return undefined;
		return list.length === 0 ? " 0/0 " : ` ${selected() + 1}/${list.length} `;
	};
	return (
		<box
			border
			borderColor={border}
			title=" Goals "
			bottomTitle={position()}
			bottomTitleAlignment="right"
		>
			<For each={goals() ?? []}>
				{(goal, index) => (
					<text
						fg={index() === selected() ? bg : fg}
						bg={index() === selected() ? accent : undefined}
						flexShrink={0}
						wrapMode="none"
					>
						{goal}
					</text>
				)}
			</For>
		</box>
	);
}
