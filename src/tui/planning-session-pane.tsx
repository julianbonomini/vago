// The planning view's session pane: a planning item's `vago plan session`
// drawn in a terminal of its own inside the pane, with every key and paste
// passed to it while the pane has the focus. Hides OpenTUI's embedded
// terminal and the session's process.

import { type BoxRenderable, EmbeddedTerminalRenderable } from "@opentui/core";
import { type JSX, useRenderer } from "@opentui/solid";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { usePane } from "./pane-grid.ts";
import { PaneTitle } from "./pane-title.tsx";
import { fitText } from "./text-fit.ts";
import { theme } from "./theme.ts";
import {
	type PlanningSessionProcess,
	startPlanningSession,
} from "./vago-commands.ts";

/**
 * A pane `width` columns wide, titled `title` with `aside` on the title
 * row's right, with planning item `item`'s session, in the Project at
 * `root`, drawn below the title. The session starts when the pane mounts,
 * through the command `vago`, and stops when it unmounts or the TUI quits;
 * hiding the pane with `visible` keeps it running. While `focused`, every
 * key and paste goes to the session. Once the session has exited, a line
 * under the title says so, until the pane is mounted again. `onOpen` gets,
 * as the session starts, a function that ends it and resolves once it has
 * exited. `onExit` gets the exit code of a session that ended on its own,
 * not through that function or an unmount.
 */
export function PlanningSessionPane(props: {
	vago: string[];
	root: string;
	item: string;
	title: string;
	aside: string;
	focused: boolean;
	visible: boolean;
	width: number;
	onOpen(end: () => Promise<void>): void;
	onExit(code: number): void;
}): JSX.Element {
	const { dimText } = theme();
	const renderer = useRenderer();
	const pane = usePane();
	const [exitCode, setExitCode] = createSignal<number>();
	// The pane's border and padding, on both sides.
	const inner = () => props.width - 4;
	let terminal: EmbeddedTerminalRenderable | undefined;
	let session: PlanningSessionProcess | undefined;
	let stopping = false;
	const mount = (box: BoxRenderable) => {
		// Corrected to the pane's height by the first layout.
		const size = { cols: inner(), rows: 24 };
		const shown = new EmbeddedTerminalRenderable(renderer, {
			width: "100%",
			height: "100%",
			...size,
			// Every source, not only keys: the terminal's answers to the
			// session's queries, such as where the cursor is, go back to it
			// too, and a program like Claude Code waits for them.
			onData: (bytes) => session?.write(bytes),
			onTerminalResize: (cols, rows) => session?.resize(cols, rows),
		});
		box.add(shown);
		terminal = shown;
		const started = startPlanningSession(props.vago, props.root, props.item, {
			...size,
			onOutput: (bytes) => shown.write(bytes),
		});
		session = started;
		started.exited.then((code) => {
			setExitCode(code);
			if (!stopping) props.onExit(code);
		});
		props.onOpen(async () => {
			stopping = true;
			started.stop();
			await started.exited;
		});
	};
	createEffect(() => {
		if (props.focused) terminal?.focus();
		else terminal?.blur();
	});
	onCleanup(() => {
		stopping = true;
		session?.stop();
		terminal?.destroy();
	});
	return (
		<box
			ref={pane}
			border
			visible={props.visible}
			width={props.width}
			flexShrink={0}
			paddingLeft={1}
			paddingRight={1}
			flexDirection="column"
		>
			<PaneTitle
				title={props.title}
				aside={props.aside}
				focused={props.focused}
				width={inner()}
			/>
			{/* Not `when={exitCode()}`, which hides exit 0. */}
			<Show when={exitCode() !== undefined}>
				<text {...dimText} flexShrink={0} wrapMode="none">
					{fitText(`The session ended (exit ${exitCode()}).`, inner())}
				</text>
			</Show>
			<box ref={mount} flexGrow={1} />
		</box>
	);
}
