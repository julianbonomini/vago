// The planning view: a planning item opened from the Goals list, under the
// Project view's header. Hides its layout and its keys.

import { type JSX, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { usePane } from "./pane-grid.ts";
import { PaneTitle } from "./pane-title.tsx";
import { type FooterKey, KeyFooter } from "./screen-keys.tsx";
import { theme } from "./theme.ts";

/**
 * Planning item `name` filling the screen under the header: a pane titled
 * with its name over what it holds, and a footer naming its keys. Esc calls
 * `onClose`.
 */
export function PlanningView(props: {
	name: string;
	onClose: () => void;
}): JSX.Element {
	const { dimText } = theme();
	const terminal = useTerminalDimensions();
	useKeyboard((key) => {
		if (key.name === "escape") props.onClose();
	});
	const pane = usePane();
	return (
		<box flexDirection="column" flexGrow={1}>
			<box ref={pane} border paddingLeft={1} paddingRight={1} flexGrow={1}>
				<PaneTitle
					title={props.name}
					aside="planning"
					focused={true}
					width={terminal().width - 4}
				/>
				<text {...dimText} flexShrink={0} wrapMode="none">
					Nothing planned yet.
				</text>
			</box>
			<box flexShrink={0} paddingLeft={1} paddingRight={1}>
				<KeyFooter keys={footerKeys} width={terminal().width - 2} />
			</box>
		</box>
	);
}

// `q` and Ctrl-C belong to `tui.tsx`, which quits on them on every screen.
const footerKeys: FooterKey[] = [
	{ keys: "Esc", label: "Back", use: 2 },
	{ keys: "q", label: "Quit", use: 1 },
];
