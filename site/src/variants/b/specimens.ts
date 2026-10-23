// PROTOTYPE: turns the real captures and files into the HTML the specimens
// print, with the TUI's status colours as spans. Throw away with variant B.

import smallToml from "../../samples/small.toml?raw";
import tuiProject from "../../samples/tui-project.txt?raw";

function escape(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function span(cls: string, text: string): string {
	return `<span class="${cls}">${text}</span>`;
}

// Glyphs the mono font lacks fall back to another font with other widths,
// so each one is pinned to a single cell.
function cells(text: string): string {
	return [...text].map((c) => `<span class="g">${c}</span>`).join("");
}

/** The project view, without its padding rows and the prototype's switcher. */
export function projectView(): string {
	const lines = tuiProject
		.split("\n")
		.map((line) => line.replace(/◂ \{.*\} ▸/, "").trimEnd())
		.filter((line) => !/^│\s*│$/.test(line))
		.filter((line, i, all) => !(line === "" && i === all.length - 1));
	return lines
		.map((raw) => {
			let line = escape(raw);
			line = line.replace(/[┌┐└┘─│]+/g, (m) => span("t-line", m));
			line = line.replace("⁘ Vago", span("t-acc", "⁘ Vago"));
			line = line.replace(/✓ done/, span("t-ok", "✓ done"));
			line = line.replace(/✗ stuck/, span("t-bad", "✗ stuck"));
			line = line.replace(/\? lost/, span("t-warn", "? lost"));
			line = line.replace(/(▰+)/, (m) => span("t-ok", cells(m)));
			line = line.replace(/(▱+)/, (m) => span("t-faint", cells(m)));
			line = line.replace(/⁘|↑↓/g, (m) => cells(m));
			line = line.replace(
				/(STATE|GOAL|TICKETS|ELAPSED|COST|NOW)/g,
				(m) => span("t-dim", m),
			);
			line = line.replace(/(↑↓|Enter|\?(?= Help)| q )/g, (m) =>
				span("t-bright", m),
			);
			return line;
		})
		.join("\n");
}

/** small.toml without comments, one HTML block per table, settings first. */
export function smallWorkflow(): string[] {
	const lines = smallToml
		.split("\n")
		.filter((line) => !line.startsWith("#"))
		.map((line) => line.replace(/\s+#.*$/, ""))
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return lines.split("\n\n").map((block) =>
		block
			.split("\n")
			.map((raw) => {
				const line = escape(raw);
			if (line.startsWith("[[")) return span("f-table", line);
			const kv = line.match(/^(\w+)(\s*=\s*)(.*)$/);
			if (kv === null) return line;
			const [, key = "", eq = "", value = ""] = kv;
			const cls = key === "type" ? "f-type" : "f-val";
				return `${span("f-key", key)}${eq}${span(cls, value)}`;
			})
			.join("\n"),
	);
}
