// The `+++` TOML header that opens `goal.md` and every Ticket file: parsing
// and checking it, writing it back, and rewriting a Ticket's or `goal.md`'s
// header in place atomically with its body kept byte for byte. Also owns
// that atomic write and reading a checked TOML file, which the planning
// files share.

import { rename } from "node:fs/promises";
import { parse, stringify } from "smol-toml";
import { z } from "zod";

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
	// Absent for a Run that started a fresh session as usual.
	resume: z.enum(["resumed", "fell-back"]).optional(),
	// Set on a failed Run whose retry a `vago run` waits for.
	retry_at: z.date().optional(),
	tokens: z.object({ input: z.number(), output: z.number() }).optional(),
	cost_usd: z.number().optional(),
	goal_report: z.boolean().optional(),
});

const TicketHeader = z.looseObject({
	status: z.enum(["ready", "running", "done", "stuck"]),
	blocked_by: z.array(z.number().int()).optional(),
	workflow: z.string().optional(),
	// Absent from a Ticket added before Vago recorded it.
	created: z.date().optional(),
	runs: z.array(RunEntry).optional(),
});

/**
 * One `[[runs]]` table of a Ticket file's or `goal.md`'s header, spelled as
 * in the file.
 */
export type TicketRunTable = z.infer<typeof RunEntry>;

/** A Ticket file's header, with the fields as spelled in the file. */
export type TicketHeader = z.infer<typeof TicketHeader>;

const GoalHeader = z.looseObject({
	workflow: z.string(),
	// Absent from a Goal made before Vago recorded it.
	created: z.date().optional(),
	// The Runs of the Goal's Goal Steps; absent until one runs.
	runs: z.array(RunEntry).optional(),
});

/** A `goal.md` header, with the fields as spelled in the file. */
export type GoalHeader = z.infer<typeof GoalHeader>;

const headerStart = "+++\n";
const headerEnd = "\n+++\n";

/**
 * Reads the Ticket file at `file` and returns its header and its body.
 * Throws an Error naming the file when it has no header or the header is bad.
 */
export async function readTicketFile(
	file: string,
): Promise<{ header: TicketHeader; body: string }> {
	const split = splitHeader(file, await Bun.file(file).text());
	if (split === undefined) throw new Error(`${file} has no +++ header`);
	const checked = TicketHeader.safeParse(split.toml);
	if (!checked.success) {
		throw new Error(`${file}: ${z.prettifyError(checked.error)}`);
	}
	return { header: checked.data, body: split.body };
}

/**
 * Reads the `goal.md` at `file` and returns the Workflow its header names,
 * when the Goal was created (undefined for a Goal made before Vago recorded
 * it), the `[[runs]]` of its Goal Steps, and its body without the blank lines
 * under the header. Throws an Error naming the file and the line to add when
 * the header is missing or names no Workflow, and naming the file and the
 * problem when another field is bad.
 */
export async function readGoalFile(file: string): Promise<{
	workflow: string;
	created: Date | undefined;
	runs: TicketRunTable[];
	body: string;
}> {
	const { header, body } = await readGoalHeader(file);
	// A human editing the header by hand may leave a blank line under it.
	return {
		workflow: header.workflow,
		created: header.created,
		runs: header.runs ?? [],
		body: body.replace(/^\n+/, ""),
	};
}

/** The text of a file with `header` in a `+++` header, then `body`. */
export function headedText(
	header: Record<string, unknown>,
	body: string,
): string {
	return `${headerStart}${stringify(header)}+++\n${body}`;
}

/**
 * Reads the Ticket file at `file`, lets `change` edit its header in place,
 * writes it back, and returns what `change` returned. A crash leaves the old
 * file or the new one, never half of each.
 */
export function rewriteHeader<Change>(
	file: string,
	change: (header: TicketHeader) => Change,
): Promise<Change> {
	return rewriteWith(file, readTicketFile, change);
}

/**
 * Reads the `goal.md` at `file`, lets `change` edit its header in place,
 * writes it back with the body byte for byte, and returns what `change`
 * returned. A crash leaves the old file or the new one, never half of each.
 */
export function rewriteGoalHeader<Change>(
	file: string,
	change: (header: GoalHeader) => Change,
): Promise<Change> {
	// Not through readGoalFile, which drops the blank lines under the header.
	return rewriteWith(file, readGoalHeader, change);
}

// Reads `file` with `read`, lets `change` edit the header, and writes the
// header and the body back atomically.
async function rewriteWith<Header extends Record<string, unknown>, Change>(
	file: string,
	read: (file: string) => Promise<{ header: Header; body: string }>,
	change: (header: Header) => Change,
): Promise<Change> {
	const { header, body } = await read(file);
	const changed = change(header);
	await writeFileAtomically(file, headedText(header, body));
	return changed;
}

/**
 * `file` parsed and checked against `schema`, or undefined when there is no
 * such file. Throws an Error naming the file when it isn't valid TOML or
 * doesn't fit.
 */
export async function readTomlFile<T>(
	file: string,
	schema: z.ZodType<T>,
): Promise<T | undefined> {
	const text = Bun.file(file);
	if (!(await text.exists())) return undefined;
	let toml: unknown;
	try {
		// smol-toml, not Bun.TOML, so datetimes round-trip as in a header.
		toml = parse(await text.text());
	} catch (error) {
		throw new Error(`${file} isn't valid TOML: ${error}`);
	}
	const checked = schema.safeParse(toml);
	if (!checked.success) {
		throw new Error(`${file}: ${z.prettifyError(checked.error)}`);
	}
	return checked.data;
}

/**
 * Writes `text` to `file` through a temp file renamed over it, so a crash
 * leaves the old file or the new one, never half of each.
 */
export async function writeFileAtomically(
	file: string,
	text: string,
): Promise<void> {
	const temp = `${file}.tmp`;
	await Bun.write(temp, text);
	await rename(temp, file);
}

// The checked header of the `goal.md` at `file` and its body exactly as
// written, with what `readGoalFile` throws.
async function readGoalHeader(
	file: string,
): Promise<{ header: GoalHeader; body: string }> {
	const split = splitHeader(file, await Bun.file(file).text());
	if (split === undefined) {
		throw new Error(
			`${file} has no +++ header naming its Workflow; start it with the lines +++, workflow = "<name>", +++`,
		);
	}
	const checked = GoalHeader.safeParse(split.toml);
	if (!checked.success) {
		const namesNoWorkflow = checked.error.issues.some(
			({ path }) => path[0] === "workflow",
		);
		throw new Error(
			namesNoWorkflow
				? `${file}: its header names no Workflow; add the line workflow = "<name>"`
				: `${file}: ${z.prettifyError(checked.error)}`,
		);
	}
	return { header: checked.data, body: split.body };
}

// Splits the `+++` header off `text`, the text of `file`, and parses it.
// Returns undefined when `text` doesn't start with a header.
function splitHeader(
	file: string,
	text: string,
): { toml: unknown; body: string } | undefined {
	const end = text.indexOf(headerEnd);
	if (!text.startsWith(headerStart) || end === -1) return undefined;
	let toml: unknown;
	try {
		// smol-toml, not Bun.TOML: Bun parses datetimes into Temporal values
		// that smol-toml's stringify can't write back, and headers round-trip.
		toml = parse(text.slice(headerStart.length, end + 1));
	} catch (error) {
		throw new Error(`${file} has a header that isn't valid TOML: ${error}`);
	}
	return { toml, body: text.slice(end + headerEnd.length) };
}
