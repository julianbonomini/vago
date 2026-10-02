// Owns Goal and Ticket files under `.punt/goals/<goal>/`: the `+++` TOML
// header, status, the `[[runs]]` history and where each Run's log goes.
// Every header rewrite is atomic and keeps the body byte for byte.

import { existsSync } from "node:fs";
import { readdir, rename } from "node:fs/promises";
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

const ticketFileName = /^(\d+)-.+\.md$/;
const headerStart = "+++\n";
const headerEnd = "\n+++\n";

/**
 * A Goal's Tickets as they stood when `readGoal` read them. Statuses change
 * as Alpha runs, so read the Goal again after a Ticket moves.
 */
export type GoalState = {
	/** Every Ticket of the Goal with its status, lowest number first. */
	tickets: { ticket: Ticket; status: TicketStatus }[];
	/**
	 * The lowest-numbered Ticket that is `ready` with every blocker `done`, or
	 * undefined when no Ticket is ready.
	 */
	next: Ticket | undefined;
};

/**
 * Reads `goal` and checks its format: `goal.md` exists, every Ticket header
 * parses, no two Tickets share a number, every blocker is a Ticket of the
 * Goal and no blockers form a cycle. Throws an Error naming the problem and
 * the file when a check fails. A Goal with no `tickets/` folder has no
 * Tickets.
 */
export async function readGoal(root: string, goal: string): Promise<GoalState> {
	const folder = goalFolder(root, goal);
	const goalFile = join(folder, "goal.md");
	if (!(await Bun.file(goalFile).exists())) {
		throw new Error(`Goal ${goal} not found: ${goalFile} doesn't exist`);
	}
	const ticketFolder = join(folder, "tickets");
	const fileNames = existsSync(ticketFolder)
		? (await readdir(ticketFolder)).sort()
		: [];
	const read: { ticket: Ticket; header: Header }[] = [];
	for (const fileName of fileNames) {
		const match = ticketFileName.exec(fileName);
		if (match?.[1] === undefined) continue;
		const ticket = {
			root,
			goal,
			name: fileName.slice(0, -".md".length),
			number: Number(match[1]),
		};
		read.push({
			ticket,
			header: (await readTicketFile(ticketFile(ticket))).header,
		});
	}
	read.sort((a, b) => a.ticket.number - b.ticket.number);

	const byNumber = new Map<number, { ticket: Ticket; header: Header }>();
	for (const entry of read) {
		const twin = byNumber.get(entry.ticket.number);
		if (twin !== undefined) {
			throw new Error(
				`${ticketFile(twin.ticket)} and ${entry.ticket.name}.md share number ${entry.ticket.number}`,
			);
		}
		byNumber.set(entry.ticket.number, entry);
	}
	for (const { ticket, header } of read) {
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
			`Goal ${goal} has a blocker cycle: ${names.join(" -> ")} (${join(folder, "tickets")})`,
		);
	}

	const next = read.find(
		({ header }) =>
			header.status === "ready" &&
			(header.blocked_by ?? []).every(
				(blocker) => byNumber.get(blocker)?.header.status === "done",
			),
	);
	return {
		tickets: read.map(({ ticket, header }) => ({
			ticket,
			status: header.status,
		})),
		next: next?.ticket,
	};
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
			const paddedNumber = String(ticket.number).padStart(2, "0");
			const logStem = `logs/${paddedNumber}-${step.id}-${position}`;
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

// Depth first along `blocked_by`, lowest number first. Reaching a Ticket
// that is still on the path closes a cycle, returned as the numbers walked
// from that Ticket back to itself.
function findBlockerCycle(
	byNumber: Map<number, { header: Header }>,
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

function goalFolder(root: string, goal: string): string {
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

async function rewriteHeader<Change>(
	file: string,
	change: (header: Header) => Change,
): Promise<Change> {
	const { header, body } = await readTicketFile(file);
	const changed = change(header);
	// Rename over the Ticket so a crash leaves the old file or the new one,
	// never half of each.
	const temp = `${file}.tmp`;
	await Bun.write(temp, `${headerStart}${stringify(header)}+++\n${body}`);
	await rename(temp, file);
	return changed;
}
