// The planning view: a planning item opened from the Goals list, or an
// accepted Goal's from the Goal view, holding its chat with the planning
// agent, the field the human types the next message in, the Preview of the
// agent's Proposal beside them, and Accept. Hides its layout, its keys, when
// the chat and the Proposal are read again, how a sent message shows before
// its turn is recorded, and how an acceptance is asked for and waited on.

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
import { projectMessage } from "./goal-rows.ts";
import { liveRunLog } from "./live-run-log.ts";
import { sharedLine, usePane } from "./pane-grid.ts";
import { PaneTitle } from "./pane-title.tsx";
import { PlanningPreview } from "./planning-preview.tsx";
import { RunActivityLines } from "./run-activity.tsx";
import {
	type FooterKey,
	type HelpKey,
	KeyFooter,
	KeyHelp,
} from "./screen-keys.tsx";
import { fitText, joinParagraphs, wrapText } from "./text-fit.ts";
import { theme } from "./theme.ts";
import { duration, money } from "./time-and-money.ts";
import {
	runPlanAccept,
	startPlanningRetry,
	startPlanningTurn,
} from "./vago-commands.ts";

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
 * every key typed while it has the focus. The title row's right side gives
 * the agent's time and cost over every response, which stay the item's
 * own, kept once it is accepted and never added to a Goal's Runs. Enter
 * sends a message that isn't blank in a `vago plan say` of its own, through
 * the command `vago`
 * (`startPlanningTurn`), and shows it at once; while a response is being
 * written, Enter sends nothing and the footer says so. A turn that failed
 * shows why. An interrupted last response says so, and Ctrl-R, in either
 * pane, answers it again in a `vago plan retry` of its own
 * (`startPlanningRetry`), once: the footer says "Retrying…" until the retry
 * shows. Earlier attempts at a retried response show above it. Beside the
 * chat, or in its place below 100 columns while it has the focus, the
 * Preview shows the agent's Proposal. Tab moves the focus between the field
 * and the Preview; with the Preview focused no field has the focus, so `q`
 * quits and `?` shows every key until `?` or Esc. There `a` asks whether
 * to accept a Proposal that is ready, or says why it isn't, and `y` accepts
 * it in a `vago plan accept` (`runPlanAccept`) that the view waits on, any
 * other key cancelling. A refusal shows in the footer and the view stays; an
 * acceptance calls `onClose` with the notice to show. Once the item was
 * accepted, the chat is read-only: no field, and no `a` or `w`. Esc calls
 * `onClose` with no notice. Reads the chat and the Proposal itself, and
 * again every second.
 */
export function PlanningView(props: {
	root: string;
	vago: string[];
	name: string;
	onClose: (notice?: string) => void;
}): JSX.Element {
	const { color, dimText, symbol } = theme();
	const terminal = useTerminalDimensions();
	const { chat, proposal, workflows, failure, readAt, reread } = livePlanning(
		props.root,
		props.name,
	);
	const [focus, setFocus] = createSignal<PlanningViewPane>("chat");
	const [picking, setPicking] = createSignal(false);
	const [helpShown, setHelpShown] = createSignal(false);
	const [notice, setNotice] = createSignal<string>();
	// The question `a` asks before accepting, shown until the next key.
	const [question, setQuestion] = createSignal<string>();
	const [accepting, setAccepting] = createSignal(false);
	// A message sent whose turn the chat doesn't show yet, and how many turns
	// the chat had when it was sent.
	const [pending, setPending] = createSignal<{
		message: string;
		turnsBefore: number;
	}>();
	const turns = () => chat()?.turns ?? [];
	const accepted = () => chat()?.accepted === true;
	const titleAside = () => {
		const { agentMs, costUsd } = agentTotals(turns(), readAt());
		return [
			accepted() ? "accepted" : "planning",
			duration(agentMs),
			money(costUsd),
		].join(` ${symbol.sep} `);
	};
	const shownPending = () => {
		const sent = pending();
		return sent !== undefined && turns().length <= sent.turnsBefore
			? sent
			: undefined;
	};
	// A retry asked for, and how many earlier attempts the last turn had
	// then. It is pending until the turn has one more, which a retry that
	// ends between two reads still leaves behind.
	const [retry, setRetry] = createSignal<{ attemptsBefore: number }>();
	const retryPending = () => {
		const asked = retry();
		const attempts = turns().at(-1)?.interruptedLogs.length ?? 0;
		return asked !== undefined && attempts <= asked.attemptsBefore;
	};
	// An interrupted last response, which Retry response answers again.
	const retryable = () =>
		!accepted() && turns().at(-1)?.outcome === "interrupted";
	const canRetry = () => retryable() && !retryPending() && !accepting();
	const answering = () => {
		const last = turns().at(-1);
		const open = last !== undefined && last.outcome === undefined;
		return open || shownPending() !== undefined || retryPending();
	};
	let field: InputRenderable | undefined;
	const send = () => {
		const message = field?.value ?? "";
		const blocked = answering() || accepting() || chat() === undefined;
		if (message.trim() === "" || blocked) return;
		startPlanningTurn(props.vago, props.root, props.name, message);
		setPending({ message, turnsBefore: turns().length });
		if (field !== undefined) field.value = "";
	};
	const retryResponse = () => {
		const last = turns().at(-1);
		if (last === undefined || !canRetry()) return;
		startPlanningRetry(props.vago, props.root, props.name);
		setRetry({ attemptsBefore: last.interruptedLogs.length });
	};
	// Asks whether to accept the Proposal, or says why it can't be.
	const askAccept = () => {
		const shown = proposal();
		if (shown === undefined) return setNotice("No proposal to accept yet.");
		const [problem] = shown.problems;
		if (problem !== undefined) {
			return setNotice(`Not ready to accept: ${problem}`);
		}
		const whose =
			shown.chosenWorkflow === undefined
				? "recommended by the agent"
				: "your choice";
		setQuestion(
			`Accept ${props.name} as a ready Goal with Workflow ${shown.workflow} (${whose}; w changes it) and ${ticketCount(shown.tickets.length)}? y accepts`,
		);
	};
	const accept = async () => {
		setAccepting(true);
		const end = await runPlanAccept(props.vago, props.root, props.name);
		setAccepting(false);
		if (end.outcome === "refused") {
			setNotice(projectMessage(end.reason, props.root));
			return;
		}
		const tickets = ticketCount(proposal()?.tickets.length ?? 0);
		props.onClose(
			`Accepted ${props.name} as a ready Goal with ${tickets}; s starts it.`,
		);
	};
	useKeyboard((key) => {
		setNotice(undefined);
		// Any key answers the question; only `y` accepts.
		if (question() !== undefined) {
			setQuestion(undefined);
			if (key.name === "y") accept();
			return;
		}
		if (helpShown()) {
			if (key.name === "escape" || key.name === "?") setHelpShown(false);
			return;
		}
		if (key.name === "escape" && picking()) setPicking(false);
		else if (key.name === "escape") props.onClose();
		// The picker has the arrows and Enter until it closes.
		else if (picking()) return;
		else if (key.ctrl && key.name === "r") retryResponse();
		else if (key.name === "tab") {
			setFocus(focus() === "chat" ? "preview" : "chat");
		} else if (key.name === "?" && focus() === "preview") setHelpShown(true);
		// One acceptance at a time, and no new choice meanwhile or after. Until
		// the chat is read, whether the item was accepted isn't known.
		else if (accepting() || chat() === undefined || accepted()) return;
		else if (focus() !== "preview") return;
		else if (key.name === "w" && proposal() !== undefined) setPicking(true);
		else if (key.name === "a") askAccept();
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
						aside={titleAside()}
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
									retryable={retryable() && turn.number === turns().length}
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
					<Show when={accepted()}>
						<text {...dimText} flexShrink={0} wrapMode="none">
							{fitText("Accepted as a Goal; this chat is read-only.", inner())}
						</text>
					</Show>
					{/* Not there until the chat is read, so nothing is typed into
					    an accepted Goal's chat. */}
					<Show when={chat() !== undefined && !accepted()}>
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
					</Show>
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
						accepted={accepted()}
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
					keys={footerKeys(focus(), {
						shown: proposal() !== undefined,
						accepted: accepted(),
						retryable: canRetry(),
					})}
					width={terminal().width - 2}
					notice={
						question() ??
						(accepting() ? "Accepting…" : undefined) ??
						(retryPending() ? "Retrying…" : undefined) ??
						notice() ??
						(answering()
							? "The agent is still answering; press Enter again once it has."
							: undefined)
					}
				/>
			</box>
			<Show when={helpShown()}>
				<KeyHelp keys={helpKeys(symbol.upDown)} />
			</Show>
		</box>
	);
}

// `upDown` names the arrow keys.
const helpKeys = (upDown: string): HelpKey[] => [
	{ keys: "Enter", meaning: "send a message, or ask for changes" },
	{ keys: "Ctrl-R", meaning: "retry an interrupted response" },
	{ keys: "Tab", meaning: "move between the chat and the Preview" },
	{ keys: `${upDown} PgUp PgDn`, meaning: "scroll the Preview" },
	{ keys: "a", meaning: "accept the Proposal as a ready Goal" },
	{ keys: "w", meaning: "choose the Goal's Workflow" },
	{ keys: "Esc", meaning: "back to the Goals" },
	{ keys: "?", meaning: "show, hide these keys, from the Preview" },
	{ keys: "q Ctrl-C", meaning: "quit; in the field only Ctrl-C" },
];

// How long the agent spent on `turns` and what they cost: each response
// that ended, and one being written up to `now`. An interrupted attempt
// counts no time, since nobody recorded when it stopped, and no cost, since
// its session never reported one.
function agentTotals(
	turns: PlanningTurn[],
	now: Date,
): { agentMs: number; costUsd: number } {
	let agentMs = 0;
	let costUsd = 0;
	for (const turn of turns) {
		costUsd += turn.costUsd ?? 0;
		if (turn.outcome === "interrupted") continue;
		const end = turn.endedAt ?? now;
		agentMs += end.getTime() - turn.startedAt.getTime();
	}
	return { agentMs, costUsd };
}

// "1 Ticket", "2 Tickets".
function ticketCount(count: number): string {
	return `${count} ${count === 1 ? "Ticket" : "Tickets"}`;
}

// The keys of the footer while `focus` has the focus, `w` and `a` only
// while a Proposal is `shown` and the item not yet `accepted`, which also
// leaves no field to send from, and Ctrl-R only while the last response is
// `retryable`. In the field `q` types, so only Ctrl-C quits there, which
// `tui.tsx` owns.
function footerKeys(
	focus: PlanningViewPane,
	chat: { shown: boolean; accepted: boolean; retryable: boolean },
): FooterKey[] {
	const { shown, accepted, retryable } = chat;
	const retry = retryable
		? [{ keys: "Ctrl-R", label: "Retry response", use: 3 }]
		: [];
	if (focus === "chat") {
		return [
			...(accepted ? [] : [{ keys: "Enter", label: "Send", use: 3 }]),
			...retry,
			{ keys: "Tab", label: "Preview", use: 2 },
			{ keys: "Esc", label: "Back", use: 1 },
		];
	}
	return [
		{ keys: "Tab", label: "Chat", use: 3 },
		...retry,
		...(shown && !accepted
			? [
					{ keys: "a", label: "Accept", use: 2 },
					{ keys: "w", label: "Workflow", use: 2 },
				]
			: []),
		{ keys: "Esc", label: "Back", use: 1 },
		{ keys: "?", label: "Help", use: 3 },
		{ keys: "q", label: "Quit", use: 2 },
	];
}

// The chat and the Proposal of planning item `item` of the Project at
// `root`, and the names of its Workflows, undefined (none) until the first
// read ends, then read again every `refreshMs`, and on `reread`, for as long
// as the calling component lives. `readAt` is when the last read started, so
// time that runs to now moves on with each read. A read that fails keeps what
// the last one gave and its reason in `failure`, until a read succeeds; a bad
// Proposal stops no chat from showing.
function livePlanning(
	root: string,
	item: string,
): {
	chat: () => PlanningChat | undefined;
	proposal: () => PlanningProposal | undefined;
	workflows: () => string[];
	failure: () => string | undefined;
	readAt: () => Date;
	reread: () => void;
} {
	const [chat, setChat] = createSignal<PlanningChat>();
	const [proposal, setProposal] = createSignal<PlanningProposal>();
	const [workflows, setWorkflows] = createSignal<string[]>([]);
	const [failure, setFailure] = createSignal<string>();
	const [readAt, setReadAt] = createSignal(new Date());
	let lastChat = "";
	let lastProposal = "";
	let reading = false;
	const read = async () => {
		if (reading) return;
		reading = true;
		setReadAt(new Date());
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
	return { chat, proposal, workflows, failure, readAt, reread: read };
}

// One turn of a chat on Harness `harness`, `width` columns wide: its
// message, then the response read from its log as it grows, live while the
// turn is open, each proposal block in it one dim line that says whether it
// is the Proposal from turn `proposalTurn` in the Preview, an earlier one or
// one never saved, then for a turn that didn't end `ok` the reason, and why
// its block couldn't be read. A `retryable` turn says Ctrl-R answers it again
// in place of its reason. Each earlier, interrupted attempt at the response
// shows between the message and the response.
function TurnLines(props: {
	root: string;
	harness: string | undefined;
	turn: PlanningTurn;
	proposalTurn: number | undefined;
	retryable: boolean;
	width: number;
}): JSX.Element {
	const { color } = theme();
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
		if (outcome === undefined || outcome === "ok" || props.retryable) {
			return undefined;
		}
		return outcome === "error" ? (reason ?? outcome) : `ended ${outcome}`;
	};
	return (
		<>
			<MessageLines message={props.turn.message} width={props.width} />
			<For each={props.turn.interruptedLogs}>
				{(log) => (
					<AttemptLines
						root={props.root}
						harness={props.harness}
						log={log}
						width={props.width}
					/>
				)}
			</For>
			<ResponseLines
				root={props.root}
				harness={props.harness}
				log={props.turn.log}
				live={props.turn.outcome === undefined}
				blockWords={blockWords}
				width={props.width}
			/>
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
			<Show when={props.retryable}>
				<For
					each={wrapText(
						"The response was interrupted; Ctrl-R retries it.",
						props.width,
					)}
				>
					{(line) => (
						<text fg={color.warn} flexShrink={0} wrapMode="none">
							{line}
						</text>
					)}
				</For>
			</Show>
			<box height={1} flexShrink={0} />
		</>
	);
}

// An earlier attempt at a turn's response on Harness `harness`, read from
// `log`, `width` columns wide, then a dim line saying it was interrupted and
// retried. A proposal block in it was never saved.
function AttemptLines(props: {
	root: string;
	harness: string | undefined;
	log: string;
	width: number;
}): JSX.Element {
	const { dimText } = theme();
	return (
		<>
			<ResponseLines
				root={props.root}
				harness={props.harness}
				log={props.log}
				live={false}
				blockWords={() => "Proposal not saved"}
				width={props.width}
			/>
			<text {...dimText} flexShrink={0} wrapMode="none">
				{fitText(`${blockIndent}Response interrupted; retried`, props.width)}
			</text>
		</>
	);
}

// A response of a chat on Harness `harness`, read from `log` as it grows and
// drawn as Run activity `width` columns wide, `live` while it is being
// written, each proposal block in it one dim line of what `blockWords` says
// of a block closed or not. Nothing while the log can't be read, or when
// this build doesn't know the Harness.
function ResponseLines(props: {
	root: string;
	harness: string | undefined;
	log: string;
	live: boolean;
	blockWords: (closed: boolean) => string;
	width: number;
}): JSX.Element {
	const { dimText } = theme();
	const read = liveRunLog(() => props.log);
	const parts = createMemo(() => {
		const text = read()?.text;
		const harness = props.harness;
		if (harness === undefined || !knownHarness(harness) || text === undefined) {
			return [];
		}
		return withoutProposalBlocks(
			findHarness(harness).runActivity(text.split("\n"), props.root),
		);
	});
	return (
		<For each={parts()}>
			{(part) =>
				part.kind === "activity" ? (
					<RunActivityLines
						activity={part.activity}
						live={props.live}
						filled={false}
						width={props.width}
					/>
				) : (
					<text {...dimText} flexShrink={0} wrapMode="none">
						{fitText(
							`${blockIndent}${props.blockWords(part.closed)}`,
							props.width,
						)}
					</text>
				)
			}
		</For>
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
