// A planning item's agent: the Harnesses it can run on, making an item on
// one, one planning turn (the message the human sends the agent and the
// response to it, written while this process holds the item), and Retry
// response, which answers an interrupted turn again. Hides each Harness's
// planning model, the default Harness, recording the turn, the planning
// instructions ahead of a fresh session's message, fresh vs. resumed, and
// how a failure is recorded.

import {
	type HarnessSessionReport,
	installedHarnesses,
} from "./harness/registry.ts";
import {
	type RunOutcome,
	runReadOnlySession,
	spellOutcome,
} from "./step-runner.ts";
import {
	createPlanningItem,
	type PlanningTurnEntry,
	readPlanningChat,
	recordPlanningSession,
	recordPlanningTurnEnd,
	recordPlanningTurnRetry,
	recordPlanningTurnStart,
	withPlanningItemClaimed,
} from "./tickets/tickets.ts";
import { readPlanningPrompt } from "./workflow.ts";

// The model a planning agent runs on, by the Harness it plans on: Opus on
// Claude Code, and on Codex the model the starter Workflows review with.
const planningModels: Record<string, string> = {
	"claude-code": "opus",
	codex: "gpt-6-sol",
};

// The Harness an item plans on when the human chooses none and its program
// is on `PATH`, or no planning Harness's is.
const defaultHarness = "claude-code";

// What a resumed session is handed in place of the message it was answering.
// Not the Step's continue message: a planning agent has no working tree.
const continueMessage =
	"You were interrupted. Continue your answer from where you stopped.\n";

/**
 * The name of every Harness a planning agent can run on whose program is on
 * `PATH`, the default first. When none is, the default alone, so that its
 * first turn says what to install.
 */
export function planningHarnesses(): string[] {
	const installed = installedHarnesses().filter((name) =>
		Object.hasOwn(planningModels, name),
	);
	return installed.length === 0 ? [defaultHarness] : installed;
}

// What an item plans on when the human chose nothing.
function harnessByDefault(): string {
	return planningHarnesses()[0] ?? defaultHarness;
}

/**
 * Makes planning item `name` in the Project at `root`, whose agent runs on
 * Harness `harness`, the first of `planningHarnesses` when not given, and
 * returns its folder. The Goal accepted from it goes through its Workflow's
 * Harnesses whatever this one is. Throws an Error naming the Harnesses that
 * plan, and makes nothing, for one that doesn't, and as
 * `createPlanningItem` does.
 */
export async function planNewGoal(
	root: string,
	name: string,
	harness = harnessByDefault(),
): Promise<string> {
	// Checked now, so a Harness that can't plan makes no item.
	planningModel(harness);
	return createPlanningItem(root, name, harness);
}

// The model a planning agent on `harness` runs on. Throws naming the
// Harnesses that plan when `harness` isn't one.
function planningModel(harness: string): string {
	const model = planningModels[harness];
	if (model === undefined) {
		throw new Error(
			`No planning agent runs on Harness "${harness}"; one runs on ${Object.keys(planningModels).join(", ")}`,
		);
	}
	return model;
}

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
		const harness = chat.harness ?? harnessByDefault();
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
		const harness = chat.harness ?? harnessByDefault();
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
	// Only a hand-edited `chat.toml` names a Harness this throws for.
	const model = planningModel(harness);
	// A chat whose first turn failed before its session started has no id
	// yet, so its next turn starts one as the first would have.
	const input =
		start.resume === undefined
			? `${(await readPlanningPrompt(root)).trimEnd()}\n\n${start.input}`
			: start.input;
	return runReadOnlySession(
		{
			harness,
			model,
			resume: start.resume,
			input,
			folder: root,
			log: entry.log,
		},
		(sessionId) => recordPlanningSession(entry, sessionId),
	);
}
