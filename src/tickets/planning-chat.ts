// A planning item's `planning/chat.toml`: its schema, reading it, and
// rewriting it in place atomically. Hides the file's name and its TOML.
// Takes the item's `planning/` folder, so it never imports `tickets.ts`.

import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import { writeFileAtomically } from "./header.ts";

// Loose objects, so fields Vago doesn't know survive a rewrite.
const TurnTable = z.looseObject({
	message: z.string(),
	started: z.date(),
	ended: z.date().optional(),
	outcome: z.string().optional(),
	reason: z.string().optional(),
	proposal_error: z.string().optional(),
	log: z.string(),
});

const ChatFile = z.looseObject({
	harness: z.string().optional(),
	session_id: z.string().optional(),
	turns: z.array(TurnTable).optional(),
});

/** A `[[turns]]` table of `chat.toml`, spelled as in the file. */
export type PlanningTurnTable = z.infer<typeof TurnTable>;

/** `chat.toml`, with the fields as spelled in the file. */
export type PlanningChatFile = z.infer<typeof ChatFile>;

/**
 * The `chat.toml` in `folder`, a planning item's `planning/` folder, as
 * spelled in the file; empty when there is none yet. Throws an Error naming
 * the file when it isn't valid TOML or a field is bad.
 */
export async function readPlanningChatFile(
	folder: string,
): Promise<PlanningChatFile> {
	const file = chatFile(folder);
	const text = Bun.file(file);
	if (!(await text.exists())) return {};
	let toml: unknown;
	try {
		// smol-toml, not Bun.TOML, so the datetimes round-trip as in header.ts.
		toml = parse(await text.text());
	} catch (error) {
		throw new Error(`${file} isn't valid TOML: ${error}`);
	}
	const checked = ChatFile.safeParse(toml);
	if (!checked.success) {
		throw new Error(`${file}: ${z.prettifyError(checked.error)}`);
	}
	return checked.data;
}

/**
 * Reads the `chat.toml` in `folder` as `readPlanningChatFile` does, lets
 * `change` edit it in place, writes it back, and returns what `change`
 * returned. A crash leaves the old file or the new one, never half of each.
 */
export async function rewritePlanningChatFile<Change>(
	folder: string,
	change: (chat: PlanningChatFile) => Change,
): Promise<Change> {
	const chat = await readPlanningChatFile(folder);
	const changed = change(chat);
	await writeFileAtomically(chatFile(folder), stringify(chat));
	return changed;
}

function chatFile(folder: string): string {
	return join(folder, "chat.toml");
}
