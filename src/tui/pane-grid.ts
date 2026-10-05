// The lines between the panes, drawn as one grid: where two panes share an
// edge it is one line, joined where lines meet. The outer edge of the panes
// together draws nothing, so only the lines between them show, and none
// carries text: a pane's title is its own first row. Hides the junction
// glyphs, the pass after each frame that draws them, and the order panes
// draw in.

import {
	type BorderCharacters,
	type BoxRenderable,
	type CliRenderer,
	type OptimizedBuffer,
	parseColor,
	type Renderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { onCleanup } from "solid-js";
import { theme } from "./theme.ts";

/**
 * A ref for a `border`ed box, which makes it a pane of the screen's grid for
 * as long as the calling component lives and the box and its parents are
 * visible. The box draws no line of its own: its border only takes the room
 * the grid draws in. Two panes share an edge by overlapping by `sharedLine`
 * cells, a margin of `-sharedLine` on the later.
 */
export function usePane(): (box: BoxRenderable) => void {
	const grid = gridOf(useRenderer());
	const pane: GridPane = { box: undefined };
	grid.panes.add(pane);
	onCleanup(() => grid.panes.delete(pane));
	return (box) => {
		box.customBorderChars = blankLines;
		// In the theme's colour, though blank, so `NO_COLOR` prints none.
		box.borderColor = theme().color.border;
		pane.box = box;
	};
}

// A pane box's own border, blank so only the grid's lines show.
const blankLines: BorderCharacters = {
	topLeft: " ",
	topRight: " ",
	bottomLeft: " ",
	bottomRight: " ",
	horizontal: " ",
	vertical: " ",
	topT: " ",
	bottomT: " ",
	leftT: " ",
	rightT: " ",
	cross: " ",
};

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

type GridPane = { box: BoxRenderable | undefined };

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
	const { color, border } = theme();
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
	const panes = [...grid.panes].flatMap(({ box }) => {
		const rect = shownRect(box);
		return rect === undefined || rect.width < 2 || rect.height < 2
			? []
			: [rect];
	});

	// The edge of all the panes together, which draws no line.
	const outer = {
		left: Math.min(...panes.map((rect) => rect.x)),
		top: Math.min(...panes.map((rect) => rect.y)),
		right: Math.max(...panes.map((rect) => rect.x + rect.width - 1)),
		bottom: Math.max(...panes.map((rect) => rect.y + rect.height - 1)),
	};
	// The arms of a cell's glyph without those along the outer edge, so a
	// line between panes runs to the edge without a junction there.
	const innerArms = (x: number, y: number, arms: number) => {
		let inner = arms;
		if (x === outer.left || x === outer.right) inner &= ~(up | down);
		if (y === outer.top || y === outer.bottom) inner &= ~(left | right);
		return inner;
	};

	// Every pane's outline adds its arms to the cells it passes, so a cell
	// two outlines pass gets the junction of both.
	const cells = new Map<number, number>();
	const mark = (x: number, y: number, arms: number) => {
		if (!onScreen(x, y)) return;
		const key = y * buffer.width + x;
		cells.set(key, (cells.get(key) ?? 0) | arms);
	};
	for (const rect of panes) {
		const lastX = rect.x + rect.width - 1;
		const lastY = rect.y + rect.height - 1;
		for (let x = rect.x; x <= lastX; x++) {
			const across = (x > rect.x ? left : 0) | (x < lastX ? right : 0);
			const corner = x === rect.x || x === lastX;
			mark(x, rect.y, across | (corner ? down : 0));
			mark(x, lastY, across | (corner ? up : 0));
		}
		for (let y = rect.y + 1; y < lastY; y++) {
			mark(rect.x, y, up | down);
			mark(lastX, y, up | down);
		}
	}
	const borderColor = parseColor(color.border);
	const bg = parseColor(color.bg);
	for (const [key, allArms] of cells) {
		const x = key % buffer.width;
		const y = Math.floor(key / buffer.width);
		const arms = innerArms(x, y, allArms);
		if (arms === 0 || covered(x, y)) continue;
		buffer.setCell(x, y, glyph(border, arms), borderColor, bg);
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
