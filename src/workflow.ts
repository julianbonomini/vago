// Owns `.punt/workflow.toml`: reads it once, along with the prompt files it
// names, checks it, and returns the Workflow a Goal runs with. Hides the TOML
// schema, its defaults and how paths resolve.

import { join } from "node:path";
import { z } from "zod";
import { knownHarness } from "./harness/registry.ts";

/** A Step that runs `run` with `sh -c` in the repo root. */
export type ShellStep = {
	readonly id: string;
	readonly type: "shell";
	readonly run: string;
};

/** A Step that one fresh session of `harness` on `model` performs. */
export type AgentStep = {
	readonly id: string;
	readonly type: "agent";
	/** The prompt file's text, before substitution. */
	readonly prompt: string;
	readonly harness: string;
	readonly model: string;
};

/** One entry of a Workflow. */
export type Step = ShellStep | AgentStep;

/** A Project's Workflow, frozen: nothing changes it once it's loaded. */
export type Workflow = {
	readonly steps: readonly Step[];
};

const WorkflowFile = z.object({
	harness: z.string().optional(),
	model: z.string().optional(),
	steps: z
		.array(
			z.discriminatedUnion("type", [
				z.object({ id: z.string(), type: z.literal("shell"), run: z.string() }),
				z.object({
					id: z.string(),
					type: z.literal("agent"),
					prompt: z.string(),
				}),
			]),
		)
		.min(1),
});

/**
 * Reads the Workflow of the Project at `root`. Throws an Error naming the
 * file and the problem when the Workflow is missing or invalid, names an
 * unknown Harness, or names a prompt file that doesn't exist.
 */
export async function loadWorkflow(root: string): Promise<Workflow> {
	const punt = join(root, ".punt");
	const path = join(punt, "workflow.toml");
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
	const { harness, model } = checked.data;
	const steps: Step[] = [];
	for (const step of checked.data.steps) {
		if (step.type === "shell") {
			steps.push(Object.freeze(step));
			continue;
		}
		if (harness === undefined || model === undefined) {
			throw new Error(
				`${path}: agent step "${step.id}" needs a harness and a model`,
			);
		}
		if (!knownHarness(harness)) {
			throw new Error(`${path}: unknown harness "${harness}"`);
		}
		const promptPath = join(punt, step.prompt);
		const prompt = Bun.file(promptPath);
		if (!(await prompt.exists())) {
			throw new Error(
				`${path}: prompt file ${promptPath} of step "${step.id}" not found`,
			);
		}
		steps.push(
			Object.freeze({ ...step, prompt: await prompt.text(), harness, model }),
		);
	}
	// Frozen, with the prompts' text inside, so a Goal runs every Ticket with
	// the Workflow it started with even if an agent edits `.punt/`.
	return Object.freeze({ steps: Object.freeze(steps) });
}
