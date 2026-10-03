// A Goal's `tickets/` folder: how Ticket files are named, reading them with
// their headers, and the checks across them (numbers unique, every blocker a
// Ticket of the Goal, no cycles). Hides the file naming and the cycle walk.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readTicketFile, type TicketHeader } from "./header.ts";

/** One Ticket file as `readTicketFolder` found it. */
export type TicketFolderEntry = {
	/** The file name without `.md`, like `01-say-hello`. */
	name: string;
	number: number;
	header: TicketHeader;
	/** Everything after the header, as `readTicketFile` returns it. */
	body: string;
};

// An entry with its path, which the checks' errors name.
type TicketFile = {
	name: string;
	number: number;
	file: string;
	header: TicketHeader;
	body: string;
};

// The name without `.md` is group 1 and the Ticket number group 2.
const ticketFileName = /^((\d+)-.+)\.md$/;

/** The name of Ticket `number` with slug `slug`, like `01-say-hello`. */
export function ticketName(number: number, slug: string): string {
	return `${ticketNumberText(number)}-${slug}`;
}

/**
 * Ticket `number` as file names spell it, with at least two digits, so a
 * folder listing shows up to 99 Tickets in number order.
 */
export function ticketNumberText(number: number): string {
	return String(number).padStart(2, "0");
}

/** The path of the Ticket file named `name` in `ticketFolder`. */
export function ticketFilePath(ticketFolder: string, name: string): string {
	return join(ticketFolder, `${name}.md`);
}

/**
 * Reads every `.md` file in `ticketFolder`, the `tickets/` folder of Goal
 * `goal`, lowest number first, and none when the folder doesn't exist.
 * Throws an Error naming the problem and the file or folder it's in when a
 * file isn't named `NN-<slug>.md` or its header is bad, two Tickets share a
 * number, a Ticket is blocked by a number none has, or blockers form a cycle.
 */
export async function readTicketFolder(
	goal: string,
	ticketFolder: string,
): Promise<TicketFolderEntry[]> {
	// node:fs because Bun.file can't tell whether a directory exists. Sorted
	// by name so a shared number is reported the same way on every machine.
	const fileNames = existsSync(ticketFolder)
		? (await readdir(ticketFolder)).sort()
		: [];
	const entries: TicketFile[] = [];
	for (const fileName of fileNames) {
		if (!fileName.endsWith(".md")) continue;
		const file = join(ticketFolder, fileName);
		const match = ticketFileName.exec(fileName);
		if (match?.[1] === undefined || match[2] === undefined) {
			throw new Error(`${file} isn't named like a Ticket, NN-<slug>.md`);
		}
		const { header, body } = await readTicketFile(file);
		entries.push({
			name: match[1],
			number: Number(match[2]),
			file,
			header,
			body,
		});
	}
	entries.sort((a, b) => a.number - b.number);

	const byNumber = new Map<number, TicketFile>();
	for (const entry of entries) {
		const twin = byNumber.get(entry.number);
		if (twin !== undefined) {
			throw new Error(
				`${twin.file} and ${entry.file} share number ${entry.number}`,
			);
		}
		byNumber.set(entry.number, entry);
	}
	for (const entry of entries) {
		for (const blocker of entry.header.blocked_by ?? []) {
			if (!byNumber.has(blocker)) {
				throw new Error(
					`${entry.file} is blocked by Ticket ${blocker}, which isn't in Goal ${goal}`,
				);
			}
		}
	}
	const cycle = findBlockerCycle(byNumber);
	if (cycle !== undefined) {
		const names = cycle.map((number) => byNumber.get(number)?.name);
		throw new Error(
			`Goal ${goal} has a blocker cycle in ${ticketFolder}: ${names.join(" -> ")}`,
		);
	}
	return entries.map(({ name, number, header, body }) => ({
		name,
		number,
		header,
		body,
	}));
}

// Walks `blocked_by` depth first from the lowest number. Returns the Ticket
// numbers of the first cycle found, starting and ending on the same Ticket.
function findBlockerCycle(
	byNumber: Map<number, TicketFile>,
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
