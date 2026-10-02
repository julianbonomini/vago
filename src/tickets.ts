// Owns Goal and Ticket files under `.punt/goals/<goal>/`: the `+++` TOML
// header, status, the `[[runs]]` history and where each Run's log goes.
// Every header rewrite is atomic and keeps the body byte for byte.

import { readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import { type Outcome, outcomeText } from "./step-runner.ts";

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
 * A Run whose `[[runs]]` entry has been written but not yet ended. Hand it
 * back to `recordRunEnd` unchanged, like a file descriptor.
 */
export type Run = {
	ticket: Ticket;
	/** The entry's 1-based position in the Ticket's `[[runs]]`. */
	position: number;
	/** Absolute path the Step's output must be written to. */
	log: string;
};

// Loose objects, so header fields Alpha doesn't know survive a rewrite.
const RunEntry = z.looseObject({
	step: z.string(),
	started: z.date(),
	ended: z.date().optional(),
	outcome: z.string().optional(),
	log: z.string(),
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
 * Returns the lowest-numbered Ticket of `goal` whose status is `ready`, or
 * undefined when there is none. Throws an Error naming the file when a
 * Ticket's header can't be read.
 */
export async function nextReadyTicket(
	root: string,
	goal: string,
): Promise<Ticket | undefined> {
	const folder = join(goalFolder(root, goal), "tickets");
	const tickets: Ticket[] = [];
	for (const fileName of await readdir(folder)) {
		const match = ticketFileName.exec(fileName);
		if (match?.[1] === undefined) continue;
		tickets.push({
			root,
			goal,
			name: fileName.slice(0, -".md".length),
			number: Number(match[1]),
		});
	}
	tickets.sort((a, b) => a.number - b.number);
	for (const ticket of tickets) {
		const { header } = await readTicketFile(ticketFile(ticket));
		if (header.status === "ready") return ticket;
	}
	return undefined;
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
 * Appends a `[[runs]]` entry for `step`, started at `started`. Call it before
 * the Step starts, so a crash mid-Step still leaves a trace. Returns the Run,
 * which carries the path its log must be written to.
 */
export async function recordRunStart(
	ticket: Ticket,
	step: string,
	started: Date,
): Promise<Run> {
	const { position, log } = await rewriteHeader(
		ticketFile(ticket),
		(header) => {
			const runs = header.runs ?? [];
			const position = runs.length + 1;
			// The position in the name gives a reset Ticket's new Runs new logs.
			const paddedNumber = String(ticket.number).padStart(2, "0");
			const log = `logs/${paddedNumber}-${step}-${position}.log`;
			runs.push({ step, started, log });
			header.runs = runs;
			return { position, log };
		},
	);
	return {
		ticket,
		position,
		log: join(goalFolder(ticket.root, ticket.goal), log),
	};
}

/** Fills in the Run's `[[runs]]` entry with when and how it ended. */
export async function recordRunEnd(
	run: Run,
	outcome: Outcome,
	ended: Date,
): Promise<void> {
	const file = ticketFile(run.ticket);
	await rewriteHeader(file, (header) => {
		const entry = header.runs?.[run.position - 1];
		if (entry === undefined) {
			throw new Error(`${file} has no [[runs]] entry ${run.position}`);
		}
		entry.ended = ended;
		entry.outcome = outcomeText(outcome);
	});
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
