// Turns captured span frames into cell grids the page can edit, [ch, fg, bg, bold],
// with every dollar amount taken out.
const hex = (c: number[] | null) => {
  if (!c || c[3] === 0 || (c[0] === 0 && c[1] === 0 && c[2] === 0)) return "";
  return "#" + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
};
type Cell = string[];
const blank = (): Cell => [" ", "", "", ""];
async function load(path: string): Promise<Cell[][]> {
  const lines = await Bun.file(path).json();
  return lines.map((spans: any[]) => {
    const cells: Cell[] = [];
    for (const s of spans) for (const ch of [...s.t]) cells.push([ch, hex(s.fg), hex(s.bg), s.a & 1 ? "1" : ""]);
    return cells;
  });
}
const text = (row: Cell[]) => row.map((c) => c[0]).join("");
function noMoney(g: Cell[][]) {
  for (let r = 0; r < g.length; r++) {
    for (;;) {
      const row = g[r]!, s = text(row);
      const m = /( · |   )?\$\d[\d,]*\.\d\d( spent)?/.exec(s);
      if (!m) break;
      const a = m.index, b = a + m[0].length, n = b - a;
      const removed = row.splice(a, n);
      const bg = removed[0]![2]!;
      const fill = () => [" ", "", bg, ""];
      if (/^ *(│|$)/.test(s.slice(b))) {
        // right-aligned: push the segment right
        const seg = s.lastIndexOf("  ", a - 1) + 2;
        row.splice(seg, 0, ...Array.from({ length: n }, fill));
      } else if (s.includes("run time")) {
        row.splice(row.length, 0, ...Array.from({ length: n }, fill));
      } else {
        row.splice(a, 0, ...Array.from({ length: n }, fill));
      }
    }
    const s = text(g[r]!), c = s.indexOf(" COST ");
    if (c >= 0) for (let k = 1; k <= 4; k++) g[r]![c + k]![0] = " ";
  }
  return g;
}
const out: Record<string, Cell[][]> = {};
out.goal = noMoney(await load("frames/gw7.json"));
out.list = noMoney(await load("frames/list.json"));
const plan = noMoney(await load("frames2/plan.json"));
plan[0] = out.list[0]!.map((c) => c.slice());
// The fake session's own line goes; the page draws the chat there.
for (let c = 0; c < 62; c++) plan[3]![c] = blank();
{ const s = text(plan[2]!), i = s.indexOf("planning · 0s"); if (i >= 0) { for (let k = 0; k < 13; k++) plan[2]![i + k]![0] = " "; "planning".split("").forEach((ch, k) => (plan[2]![i + 5 + k]![0] = ch)); } }
out.plan = plan;
await Bun.write("frames.js", "window.FRAMES = " + JSON.stringify(out) + ";");
for (const [k, g] of Object.entries(out)) console.log(k + "\n" + g.map(text).join("\n"));
