// Every text colour in tokens.css reads at WCAG AA (4.5:1) on every surface it's drawn on, in both themes.
import { expect, test } from "bun:test";
import { join } from "node:path";

const css = await Bun.file(
	join(import.meta.dir, "..", "src", "styles", "tokens.css"),
).text();

// The custom properties a rule block sets, by name without the leading --v-.
function tokensIn(selector: string): Map<string, string> {
	const block = css.split(`${selector} {`)[1]?.split("}")[0];
	if (block === undefined)
		throw new Error(`No ${selector} block in tokens.css`);
	return new Map(
		[...block.matchAll(/--v-([\w-]+):\s*(#[0-9a-f]{6});/g)].map(
			([, name = "", hex = ""]) => [name, hex],
		),
	);
}

function luminance(hex: string): number {
	const channels = [1, 3, 5].map(
		(i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255,
	);
	const [r = 0, g = 0, b = 0] = channels.map((c) =>
		c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// Each group of text colours and the surfaces they sit on.
const pairs = [
	{
		texts: ["fg", "bright", "grey", "accent", "ok", "bad"],
		surfaces: ["bg", "raised", "band", "code"],
	},
	{ texts: ["bg"], surfaces: ["bright"] },
	{ texts: ["on-accent"], surfaces: ["accent-fill", "accent-hover"] },
	{
		texts: ["t-fg", "t-bright", "t-grey", "t-ok", "t-bad"],
		surfaces: ["t-bg", "t-raised"],
	},
];

const light = tokensIn(":root");
const themes = {
	light,
	dark: new Map([...light, ...tokensIn(':root[data-theme="dark"]')]),
};

test("every text pair in both themes is at least 4.5:1", () => {
	const failing: string[] = [];
	for (const [theme, tokens] of Object.entries(themes)) {
		for (const { texts, surfaces } of pairs) {
			for (const text of texts) {
				for (const surface of surfaces) {
					const fg = tokens.get(text);
					const bg = tokens.get(surface);
					if (fg === undefined || bg === undefined)
						failing.push(`${theme}: --v-${text} or --v-${surface} missing`);
					else if (contrast(fg, bg) < 4.5)
						failing.push(
							`${theme}: --v-${text} on --v-${surface} ${contrast(fg, bg).toFixed(2)}`,
						);
				}
			}
		}
	}
	expect(failing).toEqual([]);
});
