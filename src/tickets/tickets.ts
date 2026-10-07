// The entry to the module that creates and owns Goal and Ticket files under
// `.vago-goals/<goal>/`: which Goals a Project has, the `goal.md` header
// naming the Goal's Workflow, the Workflow a Ticket names in place of it,
// Goal and Ticket titles, status, blockers, the `[[runs]]` history of each
// Ticket and of the Goal's Goal Steps and where each Run's log goes, how a
// Ticket number is spelled, the lock that marks a Goal as taken by a
// `vago run`, and the planning items that share `.vago-goals/` with the
// Goals, with each item's planning chat, its turns' logs and the rule that
// one response is written at a time, held by the item's lock, and each
// item's Proposal: the block in an answer it is read from, the human's
// Workflow choice and whether it is ready to accept, and accepting an item's
// Proposal as a ready Goal, after which its chat is read-only. Only this
// file is imported from outside `tickets/`.

import { link, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessSessionReport } from "../harness/registry.ts";
import type { GoalStepGroup, Step } from "../workflow.ts";
import {
	claimLock,
	isLockHeld,
	isLockMine,
	releaseLock,
	stopLockHolder,
} from "./goal-lock.ts";
import {
	headedText,
	readGoalFile,
	readTicketFile,
	rewriteGoalHeader,
	rewriteHeader,
	type TicketHeader,
	type TicketRunTable,
} from "./header.ts";
import {
	type PlanningTurnTable,
	readPlanningChatFile,
	rewritePlanningChatFile,
} from "./planning-chat.ts";
import {
	parseProposalBlock,
	readPlanningProposalFile,
	readPlanningWorkflowFile,
	writePlanningProposalFile,
	writePlanningWorkflowFile,
} from "./planning-proposal.ts";
import { readTicketFolder, ticketFilePath } from "./ticket-folder.ts";

/** Where a Ticket stands. Only Alpha writes it. */
export type TicketStatus = "ready" | "running" | "done" | "stuck";

/** One Ticket file of a Goal, named the way the human named the file. */
export type Ticket = {
	root: string;
	goal: string;
	/** The file name without `.md`, like `01-say-hello`. */
	name: string;
	number: number;
};

/**
 * Ticket `number` as file names spell it, with at least two digits, so a
 * folder listing shows up to 99 Tickets in number order. Anything that shows
 * a Ticket's number to the human spells it this way.
 */
export function ticketNumberText(number: number): string {
	return String(number).padStart(2, "0");
}

/**
 * Whose `[[runs]]` a Run goes in: a Ticket's file for a Ticket Step, or the
 * Goal's `goal.md` for a Goal Step of `group`.
 */
export type RunOwner =
	| { kind: "ticket"; ticket: Ticket }
	| { kind: "goal"; root: string; goal: string; group: GoalStepGroup };

/** The Project root and the name of the Goal that `owner`'s Runs belong to. */
export function runOwnerGoal(owner: RunOwner): { root: string; goal: string } {
	return owner.kind === "ticket" ? owner.ticket : owner;
}

/**
 * One entry in a `[[runs]]`, as `recordRunStart` opened it. Pass it back to
 * `recordRunEnd` unchanged, like an open file descriptor.
 */
export type TicketRunEntry = {
	owner: RunOwner;
	/** The entry's 1-based position in the owner's `[[runs]]`. */
	position: number;
	/** Absolute path the Run's log must be written to. */
	log: string;
};

/**
 * The name of the folder, directly at a Project's root, that holds every
 * Goal. Other modules may name the folder, to keep it out of git or out of a
 * Goal's worktree, but never build a path inside it: only this module does.
 */
export const goalsFolderName = ".vago-goals";

/**
 * How an agent Run set out: `resumed` an earlier Run's Harness session, or
 * set out to and `fell-back` to a fresh one when the resume failed to start.
 */
export type TicketRunResume = "resumed" | "fell-back";

/**
 * How the Goal report and the TUI spell a `TicketRunResume`, after the Run's
 * outcome.
 */
export const ticketRunResumeWords: Record<TicketRunResume, string> = {
	resumed: "resumed",
	"fell-back": "fell back to a fresh session",
};

/** One entry of a Ticket's or `goal.md`'s `[[runs]]` as `readGoal` found it. */
export type TicketRun = {
	step: string;
	started: Date;
	/** Absent while the Run is still going. */
	ended?: Date;
	/** As spelled in the header, like `ok` or `exit 1`. Absent like `ended`. */
	outcome?: string;
	/** Absolute path of the Run's log. */
	log: string;
	/**
	 * The Harness an agent Step ran on, whose stream the log holds. Absent
	 * for a shell Step, whose log is text.
	 */
	harness?: string;
	/** The model an agent Step ran on. Absent like `harness`. */
	model?: string;
	/**
	 * The id of an agent Run's Harness session, there from when the Harness
	 * reported it, so a Run still going or one cut off has it too.
	 */
	sessionId?: string;
	/** Absent for a Run that started a fresh session as usual. */
	resume?: TicketRunResume;
	/**
	 * When a `vago run` set out to retry the Run, which had failed; absent
	 * for a Run it didn't. Kept once the retry starts, or once the `vago run`
	 * stops waiting.
	 */
	retryAt?: Date;
	/** What the Harness reported the Run used. Absent like `costUsd`. */
	tokens?: { input: number; output: number };
	/** What the Harness reported the Run cost. Absent for a shell Step. */
	costUsd?: number;
	/** Whether the Goal report carries the Run's output, as its Step said. */
	inGoalReport: boolean;
};

/**
 * A Goal as `readGoal` found it. Statuses change while Alpha runs, so read
 * the Goal again after a Ticket moves.
 */
export type GoalState = {
	/** The first `# ` heading of `goal.md`'s body, or the Goal's name. */
	title: string;
	/** `goal.md`'s body after the line of its title, or all of it with none. */
	description: string;
	/**
	 * The name of the Workflow the Goal's `goal.md` header names, which a
	 * Ticket goes through unless its own header names another. It might not
	 * exist.
	 */
	workflow: string;
	/** Undefined for a Goal made before Vago recorded it. */
	created: Date | undefined;
	/** The Runs of the Goal's `before_all` Steps, from `goal.md`'s `[[runs]]`, in the order they ran. */
	beforeAll: TicketRun[];
	/** The Runs of the Goal's `after_all` Steps, like `beforeAll`. */
	afterAll: TicketRun[];
	/**
	 * Every Ticket of the Goal, lowest number first, with its status, the name
	 * of the Workflow it goes through (which might not exist) and its
	 * `[[runs]]` in the order they ran. Their count is the Goal's size.
	 */
	tickets: {
		ticket: Ticket;
		/** The first `# ` heading of the body, or the slug after `NN-`. */
		title: string;
		/** The body after the line of its title, or all of it with none. */
		description: string;
		status: TicketStatus;
		/** The numbers of the Tickets this one waits on. */
		blockedBy: number[];
		workflow: string;
		runs: TicketRun[];
	}[];
	/**
	 * The lowest-numbered Ticket that is `ready` or `stuck` and whose
	 * blockers are all `done`, with its status, the name of the Workflow it
	 * goes through and its Runs, or undefined when there is none.
	 */
	next:
		| {
				ticket: Ticket;
				workflow: string;
				status: "ready" | "stuck";
				runs: TicketRun[];
		  }
		| undefined;
	/** Whether every Ticket is `done`, which a Goal with no Tickets is. */
	done: boolean;
	/** Whether the Goal was accepted from a planning item, whose chat it keeps. */
	planned: boolean;
};

/**
 * The index in `runs`, a Ticket's or a Goal Step list's Runs in the order
 * they ran, where its latest pass starts: its last Run of Step
 * `firstStepId`, the list's first, since a pass that starts over starts
 * there. 0 when no Run is of that Step.
 */
export function latestPassStart(
	runs: TicketRun[],
	firstStepId: string,
): number {
	return Math.max(
		0,
		runs.findLastIndex(({ step }) => step === firstStepId),
	);
}

/**
 * A Step as a pass judges its Runs: its `id`, and `onFail`, which only a
 * shell Step has, `continue` when the pass goes on after it exits non-zero.
 */
export type PassStep = {
	readonly id: string;
	readonly onFail?: "stop" | "continue";
};

// Whether the latest pass in `runs`, a Goal Step list's Runs in the order
// they ran, through `steps` got past its last Step: true for no Steps, false
// for no Runs.
function passSucceeded(steps: readonly PassStep[], runs: TicketRun[]): boolean {
	const [first] = steps;
	const lastStep = steps.at(-1);
	if (first === undefined || lastStep === undefined) return true;
	const last = runs.slice(latestPassStart(runs, first.id)).at(-1);
	return (
		last !== undefined &&
		last.step === lastStep.id &&
		last.ended !== undefined &&
		runGoesOn(lastStep, last.outcome)
	);
}

/**
 * Whether a pass goes on from a Run of `step` that ended with `outcome`, as
 * the header spells it: it ended `ok`, or `exit N` on a Step whose `onFail`
 * is `continue`.
 */
export function runGoesOn(
	step: PassStep,
	outcome: string | undefined,
): boolean {
	return (
		outcome === "ok" ||
		(step.onFail === "continue" && shellExitCode(outcome) !== undefined)
	);
}

/**
 * The exit code of a shell Run whose outcome, as the header spells it, is
 * `outcome`: 0 for `ok`, N for `exit N`, and undefined for any other.
 */
export function shellExitCode(outcome: string | undefined): number | undefined {
	if (outcome === "ok") return 0;
	const exit = /^exit (\d+)$/.exec(outcome ?? "");
	return exit?.[1] === undefined ? undefined : Number(exit[1]);
}

/**
 * A Goal Step group's latest pass as the Goal stands: whether it got past
 * its last Step, whether `vago run` owes it now, and its Runs, which an owed
 * pass picks up from.
 */
export type GoalStepsPass = {
	succeeded: boolean;
	owed: boolean;
	runs: TicketRun[];
};

/**
 * The latest pass of the Goal's `group`, read as `state`, through `steps`,
 * the group's Steps in the Goal's Workflow. Its Runs are none before its
 * first Run, and for `after_all` none once a Ticket Run started after that
 * pass did, as a Ticket an `after_all` Step added does, since `after_all`
 * then starts over. A pass is owed when it hasn't succeeded and, for
 * `before_all`, the Goal has a Ticket to take next, or, for `after_all`,
 * the Goal has Tickets and every one is done. A group with no Steps is
 * never owed.
 */
export function goalStepsPass(
	state: GoalState,
	group: GoalStepGroup,
	steps: readonly PassStep[],
): GoalStepsPass {
	const groupRuns = group === "before_all" ? state.beforeAll : state.afterAll;
	const [first] = steps;
	if (first === undefined) {
		return { succeeded: true, owed: false, runs: groupRuns };
	}
	const pass = groupRuns.slice(latestPassStart(groupRuns, first.id));
	const passStarted = pass[0]?.started;
	const ticketsRanSince =
		group === "after_all" &&
		passStarted !== undefined &&
		state.tickets.some(({ runs }) =>
			runs.some(({ started }) => started > passStarted),
		);
	const runs = ticketsRanSince ? [] : pass;
	const due =
		group === "before_all"
			? state.next !== undefined
			: state.tickets.length > 0 && state.done;
	const succeeded = passSucceeded(steps, runs);
	return { succeeded, owed: due && !succeeded, runs };
}

/**
 * Creates Goal `goal` with an empty `tickets/` and a `goal.md` whose `+++`
 * header names `workflow` and when the Goal was created, followed by `body`
 * exactly as given, which is what `{{goal}}` will be. Without `body`, the
 * body is a `# <goal>` title. Doesn't check that the Workflow exists.
 * Returns the path of `goal.md`. Throws an Error naming the problem, and
 * creates nothing, when `body` is empty or only whitespace, the Goal already
 * exists, or `goal` isn't a valid name.
 */
export async function createGoal(
	root: string,
	goal: string,
	workflow: string,
	body?: string,
): Promise<string> {
	const folder = goalFolder(root, goal);
	if (body !== undefined) checkBody(`Goal ${goal}`, body);
	const goalFile = goalFilePath(root, goal);
	if (await Bun.file(goalFile).exists()) {
		throw new Error(`Goal ${goal} already exists: ${goalFile}`);
	}
	await mkdir(join(folder, "tickets"), { recursive: true });
	await Bun.write(goalFile, newGoalText(workflow, body ?? `# ${goal}\n`));
	return goalFile;
}

// A new `goal.md` naming `workflow`, created now, with `body` after it.
function newGoalText(workflow: string, body: string): string {
	return headedText({ workflow, created: new Date() }, body);
}

/**
 * The name of every Goal of the Project at `root`, in name order, without
 * reading or checking any of them. A planning item isn't one. None when the
 * Project has no Goals yet. Throws an Error naming the path when
 * `.vago-goals` isn't a folder.
 */
export async function listGoals(root: string): Promise<string[]> {
	const folders = await readGoalsFolder(root);
	return folders
		.filter(({ kind }) => kind !== "planning")
		.map(({ name }) => name);
}

/**
 * The name of every planning item of the Project at `root`, in name order,
 * none when it has none. Throws what `listGoals` throws.
 */
export async function listPlanningItems(root: string): Promise<string[]> {
	const folders = await readGoalsFolder(root);
	return folders
		.filter(({ kind }) => kind === "planning")
		.map(({ name }) => name);
}

/**
 * Makes planning item `name` in the Project at `root`, a Goal still being
 * planned whose agent runs on Harness `harness`, and returns its folder. It
 * is no Goal: `readGoal` and `vago run` don't find it. Throws an Error
 * naming the problem, and makes nothing, when a Goal or planning item
 * already has the name or it isn't a valid name.
 */
export async function createPlanningItem(
	root: string,
	name: string,
	harness: string,
): Promise<string> {
	const folder = goalFolder(root, name);
	await mkdir(join(root, goalsFolderName), { recursive: true });
	try {
		// Not recursive, so a Goal or item already there makes it fail.
		await mkdir(folder);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") {
			throw new Error(alreadyExists(name, folder));
		}
		throw error;
	}
	await mkdir(planningFolder(folder));
	await rewritePlanningChatFile(planningFolder(folder), (chat) => {
		chat.harness = harness;
	});
	return folder;
}

/**
 * Gives planning item `name` of the Project at `root` the name `newName`,
 * with everything it holds. Throws an Error naming the problem, and changes
 * nothing, when there is no such item, `name` is a Goal, a Goal or planning
 * item already has `newName`, `newName` isn't a valid name, or another vago
 * holds the item, such as one running its session. Refuses a Goal accepted
 * from a planning item: its planning chat is read-only.
 */
export async function renamePlanningItem(
	root: string,
	name: string,
	newName: string,
): Promise<void> {
	const folder = await planningItemToChange(root, name);
	const newFolder = goalFolder(root, newName);
	if (await exists(newFolder)) {
		throw new Error(alreadyExists(newName, newFolder));
	}
	// Held, so no `vago plan say` writes under the old name meanwhile.
	await withPlanningItemClaimed(root, name, async () => {
		if (await exists(newFolder)) {
			throw new Error(alreadyExists(newName, newFolder));
		}
		await rename(folder, newFolder);
		// The lock moved with the folder, so it is released where it is now.
		await releaseLock(goalLockPath(root, newName));
	});
}

/**
 * Stops the open session of planning item `name` of the Project at `root`,
 * or a response to it in progress, then removes the item and everything it
 * holds. Throws an Error naming the problem, and removes nothing, when there
 * is no such item, `name` is a Goal, or another vago takes the item first.
 * Refuses a Goal accepted from a planning item: its planning chat is
 * read-only.
 */
export async function discardPlanningItem(
	root: string,
	name: string,
): Promise<void> {
	const folder = await planningItemToChange(root, name);
	await stopLockHolder(goalLockPath(root, name));
	await withPlanningItemClaimed(root, name, () =>
		rm(folder, { recursive: true }),
	);
}

/**
 * One message the human sent a planning item's agent and the agent's
 * response to it. `log` is the absolute path of the response's stream.
 * `outcome` is absent while a live vago is writing the response; otherwise
 * it is spelled like a Run's (`ok`, `exit 1`, `permission-mode default`,
 * `interrupted`), or `error` for a turn that stopped before or around its
 * session, with `reason` saying why. A response whose vago died before it
 * ended reads `interrupted`. `proposalError` says why the proposal block in
 * the turn's answer couldn't be read. `interruptedLogs` are the absolute
 * paths of the logs of earlier attempts at the response, each interrupted
 * and retried, oldest first.
 */
export type PlanningTurn = {
	number: number;
	message: string;
	/** When the latest attempt at the response started. */
	startedAt: Date;
	endedAt?: Date;
	outcome?: string;
	reason?: string;
	/**
	 * What the Harness reported the response cost; absent while it is being
	 * written, after an interruption, or when the Harness reported none.
	 */
	costUsd?: number;
	proposalError?: string;
	log: string;
	interruptedLogs: string[];
};

/**
 * The conversation of planning item `item`. `harness` is absent for an item
 * made before its Harness was recorded at its making, until its first turn;
 * `sessionId` until a turn's session reports it.
 */
export type PlanningChat = {
	item: string;
	harness?: string;
	sessionId?: string;
	turns: PlanningTurn[];
	/** Whether the item was accepted as a Goal, which makes its chat read-only. */
	accepted: boolean;
};

/** Where `planning-runner.ts` records a turn it started. */
export type PlanningTurnEntry = {
	root: string;
	item: string;
	number: number;
	log: string;
};

/**
 * The conversation of planning item `item` of the Project at `root`, or of
 * the Goal accepted from it; no turns when none was sent. Throws an Error
 * naming the folder when `item` is neither a planning item nor a Goal
 * accepted from one, and naming the file when its chat is bad.
 */
export async function readPlanningChat(
	root: string,
	item: string,
): Promise<PlanningChat> {
	const { folder: itemFolder, accepted } = await planningFolderToRead(
		root,
		item,
	);
	const folder = planningFolder(itemFolder);
	const chat = await readPlanningChatFile(folder);
	const turns = chat.turns ?? [];
	// Read rather than written, as a lost Run is: nobody is left to write it.
	const last = turns.at(-1);
	const dead =
		last !== undefined &&
		last.ended === undefined &&
		!(await isLockHeld(goalLockPath(root, item)));
	return {
		item,
		harness: chat.harness,
		sessionId: chat.session_id,
		turns: turns.map((turn, index) => {
			const stopped = dead && index === turns.length - 1;
			return {
				number: index + 1,
				message: turn.message,
				startedAt: turn.started,
				endedAt: turn.ended,
				outcome: stopped ? "interrupted" : turn.outcome,
				reason: stopped ? stoppedEarly : turn.reason,
				costUsd: turn.cost_usd,
				proposalError: turn.proposal_error,
				log: join(folder, turn.log),
				interruptedLogs: (turn.interrupted_logs ?? []).map((log) =>
					join(folder, log),
				),
			};
		}),
		accepted,
	};
}

// Why a response whose vago died shows as interrupted.
const stoppedEarly = "the response stopped before it ended";

/**
 * Runs `run` while this process holds planning item `item` of the Project
 * at `root`, and returns what `run` returns. Releases the item however `run`
 * ends, and takes over a hold whose vago died. Throws, without calling
 * `run`, when another live vago holds the item, such as one running its
 * planning session or writing a response, and when `item` is no planning
 * item or was accepted as a Goal.
 */
export async function withPlanningItemClaimed<T>(
	root: string,
	item: string,
	run: () => Promise<T>,
): Promise<T> {
	// Checked first, so a Goal's refusal says it is a Goal.
	await planningItemToChange(root, item);
	const lock = goalLockPath(root, item);
	await claimLock(
		lock,
		(pid) =>
			`${item}: its planning session is open, a response is still being written, or another vago is changing the item (pid ${pid})`,
	);
	try {
		// Checked again under the lock: another vago may have accepted it
		// between the first check and taking the lock.
		await planningItemToChange(root, item);
		return await run();
	} finally {
		await releaseLock(lock);
	}
}

/**
 * Appends an open turn holding `message` to `item`'s chat, recording
 * `harness` as the chat's when it has none, and gives back where the turn
 * is recorded and its log goes. An interrupted last turn is closed as
 * `interrupted` first. Must run inside `withPlanningItemClaimed`, and
 * throws otherwise. Throws as `readPlanningChat` does, and refuses a Goal
 * accepted from a planning item: its planning chat is read-only. Survives a
 * crash (temp file and rename).
 */
export async function recordPlanningTurnStart(
	root: string,
	item: string,
	message: string,
	harness: string,
): Promise<PlanningTurnEntry> {
	await mustHold(root, item);
	const folder = planningFolder(await planningItemToChange(root, item));
	const { number, log } = await rewritePlanningChatFile(folder, (chat) => {
		const turns = chat.turns ?? [];
		const last = turns.at(-1);
		// Open under this process's hold, so its vago died.
		if (last !== undefined && last.ended === undefined) {
			last.ended = new Date();
			last.outcome = "interrupted";
			last.reason = stoppedEarly;
		}
		const number = turns.length + 1;
		const log = `logs/turn-${ticketNumberText(number)}.jsonl`;
		turns.push({ message, started: new Date(), log });
		chat.harness ??= harness;
		chat.turns = turns;
		return { number, log };
	});
	return { root, item, number, log: join(folder, log) };
}

/**
 * Saves `sessionId` as planning item `item`'s own session id, which
 * `readPlanningChat` gives back as `sessionId` on the next read. Must run
 * inside `withPlanningItemClaimed`, and throws otherwise. Refuses a Goal
 * accepted from a planning item: its planning chat is read-only. Survives a
 * crash.
 */
export async function recordPlanningSessionId(
	root: string,
	item: string,
	sessionId: string,
): Promise<void> {
	await mustHold(root, item);
	const folder = planningFolder(await planningItemToChange(root, item));
	await rewritePlanningChatFile(folder, (chat) => {
		chat.session_id = sessionId;
	});
}

/**
 * Saves the session id as the chat's and the turn's as soon as the Harness
 * reports it.
 */
export async function recordPlanningSession(
	entry: PlanningTurnEntry,
	sessionId: string,
): Promise<void> {
	await rewritePlanningChatFile(entryFolder(entry), (chat) => {
		chat.session_id = sessionId;
		const turn = chat.turns?.[entry.number - 1];
		if (turn !== undefined) turn.session_id = sessionId;
	});
}

/**
 * An interrupted turn reopened for Retry response: where it is recorded and
 * its new log goes, and its `message`. `sessionId` is the session an earlier
 * attempt reported, absent when the message never reached the agent.
 */
export type PlanningRetry = {
	entry: PlanningTurnEntry;
	message: string;
	sessionId?: string;
};

/**
 * Reopens `item`'s last turn when its response was interrupted, keeping the
 * interrupted attempt's log among its earlier ones and giving it a new log,
 * and gives back what to retry. Must run inside `withPlanningItemClaimed`,
 * and throws otherwise. Throws "has no interrupted response to retry" when
 * the last response wasn't interrupted, and as `readPlanningChat` does.
 * Refuses a Goal accepted from a planning item: its planning chat is
 * read-only. Survives a crash.
 */
export async function recordPlanningTurnRetry(
	root: string,
	item: string,
): Promise<PlanningRetry> {
	await mustHold(root, item);
	const folder = planningFolder(await planningItemToChange(root, item));
	return rewritePlanningChatFile(folder, (chat) => {
		const turns = chat.turns ?? [];
		const turn = turns.at(-1);
		if (turn === undefined || !isInterrupted(turn)) {
			throw new Error(`${item} has no interrupted response to retry`);
		}
		const earlier = turn.interrupted_logs ?? [];
		turn.interrupted_logs = [...earlier, turn.log];
		turn.log = `logs/turn-${ticketNumberText(turns.length)}-retry-${earlier.length + 1}.jsonl`;
		// Restarted, so the agent's time leaves out the interrupted attempt,
		// whose end nobody recorded.
		turn.started = new Date();
		delete turn.ended;
		delete turn.outcome;
		delete turn.reason;
		return {
			entry: { root, item, number: turns.length, log: join(folder, turn.log) },
			message: turn.message,
			sessionId: turn.session_id,
		};
	});
}

/**
 * Closes the turn with `outcome`, `reason` for an `error`, and what its
 * session cost when the Harness reported it. `answer` is an `ok` turn's
 * final answer: its last proposal block becomes the item's Proposal, saved
 * before the turn shows as ended. An answer without a block leaves the
 * Proposal as it was. A block that isn't valid TOML or doesn't
 * fit the format leaves it as it was too, and records why on the turn.
 * Never throws for the agent's text. Survives a crash.
 */
export async function recordPlanningTurnEnd(
	entry: PlanningTurnEntry,
	outcome: string,
	ended: { reason?: string; answer?: string; costUsd?: number } = {},
): Promise<void> {
	const folder = entryFolder(entry);
	const proposalError =
		ended.answer === undefined
			? undefined
			: await saveProposal(folder, ended.answer, entry.number);
	await rewritePlanningChatFile(folder, (chat) => {
		const turn = chat.turns?.[entry.number - 1];
		if (turn === undefined) {
			throw new Error(
				`The planning chat in ${folder} has no turn ${entry.number}`,
			);
		}
		turn.ended = new Date();
		turn.outcome = outcome;
		if (ended.reason !== undefined) turn.reason = ended.reason;
		if (ended.costUsd !== undefined) turn.cost_usd = ended.costUsd;
		if (proposalError !== undefined) turn.proposal_error = proposalError;
	});
}

// Saves the last closed proposal block of `answer`, from turn `turn`, as
// the Proposal in `folder`, and gives back why it couldn't, if it couldn't.
// Even a failed write comes back as a reason, so the turn still ends.
async function saveProposal(
	folder: string,
	answer: string,
	turn: number,
): Promise<string | undefined> {
	const lines = answer.split(/\r?\n/);
	const span = planningProposalSpans(lines).findLast(({ closed }) => closed);
	if (span === undefined) return undefined;
	const parsed = parseProposalBlock(
		lines.slice(span.start + 1, span.end - 1).join("\n"),
	);
	if (parsed.outcome === "bad") return parsed.reason;
	try {
		await writePlanningProposalFile(folder, parsed.block, turn);
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

// Lines `start` up to `end` of an answer hold one proposal block: `start` is
// its opening tag's line and `end` is one past its closing tag's, or the
// answer's length when `closed` is false.
type PlanningProposalSpan = {
	start: number;
	end: number;
	closed: boolean;
};

// The proposal blocks in `lines`, an answer's lines, from each block's
// opening tag line through its closing one, in order. A block with no
// closing line yet runs to the end with `closed` false.
function planningProposalSpans(
	lines: readonly string[],
): PlanningProposalSpan[] {
	const spans: PlanningProposalSpan[] = [];
	let start: number | undefined;
	for (const [index, line] of lines.entries()) {
		const tag = line.trim();
		if (start === undefined && tag === "<vago-plan>") start = index;
		else if (start !== undefined && tag === "</vago-plan>") {
			spans.push({ start, end: index + 1, closed: true });
			start = undefined;
		}
	}
	if (start !== undefined) {
		spans.push({ start, end: lines.length, closed: false });
	}
	return spans;
}

/** A proposed Goal's text. */
export type ProposedGoal = {
	/** The first `# ` heading of `body`, or the planning item's name. */
	title: string;
	/** `body` after the line of its title, or all of it with none. */
	description: string;
	/** The Goal's text as `goal.md` would hold it after its header. */
	body: string;
};

/** One Ticket of a Proposal, numbered by its place, from 1. */
export type ProposedTicket = {
	number: number;
	slug: string;
	/** The first `# ` heading of `body`, or the slug. */
	title: string;
	/** `body` after the line of its title, or all of it with none. */
	description: string;
	body: string;
	blockedBy: number[];
};

/**
 * The Goal, ordered Tickets and Workflow a planning item's agent proposed
 * last, with the human's Workflow choice. `turn` is the chat turn that
 * proposed it. `workflow` is the one acceptance uses: the human's choice,
 * else the agent's recommendation. `problems` says why it can't be accepted
 * yet; it is ready to accept when empty.
 */
export type PlanningProposal = {
	turn: number;
	goal: ProposedGoal;
	tickets: ProposedTicket[];
	openDecisions: string[];
	recommendedWorkflow?: string;
	workflowReason?: string;
	chosenWorkflow?: string;
	workflow?: string;
	problems: string[];
};

/**
 * The latest Proposal of planning item `item` of the Project at `root`, or
 * of the Goal accepted from it, its `problems` judged against `workflows`,
 * the names of the Project's Workflows. Undefined before the agent proposed
 * one. Throws as `readPlanningChat` does, and naming the file when a saved
 * Proposal is bad.
 */
export async function readPlanningProposal(
	root: string,
	item: string,
	workflows: readonly string[],
): Promise<PlanningProposal | undefined> {
	const { folder: itemFolder } = await planningFolderToRead(root, item);
	const folder = planningFolder(itemFolder);
	const file = await readPlanningProposalFile(folder);
	if (file === undefined) return undefined;
	const chosenWorkflow = await readPlanningWorkflowFile(folder);
	const tickets = file.tickets.map((ticket, index) => ({
		number: index + 1,
		slug: ticket.slug,
		title: headingTitle(ticket.body, ticket.slug),
		description: afterHeading(ticket.body),
		body: ticket.body,
		blockedBy: ticket.blocked_by,
	}));
	const workflow = chosenWorkflow ?? file.workflow;
	return {
		turn: file.turn,
		goal: {
			title: headingTitle(file.goal, item),
			description: afterHeading(file.goal),
			body: file.goal,
		},
		tickets,
		openDecisions: file.open_decisions,
		recommendedWorkflow: file.workflow,
		workflowReason: file.workflow_reason,
		chosenWorkflow,
		workflow,
		problems: proposalProblems(file.goal, tickets, workflow, workflows),
	};
}

// Why a Proposal of `goal` and `tickets` going through `workflow` can't be
// accepted as a Goal and its Tickets, judged by the checks `createGoal` and
// `addTicket` make. Open decisions are left to the human, so they never
// count.
function proposalProblems(
	goal: string,
	tickets: ProposedTicket[],
	workflow: string | undefined,
	workflows: readonly string[],
): string[] {
	const problems: string[] = [];
	// The checks `addTicket` makes throw; here each becomes one problem.
	const check = (run: () => void) => {
		try {
			run();
		} catch (error) {
			problems.push(error instanceof Error ? error.message : String(error));
		}
	};
	check(() => checkBody("the Goal", goal));
	if (tickets.length === 0) problems.push("The proposal has no Tickets");
	for (const { number, slug, body, blockedBy } of tickets) {
		const label = `Ticket ${ticketNumberText(number)} ${slug}`;
		check(() =>
			checkName(`The slug of Ticket ${ticketNumberText(number)}`, slug),
		);
		check(() => checkBody(label, body));
		check(() => checkNoHeader(label, body));
		// Only an earlier Ticket, so blockers come first and can't loop.
		for (const blocker of blockedBy) {
			if (blocker < 1 || blocker >= number) {
				problems.push(
					`${label} is blocked by ${blocker}, which isn't an earlier Ticket`,
				);
			}
		}
	}
	if (workflow === undefined) {
		problems.push("No Workflow is recommended or chosen");
	} else {
		check(() => checkWorkflow(workflow, workflows));
	}
	return problems;
}

// A Workflow outside `workflows`, the Project's, can't take the Goal.
function checkWorkflow(workflow: string, workflows: readonly string[]): void {
	if (!workflows.includes(workflow)) {
		const held = workflows.length > 0 ? workflows.join(", ") : "none";
		throw new Error(
			`Workflow "${workflow}" isn't one of the Project's: ${held}`,
		);
	}
}

/**
 * Records `workflow` as the human's choice for `item`'s Goal. It wins over
 * the agent's recommendation and survives every revision. Throws an Error
 * listing `workflows`, the names of the Project's Workflows, and records
 * nothing, when `workflow` isn't one of them. Otherwise throws as
 * `readPlanningChat` does, and refuses a Goal accepted from a planning item:
 * its planning chat is read-only.
 */
export async function recordPlanningWorkflow(
	root: string,
	item: string,
	workflow: string,
	workflows: readonly string[],
): Promise<void> {
	const folder = planningFolder(await planningItemToChange(root, item));
	checkWorkflow(workflow, workflows);
	await writePlanningWorkflowFile(folder, workflow);
}

/**
 * Turns planning item `item` of the Project at `root` into a ready Goal: its
 * `goal.md` names the Proposal's Workflow and holds the proposed Goal's
 * body, and each proposed Ticket is a ready Ticket with its body and
 * blockers. The Goal and its Tickets appear together; its planning chat
 * stays with it, read-only. Returns the path of `goal.md`. Throws an Error
 * naming the problem, and creates no Goal, when `item` is already a Goal or
 * no planning item, another vago holds it, such as one running its session,
 * its last response was interrupted, it has no Proposal, or the Proposal has
 * problems judged against `workflows`, the names of the Project's
 * Workflows.
 */
export async function acceptPlanningItem(
	root: string,
	item: string,
	workflows: readonly string[],
): Promise<string> {
	return withPlanningItemClaimed(root, item, async () => {
		const folder = goalFolder(root, item);
		const chat = await readPlanningChatFile(planningFolder(folder));
		const last = chat.turns?.at(-1);
		// The human's last message has no answer, and an accepted Goal must
		// never keep an open turn, which would read as live while vago run
		// holds the Goal.
		if (last !== undefined && isInterrupted(last)) {
			throw new Error(
				`${item}: its last response was interrupted; retry it or send a message first`,
			);
		}
		const proposal = await readPlanningProposal(root, item, workflows);
		if (proposal === undefined) {
			throw new Error(`${item} has no proposal to accept yet`);
		}
		// A Proposal with no Workflow has that as a problem; checked here too
		// so the Workflow below is known to be there.
		if (proposal.workflow === undefined || proposal.problems.length > 0) {
			throw new Error(
				`${item} isn't ready to accept: ${proposal.problems.join("; ")}`,
			);
		}
		const staging = join(planningFolder(folder), "accepting");
		await rm(staging, { recursive: true, force: true });
		await mkdir(join(staging, "tickets"), { recursive: true });
		for (const { number, slug, body, blockedBy } of proposal.tickets) {
			await Bun.write(
				ticketFilePath(join(staging, "tickets"), ticketName(number, slug)),
				readyTicketText(blockedBy, undefined, body),
			);
		}
		await Bun.write(
			goalFileIn(staging),
			newGoalText(proposal.workflow, proposal.goal.body),
		);
		// The folder isn't a Goal and this vago holds its lock, so a `tickets/`
		// there can only be what a crashed acceptance left.
		await rm(join(folder, "tickets"), { recursive: true, force: true });
		await rename(join(staging, "tickets"), join(folder, "tickets"));
		try {
			// The commit point: the folder is a Goal from here on, and a link
			// fails rather than replace one.
			await link(goalFileIn(staging), goalFileIn(folder));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				throw new Error(acceptedReadOnly(item, folder));
			}
			throw error;
		}
		await rm(staging, { recursive: true, force: true });
		return goalFileIn(folder);
	});
}

// Whether `turn`'s response was interrupted, judged under the item's hold:
// open there, its vago died.
function isInterrupted(turn: PlanningTurnTable): boolean {
	return turn.ended === undefined || turn.outcome === "interrupted";
}

// Throws unless this process holds planning item `item`: what a turn or a
// session records is right only while no other vago can write the item.
async function mustHold(root: string, item: string): Promise<void> {
	if (!(await isLockMine(goalLockPath(root, item)))) {
		throw new Error(
			`${item} must be held with withPlanningItemClaimed to record its chat`,
		);
	}
}

// The `planning/` folder of the item `entry` was recorded in.
function entryFolder(entry: PlanningTurnEntry): string {
	return planningFolder(goalFolder(entry.root, entry.item));
}

// Every folder in `.vago-goals`, in name order, with what it holds.
async function readGoalsFolder(
	root: string,
): Promise<{ name: string; kind: GoalFolderKind }[]> {
	const path = join(root, goalsFolderName);
	let names: string[];
	try {
		const entries = await readdir(path, { withFileTypes: true });
		names = entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return [];
		if (code === "ENOTDIR") throw new Error(`${path} isn't a folder`);
		throw error;
	}
	return Promise.all(
		names.map(async (name) => ({
			name,
			kind: await goalFolderKind(join(path, name)),
		})),
	);
}

// What a folder of `.vago-goals` holds: a Goal once it has a `goal.md`, a
// planning item while it has only a `planning/` folder, and otherwise
// neither, which reads as a Goal whose `goal.md` is missing.
type GoalFolderKind = "goal" | "planning" | "neither";

async function goalFolderKind(folder: string): Promise<GoalFolderKind> {
	if (await exists(goalFileIn(folder))) return "goal";
	return (await exists(planningFolder(folder))) ? "planning" : "neither";
}

// The folder of planning item `name`, checked to be one that may change: a
// Goal accepted from one keeps its chat read-only.
async function planningItemToChange(
	root: string,
	name: string,
): Promise<string> {
	const folder = goalFolder(root, name);
	const kind = await goalFolderKind(folder);
	if (kind === "goal") {
		throw new Error(
			(await exists(planningFolder(folder)))
				? acceptedReadOnly(name, folder)
				: goalNotPlanningItem(name, folder),
		);
	}
	if (kind === "neither") throw new Error(noPlanningItem(name, folder));
	return folder;
}

// The folder of planning item `name`, or of a Goal accepted from one, for
// reading its chat and Proposal.
async function planningFolderToRead(
	root: string,
	name: string,
): Promise<{ folder: string; accepted: boolean }> {
	const folder = goalFolder(root, name);
	const kind = await goalFolderKind(folder);
	if (kind === "planning") return { folder, accepted: false };
	if (kind === "neither") throw new Error(noPlanningItem(name, folder));
	if (!(await exists(planningFolder(folder)))) {
		throw new Error(goalNotPlanningItem(name, folder));
	}
	return { folder, accepted: true };
}

function goalNotPlanningItem(name: string, folder: string): string {
	return `${name} is a Goal, not a planning item: ${folder}`;
}

function noPlanningItem(name: string, folder: string): string {
	return `No planning item ${name}: ${folder} isn't one`;
}

function acceptedReadOnly(name: string, folder: string): string {
	return `${name} was accepted as a Goal; its planning chat is read-only: ${folder}`;
}

// Goals and planning items share `.vago-goals`, so one name can't be both.
function alreadyExists(name: string, folder: string): string {
	return `A Goal or planning item named ${name} already exists: ${folder}`;
}

// Where a planning item, `folder` of `.vago-goals`, keeps what it holds.
function planningFolder(folder: string): string {
	return join(folder, "planning");
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Reads `goal` and checks its format: `goal.md` exists and starts with a
 * `+++` header that has a `workflow` line, every `.md` file in `tickets/` is
 * named `NN-<slug>.md` and has a header that parses, no two Tickets share a
 * number, every blocker is a Ticket of the Goal, and no blockers form a
 * cycle. Throws an Error naming the problem and the file or folder it's in
 * when a check fails, and for a bad `goal.md` header says which line to add.
 * A Goal without a `tickets/` folder has no Tickets.
 */
export async function readGoal(root: string, goal: string): Promise<GoalState> {
	const folder = goalFolder(root, goal);
	const { workflow, created, runs, body } = await readGoalFile(
		await existingGoalFile(root, goal),
	);
	const goalRuns = (group: GoalStepGroup) =>
		runs
			.filter(({ log }) => log.startsWith(goalStepLogStem(group, "")))
			.map((run) => ticketRunOf(run, root, goal));
	const ticketFolder = join(folder, "tickets");
	const entries = (await readTicketFolder(goal, ticketFolder)).map(
		({ name, number, header, body }) => ({
			ticket: { root, goal, name, number },
			header,
			body,
		}),
	);
	const byNumber = new Map(
		entries.map((entry) => [entry.ticket.number, entry]),
	);

	const tickets = entries.map(({ ticket, header, body }) => ({
		ticket,
		title: headingTitle(body, ticket.name.replace(/^\d+-/, "")),
		description: afterHeading(body),
		status: header.status,
		blockedBy: header.blocked_by ?? [],
		workflow: header.workflow ?? workflow,
		runs: (header.runs ?? []).map((run) => ticketRunOf(run, root, goal)),
	}));
	const next = tickets.find(
		({ ticket, status }) =>
			(status === "ready" || status === "stuck") &&
			(byNumber.get(ticket.number)?.header.blocked_by ?? []).every(
				(blocker) => byNumber.get(blocker)?.header.status === "done",
			),
	);
	return {
		title: headingTitle(body, goal),
		description: afterHeading(body),
		workflow,
		created,
		beforeAll: goalRuns("before_all"),
		afterAll: goalRuns("after_all"),
		tickets,
		// The status is checked again only so its type is `ready` or `stuck`.
		next:
			next === undefined || (next.status !== "ready" && next.status !== "stuck")
				? undefined
				: {
						ticket: next.ticket,
						workflow: next.workflow,
						status: next.status,
						runs: next.runs,
					},
		done: entries.every(({ header }) => header.status === "done"),
		planned: await exists(planningFolder(folder)),
	};
}

/**
 * Adds a Ticket named `slug` to `goal`, numbered one past its highest
 * Ticket, created now, with status `ready` and blocked by the Tickets
 * numbered in `blockedBy` (each once, however often it's given), going
 * through Workflow `workflow`, or the Goal's when it's undefined. Doesn't
 * check that the Workflow exists. The Ticket's body is `body` exactly as
 * given, which is what `readTicketBody` will return.
 * Without `body`, it's a `# <slug>` title for the human to fill in. Returns
 * the path of the new Ticket file. Throws an Error naming the problem, and
 * writes nothing, when `body` is empty or only whitespace, `body` starts with
 * a `+++` header (only Vago writes a Ticket's header, ADR 0003), the Goal
 * doesn't exist or its format is bad, a blocker isn't a Ticket of the Goal,
 * or `goal` or `slug` isn't a valid name.
 */
export async function addTicket(
	root: string,
	goal: string,
	slug: string,
	blockedBy: number[],
	workflow: string | undefined,
	body?: string,
): Promise<string> {
	checkName("Ticket slug", slug);
	if (body !== undefined) {
		checkBody(`Ticket ${slug}`, body);
		checkNoHeader(`Ticket ${slug}`, body);
	}
	const { tickets } = await readGoal(root, goal);
	for (const blocker of blockedBy) {
		if (!tickets.some(({ ticket }) => ticket.number === blocker)) {
			throw new Error(
				`${slug} can't be blocked by Ticket ${blocker}, which isn't in Goal ${goal}`,
			);
		}
	}
	const number = Math.max(0, ...tickets.map(({ ticket }) => ticket.number)) + 1;
	const ticket = { root, goal, name: ticketName(number, slug), number };
	const file = ticketFile(ticket);
	await Bun.write(
		file,
		readyTicketText(blockedBy, workflow, body ?? `\n# ${slug}\n`),
	);
	return file;
}

// A new ready Ticket file, created now, blocked by `blockedBy` (each once),
// going through `workflow` or, when it's undefined, the Goal's, with `body`
// after its header.
function readyTicketText(
	blockedBy: number[],
	workflow: string | undefined,
	body: string,
): string {
	const header: TicketHeader = { status: "ready", created: new Date() };
	if (blockedBy.length > 0) header.blocked_by = [...new Set(blockedBy)];
	if (workflow !== undefined) header.workflow = workflow;
	return headedText(header, body);
}

/**
 * Returns the Ticket's title and body as the human wrote them. The header
 * is never part of it, so agents can't see or set status (ADR 0003).
 */
export async function readTicketBody(ticket: Ticket): Promise<string> {
	return (await readTicketFile(ticketFile(ticket))).body;
}

/** What `readRunLog` read of a Run's log. */
export type RunLogRead = {
	/** The text past the bytes skipped, up to the last whole character. */
	added: string;
	/** The bytes read up to now, to skip on the next read. */
	end: number;
};

/**
 * What the log at `log`, a `TicketRun`'s, holds past its first `from`
 * bytes, so a growing log is read a piece at a time: `added` is "" when its
 * Run hasn't written it yet or has written nothing since. A character cut
 * by a write in progress is left for the next read.
 */
export async function readRunLog(log: string, from = 0): Promise<RunLogRead> {
	const file = Bun.file(log);
	if (!(await file.exists())) {
		return { added: "", end: from };
	}
	const bytes = await file.slice(from).bytes();
	const whole = wholeCharacters(bytes);
	return {
		added: new TextDecoder().decode(bytes.subarray(0, whole)),
		end: from + whole,
	};
}

/**
 * When the log at `log`, a `TicketRun`'s, was last written; undefined while
 * its Run hasn't written it yet.
 */
export async function runLogLastWritten(
	log: string,
): Promise<Date | undefined> {
	const file = Bun.file(log);
	return (await file.exists()) ? new Date(file.lastModified) : undefined;
}

// How many of `bytes`, UTF-8, end on a whole character: all of them, unless
// the last character's bytes aren't all there yet.
function wholeCharacters(bytes: Uint8Array): number {
	// A character takes at most four bytes, the first not 10xxxxxx.
	for (let start = bytes.length - 1; start >= bytes.length - 4; start--) {
		const byte = bytes[start];
		if (byte === undefined) return bytes.length;
		if ((byte & 0xc0) === 0x80) continue;
		const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
		return start + length <= bytes.length ? bytes.length : start;
	}
	return bytes.length;
}

/**
 * Whether `ticket` is its Goal's last: every other Ticket of the Goal is
 * `done`. Read from the files each time, so a Ticket added mid-run counts.
 */
export async function isLastTicket(ticket: Ticket): Promise<boolean> {
	const { tickets } = await readGoal(ticket.root, ticket.goal);
	return tickets.every(
		(other) => other.ticket.name === ticket.name || other.status === "done",
	);
}

/**
 * Returns the `goal.md` of `goal` without its header or the blank lines
 * after it, and otherwise byte for byte, which is what `{{goal}}` and the
 * Goal report show.
 * Throws an Error naming the file when it doesn't exist or its header is
 * bad, as `readGoal` does.
 */
export async function readGoalBody(
	root: string,
	goal: string,
): Promise<string> {
	const path = goalFilePath(root, goal);
	if (!(await Bun.file(path).exists())) throw new Error(`${path} not found`);
	return (await readGoalFile(path)).body;
}

/** Sets the Ticket's status. */
export async function setStatus(
	ticket: Ticket,
	status: TicketStatus,
): Promise<void> {
	await rewriteHeader(ticketFile(ticket), (header) => {
		header.status = status;
	});
}

/**
 * Appends a `[[runs]]` entry for `step` to `owner`'s, started at `started`,
 * naming the Harness and model for an agent Step, and whether the Goal report
 * carries its output. For a Run that resumes Harness session `resumes`, the
 * entry names that session and is marked `resume = "resumed"`. Call it before
 * the Step starts, so a crash mid-Step still leaves a trace. Returns the
 * entry, which carries the path the Run's log must be written to: under the
 * Goal's `logs/`, named for the Ticket's number or the Goal Step's group, the
 * Step and the entry's position.
 */
export async function recordRunStart(
	owner: RunOwner,
	step: Step,
	started: Date,
	resumes?: string,
): Promise<TicketRunEntry> {
	const { position, log } = await rewriteRuns(owner, (runs) => {
		const position = runs.length + 1;
		// The position in the name gives a reset Ticket's new Runs new logs.
		const logStem =
			owner.kind === "ticket"
				? `logs/${ticketNumberText(owner.ticket.number)}-${step.id}-${position}`
				: goalStepLogStem(owner.group, `${step.id}-${position}`);
		const entry =
			step.type === "agent"
				? {
						step: step.id,
						harness: step.harness,
						model: step.model,
						...(resumes === undefined
							? {}
							: { session_id: resumes, resume: "resumed" as const }),
						started,
						log: `${logStem}.jsonl`,
						// Left out when false, so most entries read as before.
						...(step.inGoalReport ? { goal_report: true } : {}),
					}
				: { step: step.id, started, log: `${logStem}.log` };
		runs.push(entry);
		return { position, log: entry.log };
	});
	const { root, goal } = runOwnerGoal(owner);
	return { owner, position, log: runLogPath(root, goal, log) };
}

/**
 * Writes `sessionId`, the id the Run's Harness reported for its session, to
 * `entry` while the Run is still going, so a Run that never ends still says
 * which session to resume.
 */
export async function recordRunSession(
	entry: TicketRunEntry,
	sessionId: string,
): Promise<void> {
	await rewriteRuns(entry.owner, (runs) => {
		runTable(runs, entry).session_id = sessionId;
	});
}

/**
 * Marks `entry`, a Run that set out to resume a session, as having fallen
 * back to a fresh one: `resume = "fell-back"`. Its new session's id is
 * `recordRunSession`'s to write.
 */
export async function recordRunFellBack(entry: TicketRunEntry): Promise<void> {
	await rewriteRuns(entry.owner, (runs) => {
		runTable(runs, entry).resume = "fell-back";
	});
}

/**
 * Closes `entry` with when its Run ended, its outcome as spelled in the
 * header (`ok`, `exit 1`) and, for an agent Step, the tokens and cost its
 * Harness session reported. Its session id is `recordRunSession`'s to write.
 */
export async function recordRunEnd(
	entry: TicketRunEntry,
	outcome: string,
	ended: Date,
	session?: HarnessSessionReport,
): Promise<void> {
	await rewriteRuns(entry.owner, (runs) => {
		const table = runTable(runs, entry);
		table.ended = ended;
		table.outcome = outcome;
		if (session?.tokens !== undefined) table.tokens = session.tokens;
		if (session?.costUsd !== undefined) table.cost_usd = session.costUsd;
	});
}

// The table of `runs`, the `[[runs]]` of `entry`'s owner, that `entry`
// points at.
function runTable(
	runs: TicketRunTable[],
	entry: TicketRunEntry,
): TicketRunTable {
	const table = runs[entry.position - 1];
	if (table === undefined) {
		throw new Error(
			`${ownerFile(entry.owner)} has no [[runs]] entry ${entry.position}`,
		);
	}
	return table;
}

/**
 * Writes `retryAt`, when a `vago run` will retry `owner`'s last Run, to that
 * Run's `[[runs]]` entry. Does nothing when `owner` has no Runs.
 */
export async function recordRunRetry(
	owner: RunOwner,
	retryAt: Date,
): Promise<void> {
	await rewriteRuns(owner, (runs) => {
		const last = runs.at(-1);
		if (last !== undefined) last.retry_at = retryAt;
	});
}

/**
 * Closes `owner`'s last `[[runs]]` entry with `outcome` and `ended` when it
 * has no end yet, which is how a Run cut off by a crash leaves it. Does
 * nothing when `owner` has no such entry.
 */
export async function closeOpenRun(
	owner: RunOwner,
	outcome: string,
	ended: Date,
): Promise<void> {
	await rewriteRuns(owner, (runs) => {
		const last = runs.at(-1);
		if (last === undefined || last.ended !== undefined) return;
		last.ended = ended;
		last.outcome = outcome;
	});
}

// Lets `change` edit `owner`'s `[[runs]]` in place, in the Ticket's file or
// in `goal.md`, and returns what it returned. A header with no Runs gets a
// `runs` field only once `change` adds one, so it otherwise reads as before.
function rewriteRuns<Change>(
	owner: RunOwner,
	change: (runs: TicketRunTable[]) => Change,
): Promise<Change> {
	const rewrite = (header: { runs?: TicketRunTable[] | undefined }) => {
		const runs = header.runs ?? [];
		const changed = change(runs);
		if (runs.length > 0) header.runs = runs;
		return changed;
	};
	return owner.kind === "ticket"
		? rewriteHeader(ownerFile(owner), rewrite)
		: rewriteGoalHeader(ownerFile(owner), rewrite);
}

// The file whose header holds `owner`'s `[[runs]]`.
function ownerFile(owner: RunOwner): string {
	return owner.kind === "ticket"
		? ticketFile(owner.ticket)
		: goalFilePath(owner.root, owner.goal);
}

/**
 * Runs `run` while Goal `goal` of the Project at `root` is marked as taken by
 * this `vago run`, and returns what `run` returns. The mark is cleared when
 * `run` ends, however it ends, and a mark left by a `vago run` that has since
 * died is taken over. Throws an Error naming the Goal, without calling `run`
 * and changing nothing, when another live `vago run` has the Goal, or when
 * the Goal doesn't exist.
 */
export async function withGoalClaimed<T>(
	root: string,
	goal: string,
	run: () => Promise<T>,
): Promise<T> {
	// Checked first: writing the lock would create a mistyped Goal's folder.
	await existingGoalFile(root, goal);
	const lock = goalLockPath(root, goal);
	await claimLock(
		lock,
		(pid) =>
			`Goal ${goal} is already being run or accepted by vago (pid ${pid}). If no vago is running or accepting it, delete ${lock}`,
	);
	try {
		return await run();
	} finally {
		await releaseLock(lock);
	}
}

/**
 * Whether a live `vago run` other than this process has Goal `goal` of the
 * Project at `root`. False when no lock is there, it is unreadable, or the
 * process in it has died.
 */
export async function isGoalClaimed(
	root: string,
	goal: string,
): Promise<boolean> {
	return isLockHeld(goalLockPath(root, goal));
}

// The name becomes a folder or file under `.vago-goals/`, so a name that
// could point anywhere else, like `../x` or `a/b`, is refused.
function checkName(label: string, name: string): void {
	if (!/^[\w-]+$/.test(name)) {
		throw new Error(
			`${label} "${name}" may hold only letters, digits, - and _`,
		);
	}
}

// The text of the first `# ` heading in a Markdown `body`, or `fallback`
// when it has none.
function headingTitle(body: string, fallback: string): string {
	return /^# +(.+?)\s*$/m.exec(body)?.[1] ?? fallback;
}

// What follows the line `headingTitle` reads, or `body` with no heading.
function afterHeading(body: string): string {
	const heading = /^# +.+$/m.exec(body);
	return heading === null
		? body
		: body.slice(heading.index + heading[0].length);
}

// A header of the human's own could set status, which only Vago writes
// (ADR 0003). A +++ later in the body is fine: the header Vago writes closes
// before it.
function checkNoHeader(label: string, body: string): void {
	if (/^\s*\+\+\+[ \t]*(\r?\n|$)/.test(body)) {
		throw new Error(
			`The body for ${label} starts with a +++ header; only Vago writes a Ticket's header`,
		);
	}
}

// A file with no body gives the agent nothing to work from.
function checkBody(label: string, body: string): void {
	if (body.trim() === "") throw new Error(`The body for ${label} is empty`);
}

async function existingGoalFile(root: string, goal: string): Promise<string> {
	const goalFile = goalFilePath(root, goal);
	if (!(await Bun.file(goalFile).exists())) {
		throw new Error(`Goal ${goal} not found: ${goalFile} doesn't exist`);
	}
	return goalFile;
}

function goalFolder(root: string, goal: string): string {
	checkName("Goal name", goal);
	return join(root, goalsFolderName, goal);
}

function goalFilePath(root: string, goal: string): string {
	return goalFileIn(goalFolder(root, goal));
}

// The `goal.md` of `folder` of `.vago-goals`, there or not.
function goalFileIn(folder: string): string {
	return join(folder, "goal.md");
}

// The log path, as the header spells it and without its extension, of a Run
// of Goal Step group `group` named by `rest`. Named by group, a Goal Step's
// log can't collide with a Ticket's, and `readGoal` tells the groups' Runs
// apart by it.
function goalStepLogStem(group: GoalStepGroup, rest: string): string {
	return `logs/${group}-${rest}`;
}

// A Run's log path as the header spells it, relative to the folder of Goal
// `goal`, made absolute.
function runLogPath(root: string, goal: string, log: string): string {
	return join(goalFolder(root, goal), log);
}

// `table`, a `[[runs]]` table of Goal `goal` of the Project at `root`, as
// `readGoal` gives it.
function ticketRunOf(
	table: TicketRunTable,
	root: string,
	goal: string,
): TicketRun {
	return {
		step: table.step,
		started: table.started,
		ended: table.ended,
		outcome: table.outcome,
		log: runLogPath(root, goal, table.log),
		harness: table.harness,
		model: table.model,
		sessionId: table.session_id,
		resume: table.resume,
		retryAt: table.retry_at,
		tokens: table.tokens,
		costUsd: table.cost_usd,
		inGoalReport: table.goal_report === true,
	};
}

function goalLockPath(root: string, goal: string): string {
	return join(goalFolder(root, goal), "running.lock");
}

// The name of Ticket `number` with slug `slug`, like `01-say-hello`.
function ticketName(number: number, slug: string): string {
	return `${ticketNumberText(number)}-${slug}`;
}

function ticketFile(ticket: Ticket): string {
	return ticketFilePath(
		join(goalFolder(ticket.root, ticket.goal), "tickets"),
		ticket.name,
	);
}
