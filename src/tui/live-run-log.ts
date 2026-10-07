// Reading a growing Run log for a view: the whole log at first, then only
// what it adds, every second. Hides the re-read and how a log switched to
// mid-read is handled.

import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { readRunLog } from "../tickets/tickets.ts";

// How often the shown log is read again: what it adds shows within this.
const refreshMs = 1000;

/** A log as read so far. */
export type ShownLog = {
	/** The log's path, which tells one log from another. */
	log: string;
	text: string;
	/** The bytes of the log `text` holds, to skip on the next read. */
	end: number;
};

/**
 * The log at the path `log` gives, undefined until the first read of it
 * ends, so another log's text never shows in its place. Read again every
 * second for as long as the calling component lives, each read taking only
 * what the log added since the last.
 */
export function liveRunLog(
	log: () => string | undefined,
): () => ShownLog | undefined {
	const [shown, setShown] = createSignal<ShownLog>();
	let reading = false;
	const read = async () => {
		const path = log();
		if (path === undefined || reading) return;
		reading = true;
		try {
			const last = shown();
			const before = last?.log === path ? last : undefined;
			const piece = await readRunLog(path, before?.end ?? 0);
			if (before !== undefined && piece.added === "") return;
			setShown({
				log: path,
				text: (before?.text ?? "") + piece.added,
				end: piece.end,
			});
		} finally {
			reading = false;
		}
		// Another log picked during the read is read now, not a refresh later.
		if (log() !== path) read();
	};
	createEffect(on(log, read));
	const timer = setInterval(read, refreshMs);
	onCleanup(() => clearInterval(timer));
	return () => {
		const last = shown();
		return last?.log === log() ? last : undefined;
	};
}
