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

/**
 * The name of the folder, directly at a Project's root, that holds the
 * Project's Workflows with the prompts and scripts they run. Other modules
 * may name the folder, to copy it or keep it out of git, but never build a
 * path inside it: only this module and `init.ts`, which writes the starter
 * there, do.
 */
export const vagoFolderName = ".vago";

/** A Step that runs `run` with `sh -c` in the Goal's worktree. */
export type ShellStep = {
	readonly id: string;
	/** What the TUI and the run output call the Step: its `name`, else its `id`. */
	readonly name: string;
	readonly type: "shell";
	readonly run: string;
	/**
	 * Whether the pass goes on to its next Step when `run` exits non-zero.
	 * `stop` unless the Workflow says otherwise.
	 */
	readonly onFail: "stop" | "continue";
	readonly when: StepWhen;
};

/**
 * A Step that a fresh Harness session performs. `harness`, `model` and
 * `args` are already resolved: the Step's own value, else the Workflow's.
 */
export type AgentStep = {
	readonly id: string;
	/** What the TUI and the run output call the Step: its `name`, else its `id`. */
	readonly name: string;
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
	readonly when: StepWhen;
	/**
	 * Whether the Goal report carries the Step's output, its session's final
	 * answer, under the Ticket. False unless the Workflow says `goal_report`.
	 */
	readonly inGoalReport: boolean;
};

/** One entry of a Workflow. */
export type Step = ShellStep | AgentStep;

/**
 * Which of a Goal's Tickets a Step runs on: `every-ticket` unless the
 * Workflow says `last-ticket`, the Ticket that ends with every other Ticket
 * of the Goal `done`. A Goal Step runs once whatever its `when` says.
 */
export type StepWhen = "every-ticket" | "last-ticket";

/** The Workflow lists that run once for the whole Goal, named as in the TOML. */
export type GoalStepGroup = "before_all" | "after_all";

// Each list of a Workflow, named as in the TOML.
type StepGroup = GoalStepGroup | "steps";

/** A Project's Workflow, frozen: nothing changes it once it's loaded. */
export type Workflow = {
	/** Goal Steps run once before the Goal's first Ticket. Empty when the Workflow lists none. */
	readonly beforeAll: readonly Step[];
	/** Each Ticket's Steps, in order. */
	readonly steps: readonly Step[];
	/** Goal Steps run once no Tickets are left. Empty when the Workflow lists none. */
	readonly afterAll: readonly Step[];
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

// A placeholder's name, like `ticket`, is group 1, and the id in
// `{{steps.<id>.output}}` is group 2.
const placeholder =
	/\{\{(ticket|goal|goal_name)\}\}|\{\{steps\.([^{}]+?)\.output\}\}/g;

// Slot name to file path, in the order the human listed them, except that
// slot names that are integers come first, as in any JavaScript object.
const IncludeSlots = z.record(z.string(), z.string());

const When = z.literal("last-ticket");

const StepEntry = z.discriminatedUnion(
	"type",
	[
		z.strictObject({
			id: z.string(),
			name: z.string().optional(),
			type: z.literal("shell"),
			run: z.string(),
			on_fail: z.enum(["stop", "continue"]).optional(),
			when: When.optional(),
		}),
		z.strictObject({
			id: z.string(),
			name: z.string().optional(),
			type: z.literal("agent"),
			prompt: z.string(),
			harness: HarnessName.optional(),
			model: z.string().optional(),
			args: z.array(z.string()).optional(),
			idle_timeout: IdleTimeout.optional(),
			include: IncludeSlots.optional(),
			when: When.optional(),
			goal_report: z.boolean().optional(),
		}),
	],
	{ error: 'type must be "agent" or "shell"' },
);

const WorkflowFile = z.strictObject({
	harness: HarnessName.optional(),
	model: z.string().optional(),
	args: z.array(z.string()).optional(),
	idle_timeout: IdleTimeout.optional(),
	include: IncludeSlots.optional(),
	before_all: z.array(StepEntry).optional(),
	steps: z.array(StepEntry).min(1),
	after_all: z.array(StepEntry).optional(),
});

/**
 * Reads `.vago/workflows/<name>.toml` of the Project at `root`, with every
 * prompt's text inside. Throws an Error listing the Workflows in
 * `.vago/workflows/` when none is called `name`. Throws an Error naming the
 * file and the problem when the Workflow isn't valid TOML, has a key or
 * value its schema doesn't take (an unknown Step `type` or `harness`, a bad
 * `on_fail`, `when` or `idle_timeout`), gives two Steps one `id`, leaves an
 * agent Step without a harness or model, names a prompt or include file that
 * doesn't exist, or has a prompt read `{{steps.<id>.output}}` of a Step that
 * doesn't run before it in its own list, naming the other list when the Step
 * is in one: outputs never cross from `[[before_all]]`, `[[steps]]` or
 * `[[after_all]]` to another. Step ids are unique across all three lists,
 * and a Goal Step's prompt can't read `{{ticket}}`.
 */
export async function loadWorkflow(
	root: string,
	name: string,
): Promise<Workflow> {
	const { path, checked } = await readWorkflowFile(root, name);
	const vago = join(root, vagoFolderName);
	const workflowIncludes = await readIncludes(
		root,
		path,
		checked.include ?? {},
		"the Workflow",
	);
	const beforeAll = checked.before_all ?? [];
	const afterAll = checked.after_all ?? [];
	const lists: [StepGroup, z.infer<typeof StepEntry>[]][] = [
		["before_all", beforeAll],
		["steps", checked.steps],
		["after_all", afterAll],
	];
	// Gathered before any list is built, so a Step reading the output of a
	// Step in another list is told where that Step is. Unique across lists,
	// since a Run in `goal.md` names only its Step.
	const groupOf = new Map<string, StepGroup>();
	for (const [group, entries] of lists) {
		for (const { id } of entries) {
			if (groupOf.has(id)) {
				throw new Error(`${path}: two steps have id "${id}"`);
			}
			groupOf.set(id, group);
		}
	}
	// Builds the Steps of `entries`, the Workflow's list `group`.
	const buildSteps = async (
		entries: z.infer<typeof StepEntry>[],
		group: StepGroup,
	): Promise<readonly Step[]> => {
		const steps: Step[] = [];
		for (const step of entries) {
			const when = step.when ?? "every-ticket";
			const name = stepName(step);
			if (step.type === "shell") {
				steps.push(
					Object.freeze({
						id: step.id,
						name,
						type: step.type,
						run: step.run,
						onFail: step.on_fail ?? "stop",
						when,
					}),
				);
				continue;
			}
			const harness = step.harness ?? checked.harness;
			const model = step.model ?? checked.model;
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
			for (const [written, placeholderName, stepId] of promptTemplate.matchAll(
				placeholder,
			)) {
				if (placeholderName === "ticket" && group !== "steps") {
					throw new Error(
						`${path}: ${stepLabel(group, step.id)} reads ${written}, but a Goal Step runs on no Ticket`,
					);
				}
				if (stepId === undefined || steps.some(({ id }) => id === stepId)) {
					continue;
				}
				const otherGroup = groupOf.get(stepId);
				if (otherGroup !== undefined && otherGroup !== group) {
					throw new Error(
						`${path}: ${stepLabel(group, step.id)} reads ${written}, but "${stepId}" is in [[${otherGroup}]], and a Step reads only the outputs of Steps in its own group`,
					);
				}
				throw new Error(
					`${path}: ${stepLabel(group, step.id)} reads ${written}, but no step "${stepId}" runs before it`,
				);
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
					name,
					type: step.type,
					promptTemplate,
					harness,
					model,
					args: Object.freeze(step.args ?? checked.args ?? []),
					idleTimeoutMs:
						step.idle_timeout ?? checked.idle_timeout ?? defaultIdleTimeoutMs,
					includes: Object.freeze(includes),
					when,
					inGoalReport: step.goal_report ?? false,
				}),
			);
		}
		return Object.freeze(steps);
	};
	// Frozen, with the prompts' text inside, so a Goal runs every Ticket with
	// the Workflow it started with even if an agent edits `.vago/`.
	return Object.freeze({
		beforeAll: await buildSteps(beforeAll, "before_all"),
		steps: await buildSteps(checked.steps, "steps"),
		afterAll: await buildSteps(afterAll, "after_all"),
	});
}

/**
 * A Step as the TUI shows it: its `id`, the `name` it goes by, its `id`
 * without one, and whether a pass goes on from it when it exits non-zero,
 * which only a shell Step can.
 */
export type NamedStep = {
	id: string;
	name: string;
	onFail: "stop" | "continue";
};

/** A Workflow's three lists of Steps as the TUI shows them, in the order they run. */
export type NamedWorkflow = {
	beforeAll: NamedStep[];
	steps: NamedStep[];
	afterAll: NamedStep[];
};

/**
 * Each Step of Workflow `name` of the Project at `root`, read from its TOML
 * alone, so it costs one small file read and no prompt or include file is
 * opened or checked. Throws what `loadWorkflow` throws for a missing
 * Workflow, bad TOML or a schema it doesn't take.
 */
export async function readWorkflowStepNames(
	root: string,
	name: string,
): Promise<NamedWorkflow> {
	const { checked } = await readWorkflowFile(root, name);
	const named = (steps: z.infer<typeof StepEntry>[] = []) =>
		steps.map(
			(step): NamedStep => ({
				id: step.id,
				name: stepName(step),
				onFail: step.type === "shell" ? (step.on_fail ?? "stop") : "stop",
			}),
		);
	return {
		beforeAll: named(checked.before_all),
		steps: named(checked.steps),
		afterAll: named(checked.after_all),
	};
}

// How a message names Step `id` of list `group`: a `[[steps]]` Step plainly,
// a Goal Step with its group, like `before_all step "setup"`.
function stepLabel(group: StepGroup, id: string): string {
	return group === "steps" ? `step "${id}"` : `${group} step "${id}"`;
}

// A Step without a `name` goes by its `id`.
function stepName(step: { id: string; name?: string | undefined }): string {
	return step.name ?? step.id;
}

// The path of Workflow `name`'s TOML and its content checked against the
// schema, with what `loadWorkflow` throws for a missing Workflow, bad TOML or
// a schema it doesn't take.
async function readWorkflowFile(
	root: string,
	name: string,
): Promise<{ path: string; checked: z.infer<typeof WorkflowFile> }> {
	const folder = join(root, vagoFolderName, "workflows");
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
	return { path, checked: checked.data };
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
	/** `{{goal_name}}`: the Goal's name, like `hello`. */
	goalName: string;
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
			name: "ticket" | "goal" | "goal_name" | undefined,
			stepId: string | undefined,
		) => {
			if (stepId !== undefined) {
				return texts.stepOutputs.get(stepId) ?? written;
			}
			if (name === "ticket") return texts.ticket;
			if (name === "goal") return texts.goal;
			return texts.goalName;
		},
	);
	// Includes go in after substitution, so a doc that mentions `{{ticket}}`
	// reaches the agent as written.
	for (const { name, text } of step.includes) {
		prompt = `${prompt.trimEnd()}\n\n# ${name}\n\n${text}`;
	}
	return prompt;
}
