// Owns `.punt/workflow.toml` and the prompt and include files it names:
// reads them once, checks them, returns the Workflow a Goal runs with, and
// builds agent prompts. Hides the TOML schema, its defaults, how paths
// resolve, how include slots merge and the `{{…}}` placeholder syntax.

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
	/**
	 * Appended to the Harness command. A Step's own `args` replace the
	 * Workflow's, and it's empty when neither sets any.
	 */
	readonly args: readonly string[];
	/**
	 * The include slots appended to the prompt, in order: the Workflow's
	 * `[include]`, with the Step's own `include.<name>` replacing a slot of
	 * the same name or added after them.
	 */
	readonly includes: readonly {
		readonly name: string;
		readonly text: string;
	}[];
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

const IdleTimeout = z.string().regex(/^[1-9]\d*(ms|s|m|h)$/, {
	error: 'idle_timeout must be a duration like "30m"',
});

// `{{ticket}}` or `{{goal}}` is group 1, and the id in
// `{{steps.<id>.output}}` is group 2.
const placeholder = /\{\{(ticket|goal)\}\}|\{\{steps\.([^{}]+?)\.output\}\}/g;

// Slot name to file path, in the order the human listed them.
const IncludeSlots = z.record(z.string(), z.string());

// TODO(07): give `on_fail` and `idle_timeout` their effect. Until then the
// loader only checks them.
const WorkflowFile = z.strictObject({
	harness: HarnessName.optional(),
	model: z.string().optional(),
	args: z.array(z.string()).optional(),
	idle_timeout: IdleTimeout.optional(),
	include: IncludeSlots.optional(),
	steps: z
		.array(
			z.discriminatedUnion(
				"type",
				[
					z.strictObject({
						id: z.string(),
						type: z.literal("shell"),
						run: z.string(),
						on_fail: z.enum(["stop", "continue"]).optional(),
					}),
					z.strictObject({
						id: z.string(),
						type: z.literal("agent"),
						prompt: z.string(),
						harness: HarnessName.optional(),
						model: z.string().optional(),
						args: z.array(z.string()).optional(),
						idle_timeout: IdleTimeout.optional(),
						include: IncludeSlots.optional(),
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
 * is missing or isn't valid TOML, has a key or value its schema doesn't take
 * (an unknown Step `type` or `harness`, a bad `on_fail` or `idle_timeout`),
 * gives two Steps one `id`, leaves an agent Step without a harness or model,
 * names a prompt or include file that doesn't exist, or has a prompt read
 * `{{steps.<id>.output}}` of a Step that doesn't run before it.
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
	const workflowIncludes = await readIncludes(
		root,
		path,
		checked.data.include ?? {},
		"the Workflow",
	);
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
		const promptTemplate = await prompt.text();
		for (const [written, , stepId] of promptTemplate.matchAll(placeholder)) {
			if (stepId !== undefined && !steps.some(({ id }) => id === stepId)) {
				throw new Error(
					`${path}: step "${step.id}" reads ${written}, but no step "${stepId}" runs before it`,
				);
			}
		}
		// Spread keeps a replaced slot where the Workflow listed it and adds new
		// slots after, which is the order they reach the prompt in.
		const includes = Object.entries({
			...workflowIncludes,
			...(await readIncludes(
				root,
				path,
				step.include ?? {},
				`step "${step.id}"`,
			)),
		}).map(([name, text]) => Object.freeze({ name, text }));
		steps.push(
			Object.freeze({
				id: step.id,
				type: step.type,
				promptTemplate,
				harness,
				model,
				args: Object.freeze(step.args ?? checked.data.args ?? []),
				includes: Object.freeze(includes),
			}),
		);
	}
	// Frozen, with the prompts' text inside, so a Goal runs every Ticket with
	// the Workflow it started with even if an agent edits `.punt/`.
	return Object.freeze({ steps: Object.freeze(steps) });
}

// Returns each slot's name and its file's text, in the order `slots` lists
// them. `owner` is who sets the slots, for the message when a file is missing.
async function readIncludes(
	root: string,
	workflowPath: string,
	slots: Record<string, string>,
	owner: string,
): Promise<Record<string, string>> {
	const texts: Record<string, string> = {};
	for (const [name, slotPath] of Object.entries(slots)) {
		const file = Bun.file(join(root, slotPath));
		if (!(await file.exists())) {
			throw new Error(
				`${workflowPath}: include.${name} file ${file.name} of ${owner} not found`,
			);
		}
		texts[name] = await file.text();
	}
	return texts;
}

/** What an agent prompt's placeholders are filled with. */
export type PromptTexts = {
	/** `{{ticket}}`: the Ticket's title and body, never its header. */
	ticket: string;
	/** `{{goal}}`: the Goal's `goal.md`. */
	goal: string;
	/**
	 * `{{steps.<id>.output}}`: by Step id, the output of each Step already run
	 * on this Ticket in this pass.
	 */
	stepOutputs: ReadonlyMap<string, string>;
};

/**
 * Returns the prompt `step`'s Harness reads: its template with each
 * placeholder replaced by its text, then each include slot's text under a
 * heading with the slot's name. A prompt gets only the texts its template
 * names. Text without placeholders, and a `{{steps.<id>.output}}` whose Step
 * isn't in `stepOutputs`, are left as written.
 */
export function buildPrompt(step: AgentStep, texts: PromptTexts): string {
	// One pass, so a `{{goal}}` written inside the Ticket stays as written.
	let prompt = step.promptTemplate.replace(
		placeholder,
		(written, name: "ticket" | "goal" | undefined, stepId: string) => {
			if (name === "ticket") return texts.ticket;
			if (name === "goal") return texts.goal;
			return texts.stepOutputs.get(stepId) ?? written;
		},
	);
	// Includes go in after substitution, so a doc that mentions `{{ticket}}`
	// reaches the agent as written.
	for (const { name, text } of step.includes) {
		prompt = `${prompt.trimEnd()}\n\n# ${name}\n\n${text}`;
	}
	return prompt;
}
