// The planning view: a planning item opened from the Goals list, or an
// accepted Goal's from the Goal view, holding the item's planning session,
// the Preview of the agent's Proposal beside it, and Accept. Hides its
// layout, its keys, how the focus moves between the session and the
// Preview, when the chat and the Proposal are read again, and how an
// acceptance ends the session first and is asked for and waited on.

import { type JSX, useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createSignal, onCleanup, Show } from "solid-js";
import {
	type PlanningChat,
	type PlanningProposal,
	readPlanningChat,
	readPlanningProposal,
} from "../tickets/tickets.ts";
import { listWorkflows } from "../workflow.ts";
import { projectMessage } from "./goal-rows.ts";
import { sharedLine } from "./pane-grid.ts";
import { PlanningPreview } from "./planning-preview.tsx";
import { PlanningSessionPane } from "./planning-session-pane.tsx";
import {
	type FooterKey,
	type HelpKey,
	KeyFooter,
	KeyHelp,
} from "./screen-keys.tsx";
import { theme } from "./theme.ts";
import { duration, money } from "./time-and-money.ts";
import { runPlanAccept } from "./vago-commands.ts";

// How often the chat and the Proposal are read again: a Proposal saved
// meanwhile shows within this.
const refreshMs = 1000;

// The narrowest screen that shows the session and the Preview side by side;
// below it the focused one fills the screen.
const splitWidth = 100;

// The session's share of the screen's width when the Preview is beside it.
const sessionShare = 0.55;

// The panes the focus moves between.
type PlanningViewPane = "session" | "preview";

/**
 * Planning item `name` of the Project at `root` filling the screen under
 * the header: a pane titled with its name holding its planning session,
 * which starts as the view opens, through the command `vago`, and ends when
 * it closes. The title's right side says whether the item is planning or
 * accepted, and gives the time its sessions were open and what they cost,
 * which stay the item's own, never added to a Goal's Runs. Beside it, or
 * in its place below 100 columns while it has the focus, the Preview shows
 * the agent's Proposal. The session has the focus first, and while it has
 * it every key is the session's but Ctrl-], which moves the focus to the
 * Preview; there Ctrl-] or Tab moves it back. With the Preview focused `q`
 * quits and `?` shows every key until `?` or Esc.
 * There `a` asks whether to accept a Proposal that is ready, or says why it
 * isn't, and `y` ends the session and accepts the Proposal in a
 * `vago plan accept` (`runPlanAccept`) that the view waits on, any other
 * key cancelling. A refusal shows in the footer and starts the session
 * again, resuming it; an acceptance calls `onClose` with the notice to
 * show. A session that ends on its own with exit 0, as when the human quits
 * the Harness, calls `onClose` with no notice; any other exit stays, saying
 * how it ended. Once the item was accepted its session still opens, to read, but
 * there is no `a` or `w`. Esc from the Preview calls `onClose` with no
 * notice. Reads the chat and the Proposal itself, and again every second.
 */
export function PlanningView(props: {
	root: string;
	vago: string[];
	name: string;
	onClose: (notice?: string) => void;
}): JSX.Element {
	const { symbol } = theme();
	const terminal = useTerminalDimensions();
	const { chat, proposal, workflows, failure, reread } = livePlanning(
		props.root,
		props.name,
	);
	// Whether the item is planning or accepted, its planning time and cost.
	const titleAside = () => {
		const read = chat();
		if (read === undefined) return "";
		return [
			read.accepted ? "accepted" : "planning",
			duration(read.planningMs),
			money(read.costUsd),
		].join(` ${symbol.sep} `);
	};
	const [focus, setFocus] = createSignal<PlanningViewPane>("session");
	const [picking, setPicking] = createSignal(false);
	const [helpShown, setHelpShown] = createSignal(false);
	const [notice, setNotice] = createSignal<string>();
	// The question `a` asks before accepting, shown until the next key.
	const [question, setQuestion] = createSignal<string>();
	const [accepting, setAccepting] = createSignal(false);
	// Bumped to start the session again after a refused acceptance ended it.
	const [sessionStart, setSessionStart] = createSignal(1);
	const accepted = () => chat()?.accepted === true;
	let endSession: (() => Promise<void>) | undefined;
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
	// The session holds the item, which `vago plan accept` must take, so it
	// ends first.
	const accept = async () => {
		setAccepting(true);
		await endSession?.();
		const end = await runPlanAccept(props.vago, props.root, props.name);
		setAccepting(false);
		if (end.outcome === "refused") {
			setNotice(projectMessage(end.reason, props.root));
			setSessionStart((count) => count + 1);
			return;
		}
		const tickets = ticketCount(proposal()?.tickets.length ?? 0);
		props.onClose(
			`Accepted ${props.name} as a ready Goal with ${tickets}; s starts it.`,
		);
	};
	useKeyboard((key) => {
		// The handlers of the focused session run after this one, and skip a
		// key whose default is prevented.
		const switching = key.ctrl && key.name === "]";
		if (focus() === "session") {
			if (!switching) return;
			key.preventDefault();
			setFocus("preview");
			return;
		}
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
		else if (switching || key.name === "tab") {
			key.preventDefault();
			setFocus("session");
		} else if (key.name === "?") setHelpShown(true);
		// One acceptance at a time, and no new choice meanwhile or after. Until
		// the chat is read, whether the item was accepted isn't known.
		else if (accepting() || chat() === undefined || accepted()) return;
		else if (key.name === "w" && proposal() !== undefined) setPicking(true);
		else if (key.name === "a") askAccept();
	});
	// Started once the chat is read, after the key that opened the view, which
	// the session would otherwise get too, and again for each `sessionStart`.
	const sessionToStart = () =>
		chat() === undefined ? undefined : sessionStart();
	const split = () => terminal().width >= splitWidth;
	const sessionWidth = () =>
		split() ? Math.floor(terminal().width * sessionShare) : terminal().width;
	return (
		<box flexDirection="column" flexGrow={1}>
			<box flexDirection="row" flexGrow={1}>
				<Show when={sessionToStart()} keyed>
					<PlanningSessionPane
						vago={props.vago}
						root={props.root}
						item={props.name}
						title={props.name}
						aside={titleAside()}
						focused={focus() === "session"}
						visible={split() || focus() === "session"}
						width={sessionWidth()}
						onOpen={(end) => {
							endSession = end;
						}}
						onExit={(code) => {
							if (code === 0) props.onClose();
						}}
					/>
				</Show>
				<Show when={split() || focus() === "preview"}>
					<PlanningPreview
						root={props.root}
						item={props.name}
						proposal={proposal()}
						workflows={workflows()}
						width={
							split()
								? terminal().width - sessionWidth() + sharedLine
								: terminal().width
						}
						besideSession={split()}
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
					})}
					width={terminal().width - 2}
					notice={
						question() ??
						(accepting() ? "Accepting…" : undefined) ??
						notice() ??
						failure()
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
	{ keys: "Ctrl-] Tab", meaning: "move between the session and the Preview" },
	{ keys: `${upDown} PgUp PgDn`, meaning: "scroll the Preview" },
	{ keys: "a", meaning: "accept the Proposal as a ready Goal" },
	{ keys: "w", meaning: "choose the Goal's Workflow" },
	{ keys: "Esc", meaning: "back to the Goals, from the Preview" },
	{ keys: "?", meaning: "show, hide these keys" },
	{
		keys: "q Ctrl-C",
		meaning:
			"quit, from the Preview; in the session every key is the session's",
	},
];

// "1 Ticket", "2 Tickets".
function ticketCount(count: number): string {
	return `${count} ${count === 1 ? "Ticket" : "Tickets"}`;
}

// The keys of the footer while `focus` has the focus, `a` and `w` only
// while a Proposal is `shown` and the item not yet `accepted`. In the
// session every other key is the session's, `q` and Ctrl-C included.
function footerKeys(
	focus: PlanningViewPane,
	item: { shown: boolean; accepted: boolean },
): FooterKey[] {
	if (focus === "session")
		return [{ keys: "Ctrl-]", label: "Preview", use: 3 }];
	const { shown, accepted } = item;
	return [
		{ keys: "Ctrl-]", label: "Session", use: 3 },
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
// as the calling component lives. A read that fails keeps what the last one
// gave and its reason in `failure`, until a read succeeds.
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
