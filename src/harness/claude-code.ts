// The Claude Code Harness: the `claude -p` command and how its stream-json
// events are read. Hides Claude Code's flags and event shapes.

import { z } from "zod";
import type { Harness } from "./registry.ts";

const InitEvent = z.object({
	type: z.literal("system"),
	subtype: z.literal("init"),
	session_id: z.string(),
});

const ResultEvent = z.object({
	type: z.literal("result"),
	total_cost_usd: z.number().optional(),
	usage: z.object({
		input_tokens: z.number(),
		output_tokens: z.number(),
		cache_creation_input_tokens: z.number().default(0),
		cache_read_input_tokens: z.number().default(0),
	}),
});

/** Claude Code, run headless in its `auto` permission mode. */
export const claudeCode: Harness = {
	command(model) {
		// Never --dangerously-skip-permissions: loosening the guard is always
		// the human's explicit choice, never Punt's.
		return [
			"claude",
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--permission-mode",
			"auto",
			"--model",
			model,
		];
	},
	readLine(line) {
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			return {};
		}
		const init = InitEvent.safeParse(event);
		if (init.success) return { sessionId: init.data.session_id };
		const result = ResultEvent.safeParse(event);
		if (!result.success) return {};
		const { usage } = result.data;
		return {
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
