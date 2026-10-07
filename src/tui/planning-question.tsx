// What the Project view asks before it changes a planning item, over its
// footer: the question's words, the field a name is typed in, the Harnesses
// a new one can plan on, and the keys that answer it. Hides how the field
// and the choice are drawn and read.

import { type InputRenderable, TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { Show } from "solid-js";
import { findHarness } from "../harness/registry.ts";
import type { FooterKey } from "./screen-keys.tsx";
import { theme } from "./theme.ts";

/**
 * A question about a planning item: a name for a new one, which plans on
 * the Harness at index `chosen` of `harnesses`, a new name for `item`, or
 * whether to discard `item`.
 */
export type PlanningQuestion =
	| { kind: "new"; harnesses: string[]; chosen: number }
	| { kind: "rename"; item: string }
	| { kind: "discard"; item: string };

/**
 * The line asking `question`, and for a name a field to type it in, which
 * has the keys while it shows, starting from the item's name on a rename.
 * Enter in the field calls `onName` with what it holds. A new item's
 * Harnesses follow the field, the chosen one in brackets, when there is a
 * choice.
 */
export function QuestionLine(props: {
	question: PlanningQuestion;
	onName: (name: string) => void;
}): JSX.Element {
	const { color } = theme();
	const asked = () => {
		switch (props.question.kind) {
			case "new":
				return "New Goal name: ";
			case "rename":
				return `Rename ${props.question.item} to: `;
			case "discard":
				return `Discard ${props.question.item} and everything saved with it? y/n`;
		}
	};
	const nameShown = () =>
		props.question.kind === "rename" ? props.question.item : "";
	// Brackets, not a colour alone, mark the choice.
	const harnessChoice = () => {
		const { question } = props;
		if (question.kind !== "new" || question.harnesses.length < 2) {
			return undefined;
		}
		return question.harnesses
			.map((name, index) => {
				const { title } = findHarness(name);
				return index === question.chosen ? `[${title}]` : title;
			})
			.join(" ");
	};
	let field: InputRenderable | undefined;
	// The accent and bold show Vago waits for an answer, and bold alone does
	// it in a theme without colour.
	return (
		<box flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1}>
			<text
				fg={color.accent}
				attributes={TextAttributes.BOLD}
				flexShrink={0}
				wrapMode="none"
			>
				{asked()}
			</text>
			<Show when={props.question.kind !== "discard"}>
				<input
					ref={(input: InputRenderable) => {
						field = input;
					}}
					focused
					flexGrow={1}
					value={nameShown()}
					textColor={color.fg}
					focusedTextColor={color.fg}
					backgroundColor="transparent"
					focusedBackgroundColor="transparent"
					cursorColor={color.fg}
					// Read from the field: what OpenTUI hands its handler isn't typed.
					onSubmit={() => props.onName(field?.value ?? "")}
				/>
			</Show>
			<Show when={harnessChoice()}>
				{(choice: () => string) => (
					<text fg={color.bright} flexShrink={0} wrapMode="none">
						{choice()}
					</text>
				)}
			</Show>
		</box>
	);
}

/** The footer's keys while `question` is asked: those that answer it. */
export function questionKeys(question: PlanningQuestion): FooterKey[] {
	if (question.kind === "discard") {
		return [
			{ keys: "y", label: "Discard", use: 2 },
			{ keys: "any other key", label: "Keep", use: 1 },
		];
	}
	if (question.kind === "rename") {
		return [
			{ keys: "Enter", label: "Rename", use: 2 },
			{ keys: "Esc", label: "Cancel", use: 1 },
		];
	}
	return [
		{ keys: "Enter", label: "Create", use: 2 },
		...(question.harnesses.length < 2
			? []
			: [{ keys: "Tab", label: "Harness", use: 1 }]),
		{ keys: "Esc", label: "Cancel", use: 1 },
	];
}
