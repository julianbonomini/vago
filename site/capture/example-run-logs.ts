// The invented Run logs of the example Project: an agent Run's log in Claude Code's stream-json lines, the
// way the Harness writes it, and the shell Steps' plain output. Owns what each invented Run did; the made-up
// ids, sizes and timings come from the seeded `random` the caller passes, so every capture writes the same.

import type { ExampleTicket } from "./acme-shop.ts";

/** A source of numbers in [0, 1), the same sequence on every capture. */
export type SeededRandom = () => number;

/** The seeded random every capture starts from. */
export function seededRandom(): SeededRandom {
	let seed = 7;
	return () => {
		seed = (seed * 16807) % 2147483647;
		return (seed - 1) / 2147483646;
	};
}

/** One thing an invented agent does: says something, loads a Skill, or calls a tool. */
export type AgentAction =
	| { kind: "text"; text: string }
	| { kind: "skill"; name: string }
	| { kind: "read"; path: string; lines: string[] }
	| { kind: "grep"; pattern: string; hits: string }
	| { kind: "edit"; path: string; add: string[]; remove: string[]; at: number }
	| { kind: "write"; path: string; content: string }
	| {
			kind: "bash";
			command: string;
			description: string;
			stdout: string;
			error?: boolean;
	  };

/** What an invented agent Run ends with. `failed` is the error it stops on, if it fails. */
export type AgentRunEnd = {
	cost: number;
	seconds: number;
	result: string;
	failed?: string;
};

/** Where the example Project's worktrees are, as the logs name them. */
export const exampleWorktrees = "/home/dev/.vago/worktrees/acme-shop-5c1e7a20";

/** The example Project's remote, as the merge logs name it. */
const remote = "github.com:acme-example/acme-shop.git";
const pullRequests = "https://github.com/acme-example/acme-shop/pull";

/** A number between `low` and `high`. */
export function between(random: SeededRandom, low: number, high: number) {
	return low + (high - low) * random();
}

function hexId(random: SeededRandom, length: number): string {
	return Array.from({ length }, () =>
		Math.floor(random() * 16).toString(16),
	).join("");
}

/** A session id as the Harness prints one. */
export function sessionId(random: SeededRandom): string {
	return `${hexId(random, 8)}-${hexId(random, 4)}-4${hexId(random, 3)}-a${hexId(random, 3)}-${hexId(random, 12)}`;
}

/** The log of an agent Run in `cwd` doing `actions`: one stream-json line per event, the cost spread over
 *  its messages as a growing context would. */
export function agentRunLog(
	random: SeededRandom,
	cwd: string,
	actions: AgentAction[],
	end: AgentRunEnd,
): string {
	const session = sessionId(random);
	const lines: unknown[] = [];
	const event = (fields: Record<string, unknown>) =>
		lines.push({ ...fields, session_id: session, uuid: sessionId(random) });
	event({
		type: "system",
		subtype: "init",
		cwd,
		tools: ["Bash", "Edit", "Glob", "Grep", "Read", "Skill", "Write"],
		mcp_servers: [],
		model: "claude-opus-5-5",
		permissionMode: "auto",
	});
	const messages = actions.length;
	const costPerMessage = end.cost / Math.max(1, messages);
	let message = 0;
	const usage = () => {
		const weight = 0.5 + message++ / Math.max(1, messages - 1);
		const cacheRead = Math.max(
			8000,
			Math.round((costPerMessage * weight - 0.0104) / 0.2e-6),
		);
		return {
			input_tokens: 2,
			cache_creation_input_tokens: 800,
			cache_read_input_tokens: cacheRead,
			cache_creation: {
				ephemeral_5m_input_tokens: 0,
				ephemeral_1h_input_tokens: 800,
			},
			output_tokens: 200,
		};
	};
	const assistant = (content: unknown) =>
		event({
			type: "assistant",
			message: {
				model: "claude-opus-5-5",
				id: `msg_01${hexId(random, 22)}`,
				type: "message",
				role: "assistant",
				content: [content],
				usage: usage(),
			},
			parent_tool_use_id: null,
		});
	const toolResult = (
		id: string,
		content: string,
		toolUseResult: Record<string, unknown>,
		isError = false,
	) =>
		event({
			type: "user",
			message: {
				role: "user",
				content: [
					{
						tool_use_id: id,
						type: "tool_result",
						content,
						...(isError ? { is_error: true } : {}),
					},
				],
			},
			parent_tool_use_id: null,
			tool_use_result: toolUseResult,
		});
	for (const action of actions) {
		const id = `toolu_01${hexId(random, 22)}`;
		switch (action.kind) {
			case "text":
				assistant({ type: "text", text: action.text });
				break;
			case "skill":
				assistant({
					type: "tool_use",
					id,
					name: "Skill",
					input: { skill: action.name },
				});
				toolResult(id, `Launching skill: ${action.name}`, {
					success: true,
					commandName: action.name,
				});
				break;
			case "read": {
				const path = `${cwd}/${action.path}`;
				assistant({
					type: "tool_use",
					id,
					name: "Read",
					input: { file_path: path },
				});
				toolResult(
					id,
					action.lines.map((line, i) => `${i + 1}\t${line}`).join("\n"),
					{
						type: "text",
						file: {
							filePath: path,
							content: `${action.lines.join("\n")}\n`,
							numLines: action.lines.length,
							startLine: 1,
							totalLines: action.lines.length,
						},
					},
				);
				break;
			}
			case "grep":
				assistant({
					type: "tool_use",
					id,
					name: "Grep",
					input: { pattern: action.pattern, output_mode: "content" },
				});
				toolResult(id, action.hits, {
					mode: "content",
					content: action.hits,
					numFiles: action.hits.split("\n").length,
				});
				break;
			case "edit": {
				const path = `${cwd}/${action.path}`;
				const oldString = action.remove.join("\n");
				const newString = action.add.join("\n");
				assistant({
					type: "tool_use",
					id,
					name: "Edit",
					input: {
						file_path: path,
						old_string: oldString,
						new_string: newString,
						replace_all: false,
					},
				});
				toolResult(id, `The file ${path} has been updated successfully.`, {
					filePath: path,
					oldString,
					newString,
					structuredPatch: [
						{
							oldStart: action.at,
							oldLines: action.remove.length,
							newStart: action.at,
							newLines: action.add.length,
							lines: [
								...action.remove.map((line) => `-${line}`),
								...action.add.map((line) => `+${line}`),
							],
						},
					],
				});
				break;
			}
			case "write": {
				const path = `${cwd}/${action.path}`;
				assistant({
					type: "tool_use",
					id,
					name: "Write",
					input: { file_path: path, content: action.content },
				});
				toolResult(id, `File created successfully at: ${path}`, {
					type: "create",
					filePath: path,
					content: action.content,
					structuredPatch: [],
					originalFile: null,
				});
				break;
			}
			case "bash":
				assistant({
					type: "tool_use",
					id,
					name: "Bash",
					input: { command: action.command, description: action.description },
				});
				toolResult(
					id,
					action.stdout || "(Bash completed with no output)",
					{
						stdout: action.stdout,
						stderr: "",
						interrupted: false,
						isImage: false,
						noOutputExpected: false,
					},
					action.error === true,
				);
				break;
		}
	}
	lines.push({
		type: "result",
		subtype: end.failed === undefined ? "success" : "error_during_execution",
		is_error: end.failed !== undefined,
		...(end.failed === undefined ? { result: end.result } : {}),
		duration_ms: Math.round(end.seconds * 1000),
		num_turns: messages,
		total_cost_usd: end.cost,
		usage: {
			input_tokens: 2 * messages,
			cache_creation_input_tokens: 800 * messages,
			cache_read_input_tokens: 40000 * messages,
			output_tokens: 200 * messages,
		},
		session_id: session,
		uuid: sessionId(random),
	});
	return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

function passLines(random: SeededRandom, ticket: ExampleTicket): string {
	return ticket.tests
		.map((name) => `(pass) ${name} [${between(random, 2, 60).toFixed(2)}ms]`)
		.join("\n");
}

/** What the Build Step's agent does on `ticket`. The `replayed` Ticket gets the long, eventful Run the
 *  hero streams; every other gets a short one. */
export function buildActions(
	random: SeededRandom,
	ticket: ExampleTicket,
	replayed: boolean,
): AgentAction[] {
	const [main = "src/index.ts", second] = ticket.files;
	const actions: AgentAction[] = [
		{ kind: "skill", name: "vago-write-code" },
		{
			kind: "text",
			text: `I'll read ${main} and the code around it before changing anything.`,
		},
		{
			kind: "read",
			path: main,
			lines: [
				`// ${ticket.title}`,
				'import { db } from "../db/client.ts";',
				"",
				"export async function load() {",
				"\t// ...",
				"}",
			],
		},
		{
			kind: "grep",
			pattern: ticket.grep,
			hits: `${main}:14:${ticket.grep}\n${second ?? "src/app.ts"}:31:${ticket.grep}`,
		},
	];
	if (second)
		actions.push({
			kind: "read",
			path: second,
			lines: ["export function handler() {", "\t// ...", "}"],
		});
	const testFile = `import { describe, expect, test } from "bun:test";\n${ticket.tests.map((name) => `\ntest("${name}", async () => {\n\t// ...\n});`).join("\n")}\n`;
	if (!replayed) {
		actions.push(
			{ kind: "write", path: ticket.test, content: testFile },
			{
				kind: "edit",
				path: main,
				at: 12,
				remove: ["\t// ..."],
				add: ["\t// what the Ticket asks for", "\treturn result;"],
			},
			{
				kind: "bash",
				command: `bun test ${ticket.test}`,
				description: "Run the new tests",
				stdout: `${ticket.test}:\n${passLines(random, ticket)}\n\n ${ticket.tests.length} pass\n 0 fail`,
			},
			{
				kind: "bash",
				command: "bun run check",
				description: "Types, lint and every test",
				stdout: " 198 pass\n 0 fail",
			},
			{
				kind: "text",
				text: [
					`Done: ${ticket.title.toLowerCase()}.`,
					...ticket.notes.slice(0, 1),
					"`bun run check` passes.",
				].join(" "),
			},
		);
		return actions;
	}
	const [first = "", secondTest = "", third = "", fourth = ""] = ticket.tests;
	actions.push(
		{
			kind: "read",
			path: "src/http/rate-limit.ts",
			lines: [
				"export function rateLimit(key: string, max: number, windowMs: number) {",
				"\t// ...",
				"}",
			],
		},
		{
			kind: "text",
			text: "The login form already has a limiter keyed by address. I'll give the balance lookup its own key on the same limiter instead of writing another one.",
		},
		{ kind: "write", path: ticket.test, content: testFile },
		{
			kind: "bash",
			command: `bun test ${ticket.test}`,
			description: "Run the new tests, expecting them to fail",
			stdout: `${ticket.test}:\n(fail) ${first}\n(fail) ${secondTest}\n\n 0 pass\n 4 fail`,
			error: true,
		},
		{
			kind: "text",
			text: "Four failing tests, as expected. Now the lookup: it reads the card by code and its last five uses in one query.",
		},
		{
			kind: "write",
			path: "src/gift-cards/balance-lookup.ts",
			content:
				"export async function balanceLookup(code: string) {\n\t// ...\n}\n",
		},
		{
			kind: "edit",
			path: "src/routes/gift-cards/balance.tsx",
			at: 1,
			remove: [],
			add: [
				'import { balanceLookup } from "../../gift-cards/balance-lookup.ts";',
				"",
				"export default function BalancePage() {",
				"\t// a form with one field, and the balance once found",
				"}",
			],
		},
		{
			kind: "bash",
			command: `bun test ${ticket.test}`,
			description: "Run the balance tests",
			stdout: `${ticket.test}:\n(pass) ${first}\n(pass) ${secondTest}\n(fail) ${third}\n(pass) ${fourth}\n\n 3 pass\n 1 fail`,
			error: true,
		},
		{
			kind: "text",
			text: "The rate limit test fails: the limiter counts every lookup, not only the wrong ones. It should count a lookup only when the code isn't found.",
		},
		{
			kind: "edit",
			path: "src/http/rate-limit.ts",
			at: 22,
			remove: ["\tcount(key);"],
			add: ["\tif (!options.onlyFailures) count(key);"],
		},
		{
			kind: "edit",
			path: "src/gift-cards/balance-lookup.ts",
			at: 9,
			remove: ["\treturn card;"],
			add: [
				"\tif (card === undefined) limiter.fail(address);",
				"\treturn card;",
			],
		},
		{
			kind: "bash",
			command: `bun test ${ticket.test}`,
			description: "Run the balance tests again",
			stdout: `${ticket.test}:\n${passLines(random, ticket)}\n\n 4 pass\n 0 fail`,
		},
		{
			kind: "bash",
			command: "bun run check",
			description: "Types, lint and every test",
			stdout:
				"$ tsc --noEmit && biome check && bun test\n 214 pass\n 0 fail\nRan 214 tests across 38 files. [6.21s]",
		},
		{
			kind: "text",
			text: "Done. The balance page shows a card's balance and last five uses without an account, and wrong codes go through the login limiter with their own key. 4 new tests, `bun run check` passes.",
		},
	);
	return actions;
}

/** What the Review Step's agent does on `ticket` of Goal `goal`. */
export function reviewActions(
	random: SeededRandom,
	ticket: ExampleTicket,
	goal: string,
): AgentAction[] {
	const [main = "src/index.ts"] = ticket.files;
	const stat = [
		...ticket.files.map(
			(file) => ` ${file} | ${Math.round(between(random, 8, 60))} ++++--`,
		),
		` ${ticket.test} | ${Math.round(between(random, 20, 90))} ++++++`,
	];
	return [
		{ kind: "skill", name: "vago-check-red-flags" },
		{
			kind: "bash",
			command: `git diff vago/${goal}...HEAD --stat`,
			description: "What the Ticket changed",
			stdout: stat.join("\n"),
		},
		{
			kind: "read",
			path: main,
			lines: ["// ...", "export async function load() {", "\t// ...", "}"],
		},
		{
			kind: "text",
			text: "The change matches the Ticket. One name reads as a getter but writes to the database; renaming it.",
		},
		{
			kind: "edit",
			path: main,
			at: 18,
			remove: ["export async function getCard(code: string) {"],
			add: ["export async function findCard(code: string) {"],
		},
		{
			kind: "bash",
			command: "bun run check",
			description: "Types, lint and every test",
			stdout: " 214 pass\n 0 fail",
		},
		{
			kind: "text",
			text: "Reviewed against the Ticket and the red flags. One rename, no other findings. `bun run check` passes.",
		},
	];
}

/** What the Goal review Step's agent does on Goal `goal`. */
export function goalReviewActions(goal: string): AgentAction[] {
	return [
		{ kind: "text", text: "Reading the whole Goal's diff against goal.md." },
		{
			kind: "bash",
			command: `git diff main...vago/${goal} --stat`,
			description: "The Goal's diff",
			stdout: " 9 files changed",
		},
		{
			kind: "text",
			text: "Every user story is covered and nothing is out of scope. No changes.",
		},
	];
}

/** The New branch Step's output. */
export function branchLog(goal: string, ticket: ExampleTicket): string {
	return `Switched to a new branch '${goal}/${ticket.slug}'\n`;
}

/** The Checks Step's output on `ticket`. */
export function checkLog(random: SeededRandom, ticket: ExampleTicket): string {
	const files = [
		"test/cart.test.ts",
		"test/checkout.test.ts",
		ticket.test,
		"test/products.test.ts",
	];
	const blocks = files.map((file) => {
		const tests =
			file === ticket.test
				? ticket.tests
				: [
						"adds an item",
						"keeps the total in cents",
						"rejects a negative quantity",
					];
		const lines = tests.map(
			(name) => `(pass) ${name} [${between(random, 1, 90).toFixed(2)}ms]`,
		);
		return `${file}:\n${lines.join("\n")}`;
	});
	return `$ tsc --noEmit && biome check && bun test
Checked 142 files in 61ms. No fixes applied.
bun test v1.3.4

${blocks.join("\n\n")}

 214 pass
 0 fail
 611 expect() calls
Ran 214 tests across 38 files. [6.08s]
`;
}

/** The Squash merge Step's output for `ticket` of Goal `goal`, whose PR is `pullRequest`. */
export function mergeLog(
	random: SeededRandom,
	goal: string,
	ticket: ExampleTicket,
	pullRequest: number,
	firstTicket: boolean,
): string {
	const before = hexId(random, 7);
	const merged = hexId(random, 7);
	const after = hexId(random, 7);
	const rows = [...ticket.files, ticket.test].map(
		(file) =>
			` ${file.padEnd(40)} | ${String(Math.round(between(random, 6, 80))).padStart(3)} ++++++--`,
	);
	const push = firstTicket ? "* [new branch]     " : `${before}..${after} `;
	return `Updating ${before}..${merged}
Fast-forward
Squash commit -- not updating HEAD
${rows.join("\n")}
 ${rows.length} files changed, ${Math.round(between(random, 60, 220))} insertions(+), ${Math.round(between(random, 4, 40))} deletions(-)
Deleted branch ${goal}/${ticket.slug} (was ${merged}).
branch 'vago/${goal}' set up to track 'origin/vago/${goal}'.
To ${remote}
   ${push} vago/${goal} -> vago/${goal}
${pullRequests}/${pullRequest}
`;
}

/** The Ready for review Step's output. */
export function readyLog(pullRequest: number): string {
	return `Marked ${pullRequests}/${pullRequest} ready for review.\n`;
}
