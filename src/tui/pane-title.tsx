// A pane's title row, its first line inside the grid's lines: what the pane
// shows on the left, bold, and its numbers on the right, dim. Hides how the
// two share a narrow row and how the focused pane's title stands out.

import type { ColorInput } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { Show } from "solid-js";
import { fitText } from "./text-fit.ts";
import { theme } from "./theme.ts";

/**
 * `title` on the left of a row `width` columns wide, cut when it doesn't
 * fit, and `aside` on its right, left out unless the whole title and two
 * spaces fit beside it. The title is in `titleColor`, or else bright, and in
 * the focus look when `focused`.
 */
export function PaneTitle(props: {
	title: string;
	aside?: string;
	titleColor?: ColorInput;
	focused: boolean;
	width: number;
}): JSX.Element {
	const { color, dimSpan, focusTitle } = theme();
	const titleWidth = () => Bun.stringWidth(props.title);
	const aside = () => props.aside ?? "";
	const gap = () => props.width - titleWidth() - Bun.stringWidth(aside());
	const asideShown = () => aside() !== "" && gap() >= 2;
	const shownTitle = () =>
		titleWidth() <= props.width
			? props.title
			: fitText(props.title, props.width);
	// A span only ever adds the flags of a new style, so a change of focus
	// draws a new span.
	return (
		<text fg={color.fg} flexShrink={0} wrapMode="none">
			<Show
				when={props.focused}
				fallback={
					<span style={{ fg: props.titleColor ?? color.bright, bold: true }}>
						{shownTitle()}
					</span>
				}
			>
				<span style={{ ...focusTitle, bold: true }}>{shownTitle()}</span>
			</Show>
			<Show when={asideShown()}>
				{" ".repeat(gap())}
				<span style={dimSpan}>{aside()}</span>
			</Show>
		</text>
	);
}
