// The Claude Code Harness: the `claude -p` command, how its stream-json
// events are read, and how they condense into Run activity. Hides Claude
// Code's flags, event shapes and tool names.

import { z } from "zod";
import type {
	Harness,
	RunActivityItem,
	RunProseLine,
	RunToolCall,
} from "./registry.ts";

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

// Events of a subagent's own session carry the call that started it.
const AssistantEvent = z.object({
	type: z.literal("assistant"),
	parent_tool_use_id: z.string().nullish(),
	message: z.object({ content: z.array(z.unknown()) }),
});

// A Read's result carries the file it read.
const UserEvent = z.object({
	type: z.literal("user"),
	parent_tool_use_id: z.string().nullish(),
	message: z.object({ content: z.union([z.string(), z.array(z.unknown())]) }),
	tool_use_result: z
		.object({ file: z.object({ content: z.string() }) })
		.optional()
		.catch(undefined),
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

/**
 * Claude Code, run headless in its `auto` permission mode unless the Step's
 * `args` choose another. Its stream reports a fallback from the mode asked
 * for and every tool call Claude Code refused.
 */
export const claudeCode: Harness = {
	command(model, args) {
		return [
			"claude",
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--permission-mode",
			guardedMode,
			"--model",
			model,
			...args,
		];
	},
	readLine(line, command) {
		const event = parseJson(line);
		if (PermissionDeniedEvent.safeParse(event).success) {
			return { permissionDenied: true };
		}
		const session = SessionEvent.safeParse(event);
		if (session.success) {
			const { session_id, permissionMode } = session.data;
			// Left out in the mode asked for, so a later event can't clear a
			// fallback reported earlier.
			if (
				permissionMode === undefined ||
				permissionMode === askedMode(command)
			) {
				return { sessionId: session_id };
			}
			return { sessionId: session_id, permissionModeFallback: permissionMode };
		}
		const result = ResultEvent.safeParse(event);
		if (!result.success) return {};
		return {
			resultText: result.data.result,
			costUsd: result.data.total_cost_usd,
			tokens: sessionTokens(result.data.usage),
		};
	},
	runActivity(lines) {
		const items: RunActivityItem[] = [];
		// The session's folder, which paths in tool calls are shown relative to.
		let folder = "";
		let ended = false;
		// Calls waiting for their result, by tool_use_id. A Read's size comes
		// with its result.
		const waiting = new Map<string, { tool: string; call: RunToolCall }>();
		// A refused call's result repeats the refusal, so it isn't shown.
		const refused = new Set<string>();
		for (const line of lines) {
			const event = parseJson(line);
			const denied = PermissionDeniedEvent.safeParse(event);
			if (denied.success) {
				const { tool_name, tool_use_id, decision_reason, message } =
					denied.data;
				if (tool_use_id !== undefined) refused.add(tool_use_id);
				items.push({
					kind: "denied",
					tool: tool_name ?? "",
					reason: decision_reason ?? message ?? "",
				});
				continue;
			}
			const session = SessionEvent.safeParse(event);
			if (session.success && session.data.subtype === "init") {
				folder = session.data.cwd ?? folder;
				items.push({ kind: "session-start", model: session.data.model ?? "" });
				continue;
			}
			const assistant = AssistantEvent.safeParse(event);
			if (assistant.success && !assistant.data.parent_tool_use_id) {
				for (const block of assistant.data.message.content) {
					const text = TextBlock.safeParse(block);
					if (text.success && text.data.text.trim() !== "") {
						items.push({ kind: "prose", lines: proseLines(text.data.text) });
					}
					const use = ToolUseBlock.safeParse(block);
					if (use.success) {
						const { verb, call } = toolCall(use.data, folder);
						addCall(items, verb, call);
						waiting.set(use.data.id, { tool: use.data.name, call });
					}
				}
				continue;
			}
			const user = UserEvent.safeParse(event);
			if (user.success && !user.data.parent_tool_use_id) {
				const { content } = user.data.message;
				for (const block of typeof content === "string" ? [] : content) {
					const result = ToolResultBlock.safeParse(block);
					if (!result.success) continue;
					const { tool_use_id, is_error } = result.data;
					const caller = waiting.get(tool_use_id);
					waiting.delete(tool_use_id);
					const file = user.data.tool_use_result?.file;
					if (caller?.tool === "Read" && file !== undefined) {
						caller.call.size = `${lineCount(file.content)} lines`;
					}
					if (is_error === true && !refused.has(tool_use_id)) {
						items.push({
							kind: "failed-result",
							firstLine: firstLine(resultText(result.data.content)),
						});
					}
				}
				continue;
			}
			const result = ResultEvent.safeParse(event);
			if (result.success) {
				const { data } = result;
				const tokens = sessionTokens(data.usage);
				const failed = data.is_error === true || data.subtype !== "success";
				ended = true;
				items.push({
					kind: "session-end",
					...(failed ? { failure: data.subtype } : {}),
					durationMs: data.duration_ms,
					turns: data.num_turns,
					tokens: tokens.input + tokens.output,
					costUsd: data.total_cost_usd,
				});
			}
		}
		return { items, working: !ended && waiting.size === 0 };
	},
	resumeHint(sessionId) {
		return `claude --resume ${sessionId}`;
	},
};

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

function parseJson(line: string): unknown {
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

// The verb a call shows by, and what it worked on, in Claude Code's words
// for the tools a Vago agent uses; any other tool shows by its name.
function toolCall(
	use: z.infer<typeof ToolUseBlock>,
	folder: string,
): { verb: string; call: RunToolCall } {
	const { input } = use;
	const path = relativePath(input.file_path ?? "", folder);
	switch (use.name) {
		case "Bash":
			return {
				verb: "Execute",
				call: { subject: input.description ?? firstLine(input.command ?? "") },
			};
		case "Read":
			return { verb: "Read", call: { subject: path } };
		case "Edit":
			return {
				verb: "Edit",
				call: {
					subject: path,
					size: `+${lineCount(input.new_string ?? "")} −${lineCount(input.old_string ?? "")}`,
				},
			};
		case "Write":
			return {
				verb: "Write",
				call: {
					subject: path,
					size: `${lineCount(input.content ?? "")} lines`,
				},
			};
		case "Skill":
			return { verb: "Skill", call: { subject: input.skill ?? "" } };
		case "Grep":
			return { verb: "Search", call: { subject: input.pattern ?? "" } };
		case "Glob":
			return { verb: "Find", call: { subject: input.pattern ?? "" } };
		case "Task":
		case "Agent":
			return { verb: "Agent", call: { subject: input.description ?? "" } };
		case "TodoWrite":
			return {
				verb: "Plan",
				call: { subject: "", size: `${input.todos?.length ?? 0} todos` },
			};
		case "WebFetch":
			return { verb: "Fetch", call: { subject: input.url ?? "" } };
		default:
			return { verb: use.name, call: { subject: "" } };
	}
}

// Folds a call into the item before it when that item holds calls of the
// same verb, so a run of reads or commands takes one line.
function addCall(items: RunActivityItem[], verb: string, call: RunToolCall) {
	const last = items.at(-1);
	if (last?.kind === "tool-calls" && last.verb === verb) last.calls.push(call);
	else items.push({ kind: "tool-calls", verb, calls: [call] });
}

// Inside a Goal's worktree the session's folder mirrors the Project, so a
// path under it reads as a path in the Project.
function relativePath(path: string, folder: string): string {
	if (folder !== "" && path.startsWith(`${folder}/`)) {
		return path.slice(folder.length + 1);
	}
	return path;
}

function resultText(content: z.infer<typeof ResultContent>): string {
	if (content === undefined) return "";
	if (typeof content === "string") return content;
	return content.map((part) => part.text ?? "").join("\n");
}

// Results can carry a command's colours, which would show as escape codes.
function firstLine(text: string): string {
	return (
		Bun.stripANSI(text)
			.split("\n")
			.find((line) => line.trim() !== "")
			?.trim() ?? ""
	);
}

function lineCount(text: string): number {
	return text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
}

// Keeps the prose's line breaks, with one blank line at most between
// paragraphs, and drops the Markdown marks a terminal can't show.
function proseLines(text: string): RunProseLine[] {
	const lines: RunProseLine[] = [];
	for (const line of text.trim().split("\n")) {
		const plain = line.replaceAll("**", "").replaceAll("`", "").trimEnd();
		if (plain === "" && lines.at(-1)?.text === "") continue;
		const heading = /^#+\s+/.exec(plain);
		lines.push(
			heading
				? { text: plain.slice(heading[0].length), heading: true }
				: { text: plain, heading: false },
		);
	}
	return lines;
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
