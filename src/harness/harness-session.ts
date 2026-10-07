// What every Harness shares: a session's events, in words common to every
// Harness's CLI, and how they add up to the session's report and its Run
// activity. Hides folding calls by verb, which tools work on files, prose
// cleaning, relative paths, diffs, background tasks and pricing.

import type {
	Harness,
	HarnessInteractiveCommand,
	HarnessSessionReport,
	HarnessTranscriptFiles,
	HarnessTranscriptSession,
	RunActivity,
	RunActivityItem,
	RunBackgroundTask,
	RunDiffLine,
	RunProseLine,
	RunToolCall,
	RunToolCalls,
} from "./registry.ts";

/**
 * What one Harness module knows of its CLI: its command, how its stream's
 * lines read as events, its models' prices, how it resumes a session and its
 * resume hint. Turned into a `Harness` by `harnessFromCli`.
 */
export type HarnessCli = {
	/** As `Harness.title`. */
	title: string;
	/** As `Harness.program`. */
	program: string;
	/** As `Harness.command`. */
	command(model: string, args: readonly string[]): string[];
	/** As `Harness.resumeCommand`. */
	resumeCommand(
		sessionId: string,
		model: string,
		args: readonly string[],
	): string[];
	/** As `Harness.interactiveReadOnlyCommand`. */
	interactiveReadOnlyCommand(session: {
		model: string;
		instructions: string;
		resume?: string;
	}): HarnessInteractiveCommand;
	/**
	 * The events one stream line carries, in the order it carries them; none
	 * for a line that isn't a whole event the CLI knows. `command` is the
	 * argv `command()` gave the session, empty when it isn't known, as when
	 * a Run's log is read afterwards.
	 */
	events(line: string, command: readonly string[]): HarnessEvent[];
	/** Dollars per million tokens of each model the CLI runs. */
	prices: ModelPrice[];
	/** As `Harness.interactiveTranscript`. */
	interactiveTranscript(
		session: { sessionId?: string; folder: string },
		home: string,
		env: Readonly<Record<string, string | undefined>>,
	): HarnessTranscriptFiles | undefined;
	/** As `Harness.transcriptSession`. */
	transcriptSession(firstLine: string): HarnessTranscriptSession | undefined;
	/** As `HarnessTranscript.answers`, from the lines `readTranscript` takes. */
	transcriptAnswers(lines: readonly string[]): string[];
	/**
	 * What the session whose transcript has `lines` used, by model message,
	 * or its total for a CLI that records only that.
	 */
	transcriptUsage(lines: readonly string[]): HarnessModelUsage[];
	/** As `Harness.resumeHint`. */
	resumeHint(sessionId: string): string;
};

/**
 * One thing a session reported. Events of a subagent's own session are left
 * out, except for the tokens it used.
 */
export type HarnessEvent =
	/**
	 * The session's id, reported at its start and maybe again later, with
	 * the permission mode it fell back to when not the one asked for.
	 */
	| { kind: "session-id"; sessionId: string; permissionModeFallback?: string }
	/** `folder` is where the session runs, the Goal's worktree. */
	| { kind: "session-start"; model?: string; folder?: string }
	/**
	 * The agent's prose. `answer` marks prose that is the session's final
	 * answer unless later prose replaces it, for a CLI whose end doesn't
	 * carry the answer.
	 */
	| { kind: "prose"; text: string; answer?: true }
	| {
			kind: "tool-call";
			callId: string;
			call: HarnessToolCall;
			startedAt?: Date;
	  }
	| {
			kind: "tool-result";
			callId: string;
			/** The result's text when the call failed; absent when it didn't. */
			error?: string;
			outcome?: HarnessToolOutcome;
	  }
	/** A refused call, which gets no result of its own to show. */
	| { kind: "denied"; callId?: string; tool: string; reason: string }
	/** The end of a call that was sent to the background. */
	| {
			kind: "background-ended";
			callId: string;
			state: "completed" | "failed" | "stopped";
	  }
	/**
	 * What one model message has used so far. A later usage of the same
	 * `messageId` replaces the earlier one.
	 */
	| {
			kind: "usage";
			messageId: string;
			model: string;
			tokens: HarnessTokenUsage;
	  }
	/** How the session ended, with the numbers it reported. */
	| {
			kind: "session-end";
			/** The CLI's word for how the session failed; absent when it finished. */
			failure?: string;
			/** The session's final answer. */
			resultText?: string;
			durationMs?: number;
			turns?: number;
			/** Input, cached input included, and output. */
			tokens?: { input: number; output: number };
			costUsd?: number;
			/**
			 * What the session used, for a CLI that reports no cost: the cost
			 * is counted from it and the CLI's prices.
			 */
			usage?: HarnessModelUsage;
	  };

/** A tool call, by what it does rather than by the CLI's name for its tool. */
export type HarnessToolCall =
	| { tool: "execute"; command: string; description?: string }
	| { tool: "read"; path: string }
	| { tool: "edit"; path: string; oldText: string; newText: string }
	| { tool: "write"; path: string; content: string }
	| { tool: "skill"; name: string }
	| { tool: "search"; pattern: string }
	| { tool: "find"; pattern: string }
	| { tool: "agent"; description: string }
	| { tool: "plan"; todos: number }
	| { tool: "fetch"; url: string }
	/** A file a call added, updated or deleted, for a CLI that says no more. */
	| { tool: "file-change"; path: string; change: "add" | "update" | "delete" }
	/** Any other tool, shown by the CLI's name for it. */
	| { tool: "other"; name: string };

/**
 * What a call's result reports besides its text. Each applies only to the
 * calls it names; any other call ignores it.
 */
export type HarnessToolOutcome =
	/** A read's file. */
	| { kind: "read"; content: string }
	/** An edit's or a write's changes to a file that was there. */
	| { kind: "patched"; hunks: HarnessDiffHunk[] }
	/** A write's new file. */
	| { kind: "created"; content: string }
	/** The files a command edited. */
	| {
			kind: "edited-files";
			files: { path: string; hunks: HarnessDiffHunk[] }[];
	  }
	/** A command that went on running in the background. */
	| { kind: "sent-to-background" }
	/** A Skill loaded, by its name when the result gives it. */
	| { kind: "skill-loaded"; name?: string };

/** A unified diff's hunk, each line with its `+`, `-` or ` `. */
export type HarnessDiffHunk = {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: string[];
};

/** Tokens a model used. */
export type HarnessModelUsage = { model: string; tokens: HarnessTokenUsage };

/** Input tokens are split by how the cache priced them. */
export type HarnessTokenUsage = {
	/** Input neither read from nor written to the cache. */
	input: number;
	output: number;
	cacheRead: number;
	/** Input written to a cache entry that lasts minutes. */
	cacheWrite: number;
	/** Input written to a cache entry that lasts an hour. */
	cacheWriteHour: number;
};

/**
 * Dollars per million tokens of the models whose id is `model`, or `model`
 * with a date or a context size after it, such as `claude-haiku-4-5-20251001`.
 */
export type ModelPrice = {
	model: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cacheWriteHour: number;
};

/** The `Harness` that drives `cli`, reading its stream through `cli.events`. */
export function harnessFromCli(cli: HarnessCli): Harness {
	return {
		title: cli.title,
		program: cli.program,
		command: cli.command,
		resumeCommand: cli.resumeCommand,
		interactiveReadOnlyCommand: cli.interactiveReadOnlyCommand,
		readLine: (line, command) =>
			sessionReport(cli.events(line, command), cli.prices),
		runActivity: (lines, root) =>
			runActivity(
				lines.flatMap((line) => cli.events(line, [])),
				root,
				cli.prices,
			),
		interactiveTranscript: cli.interactiveTranscript,
		transcriptSession: cli.transcriptSession,
		readTranscript: (lines) => {
			const { costUsd } = spentSoFar(cli.transcriptUsage(lines), cli.prices);
			return {
				answers: cli.transcriptAnswers(lines),
				...(costUsd === undefined ? {} : { costUsd }),
			};
		},
		resumeHint: cli.resumeHint,
	};
}

// Fields an event doesn't carry are left out, so the kernel's spreading a
// later line's report keeps an earlier line's answer.
function sessionReport(
	events: HarnessEvent[],
	prices: ModelPrice[],
): HarnessSessionReport {
	let report: HarnessSessionReport = {};
	for (const event of events) {
		if (event.kind === "prose" && event.answer) {
			report = { ...report, resultText: event.text };
		} else if (event.kind === "denied") {
			report = { ...report, permissionDenied: true };
		} else if (event.kind === "session-id") {
			// Left out in the mode asked for, so a later event can't clear a
			// fallback reported earlier.
			report = {
				...report,
				sessionId: event.sessionId,
				...(event.permissionModeFallback === undefined
					? {}
					: { permissionModeFallback: event.permissionModeFallback }),
			};
		} else if (event.kind === "session-end") {
			const costUsd = sessionCost(event, prices);
			report = {
				...report,
				...(event.resultText === undefined
					? {}
					: { resultText: event.resultText }),
				...(costUsd === undefined ? {} : { costUsd }),
				...(event.tokens === undefined ? {} : { tokens: event.tokens }),
			};
		}
	}
	return report;
}

function runActivity(
	events: HarnessEvent[],
	root: string,
	prices: ModelPrice[],
): RunActivity {
	// One item per call while the events are read, so a result can turn its
	// call into another item; calls of one verb are folded at the end.
	const items: RunActivityItem[] = [];
	// The session's folder, the Goal's worktree, which mirrors the Project:
	// paths under it or `root` are shown relative to the Project.
	let folder = root;
	let ended = false;
	// Calls waiting for their result, by callId.
	const waiting = new Map<
		string,
		{ use: HarnessToolCall; item: RunToolCalls }
	>();
	// A refused call's result repeats the refusal, so it isn't shown.
	const refused = new Set<string>();
	// Commands sent to the background, by the callId that sent them.
	const background = new Map<string, RunBackgroundTask>();
	// The latest usage of each message, by its id, and its model.
	const messages = new Map<string, HarnessModelUsage>();
	for (const event of events) {
		switch (event.kind) {
			case "session-start":
				folder = event.folder ?? folder;
				items.push({ kind: "session-start", model: event.model ?? "" });
				break;
			case "prose":
				if (event.text.trim() !== "") {
					items.push({ kind: "prose", lines: proseLines(event.text) });
				}
				break;
			case "tool-call": {
				const { verb, files, call } = toolCall(event.call, [folder, root]);
				if (event.startedAt !== undefined) call.runningSince = event.startedAt;
				const item: RunToolCalls = {
					kind: "tool-calls",
					verb,
					files,
					calls: [call],
				};
				items.push(item);
				waiting.set(event.callId, { use: event.call, item });
				break;
			}
			case "tool-result": {
				const caller = waiting.get(event.callId);
				waiting.delete(event.callId);
				if (caller !== undefined) {
					const answered = resultItem(caller, event.outcome, [folder, root]);
					items[items.indexOf(caller.item)] = answered;
					if (answered.kind === "background-task") {
						background.set(event.callId, answered);
					}
				}
				if (event.error !== undefined && !refused.has(event.callId)) {
					items.push({
						kind: "failed-result",
						firstLine: firstLine(event.error),
					});
				}
				break;
			}
			case "denied":
				if (event.callId !== undefined) refused.add(event.callId);
				items.push({ kind: "denied", tool: event.tool, reason: event.reason });
				break;
			case "background-ended": {
				const task = background.get(event.callId);
				if (task !== undefined) task.state = event.state;
				break;
			}
			case "usage":
				messages.set(event.messageId, {
					model: event.model,
					tokens: event.tokens,
				});
				break;
			case "session-end":
				ended = true;
				items.push({
					kind: "session-end",
					...(event.failure === undefined ? {} : { failure: event.failure }),
					durationMs: event.durationMs,
					turns: event.turns,
					tokens:
						event.tokens === undefined
							? undefined
							: event.tokens.input + event.tokens.output,
					costUsd: sessionCost(event, prices),
				});
				break;
		}
	}
	return {
		items: foldCalls(items),
		working: !ended && waiting.size === 0,
		spent: spentSoFar([...messages.values()], prices),
	};
}

// The verb a call shows by, whether it works on one file, and what it
// worked on.
function toolCall(
	use: HarnessToolCall,
	folders: string[],
): { verb: string; files: boolean; call: RunToolCall } {
	switch (use.tool) {
		case "execute":
			return {
				verb: "Execute",
				files: false,
				call: { subject: use.description ?? firstLine(use.command) },
			};
		case "read":
			return {
				verb: "Read",
				files: true,
				call: { subject: relativePath(use.path, folders) },
			};
		case "edit":
			return {
				verb: "Edit",
				files: true,
				call: {
					subject: relativePath(use.path, folders),
					size: `+${lineCount(use.newText)} −${lineCount(use.oldText)}`,
				},
			};
		case "write":
			return {
				verb: "Write",
				files: true,
				call: {
					subject: relativePath(use.path, folders),
					size: `${lineCount(use.content)} lines`,
				},
			};
		case "skill":
			return { verb: "Skill", files: false, call: { subject: use.name } };
		case "search":
			return { verb: "Search", files: false, call: { subject: use.pattern } };
		case "find":
			return { verb: "Find", files: false, call: { subject: use.pattern } };
		case "agent":
			return {
				verb: "Agent",
				files: false,
				call: { subject: use.description },
			};
		case "plan":
			return {
				verb: "Plan",
				files: false,
				call: { subject: "", size: `${use.todos} todos` },
			};
		case "fetch":
			return { verb: "Fetch", files: false, call: { subject: use.url } };
		case "file-change":
			return {
				verb: { add: "Write", update: "Edit", delete: "Delete" }[use.change],
				files: true,
				call: { subject: relativePath(use.path, folders) },
			};
		case "other":
			return { verb: use.name, files: false, call: { subject: "" } };
	}
}

// What a call shows as once its result is in: an edit of each file a
// command changed, a background task, a loaded Skill, or the call itself,
// no longer running, with what its result adds to it: a read's size, an
// edit's or a write's diff.
function resultItem(
	caller: { use: HarnessToolCall; item: RunToolCalls },
	outcome: HarnessToolOutcome | undefined,
	folders: string[],
): RunActivityItem {
	const { use, item } = caller;
	const call = item.calls[0];
	if (call === undefined) return item;
	delete call.runningSince;
	if (use.tool === "execute" && outcome?.kind === "edited-files") {
		return {
			kind: "tool-calls",
			verb: "Edit",
			files: true,
			calls: outcome.files.map(({ path, hunks }) => {
				const diff = diffLines(hunks);
				const added = diff.filter((line) => line.kind === "added").length;
				const removed = diff.filter((line) => line.kind === "removed").length;
				return {
					subject: relativePath(path, folders),
					size: `+${added} −${removed}`,
					diff,
				};
			}),
		};
	}
	if (use.tool === "execute" && outcome?.kind === "sent-to-background") {
		return { kind: "background-task", subject: call.subject, state: "running" };
	}
	if (use.tool === "skill" && outcome?.kind === "skill-loaded") {
		return { kind: "skill-loaded", name: outcome.name ?? call.subject };
	}
	if (use.tool === "read" && outcome?.kind === "read") {
		call.size = `${lineCount(outcome.content)} lines`;
	}
	if (use.tool === "edit" || use.tool === "write") {
		if (outcome?.kind === "created") {
			call.diff = diffLines([createdHunk(outcome.content)]);
		} else if (outcome?.kind === "patched" && outcome.hunks.length > 0) {
			call.diff = diffLines(outcome.hunks);
		}
	}
	return item;
}

// A new file's one hunk, every line of `content` added.
function createdHunk(content: string): HarnessDiffHunk {
	const lines = content === "" ? [] : content.replace(/\n$/, "").split("\n");
	return {
		oldStart: 0,
		oldLines: 0,
		newStart: 1,
		newLines: lines.length,
		lines: lines.map((line) => `+${line}`),
	};
}

function diffLines(hunks: HarnessDiffHunk[]): RunDiffLine[] {
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

// The cost the session's end reports, or else the cost of the usage it
// reports.
function sessionCost(
	end: { costUsd?: number; usage?: HarnessModelUsage },
	prices: ModelPrice[],
): number | undefined {
	if (end.costUsd !== undefined || end.usage === undefined) return end.costUsd;
	return usageCost(end.usage, prices);
}

// The tokens `messages` used and what they cost, the cost left out when a
// message's model has no price.
function spentSoFar(
	messages: HarnessModelUsage[],
	prices: ModelPrice[],
): { tokens: number; costUsd?: number } {
	let tokens = 0;
	let costUsd: number | undefined = 0;
	for (const message of messages) {
		const used = message.tokens;
		tokens +=
			used.input +
			used.output +
			used.cacheRead +
			used.cacheWrite +
			used.cacheWriteHour;
		const cost = usageCost(message, prices);
		costUsd =
			cost === undefined || costUsd === undefined ? undefined : costUsd + cost;
	}
	return costUsd === undefined ? { tokens } : { tokens, costUsd };
}

// What `tokens` of `model` cost, undefined when the model has no price.
function usageCost(
	{ model, tokens }: HarnessModelUsage,
	prices: ModelPrice[],
): number | undefined {
	const price = prices.find(
		(price) =>
			model === price.model ||
			model.startsWith(`${price.model}-`) ||
			model.startsWith(`${price.model}[`),
	);
	if (price === undefined) return undefined;
	return (
		(tokens.input * price.input +
			tokens.output * price.output +
			tokens.cacheRead * price.cacheRead +
			tokens.cacheWrite * price.cacheWrite +
			tokens.cacheWriteHour * price.cacheWriteHour) /
		1_000_000
	);
}

// `path` relative to the first of `folders` it is under, or as it is.
function relativePath(path: string, folders: string[]): string {
	const folder = folders.find((folder) => path.startsWith(`${folder}/`));
	return folder === undefined ? path : path.slice(folder.length + 1);
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
