// One planning turn: the message the human sends a planning item's agent
// and the response to it. Hides recording the turn, the planning
// instructions ahead of a fresh session's message, fresh vs. resumed, and
// how a failure is recorded.

import type { HarnessSessionReport } from "./harness/registry.ts";
import {
	type RunOutcome,
	runReadOnlySession,
	spellOutcome,
} from "./step-runner.ts";
import {
	type PlanningChat,
	type PlanningTurnEntry,
	readPlanningChat,
	recordPlanningSession,
	recordPlanningTurnEnd,
	recordPlanningTurnStart,
} from "./tickets/tickets.ts";
import { readPlanningPrompt } from "./workflow.ts";

// The Harness and model every planning chat starts on. TODO(06): the human
// picks them.
const planningHarness = "claude-code";
const planningModel = "opus";

/** How a planning turn's response ended. */
export type PlanningResponse =
	| { outcome: "ok"; answer: string }
	| { outcome: "failed"; reason: string };

/**
 * Sends `message` as the next turn of planning item `item`'s chat, in the
 * Project at `root`, and waits for the agent's response. A chat with no
 * session yet starts one in the Project root with the planning instructions
 * ahead of the message; otherwise the saved session is resumed with the
 * message alone. The agent can read the Project but not write under it.
 * Throws, recording nothing, for an empty message, when `item` is no
 * planning item, or when a turn is already open. Throws after recording the
 * turn as `error` with the reason when the instructions are missing or no
 * sandbox is available.
 */
export async function sendPlanningMessage(
	root: string,
	item: string,
	message: string,
): Promise<PlanningResponse> {
	// An agent handed nothing would answer a question nobody asked.
	if (message.trim() === "") {
		throw new Error(`The message for ${item} is empty`);
	}
	const chat = await readPlanningChat(root, item);
	const harness = chat.harness ?? planningHarness;
	const entry = await recordPlanningTurnStart(root, item, message, harness);
	// Recorded as the turn's end, so the human sees why there's no response.
	const ran = await runTurn(root, chat, harness, message, entry).catch(
		async (error: unknown) => {
			const reason = error instanceof Error ? error.message : String(error);
			await recordPlanningTurnEnd(entry, "error", { reason });
			throw error;
		},
	);
	const outcome = spellOutcome(ran.outcome);
	await recordPlanningTurnEnd(
		entry,
		outcome,
		ran.outcome.kind === "ok" ? { answer: ran.report.resultText ?? "" } : {},
	);
	return ran.outcome.kind === "ok"
		? { outcome: "ok", answer: ran.report.resultText ?? "" }
		: {
				outcome: "failed",
				reason: `the response ended ${outcome}; its log: ${entry.log}`,
			};
}

// Runs the session of the turn `entry` records, sending `message` in the
// Project at `root`, as the next turn of `chat` on `harness`.
async function runTurn(
	root: string,
	chat: PlanningChat,
	harness: string,
	message: string,
	entry: PlanningTurnEntry,
): Promise<{ outcome: RunOutcome; report: HarnessSessionReport }> {
	// A chat whose first turn failed before its session started has no id
	// yet, so its next turn starts one as the first would have.
	const input =
		chat.sessionId === undefined
			? `${(await readPlanningPrompt(root)).trimEnd()}\n\n${message}`
			: message;
	return runReadOnlySession(
		{
			harness,
			model: planningModel,
			resume: chat.sessionId,
			input,
			folder: root,
			log: entry.log,
		},
		(sessionId) => recordPlanningSession(entry, sessionId),
	);
}
