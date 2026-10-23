// PROTOTYPE: turns the TUI text captures into HTML lines painted in the
// theme's colours (src/tui/theme.ts). Trims what the brief asked to trim:
// the prototype's variant switcher, the empty padding rows and the joke
// fixture Ticket titles.

import projectRaw from "../../samples/tui-project.txt?raw";
import goalRaw from "../../samples/tui-goal.txt?raw";

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const dropSwitcher = (line: string) => {
	const at = line.indexOf("◂ {");
	return at === -1 ? line : line.slice(0, at).trimEnd();
};

const isEmptyRow = (s: string) => /^│\s+│$/.test(s);

// Colour runs of box-drawing lines, status marks and bars.
function paint(line: string, focusTitle: string): string {
	let h = esc(line);
	h = h.replace(/[┌┐└┘─│]+/g, (m) => `<span class="c-l">${m}</span>`);
	h = h.replace(
		/(<span class="c-l">[┌─]+<\/span>) ([^<]+?) (<span class="c-l">)/g,
		(_m, a, title, b) =>
			`${a} <span class="${title === focusTitle ? "c-a" : "c-x"}">${title}</span> ${b}`,
	);
	h = h.replace(/✓( done)?/g, (m) => `<span class="c-o">${m}</span>`);
	h = h.replace(/✗( stuck)?/g, (m) => `<span class="c-r">${m}</span>`);
	h = h.replace(/\? lost/g, (m) => `<span class="c-w">${m}</span>`);
	h = h.replace(/▰+/g, (m) => `<span class="c-o">${m}</span>`);
	h = h.replace(/▱+/g, (m) => `<span class="c-f">${m}</span>`);
	h = h.replace(/\bok\b/g, `<span class="c-o">ok</span>`);
	h = h.replace(/⁘/g, `<span class="c-a">⁘</span>`);
	return h;
}

function footer(line: string): string {
	return line
		.split(/ {3,}/)
		.map((part) => {
			const [key, ...rest] = part.trim().split(" ");
			return `<span class="c-x">${esc(key ?? "")}</span> <span class="c-d">${esc(rest.join(" "))}</span>`;
		})
		.join("   ");
}

// Symbols the mono font lacks fall back to another font with another
// width, so each gets a cell of exactly one character.
const cell = (h: string) =>
	h.replace(/[✓✗○●▰▱⁘↑↓→↻]/g, (c) => `<i class="vc-g">${c}</i>`);

export function projectView(): string[] {
	return projectLines().map(cell);
}

export function goalView(): string[] {
	return goalLines().map(cell);
}

function projectLines(): string[] {
	const lines = projectRaw.replace(/\n$/, "").split("\n").map(dropSwitcher);
	const out: string[] = [];
	let blanks = 0;
	lines.forEach((line, i) => {
		if (i === 1) return; // blank row under the header
		if (isEmptyRow(line)) {
			if (++blanks > 1) return;
		}
		if (i === 0) {
			out.push(
				esc(line)
					.replace("⁘ Vago", '<span class="c-a">⁘</span> <span class="c-x">Vago</span>')
					.replace(/(vago · .*)$/, '<span class="c-d">$1</span>'),
			);
			return;
		}
		if (i === lines.length - 1) {
			out.push(` ${footer(line)}`);
			return;
		}
		if (line.includes("STATE    GOAL")) {
			out.push(
				line.replace(/^│(.*)│$/, (_m, mid) => `<span class="c-l">│</span><span class="c-d">${esc(mid)}</span><span class="c-l">│</span>`),
			);
			return;
		}
		if (line.includes("lost-goal")) {
			// The selected row: bold white on the deep orange.
			const mid = line.slice(1, -1);
			out.push(
				`<span class="c-l">│</span><span class="c-sel">${esc(mid)}</span><span class="c-l">│</span>`,
			);
			return;
		}
		if (line.includes("Retry a Run")) {
			out.push(line.replace(/^│(.*)│$/, (_m, mid) => `<span class="c-l">│</span><span class="c-x">${esc(mid)}</span><span class="c-l">│</span>`));
			return;
		}
		if (line.includes("Workflow try-hard")) {
			out.push(line.replace(/^│(.*)│$/, (_m, mid) => `<span class="c-l">│</span><span class="c-d">${esc(mid)}</span><span class="c-l">│</span>`));
			return;
		}
		out.push(paint(line, "Goals"));
	});
	return out;
}

const jokeTitles = [" 03 A very long", "ワークフロー", "Emoji in a title"];
const fixtureBody = ["fixture text", "pane has something", "wrap at eighty"];

function goalLines(): string[] {
	const lines = goalRaw.replace(/\n$/, "").split("\n").map(dropSwitcher);
	const top = lines.findIndex((l) => l.includes("┐┌"));
	const split = (lines[top] ?? "").indexOf("┐┌") + 1;
	const bottom = lines.findIndex((l, i) => i > top && l.startsWith("└"));
	const left: string[] = [];
	const right: string[] = [];
	for (let i = top; i <= bottom; i++) {
		const l = lines[i] ?? "";
		// The scrollbar no longer matches the trimmed panes.
		const strip = (s: string) => s.replace(/[█▀] │$/, "  │").replace(/ [█▀] │$/, "   │");
		left.push(strip(l.slice(0, split)));
		right.push(strip(l.slice(split)));
	}
	const leftKept = left.filter(
		(l, i) =>
			!fixtureBody.some((f) => l.includes(f)) &&
			!(i > 0 && left[i - 1]?.includes("Acceptance") && isEmptyRow(l)),
	);
	// Put back the one sentence of the body that isn't about the fixture.
	const whatAt = leftKept.findIndex((l) => l.includes("What to build"));
	const width = (leftKept[0] ?? "").length;
	const body = "│   Goal report lists every Run with its cost.";
	leftKept.splice(whatAt + 2, 0, `${body.padEnd(width - 1)}│`);
	const rightKept = right.filter((l) => !jokeTitles.some((t) => l.includes(t)));
	// Match the column heights by dropping blank rows from the Ticket pane.
	while (leftKept.length > rightKept.length) {
		const at = leftKept.findLastIndex((l, i) => i > 0 && isEmptyRow(l));
		if (at === -1) break;
		leftKept.splice(at, 1);
	}

	const out: string[] = [];
	const head = lines[0] ?? "";
	out.push(
		esc(head)
			.replace("⁘", '<span class="c-a">⁘</span>')
			.replace("many-tickets", '<span class="c-x">many-tickets</span>')
			.replace(/(Time.*)$/, '<span class="c-d">$1</span>'),
	);
	out.push(paint(lines[1] ?? "", "").replace("○ READY", '<span class="c-x">○ READY</span>'));
	for (let i = 0; i < leftKept.length; i++) {
		const l = leftKept[i] ?? "";
		const r = rightKept[i] ?? "";
		let painted = paint(l, "Ticket 09") + paint(r, "Ticket 09");
		painted = painted
			.replace(/What to build|Acceptance criteria/, (m) => `<span class="c-x c-bold">${m}</span>`)
			.replace(/(2d 16h)/, '<span class="c-d">$1</span>');
		out.push(painted);
	}
	let runBlanks = 0;
	for (let i = bottom + 1; i < lines.length - 1; i++) {
		const l = lines[i] ?? "";
		if (isEmptyRow(l) && ++runBlanks > 1) continue;
		out.push(paint(l, "").replace(/→ \$ merge/, '<span class="c-d">→ $ merge</span>'));
	}
	out.push(` ${footer(lines[lines.length - 1] ?? "")}`);
	return out;
}
