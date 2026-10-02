// Owns `.punt/workflow.toml` and its prompt files: reads them once, checks
// them, returns the Workflow a Goal runs with, and fills in agent prompts.
// Hides the TOML schema, its defaults, how paths resolve and the `{{…}}`
// placeholder syntax.

import { join } from "node:path";
import { z } from "zod";
import { knownHarness } from "./harness/registry.ts";

/** A Step that runs `run` with `sh -c` in the repo root. */
export type ShellStep = {
	readonly id: string;
	readonly type: "shell";
	readonly run: string;
};

/**
 * A Step that a fresh Harness session performs. `harness`, `model` and
 * `args` are already resolved: the Step's own value, else the Workflow's.
 */
export type AgentStep = {
	readonly id: string;
	readonly type: "agent";
	readonly promptTemplate: string;
	readonly harness: string;
	readonly model: string;
	/** Appended to the Harness command; empty when neither level sets any. */
	readonly args: readonly string[];
};

/** One entry of a Workflow. */
export type Step = ShellStep | AgentStep;

/** A Project's Workflow, frozen: nothing changes it once it's loaded. */
export type Workflow = {
	readonly steps: readonly Step[];
};

const HarnessName = z.string().refine(knownHarness, {
	error: (issue) => `unknown harness "${issue.input}"`,
});

const Duration = z.string().regex(/^[1-9]\d*(ms|s|m|h)$/, {
	error: 'idle_timeout must be a duration like "30m"',
});

// TODO(07): give `on_fail` and `idle_timeout` their effect. Until then the
// loader only checks them.
const WorkflowFile = z.object({
	harness: HarnessName.optional(),
	model: z.string().optional(),
	args: z.array(z.string()).optional(),
	idle_timeout: Duration.optional(),
	steps: z
		.array(
			z.discriminatedUnion(
				"type",
				[
					z.object({
						id: z.string(),
						type: z.literal("shell"),
						run: z.string(),
						on_fail: z.enum(["stop", "continue"]).optional(),
					}),
					z.object({
						id: z.string(),
						type: z.literal("agent"),
						prompt: z.string(),
						harness: HarnessName.optional(),
						model: z.string().optional(),
						args: z.array(z.string()).optional(),
						idle_timeout: Duration.optional(),
					}),
				],
				{ error: 'type must be "agent" or "shell"' },
			),
		)
		.min(1),
});

/**
 * Reads the Workflow of the Project at `root`, with every prompt's text
 * inside. Throws an Error naming the file and the problem when the Workflow
 * is missing or isn't valid TOML, two Steps share an `id`, a Step's `type`
 * is unknown, a `harness` isn't registered, an agent Step has no harness or
 * model, a prompt file doesn't exist, or an `on_fail` or `idle_timeout`
 * value is invalid.
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
	const steps: Step[] = [];
	for (const step of checked.data.steps) {
		if (steps.some(({ id }) => id === step.id)) {
			throw new Error(`${path}: two steps have id "${step.id}"`);
		}
		if (step.type === "shell") {
			steps.push(
				Object.freeze({ id: step.id, type: step.type, run: step.run }),
			);
			continue;
		}
		const harness = step.harness ?? checked.data.harness;
		const model = step.model ?? checked.data.model;
		if (harness === undefined || model === undefined) {
			throw new Error(
				`${path}: agent step "${step.id}" needs a harness and a model`,
			);
		}
		const promptPath = join(punt, step.prompt);
		const prompt = Bun.file(promptPath);
		if (!(await prompt.exists())) {
			throw new Error(
				`${path}: prompt file ${promptPath} of step "${step.id}" not found`,
			);
		}
		steps.push(
			Object.freeze({
				id: step.id,
				type: step.type,
				promptTemplate: await prompt.text(),
				harness,
				model,
				args: Object.freeze(step.args ?? checked.data.args ?? []),
			}),
		);
	}
	// Frozen, with the prompts' text inside, so a Goal runs every Ticket with
	// the Workflow it started with even if an agent edits `.punt/`.
	return Object.freeze({ steps: Object.freeze(steps) });
}

/** What an agent prompt's placeholders are filled with. */
export type PromptTexts = {
	/** `{{ticket}}`: the Ticket's title and body, never its header. */
	ticket: string;
	/** `{{goal}}`: the Goal's `goal.md`. */
	goal: string;
};

const placeholder = /\{\{(ticket|goal)\}\}/g;

/**
 * Returns the prompt `step`'s Harness reads, with each placeholder in its
 * template replaced by its text. A prompt gets only the texts its template
 * names, and text without placeholders is left as written.
 */
export function buildPrompt(step: AgentStep, texts: PromptTexts): string {
	// One pass, so a `{{goal}}` written inside the Ticket stays as written.
	return step.promptTemplate.replace(
		placeholder,
		(_, name: "ticket" | "goal") =>
			name === "ticket" ? texts.ticket : texts.goal,
	);
}
