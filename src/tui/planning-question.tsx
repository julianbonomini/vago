// What the Project view asks before it changes a planning item, over its
// footer: the question's words, the field a name is typed in, and the keys
// that answer it. Hides how the field is drawn and read.

import type { InputRenderable } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { Show } from "solid-js";
import type { FooterKey } from "./screen-keys.tsx";
import { theme } from "./theme.ts";

/**
 * A question about a planning item: a name for a new one, a new name for
 * `item`, or whether to discard `item`.
 */
export type PlanningQuestion =
	| { kind: "new" }
	| { kind: "rename"; item: string }
	| { kind: "discard"; item: string };

/**
 * The line asking `question`, and for a name a field to type it in, which
 * has the keys while it shows, starting from the item's name on a rename.
 * Enter in the field calls `onName` with what it holds.
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
	let field: InputRenderable | undefined;
	return (
		<box flexShrink={0} flexDirection="row" paddingLeft={1} paddingRight={1}>
			<text fg={color.bright} flexShrink={0} wrapMode="none">
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
	return [
		{
			keys: "Enter",
			label: question.kind === "new" ? "Create" : "Rename",
			use: 2,
		},
		{ keys: "Esc", label: "Cancel", use: 1 },
	];
}
