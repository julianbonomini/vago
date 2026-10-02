// Builds an agent Step's prompt from the prompt file's text. Hides the
// substitution syntax. Does no I/O.

/** The texts a prompt can refer to. */
export type PromptTexts = {
	/** The Ticket's title and body, never its header. */
	ticket: string;
	/** The body of the Goal's `goal.md`. */
	goal: string;
};

const placeholder = /\{\{(ticket|goal)\}\}/g;

/** Returns `template` with `{{ticket}}` and `{{goal}}` replaced by their texts. */
export function buildPrompt(template: string, texts: PromptTexts): string {
	// One pass, so a `{{goal}}` written inside the Ticket stays as written.
	return template.replace(placeholder, (_, name: "ticket" | "goal") =>
		name === "ticket" ? texts.ticket : texts.goal,
	);
}
