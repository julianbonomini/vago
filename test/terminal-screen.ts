// Test helper: the screen a terminal would show for what a program printed
// to it, so a test can read the frames a full-screen program drew. It knows
// cursor moves, erasing, the alternate screen and scrolling, and skips colour
// and every other mode.

/** A terminal's screen, fed what the program printed. */
export type TerminalScreen = {
	/** Draws `bytes`, the next output of the program, on the screen. */
	write(bytes: Uint8Array): void;
	/**
	 * Waits until the program has printed nothing for about 100 ms and the
	 * screen's lines pass `test`, and returns them. Throws, showing the last
	 * lines, after `timeoutMs`.
	 */
	frameWhere(
		test: (lines: string[]) => boolean,
		timeoutMs?: number,
	): Promise<string[]>;
	/** Everything the program printed, decoded, escape sequences included. */
	printed(): string;
	/** How often the screen scrolled up a line, from a newline or a wrap on its last row. */
	scrolls(): number;
};

const quietMs = 100;

/** An empty screen of `rows` rows of `cols` cells. */
export function terminalScreen(rows: number, cols: number): TerminalScreen {
	const decoder = new TextDecoder();
	const blankRow = () => Array<string>(cols).fill(" ");
	let grid = Array.from({ length: rows }, blankRow);
	let row = 0;
	let col = 0;
	// Set after a character lands in the last column: the next one wraps.
	let pendingWrap = false;
	let printed = "";
	let unparsed = "";
	let scrolls = 0;
	let lastOutput = Date.now();

	const clampCursor = () => {
		row = Math.max(0, Math.min(rows - 1, row));
		col = Math.max(0, Math.min(cols - 1, col));
		pendingWrap = false;
	};
	const lineFeed = () => {
		if (row < rows - 1) {
			row++;
			return;
		}
		grid = [...grid.slice(1), blankRow()];
		scrolls++;
	};
	const put = (char: string) => {
		const width = Bun.stringWidth(char);
		if (width === 0) return;
		if (pendingWrap || col + width > cols) {
			col = 0;
			lineFeed();
			pendingWrap = false;
		}
		const cells = grid[row] ?? blankRow();
		cells[col] = char;
		if (width === 2 && col + 1 < cols) cells[col + 1] = "";
		if (col + width >= cols) pendingWrap = true;
		else col += width;
	};
	const eraseInLine = (mode: number) => {
		const cells = grid[row] ?? blankRow();
		const [from, to] =
			mode === 0 ? [col, cols] : mode === 1 ? [0, col + 1] : [0, cols];
		cells.fill(" ", from, to);
	};
	const eraseInDisplay = (mode: number) => {
		eraseInLine(mode);
		const [from, to] =
			mode === 0 ? [row + 1, rows] : mode === 1 ? [0, row] : [0, rows];
		for (let index = from; index < to; index++) grid[index] = blankRow();
	};
	const controlSequence = (params: string, final: string) => {
		const numbers = params.split(";").map((part) => Number(part) || 0);
		const first = numbers[0] ?? 0;
		const count = Math.max(1, first);
		if (params.startsWith("?")) {
			// The alternate screen starts empty; leaving it, the test no longer reads frames.
			if (params === "?1049" && final === "h") eraseInDisplay(2);
			return;
		}
		if (final === "H" || final === "f") {
			row = Math.max(1, first) - 1;
			col = Math.max(1, numbers[1] ?? 1) - 1;
		} else if (final === "A") row -= count;
		else if (final === "B") row += count;
		else if (final === "C") col += count;
		else if (final === "D") col -= count;
		else if (final === "G") col = count - 1;
		else if (final === "d") row = count - 1;
		else if (final === "K") eraseInLine(first);
		else if (final === "J") eraseInDisplay(first);
		else return;
		clampCursor();
	};
	// The length of the escape sequence that `body` starts, after its ESC,
	// drawing it when it's a control sequence. Undefined when it's cut off.
	const escapeLength = (body: string): number | undefined => {
		if (body.startsWith("[")) {
			const sequence = /^\[([0-9;?<=>]*)[ -/]*([@-~])/.exec(body);
			if (sequence === null) return undefined;
			controlSequence(sequence[1] ?? "", sequence[2] ?? "");
			return sequence[0].length;
		}
		// A string, such as a window title, that BEL or ESC \ ends.
		if (/^[\]P_^]/.test(body)) {
			for (let index = 1; index < body.length; index++) {
				if (body[index] === "\x07") return index + 1;
				if (body.startsWith("\x1b\\", index)) return index + 2;
			}
			return undefined;
		}
		return /^[ -/]*[0-~]/.exec(body)?.[0].length;
	};
	// Draws what it can of `unparsed`, and keeps an escape sequence cut off at
	// the end of a chunk for the next one.
	const parse = () => {
		let index = 0;
		while (index < unparsed.length) {
			const rest = unparsed.slice(index);
			if (rest.startsWith("\x1b")) {
				const length = escapeLength(rest.slice(1));
				if (length === undefined) break;
				index += 1 + length;
				continue;
			}
			const char = String.fromCodePoint(rest.codePointAt(0) ?? 0);
			index += char.length;
			if (char === "\r") {
				col = 0;
				pendingWrap = false;
			} else if (char === "\n") {
				lineFeed();
				pendingWrap = false;
			} else if (char === "\b") {
				col = Math.max(0, col - 1);
			} else if (char >= " ") {
				put(char);
			}
		}
		unparsed = unparsed.slice(index);
	};
	const lines = () => grid.map((cells) => cells.join("").trimEnd());

	return {
		write(bytes) {
			const text = decoder.decode(bytes, { stream: true });
			printed += text;
			unparsed += text;
			lastOutput = Date.now();
			parse();
		},
		async frameWhere(test, timeoutMs = 10_000) {
			const deadline = Date.now() + timeoutMs;
			for (;;) {
				if (Date.now() - lastOutput >= quietMs && test(lines())) {
					return lines();
				}
				if (Date.now() > deadline) {
					throw new Error(`No frame passed the test:\n${lines().join("\n")}`);
				}
				await Bun.sleep(20);
			}
		},
		printed: () => printed,
		scrolls: () => scrolls,
	};
}
