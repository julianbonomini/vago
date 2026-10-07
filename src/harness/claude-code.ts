// The Claude Code Harness: the `claude -p` command and how its stream-json
// events read as a Harness session's events, and the interactive `claude`
// with its transcript. Hides Claude Code's flags, event shapes, tool names,
// its models' prices, and where its interactive transcript is and its line
// shapes.

import { join } from "node:path";
import { z } from "zod";
import type {
	HarnessCli,
	HarnessEvent,
	HarnessModelUsage,
	HarnessTokenUsage,
	HarnessToolCall,
	HarnessToolOutcome,
	ModelPrice,
} from "./harness-session.ts";

// Never --dangerously-skip-permissions: loosening the guard is always the
// human's explicit choice, never Vago's.
const guardedMode = "auto";
// Claude Code reports its permission mode at startup and again in a status
// event when it changes, as it does when the model doesn't offer auto mode.
const SessionEvent = z.object({
	type: z.literal("system"),
	subtype: z.enum(["init", "status"]),
	session_id: z.string(),
	permissionMode: z.string().optional(),
	model: z.string().optional(),
	cwd: z.string().optional(),
});

// Older Claude Code sends no decision_reason, only the message.
const PermissionDeniedEvent = z.object({
	type: z.literal("system"),
	subtype: z.literal("permission_denied"),
	tool_name: z.string().optional(),
	tool_use_id: z.string().optional(),
	decision_reason: z.string().optional(),
	message: z.string().optional(),
});

const Usage = z.object({
	input_tokens: z.number(),
	output_tokens: z.number(),
	cache_creation_input_tokens: z.number().default(0),
	cache_read_input_tokens: z.number().default(0),
});

const ResultEvent = z.object({
	type: z.literal("result"),
	subtype: z.string(),
	is_error: z.boolean().optional(),
	// Absent when the session ended in an error rather than an answer.
	result: z.string().optional(),
	total_cost_usd: z.number().optional(),
	duration_ms: z.number().optional(),
	num_turns: z.number().optional(),
	usage: Usage,
});

// The tokens one message used so far. Cache writes are priced by how long
// they last, which older Claude Code doesn't report.
const MessageUsage = Usage.extend({
	cache_creation: z
		.object({
			ephemeral_5m_input_tokens: z.number(),
			ephemeral_1h_input_tokens: z.number(),
		})
		.optional(),
});

// Events of a subagent's own session carry the call that started it. Each
// content block of a message comes as an event of its own, every one with
// the message's id and usage.
const AssistantEvent = z.object({
	type: z.literal("assistant"),
	parent_tool_use_id: z.string().nullish(),
	timestamp: z.string().optional(),
	message: z.object({
		id: z.string().optional(),
		model: z.string().optional(),
		usage: MessageUsage.optional().catch(undefined),
		content: z.array(z.unknown()),
	}),
});

const Hunk = z.object({
	oldStart: z.number(),
	oldLines: z.number(),
	newStart: z.number(),
	newLines: z.number(),
	lines: z.array(z.string()),
});

// What a tool's result reports besides its text: the file a Read read, the
// hunks an Edit or a Write changed or the file a Write created, the files a
// Bash command edited, the background task it became, a Skill's loading.
const ToolUseResult = z
	.object({
		file: z.object({ content: z.string() }),
		type: z.string(),
		content: z.string(),
		structuredPatch: z.array(Hunk),
		bashEditDiff: z.object({
			files: z.array(z.object({ filePath: z.string(), hunks: z.array(Hunk) })),
		}),
		backgroundTaskId: z.string(),
		success: z.boolean(),
		commandName: z.string(),
	})
	.partial();

const UserEvent = z.object({
	type: z.literal("user"),
	parent_tool_use_id: z.string().nullish(),
	message: z.object({ content: z.union([z.string(), z.array(z.unknown())]) }),
	tool_use_result: ToolUseResult.optional().catch(undefined),
});

// A background task's end, naming the call that started it.
const TaskNotificationEvent = z.object({
	type: z.literal("system"),
	subtype: z.literal("task_notification"),
	tool_use_id: z.string(),
	status: z.enum(["completed", "failed", "stopped"]),
});

const ResultContent = z
	.union([z.string(), z.array(z.object({ text: z.string().optional() }))])
	.optional();

const ToolResultBlock = z.object({
	type: z.literal("tool_result"),
	tool_use_id: z.string(),
	is_error: z.boolean().optional(),
	content: ResultContent,
});

const TextBlock = z.object({ type: z.literal("text"), text: z.string() });

// The input fields of the tools shown by more than their name, each
// optional so that a tool's own fields read alone.
const ToolInput = z
	.object({
		command: z.string(),
		description: z.string(),
		file_path: z.string(),
		old_string: z.string(),
		new_string: z.string(),
		content: z.string(),
		skill: z.string(),
		pattern: z.string(),
		url: z.string(),
		todos: z.array(z.unknown()),
	})
	.partial();

const ToolUseBlock = z.object({
	type: z.literal("tool_use"),
	id: z.string(),
	name: z.string(),
	input: ToolInput.catch({}),
});

// A line of the interactive transcript holding one content block of the
// agent's message, with the message's id and usage, as a stream's assistant
// event has them. A subagent's lines are marked as a sidechain.
const TranscriptAssistantLine = z.object({
	type: z.literal("assistant"),
	isSidechain: z.boolean().optional(),
	message: z.object({
		id: z.string().optional(),
		model: z.string().optional(),
		usage: MessageUsage.optional().catch(undefined),
		content: z.array(z.unknown()),
	}),
});

const program = "claude";

/**
 * Claude Code, run headless in its `auto` permission mode unless the Step's
 * `args` choose another. Its stream reports a fallback from the mode asked
 * for and every tool call Claude Code refused.
 */
export const claudeCode: HarnessCli = {
	title: "Claude Code",
	program,
	command(model, args) {
		return [program, "-p", ...sessionFlags(model, args)];
	},
	resumeCommand(sessionId, model, args) {
		return [program, "-p", "--resume", sessionId, ...sessionFlags(model, args)];
	},
	// An interactive `claude` reports no session id, so a fresh session runs
	// under one Vago names.
	interactiveReadOnlyCommand({ model, instructions, resume }) {
		const sessionId = resume ?? crypto.randomUUID();
		const argv = [
			program,
			resume === undefined ? "--session-id" : "--resume",
			sessionId,
			"--append-system-prompt",
			instructions,
			...readOnlyPermissions,
			"--model",
			model,
		];
		return { argv, sessionId };
	},
	events(line, command) {
		const event = parseJson(line);
		const denied = PermissionDeniedEvent.safeParse(event);
		if (denied.success) {
			const { tool_name, tool_use_id, decision_reason, message } = denied.data;
			return [
				{
					kind: "denied",
					...(tool_use_id === undefined ? {} : { callId: tool_use_id }),
					tool: tool_name ?? "",
					reason: decision_reason ?? message ?? "",
				},
			];
		}
		const session = SessionEvent.safeParse(event);
		if (session.success) {
			const { subtype, session_id, permissionMode, model, cwd } = session.data;
			const fallback =
				permissionMode === undefined || permissionMode === askedMode(command)
					? {}
					: { permissionModeFallback: permissionMode };
			const reported: HarnessEvent = {
				kind: "session-id",
				sessionId: session_id,
				...fallback,
			};
			if (subtype !== "init") return [reported];
			return [reported, { kind: "session-start", model, folder: cwd }];
		}
		const notification = TaskNotificationEvent.safeParse(event);
		if (notification.success) {
			const { tool_use_id, status } = notification.data;
			return [{ kind: "background-ended", callId: tool_use_id, state: status }];
		}
		const assistant = AssistantEvent.safeParse(event);
		if (assistant.success) return assistantEvents(assistant.data);
		const user = UserEvent.safeParse(event);
		if (user.success) return userEvents(user.data);
		const result = ResultEvent.safeParse(event);
		if (!result.success) return [];
		const { data } = result;
		const failed = data.is_error === true || data.subtype !== "success";
		return [
			{
				kind: "session-end",
				...(failed ? { failure: data.subtype } : {}),
				resultText: data.result,
				durationMs: data.duration_ms,
				turns: data.num_turns,
				tokens: sessionTokens(data.usage),
				costUsd: data.total_cost_usd,
			},
		];
	},
	// Claude Code's own layout, which it doesn't document or promise to keep
	// (ADR 0016): a folder per working directory, named by replacing each
	// character that isn't a letter or a digit with `-`.
	interactiveTranscript({ sessionId, folder }, home, env) {
		if (sessionId === undefined) return undefined;
		return {
			folder: join(
				env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"),
				"projects",
				folder.replace(/[^A-Za-z0-9]/g, "-"),
			),
			pattern: `${sessionId}.jsonl`,
		};
	},
	// Every session's id is named before it starts.
	transcriptSession() {
		return undefined;
	},
	transcriptAnswers(lines) {
		const answers: string[] = [];
		for (const line of lines) {
			const parsed = TranscriptAssistantLine.safeParse(parseJson(line));
			if (!parsed.success || parsed.data.isSidechain === true) continue;
			const texts = parsed.data.message.content.flatMap((block) => {
				const text = TextBlock.safeParse(block);
				return text.success ? [text.data.text] : [];
			});
			if (texts.length > 0) answers.push(texts.join("\n"));
		}
		return answers;
	},
	// Each content block of a message is a line of its own, every one with
	// the message's usage, so a message counts once. A subagent's count too.
	transcriptUsage(lines) {
		const messages = new Map<string, HarnessModelUsage>();
		for (const line of lines) {
			const parsed = TranscriptAssistantLine.safeParse(parseJson(line));
			if (!parsed.success) continue;
			const { id, model, usage } = parsed.data.message;
			if (id === undefined || usage === undefined) continue;
			messages.set(id, { model: model ?? "", tokens: messageTokens(usage) });
		}
		return [...messages.values()];
	},
	prices: anthropicPrices(),
	resumeHint(sessionId) {
		return `claude --resume ${sessionId}`;
	},
};

// What a fresh session and a resumed one both run with.
function sessionFlags(model: string, args: readonly string[]): string[] {
	return [
		"--output-format",
		"stream-json",
		"--verbose",
		"--permission-mode",
		guardedMode,
		"--model",
		model,
		...args,
	];
}

// What keeps a session read-only: only tools that read files or load a
// Skill, and `dontAsk`, which refuses any call those tools don't cover
// rather than wait for a human. No MCP server either, since one can change
// things the tools list doesn't name.
const readOnlyPermissions = [
	"--permission-mode",
	"dontAsk",
	"--strict-mcp-config",
	"--tools",
	"Read,Grep,Glob,Skill",
];

// A subagent's messages count only for their tokens.
function assistantEvents(
	assistant: z.infer<typeof AssistantEvent>,
): HarnessEvent[] {
	const { message, timestamp } = assistant;
	const events: HarnessEvent[] = [];
	if (message.id !== undefined && message.usage !== undefined) {
		events.push({
			kind: "usage",
			messageId: message.id,
			model: message.model ?? "",
			tokens: messageTokens(message.usage),
		});
	}
	if (assistant.parent_tool_use_id) return events;
	for (const block of message.content) {
		const text = TextBlock.safeParse(block);
		if (text.success) events.push({ kind: "prose", text: text.data.text });
		const use = ToolUseBlock.safeParse(block);
		if (use.success) {
			events.push({
				kind: "tool-call",
				callId: use.data.id,
				call: toolCall(use.data),
				...(timestamp === undefined ? {} : { startedAt: new Date(timestamp) }),
			});
		}
	}
	return events;
}

function userEvents(user: z.infer<typeof UserEvent>): HarnessEvent[] {
	if (user.parent_tool_use_id) return [];
	const { content } = user.message;
	const outcome = toolOutcome(user.tool_use_result ?? {});
	const events: HarnessEvent[] = [];
	for (const block of typeof content === "string" ? [] : content) {
		const result = ToolResultBlock.safeParse(block);
		if (!result.success) continue;
		events.push({
			kind: "tool-result",
			callId: result.data.tool_use_id,
			...(result.data.is_error === true
				? { error: resultText(result.data.content) }
				: {}),
			...(outcome === undefined ? {} : { outcome }),
		});
	}
	return events;
}

// Claude Code's tools by what they do; any other tool shows by its name.
function toolCall(use: z.infer<typeof ToolUseBlock>): HarnessToolCall {
	const { input } = use;
	const path = input.file_path ?? "";
	switch (use.name) {
		case "Bash":
			return {
				tool: "execute",
				command: input.command ?? "",
				...(input.description === undefined
					? {}
					: { description: input.description }),
			};
		case "Read":
			return { tool: "read", path };
		case "Edit":
			return {
				tool: "edit",
				path,
				oldText: input.old_string ?? "",
				newText: input.new_string ?? "",
			};
		case "Write":
			return { tool: "write", path, content: input.content ?? "" };
		case "Skill":
			return { tool: "skill", name: input.skill ?? "" };
		case "Grep":
			return { tool: "search", pattern: input.pattern ?? "" };
		case "Glob":
			return { tool: "find", pattern: input.pattern ?? "" };
		case "Task":
		case "Agent":
			return { tool: "agent", description: input.description ?? "" };
		case "TodoWrite":
			return { tool: "plan", todos: input.todos?.length ?? 0 };
		case "WebFetch":
			return { tool: "fetch", url: input.url ?? "" };
		default:
			return { tool: "other", name: use.name };
	}
}

// Each tool's result reports its own fields: the files a Bash command edited
// or the background task it became, the file a Read read, the file a Write
// created, the hunks an Edit or a Write changed, a Skill's loading.
function toolOutcome(
	reported: z.infer<typeof ToolUseResult>,
): HarnessToolOutcome | undefined {
	const edited = reported.bashEditDiff?.files ?? [];
	if (edited.length > 0) {
		return {
			kind: "edited-files",
			files: edited.map(({ filePath, hunks }) => ({ path: filePath, hunks })),
		};
	}
	if (reported.backgroundTaskId !== undefined) {
		return { kind: "sent-to-background" };
	}
	if (reported.file !== undefined) {
		return { kind: "read", content: reported.file.content };
	}
	if (reported.type === "create" && reported.content !== undefined) {
		return { kind: "created", content: reported.content };
	}
	if (reported.structuredPatch !== undefined) {
		return { kind: "patched", hunks: reported.structuredPatch };
	}
	if (reported.success === true) {
		return {
			kind: "skill-loaded",
			...(reported.commandName === undefined
				? {}
				: { name: reported.commandName }),
		};
	}
	return undefined;
}

// Cached input still went through the model, so it counts as input.
function sessionTokens(usage: z.infer<typeof Usage>): {
	input: number;
	output: number;
} {
	return {
		input:
			usage.input_tokens +
			usage.cache_creation_input_tokens +
			usage.cache_read_input_tokens,
		output: usage.output_tokens,
	};
}

// Older Claude Code reports cache writes without how long they last.
function messageTokens(usage: z.infer<typeof MessageUsage>): HarnessTokenUsage {
	return {
		input: usage.input_tokens,
		output: usage.output_tokens,
		cacheRead: usage.cache_read_input_tokens,
		cacheWrite:
			usage.cache_creation?.ephemeral_5m_input_tokens ??
			usage.cache_creation_input_tokens,
		cacheWriteHour: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
	};
}

// Dollars per million tokens of each model Claude Code runs, as Anthropic
// lists them, the most specific id first. Cache writes cost 1.25 times the
// input price when they last 5 minutes and twice it when they last an hour.
function anthropicPrices(): ModelPrice[] {
	return [
		{ model: "claude-fable-5-1", input: 10, output: 50, cacheRead: 0.25 },
		{ model: "claude-mythos-5-1", input: 10, output: 50, cacheRead: 0.25 },
		{ model: "claude-fable-5", input: 10, output: 50, cacheRead: 1 },
		{ model: "claude-mythos-5", input: 10, output: 50, cacheRead: 1 },
		{ model: "claude-opus-5-5", input: 4, output: 20, cacheRead: 0.2 },
		{ model: "claude-opus-5", input: 5, output: 25, cacheRead: 0.5 },
		{ model: "claude-opus-4-8", input: 5, output: 25, cacheRead: 0.5 },
		{ model: "claude-opus-4-7", input: 5, output: 25, cacheRead: 0.5 },
		{ model: "claude-opus-4-6", input: 5, output: 25, cacheRead: 0.5 },
		{ model: "claude-sonnet-5-5", input: 2, output: 10, cacheRead: 0.2 },
		{ model: "claude-sonnet-5", input: 2, output: 10, cacheRead: 0.2 },
		{ model: "claude-sonnet-4-6", input: 3, output: 15, cacheRead: 0.3 },
		{ model: "claude-haiku-4-5", input: 1, output: 5, cacheRead: 0.1 },
	].map((price) => ({
		...price,
		cacheWrite: price.input * 1.25,
		cacheWriteHour: price.input * 2,
	}));
}

function parseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

function resultText(content: z.infer<typeof ResultContent>): string {
	if (content === undefined) return "";
	if (typeof content === "string") return content;
	return content.map((part) => part.text ?? "").join("\n");
}

// The mode `command` asks Claude Code for: the last --permission-mode wins,
// and --dangerously-skip-permissions wins over any of them.
function askedMode(command: readonly string[]): string {
	if (command.includes("--dangerously-skip-permissions")) {
		return "bypassPermissions";
	}
	let mode = guardedMode;
	for (const [index, arg] of command.entries()) {
		if (arg === "--permission-mode") mode = command[index + 1] ?? mode;
		else if (arg.startsWith("--permission-mode=")) {
			mode = arg.slice("--permission-mode=".length);
		}
	}
	return mode;
}
