// How the TUI spells a stretch of time, a time of day, a day, dollars and a
// count of tokens, so every view spells them alike.

/** The largest two units of `ms`, like `13h 36m`, `25m 52s` or `0s`. */
export function duration(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

/** Dollars to the cent, like `$3.70`. */
export function money(usd: number): string {
	return `$${usd.toFixed(2)}`;
}

/** The hour and minute of `time` in the local time zone, like `09:05`. */
export function clock(time: Date): string {
	return time.toTimeString().slice(0, 5);
}

/** The day of `time` in the local time zone, like `2026-09-30`. */
export function day(time: Date): string {
	const month = String(time.getMonth() + 1).padStart(2, "0");
	const date = String(time.getDate()).padStart(2, "0");
	return `${time.getFullYear()}-${month}-${date}`;
}

/** A count of tokens to three figures, like `950`, `12.3k` or `29.7M`. */
export function tokenCount(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
	return `${tokens}`;
}
