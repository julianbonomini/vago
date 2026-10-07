// The Preview pane of the planning view: a planning item's Proposal as the
// Goal and Tickets it would become, whether it is ready to accept, and the
// picker the human chooses its Workflow in. Hides the pane's layout, its
// scrolling and the picker's keys.

import { type ScrollBoxRenderable, TextAttributes } from "@opentui/core";
import { type JSX, useKeyboard } from "@opentui/solid";
import { createEffect, createSignal, For, on, Show } from "solid-js";
import {
	type PlanningProposal,
	recordPlanningWorkflow,
	ticketNumberText,
} from "../tickets/tickets.ts";
import { projectMessage } from "./goal-rows.ts";
import { sharedLine, usePane } from "./pane-grid.ts";
import { PaneTitle } from "./pane-title.tsx";
import { joinParagraphs, wrapText } from "./text-fit.ts";
import { theme } from "./theme.ts";

/**
 * `proposal`, planning item `item`'s in the Project at `root`, in a pane
 * titled Preview, `width` columns wide, its left edge the session pane's
 * right one when `besideSession`. Its title row says whether it is ready to
 * accept, or that it was, once `accepted`; its body shows the Workflow, the
 * problems, the open decisions, the Goal and each Ticket with its blockers.
 * While `focused`, ↑↓, PgUp and PgDn scroll it. While `picking`, unless
 * `accepted`, it lists `workflows` above the body, where no scrolling hides
 * them, the recommended one marked and selected first: ↑↓ move and scroll
 * nothing, and Enter records the selected one as the human's choice and
 * calls `onPicked` with why it was refused, if it was.
 */
export function PlanningPreview(props: {
	root: string;
	item: string;
	proposal: PlanningProposal | undefined;
	workflows: string[];
	width: number;
	besideSession: boolean;
	focused: boolean;
	accepted: boolean;
	picking: boolean;
	onPicked: (refusal?: string) => void;
}): JSX.Element {
	const { color } = theme();
	// An accepted item's Workflow is its Goal's, so it is never picked again.
	const picking = () => props.picking && !props.accepted;
	const inner = () => props.width - paneEdges;
	const [picked, setPicked] = createSignal(0);
	createEffect(
		on(picking, (opened) => {
			if (!opened) return;
			const recommended = props.proposal?.recommendedWorkflow ?? "";
			setPicked(Math.max(0, props.workflows.indexOf(recommended)));
		}),
	);
	let scroll: ScrollBoxRenderable | undefined;
	const pick = async () => {
		const name = props.workflows[picked()];
		if (name === undefined) return props.onPicked();
		try {
			await recordPlanningWorkflow(
				props.root,
				props.item,
				name,
				props.workflows,
			);
			props.onPicked();
		} catch (error) {
			props.onPicked(projectMessage(error, props.root));
		}
	};
	useKeyboard((key) => {
		if (!props.focused) return;
		const last = props.workflows.length - 1;
		if (picking()) {
			if (key.name === "up") setPicked(Math.max(0, picked() - 1));
			else if (key.name === "down") setPicked(Math.min(last, picked() + 1));
			else if (key.name === "return") pick();
		} else if (key.name === "up") scroll?.scrollBy(-1);
		else if (key.name === "down") scroll?.scrollBy(1);
		else if (key.name === "pageup") scroll?.scrollBy(-1, "viewport");
		else if (key.name === "pagedown") scroll?.scrollBy(1, "viewport");
	});
	const ready = () => props.proposal?.problems.length === 0;
	const pane = usePane();
	return (
		<box
			ref={pane}
			border
			marginLeft={props.besideSession ? -sharedLine : 0}
			paddingLeft={1}
			paddingRight={1}
			flexGrow={1}
			flexDirection="column"
		>
			<PaneTitle
				title="Preview"
				aside={
					props.proposal === undefined
						? undefined
						: props.accepted
							? "accepted"
							: ready()
								? "ready to accept"
								: "not ready"
				}
				asideColor={ready() || props.accepted ? color.ok : undefined}
				focused={props.focused}
				width={inner()}
			/>
			{/* Above the scrollbox, so no scrolling hides it. */}
			<Show when={picking()}>
				<WorkflowPicker
					workflows={props.workflows}
					recommended={props.proposal?.recommendedWorkflow}
					picked={picked()}
				/>
			</Show>
			{/* Never focused, so a click leaves the keys to this pane's own
			    handler and the picker keeps the arrows. */}
			<scrollbox
				ref={(box: ScrollBoxRenderable) => {
					scroll = box;
				}}
				focusable={false}
				flexGrow={1}
				verticalScrollbarOptions={{ visible: false }}
			>
				<Show
					when={props.proposal}
					fallback={
						<For
							each={wrapText(
								"No proposal yet. The agent writes one once its questions are settled.",
								inner(),
							)}
						>
							{(line) => <DimLine text={line} />}
						</For>
					}
				>
					{(proposal: () => PlanningProposal) => (
						<ProposalLines
							proposal={proposal()}
							picking={picking()}
							width={inner()}
						/>
					)}
				</Show>
			</scrollbox>
		</box>
	);
}

// The pane's border and padding, on both sides.
const paneEdges = 4;

// Where a Ticket's blockers and text start, past its number and a space.
const ticketIndent = "   ";

// `proposal`'s body, `width` columns wide: its Workflow unless `picking`,
// its problems, open decisions, Goal and Tickets.
function ProposalLines(props: {
	proposal: PlanningProposal;
	picking: boolean;
	width: number;
}): JSX.Element {
	const { color } = theme();
	const paragraphs = (text: string, indent: string) =>
		joinParagraphs(text).flatMap((paragraph) =>
			wrapText(paragraph, props.width - indent.length).map(
				(line) => `${indent}${line}`,
			),
		);
	return (
		<>
			<Show when={!props.picking}>
				<For each={wrapText(workflowText(props.proposal), props.width)}>
					{(line) => <PlainLine text={line} />}
				</For>
			</Show>
			<For
				each={props.proposal.problems.flatMap((problem) =>
					wrapText(problem, props.width),
				)}
			>
				{(line) => (
					<text fg={color.bad} flexShrink={0} wrapMode="none">
						{line}
					</text>
				)}
			</For>
			<Show when={props.proposal.openDecisions.length > 0}>
				<Gap />
				<HeadingLine text="Open decisions" />
				<For
					each={props.proposal.openDecisions.flatMap((decision) =>
						paragraphs(decision, "  "),
					)}
				>
					{(line) => <PlainLine text={line} />}
				</For>
			</Show>
			<Gap />
			<For each={wrapText(props.proposal.goal.title, props.width)}>
				{(line) => <HeadingLine text={line} />}
			</For>
			<For each={paragraphs(props.proposal.goal.description, "")}>
				{(line) => <PlainLine text={line} />}
			</For>
			<Gap />
			<HeadingLine text="Tickets" />
			<For each={props.proposal.tickets}>
				{(ticket) => (
					<>
						<HeadingLine
							text={`${ticketNumberText(ticket.number)} ${ticket.title}`}
						/>
						<DimLine
							text={`${ticketIndent}${
								ticket.blockedBy.length === 0
									? "no blockers"
									: `blocked by ${ticket.blockedBy.map(ticketNumberText).join(", ")}`
							}`}
						/>
						<For each={paragraphs(ticket.description, ticketIndent)}>
							{(line) => <PlainLine text={line} />}
						</For>
					</>
				)}
			</For>
		</>
	);
}

// `workflows`, the `picked`th selected and the `recommended` one marked.
function WorkflowPicker(props: {
	workflows: string[];
	recommended: string | undefined;
	picked: number;
}): JSX.Element {
	const { color, selection } = theme();
	return (
		<box flexShrink={0} flexDirection="column">
			<DimLine text="Choose the Workflow:" />
			<For each={props.workflows}>
				{(name, index) => {
					const selected = () => index() === props.picked;
					const recommended = name === props.recommended ? ", recommended" : "";
					return (
						<text
							fg={selected() ? selection.fg : color.fg}
							bg={selected() ? selection.bg : undefined}
							attributes={selected() ? selection.attributes : 0}
							flexShrink={0}
							wrapMode="none"
						>
							{`  ${name}${recommended}`}
						</text>
					);
				}}
			</For>
		</box>
	);
}

// The Workflow acceptance would use and why: the human's choice beside the
// agent's recommendation, or the recommendation alone.
function workflowText(proposal: PlanningProposal): string {
	const { chosenWorkflow, recommendedWorkflow, workflowReason } = proposal;
	const reason = workflowReason === undefined ? "" : `: ${workflowReason}`;
	if (chosenWorkflow !== undefined && chosenWorkflow !== recommendedWorkflow) {
		return recommendedWorkflow === undefined
			? `${chosenWorkflow}, chosen`
			: `${chosenWorkflow}, chosen; ${recommendedWorkflow} recommended${reason}`;
	}
	if (recommendedWorkflow !== undefined) {
		return `${recommendedWorkflow}, ${chosenWorkflow === undefined ? "recommended" : "chosen and recommended"}${reason}`;
	}
	return "No Workflow recommended yet";
}

function PlainLine(props: { text: string }): JSX.Element {
	const { color } = theme();
	return (
		<text fg={color.fg} flexShrink={0} wrapMode="none">
			{/* An empty text takes no row, and the blank line must. */}
			{props.text === "" ? " " : props.text}
		</text>
	);
}

function HeadingLine(props: { text: string }): JSX.Element {
	const { color } = theme();
	return (
		<text
			fg={color.bright}
			attributes={TextAttributes.BOLD}
			flexShrink={0}
			wrapMode="none"
		>
			{props.text}
		</text>
	);
}

function DimLine(props: { text: string }): JSX.Element {
	const { dimText } = theme();
	return (
		<text {...dimText} flexShrink={0} wrapMode="none">
			{props.text}
		</text>
	);
}

function Gap(): JSX.Element {
	return <box height={1} flexShrink={0} />;
}
