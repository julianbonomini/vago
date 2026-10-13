// Renders the real planning view over a planning item whose Proposal is the real goal-steps Goal.
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { testRender } from "@opentui/solid";
import { ProjectView } from "../../src/tui/project-view.tsx";
import { makeFakeInteractiveClaude } from "../../test/fake-harness.ts";
const repo = join(import.meta.dir, "..", "..");
const tk = (n: string) => Bun.file(join(repo, ".vago-goals/goal-steps/tickets", n)).text();
const body = async (n: string) => { const t = (await tk(n)).split("+++")[2] ?? ""; const title = t.match(/^# .*$/m)?.[0] ?? ""; const what = t.split("## What to build")[1]?.trim().split("\n\n")[0] ?? ""; return `${title}\n\n${what}\n`; };
const names = ["01-before-all.md", "02-after-all.md", "03-starter-after-all.md", "04-show-goal-steps.md", "05-docs.md"];
const slugs = ["before-all", "after-all", "starter-after-all", "show-goal-steps", "docs"];
const blockers = [[], [1], [2], [1, 2], [3, 4]];
const goalText = ((await Bun.file(join(repo, ".vago-goals/goal-steps/goal.md")).text()).split("+++")[2] ?? "").split("## User Stories")[0]!.trim();
let proposal = `workflow = "small"\nworkflow_reason = "Each Ticket is clear once the Step groups are decided."\nopen_decisions = []\ngoal = """\n${goalText}\n"""\n`;
for (let i = 0; i < 5; i++) proposal += `\n[[tickets]]\nslug = "${slugs[i]}"\nblocked_by = [ ${blockers[i]!.join(", ")} ]\nbody = """\n${(await body(names[i]!)).replaceAll('"""', "")}"""\n`;
const root = await mkdtemp(join(tmpdir(), "vago-brag-"));
Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: root });
Bun.spawnSync(["git", "-c", "user.name=x", "-c", "user.email=x@x", "commit", "-q", "--allow-empty", "-m", "start"], { cwd: root });
const files: Record<string, string> = {
  ".vago/prompts/planning.md": "You help plan a Goal.\n",
  ".vago/workflows/small.toml": "", ".vago/workflows/try-hard.toml": "",
  ".vago-goals/goal-steps/planning/chat.toml": 'harness = "claude-code"\n',
  ".vago-goals/goal-steps/planning/proposal.toml": proposal,
};
for (const [p, t] of Object.entries(files)) { await mkdir(dirname(join(root, p)), { recursive: true }); await Bun.write(join(root, p), t); }
const fake = await makeFakeInteractiveClaude();
const vago = ["env", ...Object.entries(fake.env).map(([k, v]) => `${k}=${v}`), process.execPath, join(repo, "src/cli.ts")];
const view = await testRender(() => <ProjectView root={root} vago={vago} harnesses={["claude-code", "codex"]} />, { width: 118, height: 32, exitOnCtrlC: false });
const out = join(import.meta.dir, "frames2");
const rgba = (c: any) => c ? [c.r, c.g, c.b, c.a] : null;
async function settle(text: string) { for (let i = 0; i < 300; i++) { await view.renderOnce(); if (view.captureCharFrame().includes(text)) break; await Bun.sleep(10); } for (let i = 0; i < 40; i++) { await view.renderOnce(); await Bun.sleep(10); } }
async function dump(name: string) {
  const lines = view.captureSpans().lines.map((l: any) => l.spans.map((s: any) => ({ t: s.text, fg: rgba(s.fg), bg: rgba(s.bg), a: s.attributes })));
  await Bun.write(`${out}/${name}.json`, JSON.stringify(lines)); await Bun.write(`${out}/${name}.txt`, view.captureCharFrame());
}
await settle("1/1"); await dump("plan-list");
view.mockInput.pressEnter(); await settle("ready to accept"); await Bun.sleep(500); await settle(""); await dump("plan");
view.mockInput.pressKey("]", { ctrl: true }); await settle(""); await dump("plan-focus");
view.renderer.destroy(); process.exit(0);
