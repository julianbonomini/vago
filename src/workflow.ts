// Owns `.punt/workflow.toml`: reads it once, checks it, and returns the
// Workflow a Goal runs with. Hides the TOML schema and its defaults.

import { join } from "node:path";
import { z } from "zod";

/** A Step that runs `run` with `sh -c` in the repo root. */
export type ShellStep = {
	readonly id: string;
	readonly type: "shell";
	readonly run: string;
};

/** One entry of a Workflow. Agent Steps join this union in ticket 03. */
export type Step = ShellStep;

/** A Project's Workflow, frozen: nothing changes it once it's loaded. */
export type Workflow = {
	readonly steps: readonly Step[];
};

const WorkflowFile = z.object({
	steps: z
		.array(
			z.object({
				id: z.string(),
				type: z.literal("shell"),
				run: z.string(),
			}),
		)
		.min(1),
});

/**
 * Reads the Workflow of the Project at `root`. Throws an Error naming the
 * file and the problem when the file is missing or isn't a valid Workflow.
 */
export async function loadWorkflow(root: string): Promise<Workflow> {
	const path = join(root, ".punt", "workflow.toml");
	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(`${path} not found`);
	}
	let toml: unknown;
	try {
		toml = Bun.TOML.parse(await file.text());
	} catch (error) {
		throw new Error(`${path} is not valid TOML: ${error}`);
	}
	const checked = WorkflowFile.safeParse(toml);
	if (!checked.success) {
		throw new Error(`${path}: ${z.prettifyError(checked.error)}`);
	}
	// Frozen so a Goal runs every Ticket with the Workflow it started with.
	return Object.freeze({
		steps: Object.freeze(checked.data.steps.map((step) => Object.freeze(step))),
	});
}
