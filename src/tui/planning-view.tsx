// The planning view: a planning item opened from the Goals list, under the
// Project view's header, holding its chat with the planning agent and the
// field the human types the next message in. Hides its layout, its keys,
// when the chat is read again and how a sent message shows before its turn
// is recorded.

import type { InputRenderable } from "@opentui/core";
import { type JSX, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import {
	findHarness,
	knownHarness,
	type RunActivity,
} from "../harness/registry.ts";
import {
	type PlanningChat,
	type PlanningTurn,
	readPlanningChat,
} from "../tickets/tickets.ts";
import { startPlanningTurn } from "./detached-vago.ts";
import { projectMessage } from "./goal-rows.ts";
import { liveRunLog } from "./live-run-log.ts";
import { usePane } from "./pane-grid.ts";
import { PaneTitle } from "./pane-title.tsx";
import { RunActivityLines } from "./run-activity.tsx";
import { type FooterKey, KeyFooter } from "./screen-keys.tsx";
import { joinParagraphs, wrapText } from "./text-fit.ts";
import { theme } from "./theme.ts";

// How often the chat is read again: a turn `vago plan say` records shows
// within this.
const refreshMs = 1000;

/**
 * Planning item `name` of the Project at `root` filling the screen under
 * the header: a pane titled with its name over its chat, each turn the
 * human's message under `you` and then the agent's response as it is
 * written, the newest at the bottom, and under the chat a field that has
 * every key typed. Enter sends a message that isn't blank in a `vago plan
 * say` of its own, through the command `vago` (`startPlanningTurn`), and
 * shows it at once; while a response is being written, Enter sends nothing
 * and the footer says so. A turn that failed shows why. Esc calls
 * `onClose`. Reads the chat itself, and again every second.
 */
export function PlanningView(props: {
	root: string;
	vago: string[];
	name: string;
	onClose: () => void;
}): JSX.Element {
	const { color, dimText } = theme();
	const terminal = useTerminalDimensions();
	const { chat, failure } = liveChat(props.root, props.name);
	// A message sent whose turn the chat doesn't show yet, and how many turns
	// the chat had when it was sent.
	const [pending, setPending] = createSignal<{
		message: string;
		turnsBefore: number;
	}>();
	const turns = () => chat()?.turns ?? [];
	const shownPending = () => {
		const sent = pending();
		return sent !== undefined && turns().length <= sent.turnsBefore
			? sent
			: undefined;
	};
	const answering = () => {
		const last = turns().at(-1);
		const open = last !== undefined && last.outcome === undefined;
		return open || shownPending() !== undefined;
	};
	let field: InputRenderable | undefined;
	const send = () => {
		const message = field?.value ?? "";
		if (message.trim() === "" || answering() || chat() === undefined) return;
		startPlanningTurn(props.vago, props.root, props.name, message);
		setPending({ message, turnsBefore: turns().length });
		if (field !== undefined) field.value = "";
	};
	useKeyboard((key) => {
		if (key.name === "escape") props.onClose();
	});
	const pane = usePane();
	// The pane's border and padding, on both sides.
	const inner = () => terminal().width - 4;
	return (
		<box flexDirection="column" flexGrow={1}>
			<box
				ref={pane}
				border
				paddingLeft={1}
				paddingRight={1}
				flexGrow={1}
				flexDirection="column"
			>
				<PaneTitle
					title={props.name}
					aside="planning"
					focused={true}
					width={inner()}
				/>
				<scrollbox
					flexGrow={1}
					stickyScroll={true}
					stickyStart="bottom"
					verticalScrollbarOptions={{ visible: false }}
				>
					<Show when={failure()}>
						{(message: () => string) => (
							<For each={wrapText(message(), inner())}>
								{(line) => (
									<text fg={color.bad} flexShrink={0} wrapMode="none">
										{line}
									</text>
								)}
							</For>
						)}
					</Show>
					<Show
						when={
							chat() !== undefined &&
							turns().length === 0 &&
							shownPending() === undefined
						}
					>
						<text {...dimText} flexShrink={0} wrapMode="none">
							No messages yet. Type one below and press Enter.
						</text>
					</Show>
					<For each={turns()}>
						{(turn) => (
							<TurnLines
								root={props.root}
								harness={chat()?.harness}
								turn={turn}
								width={inner()}
							/>
						)}
					</For>
					<Show when={shownPending()}>
						{(sent: () => { message: string }) => (
							<MessageLines message={sent().message} width={inner()} />
						)}
					</Show>
				</scrollbox>
				<box flexShrink={0} flexDirection="row">
					<text fg={color.accent} flexShrink={0} wrapMode="none">
						{"> "}
					</text>
					<input
						ref={(input: InputRenderable) => {
							field = input;
						}}
						focused
						flexGrow={1}
						placeholder="Message the planning agent"
						textColor={color.fg}
						focusedTextColor={color.fg}
						backgroundColor="transparent"
						focusedBackgroundColor="transparent"
						cursorColor={color.fg}
						onSubmit={send}
					/>
				</box>
			</box>
			<box flexShrink={0} paddingLeft={1} paddingRight={1}>
				<KeyFooter
					keys={footerKeys}
					width={terminal().width - 2}
					notice={
						answering()
							? "The agent is still answering; press Enter again once it has."
							: undefined
					}
				/>
			</box>
		</box>
	);
}

// `q` types in the field, so only Ctrl-C quits here, which `tui.tsx` owns.
const footerKeys: FooterKey[] = [
	{ keys: "Enter", label: "Send", use: 2 },
	{ keys: "Esc", label: "Back", use: 1 },
];

// The chat of planning item `item` of the Project at `root`, undefined
// until the first read ends, then read again every `refreshMs` for as long
// as the calling component lives. A read that fails keeps the last chat and
// gives its reason in `failure`, until a read succeeds.
function liveChat(
	root: string,
	item: string,
): {
	chat: () => PlanningChat | undefined;
	failure: () => string | undefined;
} {
	const [chat, setChat] = createSignal<PlanningChat>();
	const [failure, setFailure] = createSignal<string>();
	let last = "";
	let reading = false;
	const read = async () => {
		if (reading) return;
		reading = true;
		try {
			const fresh = await readPlanningChat(root, item);
			setFailure(undefined);
			// Kept when unchanged, so the turns aren't drawn again.
			const text = JSON.stringify(fresh);
			if (text === last) return;
			last = text;
			setChat(fresh);
		} catch (error) {
			setFailure(projectMessage(error, root));
		} finally {
			reading = false;
		}
	};
	read();
	const timer = setInterval(read, refreshMs);
	onCleanup(() => clearInterval(timer));
	return { chat, failure };
}

// One turn of a chat on Harness `harness`, `width` columns wide: its
// message, then the response read from its log as it grows, live while the
// turn is open, then for a turn that didn't end `ok` the reason.
function TurnLines(props: {
	root: string;
	harness: string | undefined;
	turn: PlanningTurn;
	width: number;
}): JSX.Element {
	const { color } = theme();
	const log = liveRunLog(() => props.turn.log);
	// A log whose Harness this build doesn't know shows nothing.
	const activity = createMemo(() => {
		const text = log()?.text;
		const harness = props.harness;
		if (harness === undefined || !knownHarness(harness)) return undefined;
		if (text === undefined) return undefined;
		return findHarness(harness).runActivity(text.split("\n"), props.root);
	});
	const failure = () => {
		const { outcome, reason } = props.turn;
		if (outcome === undefined || outcome === "ok") return undefined;
		return outcome === "error" ? (reason ?? outcome) : `ended ${outcome}`;
	};
	return (
		<>
			<MessageLines message={props.turn.message} width={props.width} />
			<Show when={activity()}>
				{(shown: () => RunActivity) => (
					<RunActivityLines
						activity={shown()}
						live={props.turn.outcome === undefined}
						filled={false}
						width={props.width}
					/>
				)}
			</Show>
			<Show when={failure()}>
				{(reason: () => string) => (
					<For each={wrapText(`The response failed: ${reason()}`, props.width)}>
						{(line) => (
							<text fg={color.bad} flexShrink={0} wrapMode="none">
								{line}
							</text>
						)}
					</For>
				)}
			</Show>
			<box height={1} flexShrink={0} />
		</>
	);
}

// The human's `message` under `you`, its paragraphs wrapped to `width`
// columns past an indent.
function MessageLines(props: { message: string; width: number }): JSX.Element {
	const { color } = theme();
	return (
		<>
			<text fg={color.accent} flexShrink={0} wrapMode="none">
				you
			</text>
			<For
				each={joinParagraphs(props.message).flatMap((paragraph) =>
					wrapText(paragraph, props.width - messageIndent.length),
				)}
			>
				{(line) => (
					<text fg={color.fg} flexShrink={0} wrapMode="none">
						{`${messageIndent}${line}`}
					</text>
				)}
			</For>
		</>
	);
}

const messageIndent = "  ";
