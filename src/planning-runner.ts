// One planning turn: the message the human sends a planning item's agent
// and the response to it, written while this process holds the item, and
// Retry response, which answers an interrupted turn again. Hides recording
// the turn, the planning instructions ahead of a fresh session's message,
// fresh vs. resumed, and how a failure is recorded.

import type { HarnessSessionReport } from "./harness/registry.ts";
import {
	type RunOutcome,
	runReadOnlySession,
	spellOutcome,
} from "./step-runner.ts";
import {
	type PlanningTurnEntry,
	readPlanningChat,
	recordPlanningSession,
	recordPlanningTurnEnd,
	recordPlanningTurnRetry,
	recordPlanningTurnStart,
	withPlanningItemClaimed,
} from "./tickets/tickets.ts";
import { readPlanningPrompt } from "./workflow.ts";

// The Harness and model every planning chat starts on. TODO(06): the human
// picks them.
const planningHarness = "claude-code";
const planningModel = "opus";

// What a resumed session is handed in place of the message it was answering.
// Not the Step's continue message: a planning agent has no working tree.
const continueMessage =
	"You were interrupted. Continue your answer from where you stopped.\n";

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
 * planning item, or while another vago is answering or changing the item.
 * Throws after recording the turn as `error` with the reason when the
 * instructions are missing or no sandbox is available.
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
	return withPlanningItemClaimed(root, item, async () => {
		const chat = await readPlanningChat(root, item);
		const harness = chat.harness ?? planningHarness;
		const entry = await recordPlanningTurnStart(root, item, message, harness);
		return answerTurn(root, entry, harness, {
			resume: chat.sessionId,
			input: message,
		});
	});
}

/**
 * Answers the interrupted last response of planning item `item`, in the
 * Project at `root`, once more, in the same turn, and waits for it. A
 * response whose session an earlier attempt reported resumes that session,
 * told to continue; otherwise its message is sent again as the first
 * attempt sent it. Throws, recording nothing, while another vago is
 * answering or changing the item, when the last response wasn't
 * interrupted, and as `sendPlanningMessage` does.
 */
export async function retryPlanningResponse(
	root: string,
	item: string,
): Promise<PlanningResponse> {
	return withPlanningItemClaimed(root, item, async () => {
		const chat = await readPlanningChat(root, item);
		const harness = chat.harness ?? planningHarness;
		const retry = await recordPlanningTurnRetry(root, item);
		return answerTurn(
			root,
			retry.entry,
			harness,
			retry.sessionId === undefined
				? { resume: chat.sessionId, input: retry.message }
				: { resume: retry.sessionId, input: continueMessage },
		);
	});
}

// Answers the turn `entry` records on `harness`, in the Project at `root`,
// as `runTurn` does with `start`, and records how it ended.
async function answerTurn(
	root: string,
	entry: PlanningTurnEntry,
	harness: string,
	start: { resume?: string; input: string },
): Promise<PlanningResponse> {
	// Recorded as the turn's end, so the human sees why there's no response.
	const ran = await runTurn(root, entry, harness, start).catch(
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

// Runs the session of the turn `entry` records on `harness`, in the Project
// at `root`: resumes session `start.resume` with `start.input`, or, with no
// session to resume, starts one with the planning instructions ahead of it.
async function runTurn(
	root: string,
	entry: PlanningTurnEntry,
	harness: string,
	start: { resume?: string; input: string },
): Promise<{ outcome: RunOutcome; report: HarnessSessionReport }> {
	// A chat whose first turn failed before its session started has no id
	// yet, so its next turn starts one as the first would have.
	const input =
		start.resume === undefined
			? `${(await readPlanningPrompt(root)).trimEnd()}\n\n${start.input}`
			: start.input;
	return runReadOnlySession(
		{
			harness,
			model: planningModel,
			resume: start.resume,
			input,
			folder: root,
			log: entry.log,
		},
		(sessionId) => recordPlanningSession(entry, sessionId),
	);
}
