# Architecture

Punt Alpha's modules, what each one owns and hides, and the rules between them. The behaviour of each module is in the spec (`.scratch/punt-alpha/spec.md`, Implementation Decisions); this file covers boundaries only. A ticket that changes a boundary updates this file in the same PR.

## Layout

```
src/cli.ts                  src/goal-runner.ts      src/prompt.ts
src/workflow.ts             src/step-runner.ts      src/progress.ts
src/tickets.ts              src/init.ts
src/harness/registry.ts     src/harness/claude-code.ts
starter/                    the starter Workflow embedded in the binary
test/                       CLI tests, the fake `claude`, recorded fixtures
```

One file per module. A module becomes a folder only when it outgrows about 400 lines, and the folder exposes one entry file.

## Modules

| Module | Owns | Hides from everyone else |
|---|---|---|
| `cli.ts` | Commands, argument parsing, exit codes, printing errors | `process.argv`, `process.exit`, which exit code means what |
| `workflow.ts` | Loading and checking `.punt/workflow.toml`, returning the frozen Workflow | The TOML schema, defaults (`idle_timeout`, `on_fail`), path resolution, include merging |
| `tickets.ts` | Goal and Ticket files: format checks, readiness, status, `[[runs]]`, log paths | The `+++` header format, the `.punt/goals/<goal>/` layout, log naming, atomic writes |
| `goal-runner.ts` | The main loop: lost and stuck handling, picking Tickets, running Steps in order, marking `done` | The order of a Goal's lifecycle |
| `step-runner.ts` | Running one Step as a child process | Spawning, process groups, signals, the idle timer, writing the log |
| `prompt.ts` | Building an agent Step's prompt from text it's given | Substitution syntax (`{{ticket}}`, `{{goal}}`, `{{steps.<id>.output}}`), how include slots are appended |
| `progress.ts` | Everything printed during a run: Step lines, the `stuck` message, the Goal summary | Line formats, durations, cost formatting |
| `init.ts` | `punt init`: copying the starter, `.git/info/exclude` | The starter's file list, exclude lines |
| `harness/registry.ts` | The `Harness` type and the map from `harness` name to module | Which Harnesses exist |
| `harness/claude-code.ts` | Claude Code's command, stream reading and resume hint | Claude Code's flags and `stream-json` event shapes |

## Rules

1. **Only `tickets.ts` touches `.punt/goals/`.** It reads and writes `goal.md` and Ticket files, and it names each Run's log path. `step-runner.ts` writes the log at the path it's given. No other module builds a path under `.punt/goals/`.
2. **Only `tickets.ts` writes status.** Agents never see the header: `{{ticket}}` is the title and body only (ADR 0003).
3. **Every Step runs through `step-runner.ts`,** and it's the only module that spawns a process. A sandbox later wraps this one point.
4. **Harness modules are pure.** They build a command, read one stream line, and give a resume hint. They do no I/O and import only the `Harness` type from `registry.ts`. The kernel owns spawning, the idle timer, logs, `[[runs]]` and outcomes. Adding a Harness is one module plus one registry entry.
5. **The Workflow is frozen once per `punt run`.** `workflow.ts` reads the toml, prompts and include files at load, and returns a frozen value carrying their text. Nothing re-reads `.punt/` mid-Goal.
6. **`prompt.ts` does no I/O.** It turns text into text.
7. **Only `progress.ts` writes stdout during a run.** It never prints agent text. `cli.ts` writes errors to stderr.
8. **Only `cli.ts` reads `process.argv` or calls `process.exit`.**
9. **The kernel does no git** (ADR 0002). The one exception is `init.ts` appending to `.git/info/exclude`.
10. **Imports go one way:** `cli.ts` → `goal-runner.ts` / `init.ts` → the rest, and `step-runner.ts` → `harness/registry.ts` → Harness modules. No cycles.
11. **Each module owns its types** and exports them beside its functions. There's no shared `types.ts`.
12. **Ticket writes survive a crash.** Every header rewrite writes a temp file and renames it over the Ticket, keeping the body byte for byte. A Run's `[[runs]]` entry is written before its Step starts and filled in when it ends.
