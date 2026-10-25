// The cookbook's recipes: each links to the Workflows page, and each TOML block on it is a Workflow that
// `vago goal new` takes, in a Project `vago init` set up. A block whose first line is
// `# .vago/workflows/<name>.toml` is that whole file. One whose first line is
// `# In a copy of .vago/workflows/small.toml` changes the starter's small: a Step replaces the Step of its list with
// its id, or else goes at the end of that list, and a top-level key replaces small's.
import { afterAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtDocuments, servedAt } from "./built-site.ts";

const repo = join(import.meta.dir, "..", "..");

const recipes = builtDocuments()
	.map(({ path }) => path)
	.filter((path) => path.startsWith("/cookbook/") && path !== "/cookbook/")
	.map((path) => ({
		path,
		copy: servedAt(`${path.slice(0, -1)}.md`) ?? "",
	}));

const project = await mkdtemp(join(tmpdir(), "vago-cookbook-"));
afterAll(() => rm(project, { recursive: true, force: true }));

// What `vago` from this repo exits with and prints, run in the scratch Project.
function vago(args: string[], stdin = ""): { code: number; output: string } {
	const run = Bun.spawnSync(
		[process.execPath, join(repo, "src", "cli.ts"), ...args],
		{ cwd: project, stdin: Buffer.from(stdin) },
	);
	return {
		code: run.exitCode,
		output: `${run.stdout.toString()}${run.stderr.toString()}`,
	};
}

// A TOML value as TOML writes it. JSON's strings, numbers and booleans are TOML's too.
function tomlValue(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
	if (typeof value === "object" && value !== null)
		return `{ ${Object.entries(value)
			.map(([key, entry]) => `${JSON.stringify(key)} = ${tomlValue(entry)}`)
			.join(", ")} }`;
	return JSON.stringify(value);
}

type WorkflowToml = Record<string, unknown>;

const stepLists = ["before_all", "steps", "after_all"];

function workflowText(workflow: WorkflowToml): string {
	const top = Object.entries(workflow)
		.filter(([key]) => !stepLists.includes(key))
		.map(([key, value]) => `${key} = ${tomlValue(value)}`);
	const steps = stepLists.flatMap((list) =>
		((workflow[list] ?? []) as WorkflowToml[]).map((step) =>
			[
				`[[${list}]]`,
				...Object.entries(step).map(
					([key, value]) => `${key} = ${tomlValue(value)}`,
				),
			].join("\n"),
		),
	);
	return [...top, ...steps].join("\n\n");
}

function changedSmall(small: WorkflowToml, change: WorkflowToml): WorkflowToml {
	const changed = { ...small };
	for (const [key, value] of Object.entries(change)) {
		if (!stepLists.includes(key)) {
			changed[key] = value;
			continue;
		}
		const steps = [...((small[key] ?? []) as WorkflowToml[])];
		for (const step of value as WorkflowToml[]) {
			const at = steps.findIndex(({ id }) => id === step.id);
			if (at === -1) steps.push(step);
			else steps[at] = step;
		}
		changed[key] = steps;
	}
	return changed;
}

// The Workflow file a recipe's TOML block stands for, by its first line, or undefined when that line names
// neither a whole file nor a copy of small.
function recipeWorkflow(
	block: string,
	small: WorkflowToml,
): string | undefined {
	const file = block.split("\n")[0] ?? "";
	if (/^# \.vago\/workflows\/[\w-]+\.toml$/.test(file)) return block;
	if (file === "# In a copy of .vago/workflows/small.toml")
		return workflowText(
			changedSmall(small, Bun.TOML.parse(block) as WorkflowToml),
		);
	return undefined;
}

test("the cookbook has the seven recipes, each linking to the Workflows page", () => {
	expect(recipes.length).toBe(7);
	const unlinked = recipes
		.filter(({ copy }) => !copy.includes("](/docs/workflows/"))
		.map(({ path }) => path);
	expect(unlinked).toEqual([]);
});

test("every Workflow on a recipe is one vago goal new takes", async () => {
	Bun.spawnSync(["git", "init", "--quiet", "--initial-branch", "main"], {
		cwd: project,
	});
	expect(vago(["init"], "n\n").code).toBe(0);
	const smallPath = join(project, ".vago", "workflows", "small.toml");
	const small = Bun.TOML.parse(
		await Bun.file(smallPath).text(),
	) as WorkflowToml;
	const failures: string[] = [];
	let probe = 0;
	for (const { path, copy } of recipes) {
		const blocks = [...copy.matchAll(/```toml\n([\s\S]*?)```/g)].map(
			([, block = ""]) => block,
		);
		if (blocks.length === 0) failures.push(`${path}: no TOML block`);
		for (const block of blocks) {
			probe += 1;
			const name = `probe-${probe}`;
			const file = block.split("\n")[0] ?? "";
			const workflow = recipeWorkflow(block, small);
			if (workflow === undefined) {
				failures.push(`${path}: a TOML block starts with ${file}`);
				continue;
			}
			await Bun.write(
				join(project, ".vago", "workflows", `${name}.toml`),
				workflow,
			);
			// A prompt the recipe has you write is yours, so any prompt will do.
			for (const [, prompt = ""] of workflow.matchAll(
				/prompt\s*=\s*"([^"]+)"/g,
			)) {
				const promptPath = join(project, ".vago", prompt);
				if (!existsSync(promptPath)) {
					await Bun.write(promptPath, "Do the work.\n");
				}
			}
			const created = vago(["goal", "new", name, "--workflow", name]);
			if (created.code !== 0)
				failures.push(`${path}: ${file}\n${created.output}`);
		}
	}
	expect(failures).toEqual([]);
}, 60_000);
