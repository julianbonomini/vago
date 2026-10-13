# Vago brag plan (v2)

**What it is:** a software factory you design yourself. You plan a Goal with an agent until it's split into Tickets, then walk away; `vago run` takes each Ticket through your Workflow, a TOML file where every Step is yours.

**Angle:** "Grill the plan. Walk away." The selling point is the Workflow: a file you own, any Step you want, any agent per Step. Then the proof: Vago builds Vago. No cost figures anywhere; every dollar amount is removed from the TUI frames.

**Tone:** default, more dynamic: whip and zoom cuts, slam type, a punch on every downbeat, 3D drift on the windows.

**Motion rules** (from the improve-animations catalog): strong curves cubic-bezier(0.23, 1, 0.32, 1) for entrances and (0.77, 0, 0.175, 1) for moves and exits, no ease-in on entrances, blur kept at 16px or less, word staggers of 30–80ms, subtle spring on the inserted chip, a blurred crossfade on the harness label.

## Storyboard (24s, 1920×1080, 30fps, 120 BPM)

| # | Time | Scene |
|---|---|---|
| 1 | 0.0–2.5 | "Grill the plan." / "Walk away." slam in. |
| 2 | 2.5–5.5 | `vago` wordmark, "builds a Goal in your repo while you're away.", `$ vago` typed. |
| 3 | 5.5–9.0 | Real planning view: a grilling exchange in the session pane, then the goal-steps Proposal fills the Preview, ready to accept. Caption "Plan it with an agent. It writes the Tickets." |
| 4 | 9.0–14.5 | `.vago/workflows/small.toml` beside its Steps. An E2E tests Step is typed in and its chip springs in; `harness = "codex"` flips Review to Codex. Captions: "Your Workflow is a file." / "Add any Step." / "Run each one on Claude Code or Codex." |
| 5 | 14.5–17.5 | Real goal-worktrees Goal view (try-hard). Tickets tick on the 8ths, then a push into Ticket 07's ten Steps. "Vago takes every Ticket through it." |
| 6 | 17.5–20.5 | Project view, "Vago builds Vago.", 15 Goals done, 88 Tickets merged, 575 agent Runs. |
| 7 | 20.5–24.0 | "Runs on Claude Code, Codex, Pi (coming soon)", then `vago` and the repo. |

The session-pane exchange in scene 3 is illustrative, written from the goal-steps Goal's real decisions. Everything else on a terminal is the real TUI rendered from this repo's `.vago-goals/`.
