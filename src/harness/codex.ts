// The Codex Harness: the `codex exec` command and how its JSON events read
// as a Harness session's events. Hides Codex's flags, event shapes, how it
// wraps a command in a shell, and its models' prices.

import { z } from "zod";
import type {
	HarnessCli,
	HarnessEvent,
	ModelPrice,
} from "./harness-session.ts";

// Never --dangerously-bypass-approvals-and-sandbox: loosening the guard is
// always the human's explicit choice, never Vago's. --approve-for-me runs
// every command in the workspace-write sandbox and hands each request to
// leave it, such as a commit writing to a worktree's git folder outside the
// worktree, to Codex's automatic review instead of a human, so a Run never
// waits and is never unguarded.
const guardedMode = "--approve-for-me";

const ThreadStartedEvent = z.object({
	type: z.literal("thread.started"),
	thread_id: z.string(),
});

// Input tokens include the cached ones, as OpenAI counts them, and output
// tokens include the reasoning ones.
const TurnCompletedEvent = z.object({
	type: z.literal("turn.completed"),
	usage: z.object({
		input_tokens: z.number(),
		cached_input_tokens: z.number().default(0),
		cache_write_input_tokens: z.number().default(0),
		output_tokens: z.number(),
	}),
});

const TurnFailedEvent = z.object({
	type: z.literal("turn.failed"),
	error: z.object({ message: z.string() }),
});

// A provider's error comes as its own JSON inside the message.
const ProviderError = z.object({ error: z.object({ message: z.string() }) });

const ItemEvent = z.object({
	type: z.enum(["item.started", "item.updated", "item.completed"]),
	item: z.object({ id: z.string(), type: z.string() }).loose(),
});

const AgentMessage = z.object({
	type: z.literal("agent_message"),
	text: z.string(),
});

// `declined` is a command Codex's automatic review refused to let out of
// the sandbox.
const CommandExecution = z.object({
	type: z.literal("command_execution"),
	command: z.string(),
	aggregated_output: z.string(),
	exit_code: z.number().nullable(),
	status: z.enum(["in_progress", "completed", "failed", "declined"]),
});

// Codex reports which files a change touched, but not how.
const FileChange = z.object({
	type: z.literal("file_change"),
	changes: z.array(
		z.object({
			path: z.string(),
			kind: z.enum(["add", "update", "delete"]),
		}),
	),
	status: z.enum(["in_progress", "completed", "failed"]),
});

const program = "codex";

/**
 * Codex, run by `codex exec` in its sandbox with its automatic review in
 * the human's place. Its stream reports every command the review refused.
 * It reports no costs, so a session is priced from the tokens it reports
 * and the model its command names.
 */
export const codex: HarnessCli = {
	title: "Codex",
	program,
	command(model, args) {
		// "-" reads the prompt from stdin, where the kernel writes it.
		return [...execCommand(model, args), "-"];
	},
	resumeCommand(sessionId, model, args) {
		// `resume` takes no --approve-for-me of its own, so every flag goes
		// before it, to `exec`.
		return [...execCommand(model, args), "resume", sessionId, "-"];
	},
	// Codex's own read-only sandbox lets its commands read but not write.
	readOnlyCommand(model) {
		return [...readOnlyExecCommand(model), "-"];
	},
	readOnlyResumeCommand(sessionId, model) {
		return [...readOnlyExecCommand(model), "resume", sessionId, "-"];
	},
	interactiveReadOnlyCommand() {
		// TODO(planning-real-session 03): Codex's interactive session
		throw new Error("A Codex planning session isn't built yet");
	},
	events(line, command) {
		const event = parseJson(line);
		const thread = ThreadStartedEvent.safeParse(event);
		if (thread.success) {
			return [
				{ kind: "session-id", sessionId: thread.data.thread_id },
				{ kind: "session-start", model: askedModel(command) },
			];
		}
		const item = ItemEvent.safeParse(event);
		if (item.success) return itemEvents(item.data);
		const completed = TurnCompletedEvent.safeParse(event);
		if (completed.success) {
			const { usage } = completed.data;
			const model = askedModel(command);
			const tokens = {
				input:
					usage.input_tokens -
					usage.cached_input_tokens -
					usage.cache_write_input_tokens,
				output: usage.output_tokens,
				cacheRead: usage.cached_input_tokens,
				cacheWrite: usage.cache_write_input_tokens,
				cacheWriteHour: 0,
			};
			return [
				{
					kind: "session-end",
					tokens: { input: usage.input_tokens, output: usage.output_tokens },
					...(model === undefined ? {} : { usage: { model, tokens } }),
				},
			];
		}
		const failed = TurnFailedEvent.safeParse(event);
		if (!failed.success) return [];
		const { message } = failed.data.error;
		const provider = ProviderError.safeParse(parseJson(message));
		return [
			{
				kind: "session-end",
				failure: provider.success ? provider.data.error.message : message,
			},
		];
	},
	interactiveTranscriptPath() {
		// TODO(planning-real-session 03): Codex's interactive transcript, under $CODEX_HOME/sessions/
		return undefined;
	},
	transcriptAnswers() {
		// TODO(planning-real-session 03): Codex's interactive transcript, under $CODEX_HOME/sessions/
		return [];
	},
	prices: openAiPrices(),
	resumeHint(sessionId) {
		return `codex resume ${sessionId}`;
	},
};

// What a fresh session and a resumed one both run with.
function execCommand(model: string, args: readonly string[]): string[] {
	return [program, "exec", "--json", guardedMode, "--model", model, ...args];
}

function readOnlyExecCommand(model: string): string[] {
	return [
		program,
		"exec",
		"--json",
		"--sandbox",
		"read-only",
		"--model",
		model,
	];
}

// A command shows from its start; a file change, which Codex applies at
// once, shows when it's done, the only event sure to carry it.
function itemEvents(event: z.infer<typeof ItemEvent>): HarnessEvent[] {
	const { item } = event;
	const callId = item.id;
	const message = AgentMessage.safeParse(item);
	if (message.success) {
		if (event.type !== "item.completed") return [];
		return [{ kind: "prose", text: message.data.text, answer: true }];
	}
	const command = CommandExecution.safeParse(item);
	if (command.success) {
		const { data } = command;
		if (event.type === "item.started") {
			return [
				{
					kind: "tool-call",
					callId,
					call: { tool: "execute", command: shellCommand(data.command) },
				},
			];
		}
		if (data.status === "declined") {
			return [
				{
					kind: "denied",
					callId,
					tool: "shell",
					reason: "Codex's automatic review declined it",
				},
				{ kind: "tool-result", callId },
			];
		}
		if (data.status === "failed") {
			const code =
				data.exit_code === null ? "" : `Exit code ${data.exit_code}\n`;
			return [
				{ kind: "tool-result", callId, error: code + data.aggregated_output },
			];
		}
		if (data.status === "completed") return [{ kind: "tool-result", callId }];
		return [];
	}
	const change = FileChange.safeParse(item);
	if (change.success) {
		const { changes, status } = change.data;
		if (event.type !== "item.completed") return [];
		return changes.flatMap(({ path, kind }, index): HarnessEvent[] => {
			const fileCallId = `${callId}/${index}`;
			return [
				{
					kind: "tool-call",
					callId: fileCallId,
					call: { tool: "file-change", path, change: kind },
				},
				{
					kind: "tool-result",
					callId: fileCallId,
					...(status === "failed"
						? { error: "Codex couldn't apply the change" }
						: {}),
				},
			];
		});
	}
	// Any other tool, such as an MCP server's, shows by its item type.
	if (event.type === "item.started") {
		return [
			{ kind: "tool-call", callId, call: { tool: "other", name: item.type } },
		];
	}
	return event.type === "item.completed"
		? [{ kind: "tool-result", callId }]
		: [];
}

// Codex runs each command as `<shell> -lc <command>`; the command alone is
// what the agent meant.
function shellCommand(command: string): string {
	const wrapped = /^\S+ -lc (.+)$/s.exec(command);
	return wrapped?.[1] === undefined ? command : shellWord(wrapped[1]);
}

// One shell word with its quotes removed, as the shell reads it: single
// quotes keep everything, double quotes let a backslash escape `"`, `\`,
// `$` and a backtick, and a backslash outside quotes escapes any character.
function shellWord(word: string): string {
	let text = "";
	let quote: "'" | '"' | undefined;
	for (let index = 0; index < word.length; index++) {
		const char = word.charAt(index);
		const next = word.charAt(index + 1);
		if (quote === "'") {
			if (char === "'") quote = undefined;
			else text += char;
		} else if (
			char === "\\" &&
			(quote === undefined || '"\\$`'.includes(next))
		) {
			text += next;
			index++;
		} else if (char === '"') {
			quote = quote === '"' ? undefined : '"';
		} else if (char === "'" && quote === undefined) {
			quote = "'";
		} else {
			text += char;
		}
	}
	return text;
}

// The model `command` asks Codex for, the last --model or -m; undefined
// when it isn't known, as when a Run's log is read afterwards.
function askedModel(command: readonly string[]): string | undefined {
	let model: string | undefined;
	for (const [index, arg] of command.entries()) {
		if (arg === "--model" || arg === "-m") model = command[index + 1] ?? model;
		else if (arg.startsWith("--model=")) model = arg.slice("--model=".length);
	}
	return model;
}

// Dollars per million tokens of each model Codex runs, as OpenAI lists them
// for its standard tier, the most specific id first. OpenAI charges nothing
// extra for writing the cache. gpt-5.5's prices are for prompts under 272K
// tokens.
function openAiPrices(): ModelPrice[] {
	return [
		{ model: "gpt-6.1-sol", input: 2, output: 10, cacheRead: 0.1 },
		{ model: "gpt-6-astra", input: 10, output: 50, cacheRead: 1 },
		{ model: "gpt-6-sol", input: 2, output: 10, cacheRead: 0.2 },
		{ model: "gpt-6-luna", input: 0.1, output: 0.5, cacheRead: 0.01 },
		{ model: "gpt-5.6-sol", input: 4, output: 20, cacheRead: 0.4 },
		{ model: "gpt-5.6-terra", input: 2, output: 12, cacheRead: 0.2 },
		{ model: "gpt-5.6-luna", input: 0.2, output: 1.2, cacheRead: 0.02 },
		{ model: "gpt-5.5-pro", input: 30, output: 180, cacheRead: 30 },
		{ model: "gpt-5.5", input: 5, output: 30, cacheRead: 0.5 },
	].map((price) => ({
		...price,
		cacheWrite: price.input,
		cacheWriteHour: price.input,
	}));
}

function parseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}
