// Owns `.punt/workflow.toml`: reads it once, checks it, and returns the
// Workflow a Goal runs with. Hides the TOML schema and its defaults.

import { join } from "node:path";
import { z } from "zod";

export type ShellStep = {
	id: string;
	type: "shell";
	run: string;
};

export type Step = ShellStep;

export type Workflow = {
	steps: Step[];
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
		throw new Error(`${path} is not valid TOML: ${String(error)}`);
	}
	const checked = WorkflowFile.safeParse(toml);
	if (!checked.success) {
		throw new Error(`${path}: ${z.prettifyError(checked.error)}`);
	}
	return checked.data;
}
