// What the docs page tests read off a built page: its sidebar's links, the live TUIs it embeds, the
// `vago run` output its Markdown copy shows, and whether that output's numbers are the frames'.
import { type ReplayPlace, tuiFrames } from "../src/tui/tui-replay.ts";

function decodeEntities(html: string): string {
	return html
		.replaceAll("&#34;", '"')
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&amp;", "&");
}

/** The HTML of `html`'s sidebar, the one beside the page rather than the phone's menu. */
export function sidebarOf(html: string): string {
	return html.match(/<nav[^>]*aria-label="Docs"[\s\S]*?<\/nav>/)?.[0] ?? "";
}

/** The site path of every page under `section` (`/docs/`, `/agents/`) that `html`'s sidebar links to, in its
 *  order. */
export function sidebarLinks(html: string, section: string): string[] {
	return [...sidebarOf(html).matchAll(/href="([^"#]+)"/g)]
		.map(([, path = ""]) => path)
		.filter((path) => path.startsWith(section));
}

/** Each live TUI on `html`: where it starts, and the text of the first screen drawn into the page. */
export function liveTuis(html: string): { place: ReplayPlace; text: string }[] {
	return html
		.split("data-live-tui")
		.slice(1)
		.map((tui) => ({
			place: JSON.parse(
				decodeEntities(tui.match(/data-place="([^"]*)"/)?.[1] ?? "{}"),
			),
			text: decodeEntities(
				[...tui.matchAll(/<div class="row" data-row>(.*?)<\/div>/g)]
					.map(([, row = ""]) => row.replace(/<[^>]+>/g, ""))
					.join("\n"),
			),
		}));
}

/** The lines of the `vago run` output, the text block starting at its `Worktree` line, in Markdown `copy`. */
export function vagoRunOutput(copy: string): string[] {
	return copy.match(/```text\n(Worktree [\s\S]*?)```/)?.[1]?.split("\n") ?? [];
}

/** The times and costs on `lines` of `vago run` output that no captured frame shows. `vago run` writes
 *  3m34s where the TUI writes 3m 34s. */
export function numbersNotInFrames(lines: string[]): string[] {
	const frameText = tuiFrames.lines.map(({ text }) => text).join("\n");
	return lines
		.flatMap((line) => [
			...[...line.matchAll(/\b(\d+)m(\d\d)s\b/g)].map(
				([, minutes, seconds]) => `${minutes}m ${Number(seconds)}s`,
			),
			...(line.match(/\$\d+\.\d\d/g) ?? []),
		])
		.filter((text) => !frameText.includes(text));
}
