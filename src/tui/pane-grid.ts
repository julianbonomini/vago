// The panes' borders drawn as one grid of lines: where two panes share an
// edge it is one line, joined where lines meet, with each pane's titles on
// it and the focused pane's outline in the focus look. Hides the junction
// glyphs, the pass after each frame that draws them, and the order panes
// draw in, which no longer decides whose title or focus shows.

import {
	type BorderCharacters,
	type BoxRenderable,
	type CliRenderer,
	type ColorInput,
	type OptimizedBuffer,
	parseColor,
	type Renderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { onCleanup } from "solid-js";
import { theme } from "./theme.ts";

/**
 * How a pane's border is drawn: `title` on its top line from the left,
 * `bottomTitle` on its bottom line from the right, each left out when it
 * doesn't fit, in `titleColor`, or else the border's colour. A `focused`
 * pane's whole outline and titles are in the accent, its lines in the
 * theme's `focusBorder`.
 */
export type PaneLook = {
	title: string;
	bottomTitle?: string;
	titleColor?: ColorInput;
	focused: boolean;
};

/**
 * A ref for a `border`ed box, which makes it a pane of the screen's grid,
 * drawn with `look()` for as long as the calling component lives and the
 * box and its parents are visible. The box draws no title of its own. Two
 * panes share an edge by overlapping by `sharedLine` cells, a margin of
 * `-sharedLine` on the later.
 */
export function usePane(look: () => PaneLook): (box: BoxRenderable) => void {
	const grid = gridOf(useRenderer());
	const pane: GridPane = { box: undefined, look };
	grid.panes.add(pane);
	onCleanup(() => grid.panes.delete(pane));
	return (box) => {
		pane.box = box;
	};
}

/**
 * A ref for a box drawn over the panes, like the help screen: the grid
 * draws nothing under it while it lives and is visible.
 */
export function useCover(): (box: BoxRenderable) => void {
	const grid = gridOf(useRenderer());
	const cover: { box: BoxRenderable | undefined } = { box: undefined };
	grid.covers.add(cover);
	onCleanup(() => grid.covers.delete(cover));
	return (box) => {
		cover.box = box;
	};
}

/** The cells two panes that share an edge overlap by: their one line. */
export const sharedLine = 1;

type GridPane = { box: BoxRenderable | undefined; look: () => PaneLook };

type Grid = {
	panes: Set<GridPane>;
	covers: Set<{ box: BoxRenderable | undefined }>;
};

const grids = new WeakMap<CliRenderer, Grid>();

// One grid per renderer, drawn after every frame once its first pane asks.
function gridOf(renderer: CliRenderer): Grid {
	const known = grids.get(renderer);
	if (known !== undefined) return known;
	const grid: Grid = { panes: new Set(), covers: new Set() };
	grids.set(renderer, grid);
	renderer.addPostProcessFn((buffer) => drawGrid(grid, buffer));
	return grid;
}

type Rect = { x: number; y: number; width: number; height: number };

// The box's place on screen, undefined while it or a parent is hidden.
function shownRect(box: BoxRenderable | undefined): Rect | undefined {
	if (box === undefined || box.isDestroyed) return undefined;
	for (let at: Renderable | null = box; at !== null; at = at.parent) {
		if (!at.visible) return undefined;
	}
	return { x: box.x, y: box.y, width: box.width, height: box.height };
}

// The arms of a line glyph: the sides of its cell its lines reach.
const up = 1;
const down = 2;
const left = 4;
const right = 8;

function drawGrid(grid: Grid, buffer: OptimizedBuffer): void {
	const { color, border, focusBorder } = theme();
	const covers = [...grid.covers].flatMap(({ box }) => {
		const rect = shownRect(box);
		return rect === undefined ? [] : [rect];
	});
	const onScreen = (x: number, y: number) =>
		x >= 0 && y >= 0 && x < buffer.width && y < buffer.height;
	const covered = (x: number, y: number) =>
		!onScreen(x, y) ||
		covers.some(
			(rect) =>
				x >= rect.x &&
				x < rect.x + rect.width &&
				y >= rect.y &&
				y < rect.y + rect.height,
		);
	const panes = [...grid.panes].flatMap((pane) => {
		const rect = shownRect(pane.box);
		return rect === undefined || rect.width < 2 || rect.height < 2
			? []
			: [{ rect, look: pane.look() }];
	});

	// Every pane's outline adds its arms to the cells it passes, so a cell
	// two outlines pass gets the junction of both.
	const cells = new Map<number, { arms: number; focused: boolean }>();
	const mark = (x: number, y: number, arms: number, focused: boolean) => {
		if (!onScreen(x, y)) return;
		const key = y * buffer.width + x;
		const cell = cells.get(key) ?? { arms: 0, focused: false };
		cells.set(key, {
			arms: cell.arms | arms,
			focused: cell.focused || focused,
		});
	};
	for (const { rect, look } of panes) {
		const lastX = rect.x + rect.width - 1;
		const lastY = rect.y + rect.height - 1;
		for (let x = rect.x; x <= lastX; x++) {
			const across = (x > rect.x ? left : 0) | (x < lastX ? right : 0);
			mark(
				x,
				rect.y,
				across | (x === rect.x || x === lastX ? down : 0),
				look.focused,
			);
			mark(
				x,
				lastY,
				across | (x === rect.x || x === lastX ? up : 0),
				look.focused,
			);
		}
		for (let y = rect.y + 1; y < lastY; y++) {
			mark(rect.x, y, up | down, look.focused);
			mark(lastX, y, up | down, look.focused);
		}
	}
	const borderColor = parseColor(color.border);
	const accent = parseColor(color.accent);
	const bg = parseColor(color.bg);
	for (const [key, cell] of cells) {
		const x = key % buffer.width;
		const y = Math.floor(key / buffer.width);
		if (covered(x, y)) continue;
		const lines = cell.focused ? focusBorder : border;
		buffer.setCell(
			x,
			y,
			glyph(lines, cell.arms),
			cell.focused ? accent : borderColor,
			bg,
		);
	}

	// Titles go on last, so a neighbour's line never covers one. Cell by
	// cell, as `drawText` leaves a space's cell as it was.
	const titled = new Set<number>();
	const write = (text: string, x: number, y: number, fg: ColorInput) => {
		let at = x;
		for (const character of text) {
			titled.add(y * buffer.width + at);
			if (!covered(at, y)) buffer.setCell(at, y, character, parseColor(fg), bg);
			at += Bun.stringWidth(character);
		}
	};
	const titleColor = (look: PaneLook) =>
		look.titleColor ?? (look.focused ? color.accent : color.border);
	// Room between the corners and the line beside each of them.
	const room = (rect: Rect) => rect.width - 4;
	for (const { rect, look } of panes) {
		if (Bun.stringWidth(look.title) <= room(rect)) {
			write(look.title, rect.x + 2, rect.y, titleColor(look));
		}
	}
	// A bottom title shares its line with the title of the pane under it,
	// which names that pane, so it gives way to it with a line between.
	for (const { rect, look } of panes) {
		const text = look.bottomTitle ?? "";
		const width = Bun.stringWidth(text);
		const x = rect.x + rect.width - 2 - width;
		const y = rect.y + rect.height - 1;
		let free = true;
		for (let at = x - 1; at <= x + width; at++) {
			if (titled.has(y * buffer.width + at)) free = false;
		}
		if (width > 0 && width <= room(rect) && free) {
			write(text, x, y, titleColor(look));
		}
	}
}

// The glyph of `lines` whose arms are `arms`.
function glyph(lines: BorderCharacters, arms: number): string {
	switch (arms) {
		case right | down:
			return lines.topLeft;
		case left | down:
			return lines.topRight;
		case right | up:
			return lines.bottomLeft;
		case left | up:
			return lines.bottomRight;
		case left | right | down:
			return lines.topT;
		case left | right | up:
			return lines.bottomT;
		case up | down | right:
			return lines.leftT;
		case up | down | left:
			return lines.rightT;
		case up | down | left | right:
			return lines.cross;
		case up | down:
		case up:
		case down:
			return lines.vertical;
		default:
			return lines.horizontal;
	}
}
