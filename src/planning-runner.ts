// A planning item's agent: the Harnesses it can run on, making an item on
// one, and its planning session, the Harness's own interactive session, run
// while this process holds the item. Hides each Harness's planning model,
// the default Harness, the session's id, the planning instructions, and
// fresh vs. resumed.

import {
	type HarnessTranscript,
	installedHarnesses,
} from "./harness/registry.ts";
import {
	type InteractiveReadOnlySession,
	type RunOutcome,
	runInteractiveReadOnlySession,
} from "./step-runner.ts";
import {
	createPlanningItem,
	type PlanningChat,
	readPlanningChat,
	recordPlanningSessionId,
	recordPlanningTranscript,
	withPlanningSession,
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

/**
 * The name of every Harness a planning agent can run on whose program is on
 * `PATH`, the default first. When none is, the default alone, so that its
 * session says what to install.
 */
export function planningHarnesses(): string[] {
	const installed = installedHarnesses().filter((name) =>
		Object.hasOwn(planningModels, name),
	);
	if (installed.length === 0) return [defaultHarness];
	// The default first, whatever order the registry lists them in.
	return installed.sort(
		(a, b) => Number(b === defaultHarness) - Number(a === defaultHarness),
	);
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

/**
 * Runs planning item `item`'s agent, in the Project at `root`, in the
 * Harness's own interactive session on this process's terminal until it
 * ends, and returns how it ended. The item is held for the whole session.
 * The session resumes the item's saved session id, or starts a fresh one
 * whose id is saved as soon as it is known and whose agent starts at once,
 * on a first message naming the item. The planning prompt is added on
 * every start. Once, a resume that ends `exit N` is replaced by a fresh
 * session. While it runs, every proposal block the agent writes is saved as
 * the item's Proposal, and the run's start, end and cost are recorded. For
 * a Goal accepted from a planning item, its saved session resumes and
 * nothing is held or recorded, so the Goal stays as it was. Throws,
 * recording nothing, when `item` is neither, is held by another vago, or
 * is an accepted Goal with no saved session; when the planning prompt is
 * missing; or when the item's Harness can't run a session. Throws after
 * recording a run that ends at once when no sandbox is available or the
 * Harness's program isn't on `PATH`.
 */
export async function runPlanningSession(
	root: string,
	item: string,
): Promise<RunOutcome> {
	const chat = await readPlanningChat(root, item);
	if (chat.accepted) {
		if (chat.sessionId === undefined) {
			throw new Error(`${item} has no planning session to open`);
		}
		// `vago run` holds the Goal, so nothing is held, and the chat is
		// read-only, so nothing the session tells is saved.
		const ignore = async () => {};
		return runInteractiveReadOnlySession(
			{ ...(await planningSession(root, chat)), resume: chat.sessionId },
			ignore,
			ignore,
		);
	}
	return withPlanningSession(root, item, async () => {
		// Read again under the hold: the session it last held may have saved
		// another id meanwhile.
		const held = await readPlanningChat(root, item);
		const session = await planningSession(root, held);
		const onSessionId = (sessionId: string) =>
			recordPlanningSessionId(root, item, sessionId);
		const onTranscript = (transcript: HarnessTranscript) =>
			recordPlanningTranscript(root, item, transcript);
		const saved = held.sessionId;
		const fresh = { ...session, kickoff: kickoff(item) };
		const ran = await runInteractiveReadOnlySession(
			saved === undefined ? fresh : { ...session, resume: saved },
			onSessionId,
			onTranscript,
		);
		if (saved === undefined || ran.kind !== "exit") return ran;
		// Claude Code saves a conversation only once the human has sent a
		// message, so an item opened and left before that has an id with
		// nothing behind it, and resuming it fails. That is the common case,
		// so a fresh session replaces it, once.
		return runInteractiveReadOnlySession(fresh, onSessionId, onTranscript);
	});
}

// The first message of item `item`'s fresh session, so that the agent
// starts planning without waiting for the human.
function kickoff(item: string): string {
	return `Plan the Goal "${item}" with me.`;
}

// The fresh session of the planning item whose chat is `chat`, in the
// Project at `root`. Throws when the planning prompt is missing, and when a
// hand-edited `chat.toml` names a Harness that can't plan.
async function planningSession(
	root: string,
	chat: PlanningChat,
): Promise<InteractiveReadOnlySession> {
	const harness = chat.harness ?? harnessByDefault();
	return {
		harness,
		model: planningModel(harness),
		instructions: (await readPlanningPrompt(root)).trimEnd(),
		folder: root,
	};
}
