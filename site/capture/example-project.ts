// The example Project on disk: acme-shop's Goals, Tickets, Run logs and planning item written in the files
// Vago reads, its Runs laid out in time before the capture's clock, and the replay, which rewrites the running
// Goal's replayed Ticket as `vago run` would at each moment of its Steps. Owns the Ticket and Goal headers
// it writes and the timeline; what the Runs did comes from example-run-logs.ts.

import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "smol-toml";
import type { TicketStatus } from "../../src/tickets/tickets.ts";
import {
	type ExampleGoal,
	type ExampleTicket,
	exampleGoals,
	examplePlanningItem,
} from "./acme-shop.ts";
import {
	agentRunLog,
	between,
	branchLog,
	buildActions,
	checkLog,
	exampleWorktrees,
	goalReviewActions,
	mergeLog,
	readyLog,
	reviewActions,
	type SeededRandom,
	seededRandom,
	sessionId,
} from "./example-run-logs.ts";

/** The running Goal's replayed Ticket, ready to be shown at each moment of its Steps. */
export type ExampleReplay = {
	goal: string;
	/** The replayed Ticket's number, such as "03", and the number of the Ticket that starts after it. */
	ticket: string;
	next: string;
	/** What each moment shows, such as "Build", in order; the last is the Ticket done and the next begun. */
	phases: string[];
	/** Writes the files as they stand at moment `phase` and returns the time the clock reads then. */
	showPhase(phase: number): Promise<Date>;
	/** Releases the running Goal's lock holder. */
	stop(): void;
};

const minute = 60_000;
const day = 24 * 60 * minute;

// A Run as the capture writes it: its Step, its log's name and text, and how it ended.
type ExampleRun = {
	step: string;
	log: string;
	text: string;
	seconds: number;
	outcome?: string;
	resumed?: boolean;
	agent?: { session: string; cost: number; input: number; output: number };
};

/**
 * Writes acme-shop in the git repository at `root`, with `starter` copied in as its .vago, the replay's
 * clock starting at `now`. Its running Goal holds its lock through a child process until `stop`.
 */
export async function writeExampleProject(
	root: string,
	now: Date,
	starter: string,
): Promise<ExampleReplay> {
	const random = seededRandom();
	await cp(starter, join(root, ".vago"), { recursive: true });
	let pullRequest = 30;
	let replay: ReplayedTicket | undefined;
	const byAge = [...exampleGoals].sort((a, b) => b.daysAgo - a.daysAgo);
	for (const goal of byAge) {
		const goalDir = join(root, ".vago-goals", goal.name);
		await mkdir(join(goalDir, "tickets"), { recursive: true });
		await mkdir(join(goalDir, "logs"), { recursive: true });
		pullRequest++;
		const created =
			goal.state === "running"
				? now.getTime() - 95 * minute
				: now.getTime() -
					goal.daysAgo * day -
					between(random, 60, 400) * minute;
		let at = created + between(random, 3, 15) * minute;
		for (const [index, ticket] of goal.tickets.entries()) {
			if (ticket.state === "done" || ticket.state === "stuck") {
				const last = index === goal.tickets.length - 1;
				const runs = ticketRuns(random, goal, ticket, index + 1, {
					goalReview: last && goal.state === "done",
					pullRequest,
					replayed: false,
				});
				const laid = layRuns(runs, at);
				at = laid.end + between(random, 1, 3) * 1000;
				await writeLogs(goalDir, runs);
				await writeTicket(goalDir, ticket, ticket.state, created, laid.toml);
				continue;
			}
			await writeTicket(goalDir, ticket, "ready", created, "");
			if (ticket.state === "replay") {
				const next = goal.tickets[index + 1];
				if (next === undefined)
					throw new Error(`The replayed Ticket ${ticket.slug} has no next`);
				replay = {
					goalDir,
					ticket,
					next,
					created,
					runs: ticketRuns(random, goal, ticket, index + 1, {
						goalReview: false,
						pullRequest,
						replayed: true,
					}),
				};
			}
		}
		let goalRuns = "";
		if (goal.state === "done") {
			const runs = afterAllRuns(random, goal, pullRequest);
			goalRuns = layRuns(runs, at).toml;
			await writeLogs(goalDir, runs);
		}
		await Bun.write(
			join(goalDir, "goal.md"),
			`+++\nworkflow = "small"\ncreated = ${iso(created)}\n${goalRuns}\n+++\n${goalBody(goal)}`,
		);
	}
	if (replay === undefined) throw new Error("acme-shop has no replayed Ticket");
	await writePlanningItem(root, now.getTime(), random);
	const goal = byAge.find((each) => each.state === "running")?.name ?? "";
	// The lock's holder has to be a live process other than this one, which Vago reads as stale.
	const holder = Bun.spawn(["sleep", "3600"]);
	await Bun.write(
		join(root, ".vago-goals", goal, "running.lock"),
		`${holder.pid}\n`,
	);
	const phases = replayPhases(replay.runs);
	return {
		goal,
		ticket: replay.ticket.slug.slice(0, 2),
		next: replay.next.slug.slice(0, 2),
		phases: phases.map(({ label }) => label),
		showPhase: async (index) => {
			const phase = phases[index];
			if (phase === undefined) throw new Error(`No replay phase ${index}`);
			return await writePhase(replay, phase, now.getTime());
		},
		stop: () => holder.kill(),
	};
}

// The planning item's chat, with its past sessions, and its Proposal, as `vago plan session` leaves them.
async function writePlanningItem(
	root: string,
	now: number,
	random: SeededRandom,
): Promise<void> {
	const item = examplePlanningItem;
	const folder = join(root, ".vago-goals", item.name, "planning");
	await mkdir(folder, { recursive: true });
	const session = sessionId(random);
	await Bun.write(
		join(folder, "chat.toml"),
		stringify({
			harness: "claude-code",
			session_id: session,
			sessions: item.sessions.map(({ startedAgo, endedAgo, cost }) => ({
				started: new Date(now - startedAgo * minute),
				ended: new Date(now - endedAgo * minute),
				session_id: session,
				cost_usd: cost,
			})),
		}),
	);
	await Bun.write(
		join(folder, "proposal.toml"),
		stringify({
			goal: item.goal,
			workflow: item.workflow,
			workflow_reason: item.workflowReason,
			tickets: item.tickets.map(({ slug, blockedBy, body }) => ({
				slug,
				blocked_by: blockedBy,
				body,
			})),
		}),
	);
}

// The replayed Ticket and what its Runs will be.
type ReplayedTicket = {
	goalDir: string;
	ticket: ExampleTicket;
	next: ExampleTicket;
	created: number;
	runs: ExampleRun[];
};

// The Runs `ticket`, the `number`th of `goal`, went through: a stuck Ticket's failed Builds, or every Step
// of the small Workflow, with Goal review on the Goal's last Ticket.
function ticketRuns(
	random: SeededRandom,
	goal: ExampleGoal,
	ticket: ExampleTicket,
	number: number,
	options: { goalReview: boolean; pullRequest: number; replayed: boolean },
): ExampleRun[] {
	const prefix = String(number).padStart(2, "0");
	const cwd = `${exampleWorktrees}/${goal.name}`;
	let count = 0;
	const log = (step: string, extension: string) =>
		`${prefix}-${step}-${++count}.${extension}`;
	const runs: ExampleRun[] = [
		{
			step: "branch",
			log: log("branch", "log"),
			text: branchLog(goal.name, ticket),
			seconds: between(random, 0.04, 0.09),
		},
	];
	if (ticket.state === "stuck") {
		const errors = [
			"API Error: 529 Overloaded",
			"API Error: 529 Overloaded",
			"API Error: 500 Internal server error",
			"API Error: 529 Overloaded",
		];
		for (const [attempt, error] of errors.entries()) {
			const cost = between(random, 0.08, 0.3);
			const seconds = between(random, 60, 260);
			const opening =
				attempt === 0
					? [
							{ kind: "skill" as const, name: "vago-write-code" },
							{
								kind: "read" as const,
								path: ticket.files[0] ?? "",
								lines: ["// ..."],
							},
						]
					: [
							{
								kind: "text" as const,
								text: "Continuing where I stopped: the range filter's end date.",
							},
						];
			const text = agentRunLog(
				random,
				cwd,
				[
					...opening,
					{
						kind: "read",
						path: ticket.files[1] ?? "",
						lines: [
							"export async function listOrders(range) {",
							"\t// ...",
							"}",
						],
					},
					{ kind: "text", text: error },
				],
				{ cost, seconds, result: "", failed: error },
			);
			runs.push({
				...agentRun(
					random,
					"implement",
					log("implement", "jsonl"),
					cost,
					seconds,
					text,
				),
				outcome: "exit 1",
				resumed: attempt > 0,
			});
		}
		return runs;
	}
	const buildCost = options.replayed ? 0.86 : between(random, 0.42, 1.05);
	const buildSeconds = options.replayed ? 552 : between(random, 240, 720);
	runs.push(
		agentRun(
			random,
			"implement",
			log("implement", "jsonl"),
			buildCost,
			buildSeconds,
			agentRunLog(random, cwd, buildActions(random, ticket, options.replayed), {
				cost: buildCost,
				seconds: buildSeconds,
				result: "Done.",
			}),
		),
	);
	runs.push({
		step: "check",
		log: log("check", "log"),
		text: checkLog(random, ticket),
		seconds: options.replayed ? 98 : between(random, 70, 140),
	});
	const reviewCost = options.replayed ? 0.31 : between(random, 0.18, 0.42);
	const reviewSeconds = options.replayed ? 214 : between(random, 120, 300);
	runs.push(
		agentRun(
			random,
			"review",
			log("review", "jsonl"),
			reviewCost,
			reviewSeconds,
			agentRunLog(random, cwd, reviewActions(random, ticket, goal.name), {
				cost: reviewCost,
				seconds: reviewSeconds,
				result: "Reviewed.",
			}),
		),
	);
	if (options.goalReview) {
		const cost = between(random, 0.22, 0.4);
		const seconds = between(random, 90, 200);
		runs.push(
			agentRun(
				random,
				"goal-review",
				log("goal-review", "jsonl"),
				cost,
				seconds,
				agentRunLog(random, cwd, goalReviewActions(goal.name), {
					cost,
					seconds,
					result: "No changes.",
				}),
			),
		);
	}
	runs.push({
		step: "merge",
		log: log("merge", "log"),
		text: mergeLog(
			random,
			goal.name,
			ticket,
			options.pullRequest,
			number === 1,
		),
		seconds: between(random, 4, 8),
	});
	return runs;
}

// A finished Goal's after_all Runs: its PR description and marking the PR ready.
function afterAllRuns(
	random: SeededRandom,
	goal: ExampleGoal,
	pullRequest: number,
): ExampleRun[] {
	const cost = between(random, 0.1, 0.16);
	const seconds = between(random, 30, 60);
	const describe = agentRunLog(
		random,
		`${exampleWorktrees}/${goal.name}`,
		[
			{
				kind: "text",
				text: "Writing the PR description from the Goal report.",
			},
		],
		{ cost, seconds, result: "Updated the PR description." },
	);
	return [
		agentRun(
			random,
			"describe",
			"after_all-describe-1.jsonl",
			cost,
			seconds,
			describe,
		),
		{
			step: "ready",
			log: "after_all-ready-2.log",
			text: readyLog(pullRequest),
			seconds: 1.4,
		},
	];
}

function agentRun(
	random: SeededRandom,
	step: string,
	log: string,
	cost: number,
	seconds: number,
	text: string,
): ExampleRun {
	return {
		step,
		log,
		text,
		seconds,
		agent: {
			session: sessionId(random),
			cost: Number(cost.toFixed(4)),
			input: Math.round(cost * 1.6e6),
			output: Math.round(between(random, 6000, 21000)),
		},
	};
}

// A Run's [[runs]] entry, started at `started` and, unless it is still open, ended at `ended`.
function runEntry(run: ExampleRun, started: number, ended?: number): string {
	const lines = [
		"",
		"[[runs]]",
		`step = "${run.step}"`,
		`started = ${iso(started)}`,
	];
	if (ended !== undefined)
		lines.push(`ended = ${iso(ended)}`, `outcome = "${run.outcome ?? "ok"}"`);
	lines.push(`log = "logs/${run.log}"`);
	if (run.agent) {
		lines.push(
			`harness = "claude-code"`,
			`model = "claude-opus-5-5"`,
			`session_id = "${run.agent.session}"`,
		);
		if (run.resumed) lines.push(`resume = "resumed"`);
		if (ended !== undefined)
			lines.push(
				`cost_usd = ${run.agent.cost}`,
				"",
				"[runs.tokens]",
				`input = ${run.agent.input}`,
				`output = ${run.agent.output}`,
			);
	}
	return lines.join("\n");
}

// The minutes `vago run` waits before each retry of a failed agent Step, as pass-runner.ts has them.
const retryWaitMinutes = [1, 1, 5];

// `runs` end to end from `start`, a failed Run followed by the wait before its retry. Returns their
// entries and when the last one ended.
function layRuns(
	runs: ExampleRun[],
	start: number,
): { toml: string; end: number } {
	let at = start;
	let toml = "";
	// How many times the Step of the Run before has been retried so far.
	let retries = 0;
	for (const run of runs) {
		const end = at + run.seconds * 1000;
		toml += `\n${runEntry(run, at, end)}`;
		const retryWait =
			run.outcome === "exit 1" ? retryWaitMinutes[retries] : undefined;
		retries = retryWait === undefined ? 0 : retries + 1;
		at = end + (retryWait === undefined ? 400 : retryWait * minute);
	}
	return { toml, end: at };
}

async function writeLogs(goalDir: string, runs: ExampleRun[]): Promise<void> {
	for (const run of runs)
		await Bun.write(join(goalDir, "logs", run.log), run.text);
}

async function writeTicket(
	goalDir: string,
	ticket: ExampleTicket,
	status: TicketStatus,
	created: number,
	runs: string,
): Promise<void> {
	const blockedBy = ticket.blockedBy?.length
		? `blocked_by = [ ${ticket.blockedBy.join(", ")} ]\n`
		: "";
	await Bun.write(
		join(goalDir, "tickets", `${ticket.slug}.md`),
		`+++\nstatus = "${status}"\n${blockedBy}created = ${iso(created)}\n${runs}\n+++\n${ticketBody(ticket)}`,
	);
}

function ticketBody(ticket: ExampleTicket): string {
	const criteria = ticket.criteria.map((line) => `- [ ] ${line}`).join("\n");
	return `# ${ticket.title}

## What to build

${ticket.what}

## Acceptance criteria

${criteria}
`;
}

function goalBody(goal: ExampleGoal): string {
	const stories = goal.stories
		.map((story, i) => `${i + 1}. ${story}`)
		.join("\n");
	return `# ${goal.title}

## Problem Statement

${goal.problem}

## Solution

${goal.solution}

## User Stories

${stories}

## Out of Scope

${goal.out}
`;
}

function iso(time: number): string {
	return new Date(time).toISOString();
}

// A moment of the replay: the Run open then, or the Run count when every Run is done, how far through the
// open Run it is, and what the moment shows.
type ReplayPhase = { run: number; fraction: number; label: string };

// The moments the replay shows: the Steps of the small Workflow, the long ones at several points.
function replayPhases(runs: ExampleRun[]): ReplayPhase[] {
	const moments = [
		{ step: "branch", count: 1, label: "New branch" },
		{ step: "implement", count: 7, label: "Build" },
		{ step: "check", count: 2, label: "Checks" },
		{ step: "review", count: 3, label: "Review" },
		{ step: "merge", count: 1, label: "Squash merge" },
	];
	const phases: ReplayPhase[] = [];
	for (const { step, count, label } of moments) {
		const run = runs.findIndex((each) => each.step === step);
		for (let i = 1; i <= count; i++)
			phases.push({
				run,
				fraction: count === 1 ? 0.5 : i / (count + 1),
				label,
			});
	}
	phases.push({ run: runs.length, fraction: 0, label: "Done" });
	return phases;
}

// Rewrites the replayed Ticket, and the next one, as they stand at `phase` of a replay starting at
// `start`, and returns the time then.
async function writePhase(
	replay: ReplayedTicket,
	phase: ReplayPhase,
	start: number,
): Promise<Date> {
	const done = replay.runs.slice(0, phase.run);
	const laid = layRuns(done, start);
	await writeLogs(replay.goalDir, done);
	const at = laid.end;
	let toml = laid.toml;
	const open = replay.runs[phase.run];
	if (open === undefined) {
		const now = at + 2000;
		await writeTicket(
			replay.goalDir,
			replay.ticket,
			"done",
			replay.created,
			toml,
		);
		const branch: ExampleRun = {
			step: "branch",
			log: `${replay.next.slug.slice(0, 2)}-branch-1.log`,
			text: "",
			seconds: 0,
		};
		await Bun.write(join(replay.goalDir, "logs", branch.log), "");
		await writeTicket(
			replay.goalDir,
			replay.next,
			"running",
			replay.created,
			`\n${runEntry(branch, now - 400)}`,
		);
		return new Date(now);
	}
	const now = at + open.seconds * 1000 * phase.fraction;
	toml += `\n${runEntry(open, at)}`;
	const lines = open.text.split("\n").filter((line) => line !== "");
	const written = lines.slice(0, Math.round(lines.length * phase.fraction));
	await Bun.write(
		join(replay.goalDir, "logs", open.log),
		`${written.join("\n")}\n`,
	);
	await writeTicket(
		replay.goalDir,
		replay.ticket,
		"running",
		replay.created,
		toml,
	);
	await writeTicket(replay.goalDir, replay.next, "ready", replay.created, "");
	return new Date(now);
}
