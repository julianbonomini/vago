// The landing page's hero carries the live TUI: its first screen drawn into the HTML, so it shows before
// any script runs and with reduced motion, its row of keys to tap, and a caption saying it's a replay.
import { expect, test } from "bun:test";
import { servedAt } from "./built-site.ts";

const landing = servedAt("/") ?? "";
const tui = landing.split("data-live-tui")[1] ?? "";

test("the hero draws the TUI's first screen into the page", () => {
	const rows = [...tui.matchAll(/<div class="row" data-row>(.*?)<\/div>/g)];
	const text = rows
		.map(([, html = ""]) => html.replace(/<[^>]+>/g, ""))
		.join("\n");
	expect(rows.length).toBe(34);
	expect(text).toContain("acme-shop");
	expect(text).toContain("gift-cards");
});

test("the hero's TUI has a key row with Vago's keys", () => {
	const keys = [...tui.matchAll(/data-key="([^"]+)"/g)].map(([, key]) => key);
	expect(keys).toEqual(
		expect.arrayContaining([
			"ArrowUp",
			"ArrowDown",
			"Enter",
			"Escape",
			"[",
			"]",
			"Tab",
			"?",
		]),
	);
});

test("the hero says the TUI replays an example Project", () => {
	expect(tui).toMatch(/replay/i);
	expect(tui).toContain("example Project");
});
