// Renders the real Vago TUI over this repo's own .vago-goals and dumps frames as spans.
import { testRender } from "@opentui/solid";
import { ProjectView } from "../../src/tui/project-view.tsx";
const root = process.cwd();
const out = import.meta.dir + "/frames";
await Bun.$`mkdir -p ${out}`;
const view = await testRender(() => <ProjectView root={root} vago={["true"]} harnesses={["claude-code"]} />, { width: 118, height: 32, exitOnCtrlC: false });
async function settle(text: string) {
  for (let i = 0; i < 300; i++) { await view.renderOnce(); if (view.captureCharFrame().includes(text)) break; await Bun.sleep(10); }
  for (let i = 0; i < 20; i++) { await view.renderOnce(); await Bun.sleep(10); }
}
const rgba = (c: any) => c ? [c.r, c.g, c.b, c.a] : null;
async function dump(name: string) {
  const spans = view.captureSpans();
  const lines = spans.lines.map((l: any) => l.spans.map((s: any) => ({ t: s.text, fg: rgba(s.fg), bg: rgba(s.bg), a: s.attributes })));
  await Bun.write(`${out}/${name}.json`, JSON.stringify(lines));
  await Bun.write(`${out}/${name}.txt`, view.captureCharFrame());
}
await settle("Goals");
await dump("list");
const steps = (process.argv[2] ?? "").split(",").filter(Boolean);
let n = 0;
for (const s of steps) {
  if (s === "down") view.mockInput.pressArrow("down");
  else if (s === "up") view.mockInput.pressArrow("up");
  else if (s === "right") view.mockInput.pressArrow("right");
  else if (s === "left") view.mockInput.pressArrow("left");
  else if (s === "enter") view.mockInput.pressEnter();
  else if (s === "tab") view.mockInput.pressTab();
  else if (s.startsWith("dump:")) { await settle(""); await dump(s.slice(5)); continue; }
  else view.mockInput.pressKey(s);
  await settle("");
}
view.renderer.destroy();
process.exit(0);
