# Architecture

Vago Alpha's modules, what each one owns and hides, and the rules between them. The behaviour of each module is in the spec (`.scratch/vago-alpha/spec.md`, Implementation Decisions); this file covers boundaries only. A ticket that changes a boundary updates this file in the same PR.

## Layout

```
src/cli.ts                  src/goal-runner.ts      src/progress.ts
src/workflow.ts             src/step-runner.ts      src/init.ts
src/tickets/tickets.ts      src/worktree.ts
src/tickets/header.ts       src/tickets/ticket-folder.ts    src/tickets/goal-lock.ts
src/harness/registry.ts     src/harness/claude-code.ts
src/tui.tsx                 the TUI, drawn with OpenTUI and Solid
src/starter-imports.d.ts    types for init.ts's text imports of the starter
build.ts                    the Bun.build script `bun run reinstall` runs
bunfig.toml                 Solid's preload for `bun test` and `bun src/cli.ts`
starter/                    the starter Workflows and skills embedded in the binary
.vago/                      Vago's own Workflow: the starter plus Vago's docs as includes
.vago-goals/                Goals and Tickets, untracked and kept apart from the .vago/ config
test/                       CLI tests, the fake `claude`, recorded fixtures, a fixed Workflow
```

One file per module. A module becomes a folder only when it outgrows about 400 lines, and the folder exposes one entry file. Other modules import only that entry file; the folder's other files are private to it. `tickets/` is such a folder: its entry is `tickets/tickets.ts`, `header.ts` holds the `+++` header format and atomic rewrites, `ticket-folder.ts` reads a Goal's `tickets/` folder and checks numbers and blockers, and `goal-lock.ts` holds `running.lock`.

## Modules

| Module | Owns | Hides from everyone else |
|---|---|---|
| `cli.ts` | Commands, argument parsing, each command's help and usage text, exit codes, printing errors, reading a `--body-file` from a path or stdin | `process.argv`, `process.exit`, which exit code means what, the `-` for stdin convention |
| `workflow.ts` | Loading and checking `.vago/workflows/<name>.toml`, the Workflow a Goal names, and its prompt files, refusing a name that isn't there with a list of the names that are, returning the frozen Workflow, building an agent Step's prompt from it | Which Workflows exist in `.vago/workflows/`, the TOML schema, defaults (`idle_timeout`, `on_fail`, `when`), path resolution, include merging, substitution syntax (`{{ticket}}`, `{{goal}}`, `{{goal_name}}`, `{{steps.<id>.output}}`) |
| `tickets/` | Goal and Ticket files: creating them, a Goal or Ticket with a given body or a title to fill in, the `goal.md` header, which names only the Goal's `workflow` and which the human may edit by hand between runs, the Workflow each Ticket goes through, its own or the Goal's, format checks, readiness, whether a Ticket is its Goal's last, status, `[[runs]]`, log paths; the mark that a `vago run` has a Goal, held while it runs; the Goals of a Project | The `+++` header format, the `.vago-goals/<goal>/` layout, log naming, atomic writes; the lock file, and how a dead run's lock is taken over |
| `goal-runner.ts` | Creating a Goal or a Ticket with the Workflow it names, refused when `vago run` would refuse it; the main loop: lost and stuck handling, picking Tickets, running Steps in order and skipping a `last-ticket` Step on any other Ticket, marking `done`; opening the Goal's worktree, where its Steps run, once it has a ready Ticket; closing the Goal's worktree once every Ticket is done; running the Goal only while no other `vago run` has it | The order of a Goal's lifecycle and where its Steps run |
| `worktree.ts` | A Goal's worktree: creating it on `vago/<goal>` from the default branch with the main checkout's untracked and ignored files, recreating it from an existing `vago/<goal>` after the human deletes it, reusing it, keeping `.vago/` current, tracked or not, and out of the worktree's git, removing it, branches kept, once the Goal is done and nothing in it would be lost, and the Project root from inside it | The `VAGO_HOME` layout, the branch name, the default-branch rule, git commands, what gets copied, how `.vago/` is kept out of git, what counts as a change or as pushed |
| `step-runner.ts` | Running one Step on a Ticket as one Run, in the Goal's worktree it's given: its `[[runs]]` entry, its Step lines, its prompt, its child process and its log | Spawning, process groups, signals, the idle timer, writing the log, reading the Harness stream |
| `progress.ts` | Everything printed during a run: the Goal's worktree, a line naming each Ticket as it starts with its Step lines under it, the `stuck` message, the Goal summary table, what became of the Goal's worktree. Also the Markdown Goal report `vago goal report` prints | Line formats, column widths, colour and when stdout gets it, durations, cost formatting |
| `init.ts` | `vago init`: copying the starter, every Workflow included, into `.vago/` and its `vago-` skills into `.claude/skills/`, refusing when a file it would write already exists, asking whether the Workflow will be committed, `.git/info/exclude`. `vago update`: rewriting the starter files that differ, keeping the commit answer the exclude records | The starter's file list and how it's embedded, where each file goes in the Project, exclude lines |
| `tui.tsx` | `vago` with no command on a terminal: holding the terminal while the TUI is open and restoring it on every way out, holding stderr and `console`, the quit keys, and the Project view with its selection | OpenTUI, Solid, the renderer, the alternate screen, the signal and error handlers, colours |
| `harness/registry.ts` | The `Harness` type and the map from `harness` name to module | Which Harnesses exist |
| `harness/claude-code.ts` | Claude Code's command, stream reading and resume hint | Claude Code's flags and `stream-json` event shapes |

## Rules

1. **Only `tickets/` touches `.vago-goals/`.** It reads and writes `goal.md` and Ticket files, and it names each Run's log path. `step-runner.ts` writes the log at the path it's given. No other module builds a path under `.vago-goals/`.
2. **Only `tickets/` writes status.** Agents never see a header: `{{ticket}}` is the title and body only, and `{{goal}}` is `goal.md` after its header (ADR 0003).
3. **Every Step runs through `step-runner.ts`,** and it's the only module that spawns a Step's process. `worktree.ts` spawns git for the Goal's worktree. A sandbox later wraps the Step point.
4. **Harness modules are pure.** They build a command, read one stream line, and give a resume hint. They do no I/O and import only the `Harness` type from `registry.ts`. The kernel owns spawning, the idle timer, logs, `[[runs]]` and outcomes. Adding a Harness is one module plus one registry entry.
5. **Each Workflow is frozen once per `vago run`.** `workflow.ts` reads the toml, prompts and include files at load, and returns a frozen value carrying their text. `goal-runner.ts` loads the Goal's Workflow and every one its unfinished Tickets name before the first Run, and nothing re-reads them mid-Goal. Only a Ticket added mid-Goal that names a Workflow not loaded yet has it loaded when that Ticket comes up.
6. **Building a prompt does no I/O.** `workflow.ts` turns the template and the texts it's given into the prompt.
7. **Only `progress.ts` writes stdout during a run** or for `goal report`. It never prints agent text. `cli.ts` writes errors to stderr. While the TUI is open, only `tui.tsx` writes to the terminal.
8. **Only `cli.ts` reads `process.argv` or calls `process.exit`.**
9. **The kernel owns the Goal's worktree and its branch `vago/<goal>`**, in `worktree.ts`, and every other git action is the Workflow's (ADR 0004). `init.ts` also appends to `.git/info/exclude`, for `init` and `update`.
10. **Imports go one way:** `cli.ts` → `goal-runner.ts` / `init.ts` → the rest, and `step-runner.ts` → `harness/registry.ts` → Harness modules. `cli.ts` also imports `tickets/tickets.ts` with `progress.ts` for `goal report`, which only reads files. `goal-runner.ts` imports `worktree.ts` to open and close a Goal's worktree, `cli.ts` imports it for `projectRoot`, and `worktree.ts` imports only `goalsFolderName` from `tickets/tickets.ts` and `vagoFolderName` from `workflow.ts`, and nothing else of Vago's. `cli.ts` imports `tui.tsx` only through a dynamic `import()`, only for `vago` with no command on a terminal, and `tui.tsx` imports `tickets/tickets.ts` and nothing else of Vago's. No cycles. `tickets/` and `progress.ts` are leaves: they take plain values and never import the modules that call them. A type lives with the module that owns the concept it describes, never where it happens to avoid a cycle. A Harness module's type-only import of `Harness` (rule 4) is erased at runtime and doesn't count, and neither does `progress.ts`'s type-only import of the `WorktreeClose` type from `worktree.ts`.
11. **Each module owns its types** and exports them beside its functions. There's no shared `types.ts`.
12. **Ticket writes survive a crash.** Every header rewrite writes a temp file and renames it over the Ticket, keeping the body byte for byte. A Run's `[[runs]]` entry is written before its Step starts and filled in when it ends.
13. **The kernel never imports the TUI.** No module but `cli.ts` imports `tui.tsx`, and `cli.ts` only through a dynamic `import()`, so no command loads OpenTUI or needs Solid's transform, and every command test runs as if the TUI weren't there (ADR 0005).
