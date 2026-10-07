// A planning item's `planning/chat.toml`: its schema, reading it, and
// rewriting it in place atomically. Hides the file's name and its TOML.
// Takes the item's `planning/` folder, so it never imports `tickets.ts`.

import { join } from "node:path";
import { stringify } from "smol-toml";
import { z } from "zod";
import { readTomlFile, writeFileAtomically } from "./header.ts";

// Loose objects, so fields Vago doesn't know survive a rewrite.
// `session_id` is the Harness session the run was, once known, and
// `cost_usd` what that Harness session had cost when last read, earlier runs
// of it included.
const SessionTable = z.looseObject({
	started: z.date(),
	ended: z.date().optional(),
	session_id: z.string().optional(),
	cost_usd: z.number().optional(),
});

const ChatFile = z.looseObject({
	harness: z.string().optional(),
	session_id: z.string().optional(),
	sessions: z.array(SessionTable).optional(),
});

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
	return (await readTomlFile(chatFile(folder), ChatFile)) ?? {};
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
