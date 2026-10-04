// The entry to the module that creates and owns Goal and Ticket files under
// `.vago-goals/<goal>/`: which Goals a Project has, the `goal.md` header
// naming the Goal's Workflow, the Workflow a Ticket names in place of it,
// Goal and Ticket titles, status, blockers, the `[[runs]]` history and where
// each Run's log goes, how a Ticket number is spelled, and the lock that
// marks a Goal as taken by a `vago run`. Only this file is imported from
// outside `tickets/`.

import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessSessionReport } from "../harness/registry.ts";
import type { Step } from "../workflow.ts";
import { claimLock, isLockHeld, releaseLock } from "./goal-lock.ts";
import {
	headedText,
	readGoalFile,
	readTicketFile,
	rewriteHeader,
	type TicketHeader,
} from "./header.ts";
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
 * One entry in a Ticket's `[[runs]]`, as `recordRunStart` opened it. Pass it
 * back to `recordRunEnd` unchanged, like an open file descriptor.
 */
export type TicketRunEntry = {
	ticket: Ticket;
	/** The entry's 1-based position in the Ticket's `[[runs]]`. */
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

/** One entry of a Ticket's `[[runs]]` as `readGoal` found it. */
export type TicketRun = {
	step: string;
	started: Date;
	/** Absent while the Run is still going. */
	ended?: Date;
	/** As spelled in the header, like `ok` or `exit 1`. Absent like `ended`. */
	outcome?: string;
	/** Absolute path of the Run's log. */
	log: string;
	/** The model an agent Step ran on. Absent for a shell Step. */
	model?: string;
	/** What the Harness reported the Run used. Absent like `costUsd`. */
	tokens?: { input: number; output: number };
	/** What the Harness reported the Run cost. Absent for a shell Step. */
	costUsd?: number;
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
	/**
	 * Every Ticket of the Goal with its status, the name of the Workflow it
	 * goes through (which might not exist) and its `[[runs]]` in the order
	 * they ran, lowest number first.
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
	 * The lowest-numbered Ticket that is `ready` and whose blockers are all
	 * `done`, with the name of the Workflow it goes through, or undefined
	 * when there is none.
	 */
	nextReady: { ticket: Ticket; workflow: string } | undefined;
	/** Whether every Ticket is `done`, which a Goal with no Tickets is. */
	done: boolean;
};

/**
 * Creates Goal `goal` with an empty `tickets/` and a `goal.md` whose `+++`
 * header names `workflow`, followed by `body` exactly as given, which is what
 * `{{goal}}` will be. Without `body`, the body is a `# <goal>` title. Doesn't
 * check that the Workflow exists. Returns the path of `goal.md`. Throws an
 * Error naming the problem, and creates nothing, when `body` is empty or only
 * whitespace, the Goal already exists, or `goal` isn't a valid name.
 */
export async function createGoal(
	root: string,
	goal: string,
	workflow: string,
	body?: string,
): Promise<string> {
	const folder = goalFolder(root, goal);
	if (body !== undefined) checkBody(`Goal ${goal}`, body);
	const goalFile = join(folder, "goal.md");
	if (await Bun.file(goalFile).exists()) {
		throw new Error(`Goal ${goal} already exists: ${goalFile}`);
	}
	await mkdir(join(folder, "tickets"), { recursive: true });
	await Bun.write(goalFile, headedText({ workflow }, body ?? `# ${goal}\n`));
	return goalFile;
}

/**
 * The name of every Goal of the Project at `root`, in name order, without
 * reading or checking any of them. None when the Project has no Goals yet.
 * Throws an Error naming the path when `.vago-goals` isn't a folder.
 */
export async function listGoals(root: string): Promise<string[]> {
	const path = join(root, goalsFolderName);
	try {
		const entries = await readdir(path, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
			.sort();
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return [];
		if (code === "ENOTDIR") throw new Error(`${path} isn't a folder`);
		throw error;
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
	const { workflow, body } = await readGoalFile(
		await existingGoalFile(root, goal),
	);
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
		runs: (header.runs ?? []).map((run) => ({
			step: run.step,
			started: run.started,
			ended: run.ended,
			outcome: run.outcome,
			log: runLogPath(ticket, run.log),
			model: run.model,
			tokens: run.tokens,
			costUsd: run.cost_usd,
		})),
	}));
	const nextReady = tickets.find(
		({ ticket, status }) =>
			status === "ready" &&
			(byNumber.get(ticket.number)?.header.blocked_by ?? []).every(
				(blocker) => byNumber.get(blocker)?.header.status === "done",
			),
	);
	return {
		title: headingTitle(body, goal),
		description: afterHeading(body),
		workflow,
		tickets,
		nextReady:
			nextReady === undefined
				? undefined
				: { ticket: nextReady.ticket, workflow: nextReady.workflow },
		done: entries.every(({ header }) => header.status === "done"),
	};
}

/**
 * Adds a Ticket named `slug` to `goal`, numbered one past its highest
 * Ticket, with status `ready` and blocked by the Tickets numbered in
 * `blockedBy` (each once, however often it's given), going through Workflow
 * `workflow`, or the Goal's when it's undefined. Doesn't check that the
 * Workflow exists. The Ticket's body is
 * `body` exactly as given, which is what `readTicketBody` will return.
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
		// A header of the human's own could set status, which only Vago
		// writes (ADR 0003). A +++ later in the body is fine: the header Vago
		// writes closes before it.
		if (/^\s*\+\+\+[ \t]*(\r?\n|$)/.test(body)) {
			throw new Error(
				`The body for Ticket ${slug} starts with a +++ header; only Vago writes a Ticket's header`,
			);
		}
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
	const header: TicketHeader = { status: "ready" };
	if (blockedBy.length > 0) header.blocked_by = [...new Set(blockedBy)];
	if (workflow !== undefined) header.workflow = workflow;
	const file = ticketFile(ticket);
	await Bun.write(file, headedText(header, body ?? `\n# ${slug}\n`));
	return file;
}

/**
 * Returns the Ticket's title and body as the human wrote them. The header
 * is never part of it, so agents can't see or set status (ADR 0003).
 */
export async function readTicketBody(ticket: Ticket): Promise<string> {
	return (await readTicketFile(ticketFile(ticket))).body;
}

/**
 * What the log at `log`, a `TicketRun`'s, holds so far: "" when its Run
 * hasn't written it yet.
 */
export async function readRunLog(log: string): Promise<string> {
	const file = Bun.file(log);
	return (await file.exists()) ? file.text() : "";
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
	const path = join(goalFolder(root, goal), "goal.md");
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
 * Appends a `[[runs]]` entry for `step`, started at `started`, naming the
 * Harness and model for an agent Step. Call it before the Step starts, so a
 * crash mid-Step still leaves a trace. Returns the entry, which carries the
 * path the Run's log must be written to.
 */
export async function recordRunStart(
	ticket: Ticket,
	step: Step,
	started: Date,
): Promise<TicketRunEntry> {
	const { position, log } = await rewriteHeader(
		ticketFile(ticket),
		(header) => {
			const runs = header.runs ?? [];
			const position = runs.length + 1;
			// The position in the name gives a reset Ticket's new Runs new logs.
			const logStem = `logs/${ticketNumberText(ticket.number)}-${step.id}-${position}`;
			const entry =
				step.type === "agent"
					? {
							step: step.id,
							harness: step.harness,
							model: step.model,
							started,
							log: `${logStem}.jsonl`,
						}
					: { step: step.id, started, log: `${logStem}.log` };
			runs.push(entry);
			header.runs = runs;
			return { position, log: entry.log };
		},
	);
	return { ticket, position, log: runLogPath(ticket, log) };
}

/**
 * Closes `entry` with when its Run ended, its outcome as spelled in the
 * header (`ok`, `exit 1`) and, for an agent Step, what its Harness session
 * reported.
 */
export async function recordRunEnd(
	entry: TicketRunEntry,
	outcome: string,
	ended: Date,
	session?: HarnessSessionReport,
): Promise<void> {
	const file = ticketFile(entry.ticket);
	await rewriteHeader(file, (header) => {
		const table = header.runs?.[entry.position - 1];
		if (table === undefined) {
			throw new Error(`${file} has no [[runs]] entry ${entry.position}`);
		}
		table.ended = ended;
		table.outcome = outcome;
		if (session?.sessionId !== undefined) table.session_id = session.sessionId;
		if (session?.tokens !== undefined) table.tokens = session.tokens;
		if (session?.costUsd !== undefined) table.cost_usd = session.costUsd;
	});
}

/**
 * Closes the Ticket's last `[[runs]]` entry with `outcome` and `ended` when
 * it has no end yet, which is how a Run cut off by a crash leaves it. Does
 * nothing when the Ticket has no such entry.
 */
export async function closeOpenRun(
	ticket: Ticket,
	outcome: string,
	ended: Date,
): Promise<void> {
	await rewriteHeader(ticketFile(ticket), (header) => {
		const last = header.runs?.at(-1);
		if (last === undefined || last.ended !== undefined) return;
		last.ended = ended;
		last.outcome = outcome;
	});
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
	await claimLock(lock, goal);
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

// A file with no body gives the agent nothing to work from.
function checkBody(label: string, body: string): void {
	if (body.trim() === "") throw new Error(`The body for ${label} is empty`);
}

async function existingGoalFile(root: string, goal: string): Promise<string> {
	const goalFile = join(goalFolder(root, goal), "goal.md");
	if (!(await Bun.file(goalFile).exists())) {
		throw new Error(`Goal ${goal} not found: ${goalFile} doesn't exist`);
	}
	return goalFile;
}

function goalFolder(root: string, goal: string): string {
	checkName("Goal name", goal);
	return join(root, goalsFolderName, goal);
}

// A Run's log path as the header spells it, relative to the Goal's folder,
// made absolute.
function runLogPath(ticket: Ticket, log: string): string {
	return join(goalFolder(ticket.root, ticket.goal), log);
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
