// The planning view: a planning item opened from the Goals list, under the
// Project view's header, holding its chat with the planning agent, the
// field the human types the next message in, and the Preview of the agent's
// Proposal beside them. Hides its layout, its keys, when the chat and the
// Proposal are read again and how a sent message shows before its turn is
// recorded.

import type { InputRenderable } from "@opentui/core";
import { type JSX, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import {
	findHarness,
	knownHarness,
	type RunActivity,
	type RunActivityItem,
} from "../harness/registry.ts";
import {
	type PlanningChat,
	type PlanningProposal,
	type PlanningTurn,
	planningProposalSpans,
	readPlanningChat,
	readPlanningProposal,
} from "../tickets/tickets.ts";
import { listWorkflows } from "../workflow.ts";
import { startPlanningTurn } from "./detached-vago.ts";
import { projectMessage } from "./goal-rows.ts";
import { liveRunLog } from "./live-run-log.ts";
import { sharedLine, usePane } from "./pane-grid.ts";
import { PaneTitle } from "./pane-title.tsx";
import { PlanningPreview } from "./planning-preview.tsx";
import { RunActivityLines } from "./run-activity.tsx";
import { type FooterKey, KeyFooter } from "./screen-keys.tsx";
import { fitText, joinParagraphs, wrapText } from "./text-fit.ts";
import { theme } from "./theme.ts";

// How often the chat and the Proposal are read again: a turn `vago plan
// say` records shows within this.
const refreshMs = 1000;

// The narrowest screen that shows the chat and the Preview side by side;
// below it the focused one fills the screen.
const splitWidth = 100;

// The chat's share of the screen's width when the Preview is beside it.
const chatShare = 0.55;

// The panes the focus moves between, in the order of Tab.
type PlanningViewPane = "chat" | "preview";

/**
 * Planning item `name` of the Project at `root` filling the screen under
 * the header: a pane titled with its name over its chat, each turn the
 * human's message under `you` and then the agent's response as it is
 * written, the newest at the bottom, and under the chat a field that has
 * every key typed while it has the focus. Enter sends a message that isn't
 * blank in a `vago plan say` of its own, through the command `vago`
 * (`startPlanningTurn`), and shows it at once; while a response is being
 * written, Enter sends nothing and the footer says so. A turn that failed
 * shows why. Beside the chat, or in its place below 100 columns while it
 * has the focus, the Preview shows the agent's Proposal. Tab moves the
 * focus between the field and the Preview; with the Preview focused no
 * field has the focus, so `q` quits. Esc calls `onClose`. Reads the chat
 * and the Proposal itself, and again every second.
 */
export function PlanningView(props: {
	root: string;
	vago: string[];
	name: string;
	onClose: () => void;
}): JSX.Element {
	const { color, dimText } = theme();
	const terminal = useTerminalDimensions();
	const { chat, proposal, workflows, failure, reread } = livePlanning(
		props.root,
		props.name,
	);
	const [focus, setFocus] = createSignal<PlanningViewPane>("chat");
	const [picking, setPicking] = createSignal(false);
	const [notice, setNotice] = createSignal<string>();
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
		setNotice(undefined);
		if (key.name === "escape" && picking()) setPicking(false);
		else if (key.name === "escape") props.onClose();
		// The picker has the arrows and Enter until it closes.
		else if (picking()) return;
		else if (key.name === "tab") {
			setFocus(focus() === "chat" ? "preview" : "chat");
		} else if (
			key.name === "w" &&
			focus() === "preview" &&
			proposal() !== undefined
		) {
			setPicking(true);
		}
	});
	const pane = usePane();
	const split = () => terminal().width >= splitWidth;
	const chatWidth = () =>
		split() ? Math.floor(terminal().width * chatShare) : terminal().width;
	// The pane's border and padding, on both sides.
	const inner = () => chatWidth() - 4;
	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="row" flexGrow={1}>
				<box
					ref={pane}
					border
					visible={split() || focus() === "chat"}
					width={chatWidth()}
					flexShrink={0}
					paddingLeft={1}
					paddingRight={1}
					flexDirection="column"
				>
					<PaneTitle
						title={props.name}
						aside="planning"
						focused={focus() === "chat"}
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
									proposalTurn={proposal()?.turn}
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
							focused={focus() === "chat"}
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
				<Show when={split() || focus() === "preview"}>
					<PlanningPreview
						root={props.root}
						item={props.name}
						proposal={proposal()}
						workflows={workflows()}
						width={
							split()
								? terminal().width - chatWidth() + sharedLine
								: terminal().width
						}
						besideChat={split()}
						focused={focus() === "preview"}
						picking={picking()}
						onPicked={(refusal) => {
							setPicking(false);
							setNotice(refusal);
							reread();
						}}
					/>
				</Show>
			</box>
			<box flexShrink={0} paddingLeft={1} paddingRight={1}>
				<KeyFooter
					keys={footerKeys(focus(), proposal() !== undefined)}
					width={terminal().width - 2}
					notice={
						notice() ??
						(answering()
							? "The agent is still answering; press Enter again once it has."
							: undefined)
					}
				/>
			</box>
		</box>
	);
}

// The keys of the footer while `focus` has the focus, `w` only while a
// Proposal is `shown`. In the field `q` types, so only Ctrl-C quits there,
// which `tui.tsx` owns.
function footerKeys(focus: PlanningViewPane, shown: boolean): FooterKey[] {
	if (focus === "chat") {
		return [
			{ keys: "Enter", label: "Send", use: 3 },
			{ keys: "Tab", label: "Preview", use: 2 },
			{ keys: "Esc", label: "Back", use: 1 },
		];
	}
	return [
		{ keys: "Tab", label: "Chat", use: 3 },
		...(shown ? [{ keys: "w", label: "Workflow", use: 2 }] : []),
		{ keys: "q", label: "Quit", use: 2 },
		{ keys: "Esc", label: "Back", use: 1 },
	];
}

// The chat and the Proposal of planning item `item` of the Project at
// `root`, and the names of its Workflows, undefined (none) until the first
// read ends, then read again every `refreshMs`, and on `reread`, for as long
// as the calling component lives. A read that fails keeps what the last one
// gave and its reason in `failure`, until a read succeeds; a bad Proposal
// stops no chat from showing.
function livePlanning(
	root: string,
	item: string,
): {
	chat: () => PlanningChat | undefined;
	proposal: () => PlanningProposal | undefined;
	workflows: () => string[];
	failure: () => string | undefined;
	reread: () => void;
} {
	const [chat, setChat] = createSignal<PlanningChat>();
	const [proposal, setProposal] = createSignal<PlanningProposal>();
	const [workflows, setWorkflows] = createSignal<string[]>([]);
	const [failure, setFailure] = createSignal<string>();
	let lastChat = "";
	let lastProposal = "";
	let reading = false;
	const read = async () => {
		if (reading) return;
		reading = true;
		try {
			const fresh = await readPlanningChat(root, item);
			// Each kept when unchanged, so it isn't drawn again.
			const chatText = JSON.stringify(fresh);
			if (chatText !== lastChat) {
				lastChat = chatText;
				setChat(fresh);
			}
			const names = await listWorkflows(root);
			const proposed = await readPlanningProposal(root, item, names);
			setFailure(undefined);
			if (names.join("\n") !== workflows().join("\n")) setWorkflows(names);
			const proposalText = JSON.stringify(proposed) ?? "";
			if (proposalText !== lastProposal) {
				lastProposal = proposalText;
				setProposal(proposed);
			}
		} catch (error) {
			setFailure(projectMessage(error, root));
		} finally {
			reading = false;
		}
	};
	read();
	const timer = setInterval(read, refreshMs);
	onCleanup(() => clearInterval(timer));
	return { chat, proposal, workflows, failure, reread: read };
}

// One turn of a chat on Harness `harness`, `width` columns wide: its
// message, then the response read from its log as it grows, live while the
// turn is open, each proposal block in it one dim line that says whether it
// is the Proposal from turn `proposalTurn` in the Preview, an earlier one or
// one never saved, then for a turn
// that didn't end `ok` the reason, and why its block couldn't be read.
function TurnLines(props: {
	root: string;
	harness: string | undefined;
	turn: PlanningTurn;
	proposalTurn: number | undefined;
	width: number;
}): JSX.Element {
	const { color, dimText } = theme();
	const log = liveRunLog(() => props.turn.log);
	// A log whose Harness this build doesn't know shows nothing.
	const activity = createMemo(() => {
		const text = log()?.text;
		const harness = props.harness;
		if (harness === undefined || !knownHarness(harness)) return undefined;
		if (text === undefined) return undefined;
		return findHarness(harness).runActivity(text.split("\n"), props.root);
	});
	const parts = createMemo(() => {
		const shown = activity();
		if (shown === undefined) return [];
		return withoutProposalBlocks(shown);
	});
	// What a block's line says: whether its turn's Proposal is the one the
	// Preview shows, was replaced since, or was never saved.
	const blockWords = (closed: boolean) => {
		if (!closed) return "Writing the proposal…";
		if (props.turn.proposalError !== undefined) {
			return "Proposal not saved, as said below";
		}
		return props.turn.number === props.proposalTurn
			? "Proposal, shown in the Preview"
			: "Earlier proposal, since replaced";
	};
	const failure = () => {
		const { outcome, reason } = props.turn;
		if (outcome === undefined || outcome === "ok") return undefined;
		return outcome === "error" ? (reason ?? outcome) : `ended ${outcome}`;
	};
	return (
		<>
			<MessageLines message={props.turn.message} width={props.width} />
			<For each={parts()}>
				{(part) =>
					part.kind === "activity" ? (
						<RunActivityLines
							activity={part.activity}
							live={props.turn.outcome === undefined}
							filled={false}
							width={props.width}
						/>
					) : (
						<text {...dimText} flexShrink={0} wrapMode="none">
							{fitText(`${blockIndent}${blockWords(part.closed)}`, props.width)}
						</text>
					)
				}
			</For>
			<Show when={props.turn.proposalError}>
				{(reason: () => string) => (
					<For
						each={wrapText(
							`The proposal in this answer couldn't be read: ${reason()}`,
							props.width,
						)}
					>
						{(line) => (
							<text fg={color.bad} flexShrink={0} wrapMode="none">
								{line}
							</text>
						)}
					</For>
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

// What a turn's response shows: runs of its activity, and in place of each
// proposal block in its prose, a line of words about it.
type TurnPart =
	| { kind: "activity"; activity: RunActivity }
	| { kind: "proposal"; closed: boolean };

// Where a block's line starts: under the prose's text, past its mark.
const blockIndent = "   ";

// `activity` cut around each proposal block in its prose, each block a
// `proposal` part.
// Only the last run keeps `working`, since the line it draws ends the turn;
// after a block that ends the activity, an empty run keeps it.
function withoutProposalBlocks(activity: RunActivity): TurnPart[] {
	const parts: TurnPart[] = [];
	let items: RunActivityItem[] = [];
	const endRun = () => {
		if (items.length === 0) return;
		parts.push({
			kind: "activity",
			activity: { ...activity, items, working: false },
		});
		items = [];
	};
	for (const item of activity.items) {
		if (item.kind !== "prose") {
			items.push(item);
			continue;
		}
		const spans = planningProposalSpans(item.lines.map(({ text }) => text));
		let from = 0;
		for (const span of spans) {
			const before = item.lines.slice(from, span.start);
			if (before.some(({ text }) => text.trim() !== "")) {
				items.push({ kind: "prose", lines: before });
			}
			endRun();
			parts.push({ kind: "proposal", closed: span.closed });
			from = span.end;
		}
		const after = item.lines.slice(from);
		if (after.some(({ text }) => text.trim() !== "")) {
			items.push({ kind: "prose", lines: after });
		}
	}
	endRun();
	const last = parts.at(-1);
	if (last?.kind === "activity") last.activity.working = activity.working;
	else if (activity.working) {
		parts.push({ kind: "activity", activity: { ...activity, items: [] } });
	}
	return parts;
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
