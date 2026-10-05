// The entry to the TUI that a bare `vago` opens on a terminal: how the
// terminal is held while it is open and given back on every way out. It
// reads, writes nothing and only starts Goals (ADR 0005), and is drawn with
// OpenTUI and Solid (ADR 0006). Only `cli.ts` imports this file, and only
// lazily, so no command loads OpenTUI.

import { format } from "node:util";
import { createCliRenderer } from "@opentui/core";
import {
	type JSX,
	render,
	useKeyboard,
	useTerminalDimensions,
} from "@opentui/solid";
import { ErrorBoundary } from "solid-js";
import { ProjectView } from "./project-view.tsx";
import { theme } from "./theme.ts";

/**
 * Shows the Project at `root` full-screen until the human quits with `q` or
 * Ctrl-C, or a signal ends it. Always leaves the terminal as it found it:
 * out of the alternate screen, cursor shown, raw mode off. Holds what is
 * written to stderr and `console` meanwhile and prints it afterwards. Throws,
 * after restoring the terminal, any error the view hit. Needs stdin and
 * stdout to be terminals. `vago` is the command that runs this same `vago`,
 * which the TUI starts Goals with.
 */
export async function openTui(root: string, vago: string[]): Promise<void> {
	return holdTerminal(() => <ProjectView root={root} vago={vago} />);
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
		backgroundColor: theme().color.bg,
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
					<QuitKeys onQuit={quit}>
						<box flexGrow={1}>
							<Backdrop />
							{view()}
						</box>
					</QuitKeys>
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

// Spaces in the fg token under the whole screen. OpenTUI gives a cell no text
// covers a white RGB foreground, which `NO_COLOR` forbids.
function Backdrop(): JSX.Element {
	const terminal = useTerminalDimensions();
	return (
		<text
			position="absolute"
			top={0}
			left={0}
			zIndex={-1}
			fg={theme().color.fg}
			wrapMode="none"
		>
			{`${" ".repeat(terminal().width)}\n`.repeat(terminal().height)}
		</text>
	);
}
