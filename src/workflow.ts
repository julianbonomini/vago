// Owns `.vago/workflows/<name>.toml` and the prompt and include files each
// names: which Workflows exist, reading one once, checking it, returning the
// Workflow a Goal runs with, and building agent prompts. Hides the TOML
// schema, its defaults, how paths resolve, how include slots merge and the
// `{{…}}` placeholder syntax.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { knownHarness } from "./harness/registry.ts";

/** A Step that runs `run` with `sh -c` in the repo root. */
export type ShellStep = {
	readonly id: string;
	readonly type: "shell";
	readonly run: string;
	/**
	 * Whether the Ticket goes on to its next Step when `run` exits non-zero.
	 * `stop` unless the Workflow says otherwise.
	 */
	readonly onFail: "stop" | "continue";
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
	 * How long the Harness may stream nothing before the Run is killed: the
	 * Step's `idle_timeout`, else the Workflow's, else 30 minutes.
	 */
	readonly idleTimeoutMs: number;
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

const millisecondsPer = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

// The amount is group 1 and the unit group 2.
const duration = /^([1-9]\d*)(ms|s|m|h)$/;

const IdleTimeout = z
	.string()
	.regex(duration, { error: 'idle_timeout must be a duration like "30m"' })
	.transform((written) => {
		const [, amount, unit] = duration.exec(written) ?? [];
		return Number(amount) * millisecondsPer[unit as "ms" | "s" | "m" | "h"];
	});

const defaultIdleTimeoutMs = 30 * millisecondsPer.m;

// `{{ticket}}` or `{{goal}}` is group 1, and the id in
// `{{steps.<id>.output}}` is group 2.
const placeholder = /\{\{(ticket|goal)\}\}|\{\{steps\.([^{}]+?)\.output\}\}/g;

// Slot name to file path, in the order the human listed them, except that
// slot names that are integers come first, as in any JavaScript object.
const IncludeSlots = z.record(z.string(), z.string());

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
 * Reads `.vago/workflows/<name>.toml` of the Project at `root`, with every
 * prompt's text inside. Throws an Error listing the Workflows in
 * `.vago/workflows/` when none is called `name`. Throws an Error naming the
 * file and the problem when the Workflow isn't valid TOML, has a key or
 * value its schema doesn't take (an unknown Step `type` or `harness`, a bad
 * `on_fail` or `idle_timeout`), gives two Steps one `id`, leaves an agent
 * Step without a harness or model, names a prompt or include file that
 * doesn't exist, or has a prompt read `{{steps.<id>.output}}` of a Step that
 * doesn't run before it.
 */
export async function loadWorkflow(
	root: string,
	name: string,
): Promise<Workflow> {
	const vago = join(root, ".vago");
	const folder = join(vago, "workflows");
	// node:fs because Bun.file can't tell whether a directory exists.
	const names = existsSync(folder)
		? (await readdir(folder))
				.filter((fileName) => fileName.endsWith(".toml"))
				.map((fileName) => fileName.slice(0, -".toml".length))
				.sort()
		: [];
	// Looked up before any path is built, so a name like `../x` never reaches
	// the filesystem.
	if (!names.includes(name)) {
		const held = names.length > 0 ? names.join(", ") : "no Workflows";
		throw new Error(`No Workflow "${name}" in ${folder}/: it holds ${held}`);
	}
	const path = join(folder, `${name}.toml`);
	const file = Bun.file(path);
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
				Object.freeze({
					id: step.id,
					type: step.type,
					run: step.run,
					onFail: step.on_fail ?? "stop",
				}),
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
		const promptPath = join(vago, step.prompt);
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
				idleTimeoutMs:
					step.idle_timeout ??
					checked.data.idle_timeout ??
					defaultIdleTimeoutMs,
				includes: Object.freeze(includes),
			}),
		);
	}
	// Frozen, with the prompts' text inside, so a Goal runs every Ticket with
	// the Workflow it started with even if an agent edits `.vago/`.
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
	/** `{{goal}}`: the Goal's `goal.md` without its header. */
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
		(
			written,
			name: "ticket" | "goal" | undefined,
			stepId: string | undefined,
		) => {
			if (stepId === undefined) {
				return name === "ticket" ? texts.ticket : texts.goal;
			}
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
