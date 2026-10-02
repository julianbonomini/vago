// Creates and owns Goal and Ticket files under `.punt/goals/<goal>/`: the
// `+++` TOML header, status, the `[[runs]]` history and where each Run's log
// goes. Every header rewrite is atomic and keeps the body byte for byte.

import { existsSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import type { HarnessSessionReport } from "./harness/registry.ts";
import type { Step } from "./workflow.ts";

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

// Loose objects, so header fields Alpha doesn't know survive a rewrite.
const RunEntry = z.looseObject({
	step: z.string(),
	started: z.date(),
	ended: z.date().optional(),
	outcome: z.string().optional(),
	log: z.string(),
	harness: z.string().optional(),
	model: z.string().optional(),
	session_id: z.string().optional(),
	tokens: z.object({ input: z.number(), output: z.number() }).optional(),
	cost_usd: z.number().optional(),
});

const Header = z.looseObject({
	status: z.enum(["ready", "running", "done", "stuck"]),
	blocked_by: z.array(z.number().int()).optional(),
	runs: z.array(RunEntry).optional(),
});

type Header = z.infer<typeof Header>;

// The name without `.md` is group 1 and the Ticket number group 2.
const ticketFileName = /^((\d+)-.+)\.md$/;
const headerStart = "+++\n";
const headerEnd = "\n+++\n";

/**
 * A Goal's Tickets as `readGoal` found them. Statuses change while Alpha
 * runs, so read the Goal again after a Ticket moves.
 */
export type GoalState = {
	/** Every Ticket of the Goal with its status, lowest number first. */
	tickets: { ticket: Ticket; status: TicketStatus }[];
	/**
	 * The lowest-numbered Ticket that is `ready` and whose blockers are all
	 * `done`, or undefined when there is none.
	 */
	nextReady: Ticket | undefined;
	/** Whether every Ticket is `done`, which a Goal with no Tickets is. */
	done: boolean;
};

type TicketHeader = { ticket: Ticket; header: Header };

/**
 * Creates Goal `goal` with a `goal.md` titled with its name, for the human
 * to describe the outcome in, and an empty `tickets/`. Returns the path of
 * `goal.md`. Throws an Error naming the file when the Goal already exists,
 * or naming the problem when `goal` isn't a valid name.
 */
export async function createGoal(root: string, goal: string): Promise<string> {
	const folder = goalFolder(root, goal);
	const goalFile = join(folder, "goal.md");
	if (await Bun.file(goalFile).exists()) {
		throw new Error(`Goal ${goal} already exists: ${goalFile}`);
	}
	await mkdir(join(folder, "tickets"), { recursive: true });
	await Bun.write(goalFile, `# ${goal}\n`);
	return goalFile;
}

/**
 * Reads `goal` and checks its format: `goal.md` exists, every `.md` file in
 * `tickets/` is named `NN-<slug>.md` and has a header that parses, no two
 * Tickets share a number, every blocker is a Ticket of the Goal, and no
 * blockers form a cycle. Throws an Error naming the problem and the file or
 * folder it's in when a check fails. A Goal without a `tickets/` folder has
 * no Tickets.
 */
export async function readGoal(root: string, goal: string): Promise<GoalState> {
	const folder = goalFolder(root, goal);
	const goalFile = join(folder, "goal.md");
	if (!(await Bun.file(goalFile).exists())) {
		throw new Error(`Goal ${goal} not found: ${goalFile} doesn't exist`);
	}
	const ticketFolder = join(folder, "tickets");
	// node:fs because Bun.file can't tell whether a directory exists. Sorted
	// by name so a shared number is reported the same way on every machine.
	const fileNames = existsSync(ticketFolder)
		? (await readdir(ticketFolder)).sort()
		: [];
	const entries: TicketHeader[] = [];
	for (const fileName of fileNames) {
		if (!fileName.endsWith(".md")) continue;
		const match = ticketFileName.exec(fileName);
		if (match?.[1] === undefined || match[2] === undefined) {
			throw new Error(
				`${join(ticketFolder, fileName)} isn't named like a Ticket, NN-<slug>.md`,
			);
		}
		const ticket = { root, goal, name: match[1], number: Number(match[2]) };
		const { header } = await readTicketFile(ticketFile(ticket));
		entries.push({ ticket, header });
	}
	entries.sort((a, b) => a.ticket.number - b.ticket.number);

	const byNumber = new Map<number, TicketHeader>();
	for (const entry of entries) {
		const twin = byNumber.get(entry.ticket.number);
		if (twin !== undefined) {
			throw new Error(
				`${ticketFile(twin.ticket)} and ${ticketFile(entry.ticket)} share number ${entry.ticket.number}`,
			);
		}
		byNumber.set(entry.ticket.number, entry);
	}
	for (const { ticket, header } of entries) {
		for (const blocker of header.blocked_by ?? []) {
			if (!byNumber.has(blocker)) {
				throw new Error(
					`${ticketFile(ticket)} is blocked by Ticket ${blocker}, which isn't in Goal ${goal}`,
				);
			}
		}
	}
	const cycle = findBlockerCycle(byNumber);
	if (cycle !== undefined) {
		const names = cycle.map((number) => byNumber.get(number)?.ticket.name);
		throw new Error(
			`Goal ${goal} has a blocker cycle in ${ticketFolder}: ${names.join(" -> ")}`,
		);
	}

	const nextReady = entries.find(
		({ header }) =>
			header.status === "ready" &&
			(header.blocked_by ?? []).every(
				(blocker) => byNumber.get(blocker)?.header.status === "done",
			),
	);
	return {
		tickets: entries.map(({ ticket, header }) => ({
			ticket,
			status: header.status,
		})),
		nextReady: nextReady?.ticket,
		done: entries.every(({ header }) => header.status === "done"),
	};
}

/**
 * Adds a Ticket named `slug` to `goal`, numbered one past its highest
 * Ticket, with status `ready`, blocked by the Tickets numbered in
 * `blockedBy` (each once, however often it's given), and a title for the
 * human to fill in. Returns the path of the new Ticket file. Throws an Error
 * naming the problem when the Goal doesn't exist or its format is bad, a
 * blocker isn't a Ticket of the Goal, or `goal` or `slug` isn't a valid name.
 */
export async function addTicket(
	root: string,
	goal: string,
	slug: string,
	blockedBy: number[],
): Promise<string> {
	checkName("Ticket slug", slug);
	const { tickets } = await readGoal(root, goal);
	for (const blocker of blockedBy) {
		if (!tickets.some(({ ticket }) => ticket.number === blocker)) {
			throw new Error(
				`${slug} can't be blocked by Ticket ${blocker}, which isn't in Goal ${goal}`,
			);
		}
	}
	const number = Math.max(0, ...tickets.map(({ ticket }) => ticket.number)) + 1;
	const ticket = { root, goal, name: `${twoDigits(number)}-${slug}`, number };
	const header: Header =
		blockedBy.length > 0
			? { status: "ready", blocked_by: [...new Set(blockedBy)] }
			: { status: "ready" };
	const file = ticketFile(ticket);
	await Bun.write(file, ticketText(header, `\n# ${slug}\n`));
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
 * Returns the `goal.md` of the Ticket's Goal as the human wrote it. Throws an
 * Error naming the file when it doesn't exist.
 */
export async function readGoalBody(ticket: Ticket): Promise<string> {
	const path = join(goalFolder(ticket.root, ticket.goal), "goal.md");
	const file = Bun.file(path);
	if (!(await file.exists())) throw new Error(`${path} not found`);
	return await file.text();
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
			const logStem = `logs/${twoDigits(ticket.number)}-${step.id}-${position}`;
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
	return {
		ticket,
		position,
		log: join(goalFolder(ticket.root, ticket.goal), log),
	};
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

// Walks `blocked_by` depth first from the lowest number. Returns the Ticket
// numbers of the first cycle found, starting and ending on the same Ticket.
function findBlockerCycle(
	byNumber: Map<number, TicketHeader>,
): number[] | undefined {
	const cleared = new Set<number>();
	const path: number[] = [];
	const visit = (number: number): number[] | undefined => {
		const onPath = path.indexOf(number);
		if (onPath !== -1) return [...path.slice(onPath), number];
		if (cleared.has(number)) return undefined;
		path.push(number);
		for (const blocker of byNumber.get(number)?.header.blocked_by ?? []) {
			const cycle = visit(blocker);
			if (cycle !== undefined) return cycle;
		}
		path.pop();
		cleared.add(number);
		return undefined;
	};
	for (const number of byNumber.keys()) {
		const cycle = visit(number);
		if (cycle !== undefined) return cycle;
	}
	return undefined;
}

// The name becomes a folder or file under `.punt/goals/`, so a name that
// could point anywhere else, like `../x` or `a/b`, is refused.
function checkName(label: string, name: string): void {
	if (!/^[\w-]+$/.test(name)) {
		throw new Error(
			`${label} "${name}" may hold only letters, digits, - and _`,
		);
	}
}

// Ticket files and logs number Tickets with at least two digits, so a folder
// listing shows up to 99 Tickets in number order.
function twoDigits(number: number): string {
	return String(number).padStart(2, "0");
}

function goalFolder(root: string, goal: string): string {
	checkName("Goal name", goal);
	return join(root, ".punt", "goals", goal);
}

function ticketFile(ticket: Ticket): string {
	return join(
		goalFolder(ticket.root, ticket.goal),
		"tickets",
		`${ticket.name}.md`,
	);
}

async function readTicketFile(
	file: string,
): Promise<{ header: Header; body: string }> {
	const text = await Bun.file(file).text();
	const end = text.indexOf(headerEnd);
	if (!text.startsWith(headerStart) || end === -1) {
		throw new Error(`${file} has no +++ header`);
	}
	let toml: unknown;
	try {
		// smol-toml, not Bun.TOML: Bun parses datetimes into Temporal values
		// that smol-toml's stringify can't write back, and headers round-trip.
		toml = parse(text.slice(headerStart.length, end + 1));
	} catch (error) {
		throw new Error(`${file} has a header that isn't valid TOML: ${error}`);
	}
	const checked = Header.safeParse(toml);
	if (!checked.success) {
		throw new Error(`${file}: ${z.prettifyError(checked.error)}`);
	}
	return { header: checked.data, body: text.slice(end + headerEnd.length) };
}

function ticketText(header: Header, body: string): string {
	return `${headerStart}${stringify(header)}+++\n${body}`;
}

async function rewriteHeader<Change>(
	file: string,
	change: (header: Header) => Change,
): Promise<Change> {
	const { header, body } = await readTicketFile(file);
	const changed = change(header);
	// Rename over the Ticket so a crash leaves the old file or the new one,
	// never half of each.
	const temp = `${file}.tmp`;
	await Bun.write(temp, ticketText(header, body));
	await rename(temp, file);
	return changed;
}
