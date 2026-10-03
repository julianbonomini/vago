// What a screen tells the human about its keys: the footer line under it and
// the help screen `?` opens over it. Hides how the footer fits its width and
// how the help screen is laid out.

import { type JSX, useTerminalDimensions } from "@opentui/solid";
import { For } from "solid-js";
import { fitText } from "./text-fit.ts";
import { theme } from "./theme.ts";

/**
 * A key in a screen's footer: `keys` as pressed, `label` what it does in a
 * word or two, and `use`, how often the human presses it, higher for more.
 */
export type FooterKey = { keys: string; label: string; use: number };

/** A line of the help screen: `keys` as pressed, `meaning` what they do. */
export type HelpKey = { keys: string; meaning: string };

const footerGap = "   ";

/**
 * One line naming `keys` in the order given, each key bright and its label
 * dim. Where the line would be wider than `width`, the least used keys drop
 * out until it fits.
 */
export function KeyFooter(props: {
	keys: FooterKey[];
	width: number;
}): JSX.Element {
	const { color, dimSpan } = theme();
	const shown = () => {
		const kept = [...props.keys];
		const lineWidth = () =>
			Bun.stringWidth(
				kept.map(({ keys, label }) => `${keys} ${label}`).join(footerGap),
			);
		while (kept.length > 0 && lineWidth() > props.width) {
			const leastUsed = kept.reduce((least, key) =>
				key.use < least.use ? key : least,
			);
			kept.splice(kept.indexOf(leastUsed), 1);
		}
		return kept;
	};
	return (
		<text fg={color.fg} flexShrink={0} wrapMode="none">
			<For each={shown()}>
				{(key, index) => (
					<>
						{index() === 0 ? "" : footerGap}
						{key.keys}
						<span style={dimSpan}>{` ${key.label}`}</span>
					</>
				)}
			</For>
		</text>
	);
}

// Wide enough for the keys column and a meaning of a few words.
const helpWidth = 56;
const keysWidth = 12;

/**
 * The help screen: a box titled `Keys` over the middle of the screen, one
 * line per entry of `keys`. Draws over whatever is under it; the caller
 * decides when it shows.
 */
export function KeyHelp(props: { keys: HelpKey[] }): JSX.Element {
	const { color, border, dimSpan } = theme();
	const terminal = useTerminalDimensions();
	const width = () => Math.min(helpWidth, terminal().width);
	// The border and a space on both sides.
	const meaningWidth = () => width() - 4 - keysWidth;
	return (
		<box
			position="absolute"
			top={2}
			left={Math.floor((terminal().width - width()) / 2)}
			width={width()}
			zIndex={10}
			border
			customBorderChars={border}
			borderColor={color.accent}
			// The lines cover the inside, spaces included: a filled box would
			// leave its blank cells OpenTUI's white, which `NO_COLOR` forbids.
			backgroundColor={color.bg}
			shouldFill={false}
			title=" Keys "
			flexDirection="column"
		>
			<For each={props.keys}>
				{(key) => (
					<text fg={color.fg} bg={color.bg} flexShrink={0} wrapMode="none">
						{` ${fitText(key.keys, keysWidth)}`}
						<span style={dimSpan}>
							{`${fitText(key.meaning, meaningWidth())} `}
						</span>
					</text>
				)}
			</For>
		</box>
	);
}
