// How an agent Run's activity reads in the Run pane: the session's start as
// a divider, the agent's prose in blocks of its own with its tool calls
// indented under it and failures further in, and the session's end as a
// block of its numbers; and which of its items are edits, and how an edit's
// diff reads. Hides the indents, the blocks' look, where a long message is
// cut and how a running call's clock ticks.

import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createSignal, For, onCleanup, Show } from "solid-js";
import type {
	RunActivity,
	RunActivityItem,
	RunBackgroundTask,
	RunDiffLine,
	RunProseLine,
	RunSessionEnd,
	RunToolCalls,
} from "../harness/registry.ts";
import { fitSpans, fitText, type StyledSpan, wrapText } from "./text-fit.ts";
import { theme } from "./theme.ts";
import { duration, money, tokenCount } from "./time-and-money.ts";

/**
 * `activity`, a Run's, `width` columns wide, its items one after another in
 * the order they happened, each with the id `activityItemId` gives it, the
 * `selected`th in the selection's colours when `filled`, else bold. Only
 * the first 40 lines of a
 * prose message show, then how many more it has. While the Run is `live`,
 * open with a `vago run` running it, a trailing `working` line shows the
 * agent has the turn, and a call still running shows how long it has run,
 * every second.
 */
export function RunActivityLines(props: {
	activity: RunActivity;
	live: boolean;
	selected?: number;
	filled: boolean;
	width: number;
}): JSX.Element {
	const { color, symbol } = theme();
	const [now, setNow] = createSignal(new Date());
	const timer = setInterval(() => setNow(new Date()), clockMs);
	onCleanup(() => clearInterval(timer));
	return (
		<>
			<For each={props.activity.items}>
				{(item, index) => (
					<ActivityItem
						id={activityItemId(index())}
						item={item}
						selected={index() === props.selected}
						filled={props.filled}
						now={props.live ? now() : undefined}
						width={props.width}
					/>
				)}
			</For>
			<Show when={props.live && props.activity.working}>
				<text fg={color.accent} flexShrink={0} wrapMode="none">
					{fitText(` ${symbol.prose} working`, props.width)}
				</text>
			</Show>
		</>
	);
}

/** The id of the `index`th item of a Run's activity, to scroll it into view. */
export function activityItemId(index: number): string {
	return `activity-item-${index}`;
}

/**
 * The indexes of `activity`'s edits, the items whose calls changed files and
 * carry their diff, in order.
 */
export function editIndexes(activity: RunActivity): number[] {
	return activity.items.flatMap((item, index) =>
		item.kind === "tool-calls" && item.calls.some((call) => call.diff)
			? [index]
			: [],
	);
}

/**
 * The diff of each file the edit `item` changed, `width` columns wide: the
 * file's path and size in bold, then its hunks' headers dim, and its lines
 * kept, added in the ok colour and removed in the bad one, each led by its
 * ` `, `+` or `-`.
 */
export function RunDiffLines(props: {
	item: RunToolCalls;
	width: number;
}): JSX.Element {
	const { color, dimText } = theme();
	const lineColor = { kept: color.fg, added: color.ok, removed: color.bad };
	const lead = { kept: " ", added: "+", removed: "-" };
	return (
		<For each={props.item.calls.filter((call) => call.diff)}>
			{(call, index) => (
				<>
					<text
						fg={color.fg}
						attributes={TextAttributes.BOLD}
						marginTop={index() === 0 ? 0 : 1}
						flexShrink={0}
						wrapMode="none"
					>
						{fitText(
							call.size === undefined
								? call.subject
								: `${call.subject} (${call.size})`,
							props.width,
						)}
					</text>
					<For each={call.diff}>
						{(line: RunDiffLine) =>
							line.kind === "hunk" ? (
								<text {...dimText} flexShrink={0} wrapMode="none">
									{fitText(line.text, props.width)}
								</text>
							) : (
								<text fg={lineColor[line.kind]} flexShrink={0} wrapMode="none">
									{fitText(
										`${lead[line.kind]}${line.text.replaceAll("\t", tab)}`,
										props.width,
									)}
								</text>
							)
						}
					</For>
				</>
			)}
		</For>
	);
}

// What a tab in a diff line shows as: the terminal would move to its next
// stop, which the line's fitting can't measure. Claude Code's own diffs
// spell a tab so.
const tab = "  ";

// How often a running call's clock ticks.
const clockMs = 1000;

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

// One item of a Run's activity, `id` its id, in the selection's colours when
// `selected` and `filled`, and bold when only `selected`. Its running calls show their clock to `now` while the Run is
// live, `now` undefined otherwise.
function ActivityItem(props: {
	id: string;
	item: RunActivityItem;
	selected: boolean;
	filled: boolean;
	now: Date | undefined;
	width: number;
}): JSX.Element {
	const { color, symbol, dimText, selection } = theme();
	const { item } = props;
	const highlit = () => props.selected && props.filled;
	const spansLine = (spans: () => StyledSpan[]) => (
		<text
			id={props.id}
			fg={color.fg}
			bg={highlit() ? selection.bg : undefined}
			attributes={
				highlit()
					? selection.attributes
					: props.selected
						? TextAttributes.BOLD
						: 0
			}
			flexShrink={0}
			wrapMode="none"
		>
			<For each={fitSpans(spans(), props.width)}>
				{(span) => (
					<span
						style={highlit() ? { ...span.style, fg: selection.fg } : span.style}
					>
						{span.text}
					</span>
				)}
			</For>
		</text>
	);
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
			return spansLine(() => callSpans(item, props.now));
		case "background-task":
			return spansLine(() => backgroundSpans(item));
		case "skill-loaded":
			return spansLine(() => [
				{ text: callIndent, style: { fg: color.fg } },
				{ text: "Skill", style: { fg: color.fg, bold: true } },
				{ text: ` ${item.name} loaded`, style: { fg: color.fg } },
			]);
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
// the last one's subject; then, given `now`, how long the first call still
// running has run.
function callSpans(item: RunToolCalls, now: Date | undefined): StyledSpan[] {
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
	const since = calls.find((call) => call.runningSince)?.runningSince;
	return [
		{ text: callIndent, style: { fg: color.fg } },
		{ text: label, style: { fg: color.fg, bold: true } },
		{ text: ` ${subject}`, style: { fg: color.fg } },
		...(size === undefined ? [] : [{ text: ` (${size})`, style: dimSpan }]),
		...(since === undefined || now === undefined
			? []
			: [
					{
						text: ` ${symbol.sep} ${duration(now.getTime() - since.getTime())}`,
						style: dimSpan,
					},
				]),
	];
}

// A background command by its subject and how it stands, a failure in the
// bad colour.
function backgroundSpans(task: RunBackgroundTask): StyledSpan[] {
	const { color, dimSpan } = theme();
	const word = {
		running: "running",
		completed: "done",
		failed: "failed",
		stopped: "stopped",
	}[task.state];
	return [
		{ text: callIndent, style: { fg: color.fg } },
		{ text: "Background", style: { fg: color.fg, bold: true } },
		{ text: ` ${task.subject}`, style: { fg: color.fg } },
		{
			text: ` (${word})`,
			style: task.state === "failed" ? { fg: color.bad } : dimSpan,
		},
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
