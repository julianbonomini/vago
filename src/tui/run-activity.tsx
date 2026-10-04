// How an agent Run's activity reads in the Run pane: the session's start as
// a divider, the agent's prose in blocks of its own with its tool calls
// indented under it and failures further in, and the session's end as a
// block of its numbers. Hides the indents, the blocks' look and where a long
// message is cut.

import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { For, Show } from "solid-js";
import type {
	RunActivityItem,
	RunProseLine,
	RunSessionEnd,
	RunToolCalls,
} from "../harness/registry.ts";
import { fitSpans, fitText, type StyledSpan, wrapText } from "./text-fit.ts";
import { theme } from "./theme.ts";
import { duration, money, tokenCount } from "./time-and-money.ts";

/**
 * `items`, a Run's activity, `width` columns wide, one after another in the
 * order they happened. Only the first 40 lines of a prose message show,
 * then how many more it has.
 */
export function RunActivityLines(props: {
	items: RunActivityItem[];
	width: number;
}): JSX.Element {
	return (
		<For each={props.items}>
			{(item) => <ActivityItem item={item} width={props.width} />}
		</For>
	);
}

// Tool calls start past the prose's text, which starts at column 3 after
// the block's padding and the prose mark, and failures further in, so the
// stream reads as prose with the work under it.
const callIndent = "    ";
const failureIndent = "      ";

// A prose message's lines shown before the rest is counted instead.
const proseLinesShown = 40;

// The prose block's padding on both sides and its mark's column.
const proseEdges = 4;

// The end block's padding on both sides.
const endEdges = 2;

function ActivityItem(props: {
	item: RunActivityItem;
	width: number;
}): JSX.Element {
	const { color, symbol, dimText } = theme();
	const { item } = props;
	const failure = (text: string) => (
		<text fg={color.bad} flexShrink={0} wrapMode="none">
			{fitText(`${failureIndent}${symbol.stuck} ${text}`, props.width)}
		</text>
	);
	switch (item.kind) {
		case "session-start": {
			const rule = symbol.rule.repeat(2);
			const model = item.model === "" ? "" : ` ${symbol.sep} ${item.model}`;
			return (
				<text
					{...dimText}
					marginTop={1}
					marginBottom={1}
					flexShrink={0}
					wrapMode="none"
				>
					{fitText(`${rule} Session started${model} ${rule}`, props.width)}
				</text>
			);
		}
		case "prose":
			return <ProseBlock lines={item.lines} width={props.width} />;
		case "tool-calls":
			return (
				<text fg={color.fg} flexShrink={0} wrapMode="none">
					<For each={fitSpans(callSpans(item), props.width)}>
						{(span) => <span style={span.style}>{span.text}</span>}
					</For>
				</text>
			);
		case "failed-result":
			return failure(item.firstLine);
		case "denied":
			return failure(`Denied ${item.tool}: ${item.reason}`);
		case "session-end":
			return (
				<box
					flexShrink={0}
					marginTop={1}
					backgroundColor={color.raised}
					paddingLeft={1}
					paddingRight={1}
				>
					<text fg={color.fg} flexShrink={0} wrapMode="none">
						<For each={fitSpans(endSpans(item), props.width - endEdges)}>
							{(span) => <span style={span.style}>{span.text}</span>}
						</For>
					</text>
				</box>
			);
	}
}

// The agent's prose, which the human looks for first, so it stands out: a
// raised block with a blank line around it, the accent mark, bright text
// and bold headings, cut after `proseLinesShown` lines.
function ProseBlock(props: {
	lines: RunProseLine[];
	width: number;
}): JSX.Element {
	const { color, symbol, dimText } = theme();
	const more = () => props.lines.length - proseLinesShown;
	const wrapped = () =>
		props.lines.slice(0, proseLinesShown).flatMap(({ text, heading }) =>
			wrapText(text, props.width - proseEdges).map((part) => ({
				text: part,
				heading,
			})),
		);
	return (
		<box
			flexDirection="row"
			flexShrink={0}
			marginTop={1}
			marginBottom={1}
			backgroundColor={color.raised}
			paddingLeft={1}
			paddingRight={1}
		>
			<text fg={color.accent} width={2} flexShrink={0}>
				{symbol.prose}
			</text>
			<box flexDirection="column" flexGrow={1}>
				<For each={wrapped()}>
					{(line) => (
						<text
							fg={color.bright}
							attributes={line.heading ? TextAttributes.BOLD : 0}
							flexShrink={0}
							wrapMode="none"
						>
							{/* An empty text takes no row, and the blank line must. */}
							{line.text === "" ? " " : line.text}
						</text>
					)}
				</For>
				<Show when={more() > 0}>
					<text {...dimText} flexShrink={0} wrapMode="none">
						{`${symbol.cut} ${more()} more lines`}
					</text>
				</Show>
			</box>
		</box>
	);
}

// One line for calls of one verb: a single call by its subject and size,
// calls on files by how many and their names, and others by how many and
// the last one's subject.
function callSpans(item: RunToolCalls): StyledSpan[] {
	const { color, symbol, dimSpan } = theme();
	const { verb, calls } = item;
	const last = calls.at(-1);
	const label =
		calls.length === 1
			? verb
			: item.files
				? `${verb} ${calls.length} files`
				: `${verb} ${symbol.times}${calls.length}`;
	const subject =
		item.files && calls.length > 1
			? calls.map((call) => call.subject.split("/").at(-1)).join(", ")
			: (last?.subject ?? "");
	const size = calls.length === 1 ? last?.size : undefined;
	return [
		{ text: callIndent, style: { fg: color.fg } },
		{ text: label, style: { fg: color.fg, bold: true } },
		{ text: ` ${subject}`, style: { fg: color.fg } },
		...(size === undefined ? [] : [{ text: ` (${size})`, style: dimSpan }]),
	];
}

// `✓ Run finished` or `✗ Run ended: <failure>`, then each number the
// session reported, values bold and labels dim.
function endSpans(item: RunSessionEnd): StyledSpan[] {
	const { color, symbol, dimSpan } = theme();
	const numbers: [string, string][] = [];
	if (item.durationMs !== undefined)
		numbers.push([duration(item.durationMs), ""]);
	if (item.turns !== undefined) numbers.push([`${item.turns}`, " turns"]);
	if (item.tokens !== undefined) {
		numbers.push([tokenCount(item.tokens), " tokens"]);
	}
	if (item.costUsd !== undefined) numbers.push([money(item.costUsd), ""]);
	return [
		item.failure === undefined
			? {
					text: `${symbol.done} Run finished`,
					style: { fg: color.ok, bold: true },
				}
			: {
					text: `${symbol.stuck} Run ended: ${item.failure}`,
					style: { fg: color.bad, bold: true },
				},
		...numbers.flatMap(([value, label]) => [
			{ text: "   ", style: dimSpan },
			{ text: value, style: { fg: color.fg, bold: true } },
			{ text: label, style: dimSpan },
		]),
	];
}
