// The Claude Code Harness: the `claude -p` command, how its stream-json
// events are read, and how they condense into Run activity. Hides Claude
// Code's flags, event shapes and tool names.

import { z } from "zod";
import type {
	Harness,
	RunActivityItem,
	RunBackgroundTask,
	RunDiffLine,
	RunProseLine,
	RunToolCall,
	RunToolCalls,
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
	runActivity(lines, root) {
		// One item per call while the stream is read, so a result can turn its
		// call into another item; calls of one verb are folded at the end.
		const items: RunActivityItem[] = [];
		// The session's folder, the Goal's worktree, which mirrors the Project:
		// paths under it or `root` are shown relative to the Project.
		let folder = root;
		let ended = false;
		// Calls waiting for their result, by tool_use_id.
		const waiting = new Map<string, { tool: string; item: RunToolCalls }>();
		// A refused call's result repeats the refusal, so it isn't shown.
		const refused = new Set<string>();
		// Commands sent to the background, by the tool_use_id that sent them.
		const background = new Map<string, RunBackgroundTask>();
		// The latest usage of each message, by its id, and its model.
		const messages = new Map<
			string,
			{ model: string; usage: z.infer<typeof MessageUsage> }
		>();
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
			const notification = TaskNotificationEvent.safeParse(event);
			if (notification.success) {
				const task = background.get(notification.data.tool_use_id);
				if (task !== undefined) task.state = notification.data.status;
				continue;
			}
			const assistant = AssistantEvent.safeParse(event);
			if (assistant.success) {
				const { message, timestamp } = assistant.data;
				if (message.id !== undefined && message.usage !== undefined) {
					messages.set(message.id, {
						model: message.model ?? "",
						usage: message.usage,
					});
				}
				if (assistant.data.parent_tool_use_id) continue;
				for (const block of message.content) {
					const text = TextBlock.safeParse(block);
					if (text.success && text.data.text.trim() !== "") {
						items.push({ kind: "prose", lines: proseLines(text.data.text) });
					}
					const use = ToolUseBlock.safeParse(block);
					if (use.success) {
						const { verb, files, call } = toolCall(use.data, [folder, root]);
						if (timestamp !== undefined)
							call.runningSince = new Date(timestamp);
						const item: RunToolCalls = {
							kind: "tool-calls",
							verb,
							files: files ?? false,
							calls: [call],
						};
						items.push(item);
						waiting.set(use.data.id, { tool: use.data.name, item });
					}
				}
				continue;
			}
			const user = UserEvent.safeParse(event);
			if (user.success && !user.data.parent_tool_use_id) {
				const { content } = user.data.message;
				const reported = user.data.tool_use_result ?? {};
				for (const block of typeof content === "string" ? [] : content) {
					const result = ToolResultBlock.safeParse(block);
					if (!result.success) continue;
					const { tool_use_id, is_error } = result.data;
					const caller = waiting.get(tool_use_id);
					waiting.delete(tool_use_id);
					if (caller !== undefined) {
						const answered = resultItem(caller, reported, [folder, root]);
						items[items.indexOf(caller.item)] = answered;
						if (answered.kind === "background-task") {
							background.set(tool_use_id, answered);
						}
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
		return {
			items: foldCalls(items),
			working: !ended && waiting.size === 0,
			spent: spentSoFar([...messages.values()]),
		};
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

// The verb a call shows by, whether it works on one file, and what it
// worked on, in Claude Code's words for the tools a Vago agent uses; any
// other tool shows by its name.
function toolCall(
	use: z.infer<typeof ToolUseBlock>,
	folders: string[],
): { verb: string; files?: boolean; call: RunToolCall } {
	const { input } = use;
	const path = relativePath(input.file_path ?? "", folders);
	switch (use.name) {
		case "Bash":
			return {
				verb: "Execute",
				call: { subject: input.description ?? firstLine(input.command ?? "") },
			};
		case "Read":
			return { verb: "Read", files: true, call: { subject: path } };
		case "Edit":
			return {
				verb: "Edit",
				files: true,
				call: {
					subject: path,
					size: `+${lineCount(input.new_string ?? "")} −${lineCount(input.old_string ?? "")}`,
				},
			};
		case "Write":
			return {
				verb: "Write",
				files: true,
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

// What a call shows as once its result is in: an edit of each file a Bash
// command changed, a background task, a loaded Skill, or the call itself,
// no longer running, with what its result adds to it: a Read's size, an
// Edit's or a Write's diff.
function resultItem(
	caller: { tool: string; item: RunToolCalls },
	reported: z.infer<typeof ToolUseResult>,
	folders: string[],
): RunActivityItem {
	const { tool, item } = caller;
	const call = item.calls[0];
	if (call === undefined) return item;
	delete call.runningSince;
	const edited = reported.bashEditDiff?.files ?? [];
	if (tool === "Bash" && edited.length > 0) {
		return {
			kind: "tool-calls",
			verb: "Edit",
			files: true,
			calls: edited.map(({ filePath, hunks }) => {
				const diff = diffLines(hunks);
				const added = diff.filter((line) => line.kind === "added").length;
				const removed = diff.filter((line) => line.kind === "removed").length;
				return {
					subject: relativePath(filePath, folders),
					size: `+${added} −${removed}`,
					diff,
				};
			}),
		};
	}
	if (tool === "Bash" && reported.backgroundTaskId !== undefined) {
		return { kind: "background-task", subject: call.subject, state: "running" };
	}
	if (tool === "Skill" && reported.success === true) {
		return { kind: "skill-loaded", name: reported.commandName ?? call.subject };
	}
	if (tool === "Read" && reported.file !== undefined) {
		call.size = `${lineCount(reported.file.content)} lines`;
	}
	if (tool === "Edit" || tool === "Write") {
		const created =
			reported.type === "create" && reported.content !== undefined;
		const hunks = created
			? [createdHunk(reported.content ?? "")]
			: (reported.structuredPatch ?? []);
		if (hunks.length > 0) call.diff = diffLines(hunks);
	}
	return item;
}

// A new file's one hunk, every line of `content` added.
function createdHunk(content: string): z.infer<typeof Hunk> {
	const lines = content === "" ? [] : content.replace(/\n$/, "").split("\n");
	return {
		oldStart: 0,
		oldLines: 0,
		newStart: 1,
		newLines: lines.length,
		lines: lines.map((line) => `+${line}`),
	};
}

function diffLines(hunks: z.infer<typeof Hunk>[]): RunDiffLine[] {
	return hunks.flatMap((hunk) => [
		{
			kind: "hunk" as const,
			text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
		},
		...hunk.lines.map((line): RunDiffLine => {
			if (line.startsWith("+")) return { kind: "added", text: line.slice(1) };
			if (line.startsWith("-")) return { kind: "removed", text: line.slice(1) };
			if (line.startsWith(" ")) return { kind: "kept", text: line.slice(1) };
			// Such as "\ No newline at end of file".
			return { kind: "kept", text: line };
		}),
	]);
}

// Folds each run of calls of one verb into one item, so a run of reads or
// commands takes one line.
function foldCalls(items: RunActivityItem[]): RunActivityItem[] {
	const folded: RunActivityItem[] = [];
	for (const item of items) {
		const last = folded.at(-1);
		if (
			item.kind === "tool-calls" &&
			last?.kind === "tool-calls" &&
			last.verb === item.verb
		) {
			folded[folded.length - 1] = {
				...last,
				calls: [...last.calls, ...item.calls],
			};
		} else folded.push(item);
	}
	return folded;
}

// Dollars per million tokens of each model Claude Code runs, as Anthropic
// lists them, the most specific id first. Cache writes cost 1.25 times the
// input price when they last 5 minutes and twice it when they last an hour.
const prices: {
	model: string;
	input: number;
	output: number;
	cacheRead: number;
}[] = [
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
];

// The tokens `messages` used and what they cost, the cost left out when a
// message's model has no price. A model's id may carry a date or a
// context size after the one priced, such as `claude-haiku-4-5-20251001`.
function spentSoFar(
	messages: { model: string; usage: z.infer<typeof MessageUsage> }[],
): { tokens: number; costUsd?: number } {
	let tokens = 0;
	let costUsd: number | undefined = 0;
	for (const { model, usage } of messages) {
		const used = sessionTokens(usage);
		tokens += used.input + used.output;
		const price = prices.find(
			(price) =>
				model === price.model ||
				model.startsWith(`${price.model}-`) ||
				model.startsWith(`${price.model}[`),
		);
		if (price === undefined || costUsd === undefined) {
			costUsd = undefined;
			continue;
		}
		const writes = usage.cache_creation ?? {
			ephemeral_5m_input_tokens: usage.cache_creation_input_tokens,
			ephemeral_1h_input_tokens: 0,
		};
		costUsd +=
			(usage.input_tokens * price.input +
				usage.output_tokens * price.output +
				usage.cache_read_input_tokens * price.cacheRead +
				writes.ephemeral_5m_input_tokens * price.input * 1.25 +
				writes.ephemeral_1h_input_tokens * price.input * 2) /
			1_000_000;
	}
	return costUsd === undefined ? { tokens } : { tokens, costUsd };
}

// `path` relative to the first of `folders` it is under, or as it is.
function relativePath(path: string, folders: string[]): string {
	const folder = folders.find((folder) => path.startsWith(`${folder}/`));
	return folder === undefined ? path : path.slice(folder.length + 1);
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
