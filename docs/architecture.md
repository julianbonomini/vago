# Architecture

Vago Alpha's modules, what each one owns and hides, and the rules between them. The behaviour of each module is in the spec (`.scratch/vago-alpha/spec.md`, Implementation Decisions); this file covers boundaries only. A ticket that changes a boundary updates this file in the same PR.

## Layout

```
src/cli.ts                  src/goal-runner.ts      src/progress.ts
src/workflow.ts             src/step-runner.ts      src/init.ts
src/tickets.ts
src/harness/registry.ts     src/harness/claude-code.ts
src/starter-imports.d.ts    types for init.ts's text imports of the starter
starter/                    the starter Workflows and skills embedded in the binary
.vago/                      Vago's own Workflow: the starter plus Vago's docs as includes
.vago-goals/                Goals and Tickets, untracked and kept apart from the .vago/ config
test/                       CLI tests, the fake `claude`, recorded fixtures, a fixed Workflow
```

One file per module. A module becomes a folder only when it outgrows about 400 lines, and the folder exposes one entry file.

## Modules

| Module | Owns | Hides from everyone else |
|---|---|---|
| `cli.ts` | Commands, argument parsing, each command's help and usage text, exit codes, printing errors, reading a `--body-file` from a path or stdin | `process.argv`, `process.exit`, which exit code means what, the `-` for stdin convention |
| `workflow.ts` | Loading and checking `.vago/workflows/<name>.toml`, the Workflow a Goal names, and its prompt files, refusing a name that isn't there with a list of the names that are, returning the frozen Workflow, building an agent Step's prompt from it | Which Workflows exist in `.vago/workflows/`, the TOML schema, defaults (`idle_timeout`, `on_fail`), path resolution, include merging, substitution syntax (`{{ticket}}`, `{{goal}}`, `{{steps.<id>.output}}`) |
| `tickets.ts` | Goal and Ticket files: creating them, a Goal or Ticket with a given body or a title to fill in, the `goal.md` header, which names only the Goal's `workflow` and which the human may edit by hand between runs, format checks, readiness, status, `[[runs]]`, log paths | The `+++` header format, the `.vago-goals/<goal>/` layout, log naming, atomic writes |
| `goal-runner.ts` | Creating a Goal with the Workflow it names, refused when `vago run` would refuse it; the main loop: lost and stuck handling, picking Tickets, running Steps in order, marking `done`; the checkout a Goal's Steps run in, which is the Project root | The order of a Goal's lifecycle and where its Steps run |
| `step-runner.ts` | Running one Step on a Ticket as one Run, in the checkout it's given: its `[[runs]]` entry, its Step lines, its prompt, its child process and its log | Spawning, process groups, signals, the idle timer, writing the log, reading the Harness stream |
| `progress.ts` | Everything printed during a run: a line naming each Ticket as it starts with its Step lines under it, the `stuck` message, the Goal summary table. Also the Markdown Goal report `vago goal report` prints | Line formats, column widths, colour and when stdout gets it, durations, cost formatting |
| `init.ts` | `vago init`: copying the starter, every Workflow included, into `.vago/` and its `vago-` skills into `.claude/skills/`, refusing when a file it would write already exists, asking whether the Workflow will be committed, `.git/info/exclude`. `vago update`: rewriting the starter files that differ, keeping the commit answer the exclude records | The starter's file list and how it's embedded, where each file goes in the Project, exclude lines |
| `harness/registry.ts` | The `Harness` type and the map from `harness` name to module | Which Harnesses exist |
| `harness/claude-code.ts` | Claude Code's command, stream reading and resume hint | Claude Code's flags and `stream-json` event shapes |

## Rules

1. **Only `tickets.ts` touches `.vago-goals/`.** It reads and writes `goal.md` and Ticket files, and it names each Run's log path. `step-runner.ts` writes the log at the path it's given. No other module builds a path under `.vago-goals/`.
2. **Only `tickets.ts` writes status.** Agents never see a header: `{{ticket}}` is the title and body only, and `{{goal}}` is `goal.md` after its header (ADR 0003).
3. **Every Step runs through `step-runner.ts`,** and it's the only module that spawns a process. A sandbox later wraps this one point.
4. **Harness modules are pure.** They build a command, read one stream line, and give a resume hint. They do no I/O and import only the `Harness` type from `registry.ts`. The kernel owns spawning, the idle timer, logs, `[[runs]]` and outcomes. Adding a Harness is one module plus one registry entry.
5. **The Workflow the Goal names is frozen once per `vago run`.** `workflow.ts` reads the toml, prompts and include files at load, and returns a frozen value carrying their text. Nothing re-reads `.vago/` mid-Goal.
6. **Building a prompt does no I/O.** `workflow.ts` turns the template and the texts it's given into the prompt.
7. **Only `progress.ts` writes stdout during a run** or for `goal report`. It never prints agent text. `cli.ts` writes errors to stderr.
8. **Only `cli.ts` reads `process.argv` or calls `process.exit`.**
9. **The kernel does no git** (ADR 0002). The one exception is `init.ts` appending to `.git/info/exclude`, for `init` and `update`.
10. **Imports go one way:** `cli.ts` → `goal-runner.ts` / `init.ts` → the rest, and `step-runner.ts` → `harness/registry.ts` → Harness modules. `cli.ts` also imports `tickets.ts` for `ticket add`, which only writes files, and `tickets.ts` with `progress.ts` for `goal report`, which only reads them. No cycles. `tickets.ts` and `progress.ts` are leaves: they take plain values and never import the modules that call them. A type lives with the module that owns the concept it describes, never where it happens to avoid a cycle. A Harness module's type-only import of `Harness` (rule 4) is erased at runtime and doesn't count.
11. **Each module owns its types** and exports them beside its functions. There's no shared `types.ts`.
12. **Ticket writes survive a crash.** Every header rewrite writes a temp file and renames it over the Ticket, keeping the body byte for byte. A Run's `[[runs]]` entry is written before its Step starts and filled in when it ends.
