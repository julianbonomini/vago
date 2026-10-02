// The Claude Code Harness: the `claude -p` command and how its stream-json
// events are read. Hides Claude Code's flags and event shapes.

import { z } from "zod";
import type { Harness } from "./registry.ts";

// Never --dangerously-skip-permissions: loosening the guard is always the
// human's explicit choice, never Punt's.
const guardedMode = "auto";

// Claude Code reports its permission mode at startup and again in a status
// event when it changes, as it does when the model doesn't offer auto mode.
const SessionEvent = z.object({
	type: z.literal("system"),
	subtype: z.enum(["init", "status"]),
	session_id: z.string(),
	permissionMode: z.string().optional(),
});

const PermissionDeniedEvent = z.object({
	type: z.literal("system"),
	subtype: z.literal("permission_denied"),
});

const ResultEvent = z.object({
	type: z.literal("result"),
	// Absent when the session ended in an error rather than an answer.
	result: z.string().optional(),
	total_cost_usd: z.number().optional(),
	usage: z.object({
		input_tokens: z.number(),
		output_tokens: z.number(),
		cache_creation_input_tokens: z.number().default(0),
		cache_read_input_tokens: z.number().default(0),
	}),
});

/**
 * Claude Code, run headless in its `auto` permission mode. Its stream
 * reports a fallback from `auto` and every tool call Claude Code refused.
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
	readLine(line) {
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			return {};
		}
		if (PermissionDeniedEvent.safeParse(event).success) {
			return { permissionDenied: true };
		}
		const session = SessionEvent.safeParse(event);
		if (session.success) {
			const { session_id, permissionMode } = session.data;
			// Left out in the guarded mode, so a later event can't clear a
			// fallback reported earlier.
			if (permissionMode === undefined || permissionMode === guardedMode) {
				return { sessionId: session_id };
			}
			return { sessionId: session_id, permissionModeFallback: permissionMode };
		}
		const result = ResultEvent.safeParse(event);
		if (!result.success) return {};
		const { usage } = result.data;
		return {
			resultText: result.data.result,
			costUsd: result.data.total_cost_usd,
			// Cached input still went through the model, so it counts as input.
			tokens: {
				input:
					usage.input_tokens +
					usage.cache_creation_input_tokens +
					usage.cache_read_input_tokens,
				output: usage.output_tokens,
			},
		};
	},
	resumeHint(sessionId) {
		return `claude --resume ${sessionId}`;
	},
};
