# Handoff: prototype Vago's TUI

You're starting a prototype session for Vago's TUI. A grilling session on 2026-10-03 settled what the TUI is. This session answers how it looks and feels, with throwaway code, so the human can then split the real work into Goals and Tickets. Use the `/prototype` skill for the method and the `/tui-design` skill for every design and build decision.

Read first: `CONTEXT.md` (Vago's words; use them exactly), `docs/adr/0004-the-tui-is-a-read-only-layer-in-the-vago-binary.md`, `docs/adr/0005-the-tui-draws-with-opentui-and-solid.md`, and `.scratch/vago-tui/research/factory-missions.md`, the research on Factory's Mission Control, the TUI the human wants Vago's to feel like.

## Where to work

- This worktree, `~/Documents/Buenomini/vago-tui`, on a new branch `prototype/tui` cut from `tui-decisions`. The branch is kept afterwards as a reference for the Goals; it is never merged.
- The prototype is throwaway: no tests, no `bun run check`, no AGENTS.md code rules. Put it in its own folder, `prototype/tui/`, with its own `package.json`, so `src/` stays untouched.
- **Never write to `~/Documents/Buenomini/vago` (the main checkout).** A Goal (`goal-worktrees`) is running there, and any file you add gets swept into its commits. Read from it only.

## What's settled

- `vago` with no command opens the TUI; `vago <command>` stays the CLI. Same binary. The TUI only shows: no start, stop, reset or steering.
- Vago's words everywhere: Goal, Ticket, Workflow, Step, Run, Harness, Milestone. Factory's Mission is Vago's Goal, its Feature is a Ticket, its Worker session is a Run.
- Two views: one Goal's view, and a Project view listing every Goal (running, ready to start, stuck, done) that opens into a Goal's view.
- The one-Goal view shows: a header with the Goal, elapsed time, tokens and cost; Tickets done of total; the Ticket list with status and blockers; the current Ticket's text with its Workflow's Steps marked done, current or pending; the live Run activity, condensed from the Run's `.jsonl` log; an event log (Run started, Run ended with outcome, time and cost).
- A Ticket whose file says `running` while no `vago run` process runs its Goal shows as `lost`. The kernel doesn't record that process yet; fake it in the prototype.
- OpenTUI with Solid (`@opentui/core`, `@opentui/solid`, `solid-js`), pinned.
- Out of scope: actions, an orchestrator, Factory's Milestone checkpoints, validators, re-planning, a view across Projects.

## Questions the prototype answers

1. The one-Goal view's layout: which panes, where, and what each shows at what width.
2. The Project view's layout, and how the human moves from it into a Goal and back.
3. Whether the live Run activity from `.jsonl` logs reads well: which Claude Code events to show, how to condense tool calls (Factory shows `Execute`, `Read file (N lines)`), and how it follows a Run as it writes.
4. The visual style: colours (Factory uses a near-black background and one orange accent), symbols for Ticket status, how the screen is divided, borders, navigation and keys, and how it behaves on a narrow terminal and with `NO_COLOR`.
5. Whether Solid's JSX transform works in a `bun build --compile` binary. Build the prototype into a binary and run it. ADR 0005 has a TODO that depends on this.

## The data

- Goals and Tickets: `~/Documents/Buenomini/vago/.vago-goals/<goal>/goal.md` and `tickets/NN-<slug>.md`. Each Ticket starts with a `+++` TOML header: `status` (`ready`, `running`, `done`, `stuck`), `blocked_by`, and one `[[runs]]` entry per Run with `step`, `started`, `ended`, `outcome`, `log`, and for agent Steps `harness`, `model`, `session_id`, `cost_usd` and `[runs.tokens]`. An open Run has no `ended`.
- Run logs: `.vago-goals/<goal>/logs/NN-<step>-<n>.jsonl` (Claude Code's raw `stream-json`) or `.log` (a shell Step's output).
- The Workflow's Steps: `.vago/workflows/<name>.toml`, the name in `goal.md`'s header.
- Live data: `goal-worktrees` is running now, so its newest log grows while you work. The other Goals are done.
- How the kernel parses these: `src/tickets.ts` and `src/harness/claude-code.ts`. Read them; don't import them into the prototype if it slows you down.

## What to hand back

When the human is happy with the prototype, write `.scratch/vago-tui/prototype-findings.md` on `prototype/tui`:

- the answer to each of the five questions, with a screenshot or a text capture of each view
- the design decisions the Goals should carry (layout, keys, colours, the event list for the live Run activity)
- anything that contradicts ADR 0004 or 0005, or the settled list above
- what was hard, which tells the human where the Tickets need to be small

Commit the prototype and the findings to `prototype/tui`. The human takes the findings back to the grilling session, which splits the work into Goals and Tickets.
