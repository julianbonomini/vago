import { expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { makeFakeClaude } from "./fake-harness.ts";
import {
	goalText,
	goalWorktree,
	makeProject,
	oneStep,
	readTicketFile,
	runsOf,
	runVago,
	ticketText,
} from "./project.ts";

const goalDir = ".vago-goals/hello";

// A Workflow with one Step in each list, every one a shell Step that prints
// its name.
const withGoalSteps = `
[[before_all]]
id   = "setup"
type = "shell"
run  = "echo set up"

[[steps]]
id   = "work"
type = "shell"
run  = "echo working"

[[after_all]]
id   = "wrap"
type = "shell"
run  = "echo wrapped"
`;

test("a Workflow with before_all and after_all loads, and its Goal's Ticket runs", async () => {
	const root = await makeProject({ ".vago/workflows/w.toml": withGoalSteps });

	const created = await runVago(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"w",
	]);
	expect(created.stderr).toBe("");
	expect(created.exitCode).toBe(0);
	await runVago(root, ["ticket", "add", "hello", "greet"]);
	const result = await runVago(root, ["run", "hello"]);

	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	const { header } = await readTicketFile(
		root,
		`${goalDir}/tickets/01-greet.md`,
	);
	expect(header.status).toBe("done");
});

// Two agent Steps, `setup` in `[[before_all]]` and `implement` in
// `[[steps]]`, with prompts `setup.md` and `implement.md`, and a shell Step
// `wrap` in `[[after_all]]`.
const agentStepsInEachGroup = `
harness = "claude-code"
model   = "opus"

[[before_all]]
id     = "setup"
type   = "agent"
prompt = "prompts/setup.md"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"

[[after_all]]
id     = "report"
type   = "agent"
prompt = "prompts/report.md"
`;

// Runs `vago goal new hello --workflow w` in a Project whose Workflow is
// `workflow` with `prompts` in `.vago/prompts/`, and checks that it's
// refused, naming the Workflow file, with no Goal written. Returns stderr.
async function refusedGoal(
	workflow: string,
	prompts: Record<string, string>,
): Promise<string> {
	const root = await makeProject({
		".vago/workflows/w.toml": workflow,
		...Object.fromEntries(
			Object.entries(prompts).map(([name, text]) => [
				`.vago/prompts/${name}`,
				text,
			]),
		),
	});
	const result = await runVago(root, [
		"goal",
		"new",
		"hello",
		"--workflow",
		"w",
	]);
	expect(result.exitCode).not.toBe(0);
	expect(result.stderr).toContain(join(root, ".vago/workflows/w.toml"));
	expect(await Bun.file(join(root, goalDir, "goal.md")).exists()).toBe(false);
	return result.stderr;
}

test("a Step reading the output of a Step in another group is refused, naming both", async () => {
	const prompts = {
		"setup.md": "Set up.\n",
		"implement.md": "Implement it.\n",
		"report.md": "Report.\n",
	};

	expect(
		await refusedGoal(agentStepsInEachGroup, {
			...prompts,
			"setup.md": "Set up after {{steps.implement.output}}.\n",
		}),
	).toContain(
		'before_all step "setup" reads {{steps.implement.output}}, but "implement" is in [[steps]], and a Step reads only the outputs of Steps in its own group',
	);
	expect(
		await refusedGoal(agentStepsInEachGroup, {
			...prompts,
			"implement.md": "Implement after {{steps.setup.output}}.\n",
		}),
	).toContain(
		'step "implement" reads {{steps.setup.output}}, but "setup" is in [[before_all]], and a Step reads only the outputs of Steps in its own group',
	);
	expect(
		await refusedGoal(agentStepsInEachGroup, {
			...prompts,
			"report.md": "Report on {{steps.setup.output}}.\n",
		}),
	).toContain(
		'after_all step "report" reads {{steps.setup.output}}, but "setup" is in [[before_all]], and a Step reads only the outputs of Steps in its own group',
	);
});

test("two Steps sharing an id across groups, and {{ticket}} in a Goal Step's prompt, are refused", async () => {
	const prompts = {
		"setup.md": "Set up.\n",
		"implement.md": "Implement it.\n",
		"report.md": "Report.\n",
	};

	expect(
		await refusedGoal(
			agentStepsInEachGroup.replace('id     = "report"', 'id     = "setup"'),
			prompts,
		),
	).toContain('two steps have id "setup"');
	expect(
		await refusedGoal(agentStepsInEachGroup, {
			...prompts,
			"setup.md": "Set up for {{ticket}}.\n",
		}),
	).toContain(
		'before_all step "setup" reads {{ticket}}, but a Goal Step runs on no Ticket',
	);
});

// Two shell `before_all` Steps, `setup` and `prepare`, before one shell
// Ticket Step, `work`.
const twoBeforeAll = `
[[before_all]]
id   = "setup"
type = "shell"
run  = "echo set up"

[[before_all]]
id   = "prepare"
type = "shell"
run  = "echo prepared"

[[steps]]
id   = "work"
type = "shell"
run  = "echo working"
`;

function goalRuns(root: string): Promise<Record<string, unknown>[]> {
	return readTicketFile(root, `${goalDir}/goal.md`).then(({ header }) =>
		runsOf(header),
	);
}

test("before_all runs once, before the first Ticket, and not on a later vago run", async () => {
	const root = await makeProject({
		".vago/workflows/w.toml": twoBeforeAll,
		[`${goalDir}/goal.md`]: goalText("w"),
		[`${goalDir}/tickets/01-greet.md`]: ticketText("ready"),
	});

	const first = await runVago(root, ["run", "hello"]);

	expect(first.stderr).toBe("");
	expect(first.exitCode).toBe(0);
	const lines = first.stdout.split("\n");
	const heading = lines.indexOf("before_all");
	const setup = lines.findIndex((line) => / setup ok$/.test(line));
	const prepare = lines.findIndex((line) => / prepare ok$/.test(line));
	const ticket = lines.indexOf("01-greet");
	expect(heading).toBeGreaterThan(-1);
	expect([heading, setup, prepare, ticket]).toEqual(
		[heading, setup, prepare, ticket].toSorted((a, b) => a - b),
	);
	expect(setup).toBeGreaterThan(heading);
	const runs = await goalRuns(root);
	expect(runs.map(({ step, outcome, log }) => [step, outcome, log])).toEqual([
		["setup", "ok", "logs/before_all-setup-1.log"],
		["prepare", "ok", "logs/before_all-prepare-2.log"],
	]);

	await runVago(root, ["ticket", "add", "hello", "again"]);
	const second = await runVago(root, ["run", "hello"]);

	expect(second.exitCode).toBe(0);
	expect(second.stdout).not.toContain("before_all");
	expect(second.stdout).toContain("02-again");
	expect(await goalRuns(root)).toHaveLength(2);
});

test("a Goal with no Ticket to take runs no before_all", async () => {
	const noTickets = await makeProject({
		".vago/workflows/w.toml": twoBeforeAll,
		[`${goalDir}/goal.md`]: goalText("w"),
	});
	const allDone = await makeProject({
		".vago/workflows/w.toml": twoBeforeAll,
		[`${goalDir}/goal.md`]: goalText("w"),
		[`${goalDir}/tickets/01-greet.md`]: ticketText("done"),
	});

	for (const root of [noTickets, allDone]) {
		const result = await runVago(root, ["run", "hello"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).not.toContain("before_all");
		expect((await readTicketFile(root, `${goalDir}/goal.md`)).header.runs).toBe(
			undefined,
		);
	}
});

test("Goal Step Runs are recorded in goal.md, whose body and other fields stay as written", async () => {
	const goalBody = "\n# Hello\n\nSay hello.\n";
	const root = await makeProject({
		".vago/workflows/w.toml": `
harness = "claude-code"
model   = "opus"

[[before_all]]
id   = "setup"
type = "shell"
run  = "echo set up"

[[before_all]]
id     = "plan"
type   = "agent"
prompt = "prompts/plan.md"

[[steps]]
id   = "work"
type = "shell"
run  = "echo working"
`,
		".vago/prompts/plan.md": "Plan {{goal_name}}:\n{{goal}}",
		[`${goalDir}/goal.md`]: `+++\nworkflow = "w"\nowner = "someone"\n+++\n${goalBody}`,
		[`${goalDir}/tickets/01-greet.md`]: ticketText("ready"),
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(0);
	const { header, body } = await readTicketFile(root, `${goalDir}/goal.md`);
	expect(body).toBe(goalBody);
	expect(header.owner).toBe("someone");
	const [setup, plan] = runsOf(header);
	expect(setup).toEqual({
		step: "setup",
		started: expect.any(Date),
		ended: expect.any(Date),
		outcome: "ok",
		log: "logs/before_all-setup-1.log",
	});
	expect(
		await Bun.file(join(root, goalDir, "logs/before_all-setup-1.log")).text(),
	).toBe("set up\n");
	expect(plan).toMatchObject({
		step: "plan",
		outcome: "ok",
		harness: "claude-code",
		model: "opus",
		session_id: expect.any(String),
		tokens: { input: expect.any(Number), output: expect.any(Number) },
		cost_usd: expect.any(Number),
		log: "logs/before_all-plan-2.jsonl",
	});
	const [call] = await claude.calls();
	expect(call?.stdin).toBe("Plan hello:\n# Hello\n\nSay hello.\n");
});

test("a failed before_all Step leaves the Goal stuck with no Ticket run, and the next vago run picks it up at that Step", async () => {
	const root = await makeProject({
		".vago/workflows/w.toml": `
[[before_all]]
id   = "setup"
type = "shell"
run  = "echo set up"

[[before_all]]
id   = "check"
name = "Check"
type = "shell"
run  = 'test -f "$VAGO_PROJECT_ROOT/fixed"'

[[steps]]
id   = "work"
type = "shell"
run  = "echo working"
`,
		[`${goalDir}/goal.md`]: goalText("w"),
		[`${goalDir}/tickets/01-greet.md`]: ticketText("ready"),
		[`${goalDir}/tickets/02-again.md`]: ticketText("ready"),
	});

	const stuck = await runVago(root, ["run", "hello"]);

	expect(stuck.exitCode).not.toBe(0);
	expect(stuck.stdout).toContain(
		"hello is stuck after Check: exit 1\n  log:    .vago-goals/hello/logs/before_all-check-2.log\n  again:  vago run hello\n",
	);
	expect(stuck.stdout).not.toContain("reset:");
	for (const name of ["01-greet", "02-again"]) {
		const { header } = await readTicketFile(
			root,
			`${goalDir}/tickets/${name}.md`,
		);
		expect(header.status).toBe("ready");
		expect(header.runs).toBeUndefined();
	}

	await Bun.write(join(root, "fixed"), "");
	const picked = await runVago(root, ["run", "hello"]);

	expect(picked.exitCode).toBe(0);
	expect(picked.stdout).toContain("before_all, picked up at Check\n");
	expect(
		(await goalRuns(root)).map(({ step, outcome }) => [step, outcome]),
	).toEqual([
		["setup", "ok"],
		["check", "exit 1"],
		["check", "ok"],
	]);
	for (const name of ["01-greet", "02-again"]) {
		const { header } = await readTicketFile(
			root,
			`${goalDir}/tickets/${name}.md`,
		);
		expect(header.status).toBe("done");
	}
});

// One agent `before_all` Step, `plan`, before one shell Ticket Step.
const agentBeforeAll = `
harness = "claude-code"
model   = "opus"

[[before_all]]
id     = "plan"
type   = "agent"
prompt = "prompts/plan.md"

[[steps]]
id   = "work"
type = "shell"
run  = "echo working"
`;

test("a failed before_all agent Step is retried three times, resuming its session, and the next vago run resumes it again", async () => {
	const root = await makeProject({
		".vago/workflows/w.toml": agentBeforeAll,
		".vago/prompts/plan.md": "Plan it.\n",
		[`${goalDir}/goal.md`]: goalText("w"),
		[`${goalDir}/tickets/01-greet.md`]: ticketText("ready"),
	});
	const claude = await makeFakeClaude("exit 1");

	const first = await runVago(root, ["run", "hello"], claude.env);

	expect(first.exitCode).not.toBe(0);
	expect(
		(await goalRuns(root)).map(({ outcome, resume }) => [outcome, resume]),
	).toEqual([
		["exit 1", undefined],
		["exit 1", "resumed"],
		["exit 1", "resumed"],
		["exit 1", "resumed"],
	]);

	await runVago(root, ["run", "hello"], claude.env);

	const runs = await goalRuns(root);
	expect(runs).toHaveLength(8);
	expect(runs.slice(4).map(({ resume }) => resume)).toEqual(
		Array(4).fill("resumed"),
	);
	const calls = await claude.calls();
	expect(calls[4]?.argv.slice(0, 2)).toEqual(["-p", "--resume"]);
	const { header } = await readTicketFile(
		root,
		`${goalDir}/tickets/01-greet.md`,
	);
	expect(header.status).toBe("ready");
});

// A shell `before_all` Step, `setup`, then an agent one, `plan`, whose prompt
// reads `setup`'s output, before one shell Ticket Step.
const setupThenPlan = `
harness = "claude-code"
model   = "opus"

[[before_all]]
id   = "setup"
type = "shell"
run  = "echo set up"

[[before_all]]
id     = "plan"
type   = "agent"
prompt = "prompts/plan.md"

[[steps]]
id   = "work"
type = "shell"
run  = "echo working"
`;

// A `goal.md` naming Workflow `w` whose header ends with `runs`, TOML
// `[[runs]]` tables.
function goalWithRuns(runs: string): string {
	return `+++\nworkflow = "w"\n${runs}+++\n# Hello\n`;
}

// `setup`'s Run, ended `ok`, and a `plan` Run with no session: open when
// `planOutcome` is undefined.
function setupAndPlanRuns(planOutcome?: string): string {
	const planEnd =
		planOutcome === undefined
			? ""
			: `ended = 2026-10-01T09:03:00Z\noutcome = "${planOutcome}"\n`;
	return `
[[runs]]
step = "setup"
started = 2026-10-01T09:00:00Z
ended = 2026-10-01T09:01:00Z
outcome = "ok"
log = "logs/before_all-setup-1.log"

[[runs]]
step = "plan"
harness = "claude-code"
model = "opus"
started = 2026-10-01T09:02:00Z
${planEnd}log = "logs/before_all-plan-2.jsonl"
`;
}

test("a before_all Run a dead vago run left open is closed lost, and the pass is picked up at its Step", async () => {
	const root = await makeProject({
		".vago/workflows/w.toml": setupThenPlan,
		".vago/prompts/plan.md": "Plan it.\n",
		[`${goalDir}/goal.md`]: goalWithRuns(setupAndPlanRuns()),
		[`${goalDir}/logs/before_all-setup-1.log`]: "set up\n",
		[`${goalDir}/tickets/01-greet.md`]: ticketText("ready"),
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).toContain("before_all, picked up at plan\n");
	expect(
		(await goalRuns(root)).map(({ step, outcome }) => [step, outcome]),
	).toEqual([
		["setup", "ok"],
		["plan", "lost"],
		["plan", "ok"],
	]);
	expect(await claude.calls()).toHaveLength(1);
});

test("a picked-up before_all Step's prompt gets the earlier before_all Step's output, rebuilt from its log", async () => {
	const root = await makeProject({
		".vago/workflows/w.toml": setupThenPlan,
		".vago/prompts/plan.md": "Plan after {{steps.setup.output}}",
		[`${goalDir}/goal.md`]: goalWithRuns(setupAndPlanRuns("interrupted")),
		[`${goalDir}/logs/before_all-setup-1.log`]: "set up\n",
		[`${goalDir}/tickets/01-greet.md`]: ticketText("ready"),
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).toBe(0);
	const calls = await claude.calls();
	expect(calls.map(({ stdin }) => stdin)).toEqual([
		"Plan after exit code 0\nset up\n",
	]);
});

test("a shell Goal Step runs in the Goal's worktree on vago/<goal>, with VAGO_GOAL and VAGO_PROJECT_ROOT and no VAGO_TICKET", async () => {
	const root = await makeProject({
		".vago/workflows/w.toml": `
[[before_all]]
id   = "env"
type = "shell"
run  = '''
echo "$VAGO_GOAL"
echo "\${VAGO_TICKET-unset}"
echo "\${VAGO_LAST_TICKET-unset}"
echo "$VAGO_PROJECT_ROOT"
pwd -P
git branch --show-current
'''

[[steps]]
id   = "work"
type = "shell"
run  = "echo working"
`,
		[`${goalDir}/goal.md`]: goalText("w"),
		[`${goalDir}/tickets/01-greet.md`]: ticketText("ready"),
	});

	const result = await runVago(root, ["run", "hello"], {
		VAGO_TICKET: "x",
		VAGO_LAST_TICKET: "true",
	});

	expect(result.exitCode).toBe(0);
	const log = await Bun.file(
		join(root, goalDir, "logs/before_all-env-1.log"),
	).text();
	expect(log.split("\n")).toEqual([
		"hello",
		"unset",
		"unset",
		await realpath(root),
		await goalWorktree(root, "hello"),
		"vago/hello",
		"",
	]);
});

test("vago ticket add --workflow refuses a Workflow with Goal Steps, unless it's the Goal's own", async () => {
	const root = await makeProject({
		".vago/workflows/w.toml": twoBeforeAll,
		".vago/workflows/plain.toml": `
[[steps]]
id   = "work"
type = "shell"
run  = "echo working"
`,
		[`${goalDir}/goal.md`]: goalText("plain"),
	});

	const refused = await runVago(root, [
		"ticket",
		"add",
		"hello",
		"x",
		"--workflow",
		"w",
	]);

	expect(refused.exitCode).not.toBe(0);
	expect(refused.stderr).toContain(
		"Workflow \"w\" has Goal Steps (before_all or after_all), which run only from the Goal's Workflow, so a Ticket can't go through it",
	);
	expect(await Bun.file(join(root, goalDir, "tickets/01-x.md")).exists()).toBe(
		false,
	);

	await Bun.write(join(root, goalDir, "goal.md"), goalText("w"));
	const own = await runVago(root, [
		"ticket",
		"add",
		"hello",
		"x",
		"--workflow",
		"w",
	]);

	expect(own.stderr).toBe("");
	expect(own.exitCode).toBe(0);
});

test("a Workflow without Goal Steps runs as before, leaving goal.md byte for byte", async () => {
	const goalFile = `+++\nworkflow = "w"\nowner = "someone"\n+++\n\n# Hello\n`;
	const root = await makeProject({
		".vago/workflows/w.toml": oneStep("echo working"),
		[`${goalDir}/goal.md`]: goalFile,
		[`${goalDir}/tickets/01-greet.md`]: ticketText("ready"),
	});

	const result = await runVago(root, ["run", "hello"]);

	expect(result.exitCode).toBe(0);
	expect(result.stdout).not.toContain("before_all");
	expect(await Bun.file(join(root, goalDir, "goal.md")).text()).toBe(goalFile);
});

test("a before_all shell Step with on_fail = continue that exits 1 lets the Tickets run, and counts as succeeded", async () => {
	const root = await makeProject({
		".vago/workflows/w.toml": `
[[before_all]]
id      = "setup"
type    = "shell"
run     = "exit 1"
on_fail = "continue"

[[steps]]
id   = "work"
type = "shell"
run  = "echo working"
`,
		[`${goalDir}/goal.md`]: goalText("w"),
		[`${goalDir}/tickets/01-greet.md`]: ticketText("ready"),
	});

	const first = await runVago(root, ["run", "hello"]);

	expect(first.exitCode).toBe(0);
	expect((await goalRuns(root)).map(({ outcome }) => outcome)).toEqual([
		"exit 1",
	]);

	await runVago(root, ["ticket", "add", "hello", "again"]);
	const second = await runVago(root, ["run", "hello"]);

	expect(second.exitCode).toBe(0);
	expect(second.stdout).not.toContain("before_all");
	expect(await goalRuns(root)).toHaveLength(1);
});

test("a before_all pass that can't be picked up stops the Goal, naming the Step, with goal.md left as it was", async () => {
	const goalFile = goalWithRuns(setupAndPlanRuns("exit 1"));
	const root = await makeProject({
		".vago/workflows/w.toml": setupThenPlan,
		".vago/prompts/plan.md": "Plan it.\n",
		[`${goalDir}/goal.md`]: goalFile,
		[`${goalDir}/tickets/01-greet.md`]: ticketText("ready"),
	});
	const claude = await makeFakeClaude();

	const result = await runVago(root, ["run", "hello"], claude.env);

	expect(result.exitCode).not.toBe(0);
	expect(result.stdout).toContain(
		"hello can't be picked up: setup has no log left to rebuild its output from\n",
	);
	expect(result.stdout).not.toContain("reset:");
	expect(await claude.calls()).toHaveLength(0);
	const { header } = await readTicketFile(
		root,
		`${goalDir}/tickets/01-greet.md`,
	);
	expect(header.status).toBe("ready");
	expect(header.runs).toBeUndefined();
	expect(await Bun.file(join(root, goalDir, "goal.md")).text()).toBe(goalFile);
});
