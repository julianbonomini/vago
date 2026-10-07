// A planning item's Proposal files: the TOML a proposal block holds, checked
// against its schema, `planning/proposal.toml` that keeps the last good one,
// and `planning/workflow.toml` that keeps the human's Workflow choice. Takes
// the item's `planning/` folder, so it never imports `tickets.ts`.

import { join } from "node:path";
import { parse, stringify } from "smol-toml";
import { z } from "zod";
import { readTomlFile, writeFileAtomically } from "./header.ts";

// Strict, so a misspelled field such as `blockers` is refused rather than
// silently dropped.
const ProposedTicketTable = z.strictObject({
	slug: z.string(),
	blocked_by: z.array(z.int()).default([]),
	body: z.string(),
});

const ProposalBlock = z.strictObject({
	goal: z.string(),
	tickets: z.array(ProposedTicketTable),
	workflow: z.string().optional(),
	workflow_reason: z.string().optional(),
	open_decisions: z.array(z.string()).default([]),
});

const WorkflowFile = z.strictObject({ workflow: z.string() });

/** What a proposal block holds, with the fields as spelled in it. */
export type PlanningProposalBlock = z.infer<typeof ProposalBlock>;

/**
 * The block `toml`, the text between a proposal block's tags, checked
 * against the format; `bad` with the reason when it isn't valid TOML or
 * doesn't fit. Never throws.
 */
export function parseProposalBlock(
	toml: string,
):
	| { outcome: "ok"; block: PlanningProposalBlock }
	| { outcome: "bad"; reason: string } {
	let parsed: unknown;
	try {
		parsed = parse(toml);
	} catch (error) {
		return { outcome: "bad", reason: `it isn't valid TOML: ${error}` };
	}
	const checked = ProposalBlock.safeParse(parsed);
	return checked.success
		? { outcome: "ok", block: checked.data }
		: { outcome: "bad", reason: z.prettifyError(checked.error) };
}

/**
 * The `proposal.toml` in `folder`, a planning item's `planning/` folder;
 * undefined when there is none yet. Throws an Error naming the file when it
 * isn't valid TOML or a field is bad.
 */
export async function readPlanningProposalFile(
	folder: string,
): Promise<PlanningProposalBlock | undefined> {
	return readTomlFile(join(folder, "proposal.toml"), ProposalBlock);
}

/**
 * Replaces the `proposal.toml` in `folder` with `block`. A crash leaves the
 * old file or the new one, never half of each.
 */
export async function writePlanningProposalFile(
	folder: string,
	block: PlanningProposalBlock,
): Promise<void> {
	await writeFileAtomically(join(folder, "proposal.toml"), stringify(block));
}

/**
 * The Workflow the human chose in the `workflow.toml` in `folder`; undefined
 * when they chose none. Throws as `readPlanningProposalFile` does.
 */
export async function readPlanningWorkflowFile(
	folder: string,
): Promise<string | undefined> {
	return (await readTomlFile(join(folder, "workflow.toml"), WorkflowFile))
		?.workflow;
}

/** Records `workflow` in the `workflow.toml` in `folder`, atomically. */
export async function writePlanningWorkflowFile(
	folder: string,
	workflow: string,
): Promise<void> {
	await writeFileAtomically(
		join(folder, "workflow.toml"),
		stringify({ workflow }),
	);
}
