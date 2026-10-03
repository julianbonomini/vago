# Spec: Vago Alpha

Status: ready-for-agent
Map: [Vago Alpha](map.md)

## Problem Statement

The human has a Project with work broken into a Goal and its Tickets. They want coding agents to push every Ticket through the Project's own steps (implement, check, review, merge) while they're away from the machine. Today the human has to start each Harness session by hand, wait for it, paste in the next prompt and decide what comes next. No tool does this the way they want:

- it lives inside one Project's repo and leaves no trace in git;
- it runs the human's own Workflow and skills, not the tool's;
- it works with whatever Harness they use, with Claude Code first;
- it's small enough that it can improve itself.

## Solution

Vago Alpha is a single `vago` binary. In a Project, the human runs `vago init` once, which copies a starter Workflow into `.vago/`. They then write a Goal and its Tickets as Markdown files and run `vago run <goal>`.

Alpha checks the Workflow and the Goal, then takes each ready Ticket in turn, lowest number first. Each Ticket goes through every Step of the frozen Workflow:

- agent Steps run as one fresh Claude Code session each, in Claude Code's guarded mode;
- shell Steps run a command.

Everything happens in the human's checkout on their own machine. Alpha prints one line when each Step starts and one when it ends, keeps a full log of every Run, and records a history of Runs in each Ticket's header. A Ticket is `done` when its last Step succeeds, and the Goal is done when every Ticket is `done`.

If a Step fails, Alpha marks the Ticket `stuck`, stops the whole Goal, and tells the human how to inspect the session and reset the Ticket. It never retries.

The Harness sits behind a small module boundary. Alpha ships with Claude Code only, and adding another Harness means writing one module.

The bar for Alpha: on Vago's own repo, `vago run <goal>` takes a Goal of two Tickets, where the second is blocked by the first, to `done`. It works through the first Ticket and then the second, each through every Step of the Workflow, with no human touching anything.

## User Stories

### Setting up a Project

1. As the human, I want `vago init` to copy a starter Workflow into my Project's `.vago/`, so that I can start from a working implement → check → review → merge flow.
2. As the human, I want the starter Workflow to come with its prompts and starter skills for code style and design, so that the agents have house rules from day one.
3. As the human, I want the starter files to be plain copies I own and can edit, so that Vago imposes no opinions I can't change.
4. As the human, I want `vago init` to keep `.vago-goals/` out of git via `.git/info/exclude`, never `.gitignore`, so that Vago leaves no trace in a repo other people share.
5. As the human, I want `vago init` to ask whether to commit the Workflow and explain what that means, so that I can share a Workflow with a team or keep it private.
6. As the human, I want the Workflow kept private by default, so that using Vago on someone else's open-source repo doesn't pollute it.
7. As the human, I want `vago init` to refuse to overwrite any file already in `.vago/`, so that I don't lose a Workflow or prompt I've tuned.
8. As the human, I want the starter Workflow shipped inside the binary, so that `vago init` works offline and matches the installed version.

### Defining the Workflow

9. As the human, I want each Workflow to be a TOML file, `.vago/workflows/<name>.toml`, so that I never have to write TypeScript to change how my Project is built.
10. As the human, I want to list Steps in order, each with an `id` and a `type` of `agent` or `shell`, so that the flow is linear and easy to read.
11. As the human, I want an agent Step to point at a prompt file, so that prompts are ordinary Markdown I can version and edit.
12. As the human, I want my prompts to call my own skills, so that I bring my own way of working instead of Vago's.
13. As the human, I want to set `harness` and `model` once for the Workflow and override them per Step, so that, for example, review can use a different model.
14. As the human, I want an optional `args` list, Workflow-wide and per Step, appended to the Harness command, so that I can tighten or loosen the Harness's guard without a kernel change.
15. As the human, I want a shell Step's `on_fail` to be `stop` by default or `continue`, so that a failing check can feed the reviewer instead of stopping the Ticket.
16. As the human, I want `{{ticket}}`, `{{goal}}` and `{{steps.<id>.output}}` substituted into prompts, so that each Run knows its task and what earlier Steps produced.
17. As the human, I want a shell Step's output to be its stdout, stderr and exit code, so that a review prompt can read exactly what the check said.
18. As the human, I want named include slots, Workflow-wide under `[include]` and per Step under `include.<name>`, so that docs like my code style reach every agent prompt.
19. As the human, I want a per-Step include to add a new slot or replace one with the same name, so that one Step can carry an extra doc without repeating the rest.
20. As the human, I want an optional `idle_timeout`, Workflow-wide or per Step, defaulting to 30 minutes, so that a stalled Harness doesn't hang my Goal forever.
21. As the human, I want Alpha to freeze the Workflow the Goal names when it starts a Goal, so that an agent editing `.vago/` mid-Goal can't weaken the later Tickets.
22. As the human, I want a bad Workflow to fail before any Run starts, with a message naming the problem, so that I never find out halfway through a Goal.
23. As the human, I want an unknown `harness` name to fail that check, so that a typo doesn't start a broken Run.

### Writing Goals and Tickets

24. As the human, I want `vago goal new <goal> --workflow <name>` to create the Goal's folder and a `goal.md` whose header names that Workflow, refusing a name with no `.vago/workflows/<name>.toml`, so that I have a place to describe the outcome I want and the Goal runs through the Workflow I chose.
25. As the human, I want `vago ticket add <goal> <slug>` to create the next numbered Ticket file with status `ready`, so that I don't number or format headers by hand.
26. As the human, I want to name a Ticket's blockers when I add it, so that a Ticket waits for the work it depends on.
27. As the human, I want Tickets to be Markdown with a TOML header, so that I can write the body in my editor or with my own skills.
28. As the human, I want Goal and Ticket files to never be tracked by git, so that Alpha's status writes never land in a commit or vanish on a branch switch.
29. As the human, I want only Alpha to write status, so that an agent can never mark its own work done.
30. As an agent in a Run, I want to see only the Ticket's title and body, never its header, so that status and Run history don't distract me.

### Running a Goal

31. As the human, I want `vago run <goal>` to treat every Ticket in that Goal as fair game, so that one command is my signal to start.
32. As the human, I want `vago run` to check the Goal's format first (the Goal exists, `goal.md` has a header naming its Workflow, every header parses, every blocker exists, no cycles), so that a broken Ticket file stops Alpha before any work.
33. As the human, I want Alpha to pick the lowest-numbered Ticket that is `ready` and whose blockers are all `done`, so that the order is predictable.
34. As the human, I want Tickets run one at a time, so that they never fight over my checkout.
35. As the human, I want each Ticket to go through every Step of the Workflow in order, so that my process is followed every time.
36. As the human, I want every agent Step to be a fresh Harness session, so that each Step starts from clean context with git as the handoff.
37. As the human, I want agent Steps to run in the Harness's own guarded mode (Claude Code's `--permission-mode auto`), so that unattended agents still have a safety check.
38. As the human, I want Alpha never to add a skip-permissions flag on its own, so that loosening the guard is always my explicit choice through `args`.
39. As the human, I want Steps to run in my checkout with my own Harness login, `gh` auth and git identity, so that there's no credential setup.
40. As the human, I want all git work (branches, commits, merges, PRs) done by Steps, so that the Workflow, not the kernel, decides my branch model.
41. As the human, I want a Ticket marked `done` by Alpha when its last Step succeeds, so that "done" means the whole Workflow ran.
42. As the human, I want `vago run` to exit when no Ticket is ready, with exit code 0 only if the Goal is done, so that scripts and tmux sessions can tell success from failure.

### Seeing progress

43. As the human, I want one line printed when each Step starts and one when it ends, showing the timestamp, Ticket, Step, outcome, duration and cost, so that I can glance at a tmux pane and know where things are.
44. As the human, I want a short summary when `vago run` exits, so that I know how the Goal ended without reading files.
45. As the human, I want every Run's raw Harness stream saved to `.vago-goals/<goal>/logs/`, one file per Run, so that I can follow a Run live with `tail -f` or read it afterwards.
46. As the human, I want shell Steps logged too, so that I can see exactly what a check printed.
47. As the human, I want a reset Ticket's new Runs to get new log files, so that the logs of the failed attempt survive.
48. As the human, I want each Ticket's header to keep a `[[runs]]` history (Step, start, end, outcome, Harness, model, session ID, tokens, cost, log path), so that I can audit what happened and what it cost.
49. As the human, I want a Run's entry written when the Step starts and filled in when it ends, so that a crash still leaves a trace.
50. As the human, I want the session ID recorded, so that I can resume any Run's session by hand to see what the agent was doing.

### When things go wrong

51. As the human, I want an agent Step to fail on a non-zero exit, so that Harness errors like auth or max turns stop the Ticket.
52. As the human, I want an agent Step to fail when the Harness has streamed nothing for `idle_timeout`, so that a hung session is caught.
53. As the human, I want a shell Step to fail on a non-zero exit, with `on_fail` deciding whether the Ticket goes on, and no timeout, so that my own commands behave as they do by hand.
54. As the human, I want a failed Step to mark the Ticket `stuck` and stop the whole Goal, so that no further Ticket runs on top of a checkout in an unknown state.
55. As the human, I want Alpha never to retry, so that a failure is always mine to look at.
56. As the human, I want the `stuck` message to show the log path, the command that resumes the session, and the `vago ticket reset` command, so that I know exactly where to look and how to continue.
57. As the human, I want Ctrl-C (or SIGTERM) to kill the running Run's whole process group, mark the Ticket `stuck` with outcome `interrupted`, and exit, so that stopping Alpha leaves no orphan agents.
58. As the human, I want a Ticket left `running` by a crash to be marked `stuck` with outcome `lost` the next time I run Alpha, so that it's never silently restarted on top of its own partial work.
59. As the human, I want `vago run` to refuse to start while any Ticket in the Goal is `stuck`, naming them and printing the reset command, so that I have to check the checkout first.
60. As the human, I want `vago ticket reset <goal> <NN>` to set a `stuck` Ticket back to `ready` and keep its Run history, so that I can continue once I've sorted out the checkout.
61. As the human, I want to change the Workflow mid-Goal by stopping Alpha, editing `.vago/` or the `workflow` line in the `goal.md` header, resetting and running again, so that done Tickets stay done and the rest use the new Workflow.

### Building and extending Vago

62. As the human, I want Vago's repo to have `bun run check` (strict `tsc --noEmit`, Biome, `bun test`), so that every change, mine or Alpha's, meets the same bar.
63. As the human, I want a reinstall script that compiles Vago with `bun build --compile` and puts it on my `PATH`, so that Alpha's merged changes to itself take effect only when I choose.
64. As the human, I want Alpha to keep running its installed binary during a Goal, so that a bad merge to Vago can't break the Alpha that is driving the Goal.
65. As a developer adding a Harness, I want the Harness to be one module behind a small interface, plus one registry entry, so that adding Codex doesn't touch the kernel.
66. As a developer adding a Harness, I want the kernel to own spawning, the idle timer, logs, `[[runs]]` and outcomes, so that my module only knows its own CLI.
67. As the human, I want Vago's own repo built with the same starter Workflow that `vago init` copies, so that Vago eats its own cooking.
68. As the human, I want Vago's own code-style file (plain TypeScript, *A Philosophy of Software Design*, *Designing Data-Intensive Applications*) included in agent prompts the same way any Project's is, so that Vago has no special path for itself.

## Implementation Decisions

Recorded in ADR 0001 (TypeScript on Bun, driving Harness CLIs), ADR 0002 (the kernel owns no git and no workspace) and ADR 0003 (Tickets are untracked files, and only Alpha writes status). The map's tickets hold the reasoning behind each decision below.

### Language and shape

- TypeScript on Bun, compiled to one binary with `bun build --compile`. Harnesses are driven through their headless CLIs, never an SDK.
- House style: plain TypeScript, meaning functions and modules, classes only for real state, no clever types, Zod only at edges, few dependencies, Bun built-ins first.
- Alpha has no runtime dependency on Sandcastle or any other orchestrator.

### Modules

- **CLI.** Parses `init`, `goal new`, `ticket add`, `run` and `ticket reset`. `goal new` takes `--workflow <name>`, required, and `--body-file <path>`, optional, in either order. It maps outcomes to exit codes: 0 when the command succeeded or the Goal is done, non-zero otherwise. Which non-zero code it uses carries no meaning.
- **Workflow loader.** Reads `.vago/workflows/<name>.toml` once per `vago run`, for the name the Goal gives, checks it and returns a frozen Workflow. The checks: the TOML parses, Step `id`s are unique, every `type` is `agent` or `shell`, prompt and include files exist, every `harness` name is registered, `on_fail` and `idle_timeout` values are valid, and every `{{steps.<id>.output}}` points at an earlier Step. It fails closed with a message naming the problem, and refuses a name that isn't in `.vago/workflows/`, listing the ones that are.
- **Ticket store.** Owns `.vago-goals/<goal>/goal.md` and `.vago-goals/<goal>/tickets/NN-<slug>.md`:
  - reads and writes the TOML front matter (`+++`);
  - writes the `goal.md` header at `goal new` and reads it: a `+++` header holding `workflow = "<name>"`. The human may edit it by hand. A Goal without it is refused;
  - runs the Goal format checks: the Goal exists, every header parses, every blocker exists, no cycles;
  - finds the next ready Ticket;
  - writes status and `[[runs]]`.

  It's the only code that writes status. Ticket files must keep the body byte-for-byte on header rewrites.
- **Goal runner.** The main loop:
  1. Freeze the Workflow, then check the Goal's format.
  2. Mark any `running` Ticket `stuck` with outcome `lost`, then stop.
  3. Refuse to start if any Ticket is `stuck`.
  4. Take the lowest-numbered ready Ticket and set it to `running`.
  5. Run its Steps in order. If the Ticket goes `stuck`, stop the Goal; if its last Step succeeds, mark it `done`.
  6. Repeat until no Ticket is ready.
- **Step runner.** The single place every Step executes. A container sandbox can be added later by wrapping only this point.
  - Spawns each Step as a child process in its own process group, with the repo root as the working directory.
  - Writes the raw output to the Run's log.
  - Runs the idle timer for agent Steps, resetting it on every streamed line.
  - Kills the process group on SIGINT, SIGTERM or Alpha exiting.
  - Returns the outcome: `ok`, `exit <n>`, `permission-mode <mode>`, `permission-denied`, `idle-timeout` or `interrupted`. An agent Step whose session ran in another permission mode than its command asked for ends `permission-mode <mode>`, naming the mode it ran in, and one whose Harness refused a tool call ends `permission-denied`. Both fail the Run even when the Harness exits 0, and both win over a non-zero exit code. A fallback wins over a denial, since it's why the calls were denied.
- **Prompt builder.** Plain string substitution, with no templating logic:
  - `{{ticket}}` becomes the Ticket's title and body, without the header;
  - `{{goal}}` becomes the body of `goal.md`, without its header;
  - `{{steps.<id>.output}}` becomes an earlier Step's output in this Ticket's current pass;
  - each include slot's file is appended after the prompt under a heading with the slot's name.

  Includes merge shallowly: the Step's slots add to the Workflow's, and a slot with the same name replaces the Workflow's. A Step can't remove a slot.
- **Harness registry and modules.** A compiled-in map from `harness` name to module; Alpha ships `claude-code` only. A module provides three things:
  - **Command:** the command to spawn, given the prompt, model and `args`, including the Harness's guarded mode and JSONL streaming flags;
  - **Stream reading:** reads one stream line at a time and returns what it carries: session ID, token counts, cost if the Harness reports one, the final result text that becomes the agent Step's `{{steps.<id>.output}}`, the permission mode the session ran in if it isn't the one the command asked for, and whether the Harness refused a tool call;
  - **Resume hint:** the command that resumes a given session, for the `stuck` message.

  The kernel owns everything else.
- **Claude Code module.** Runs `claude -p --output-format stream-json --verbose --permission-mode auto --model <model>`, adding the Step's `args`. It takes the session ID from the `system/init` event and tokens and `total_cost_usd` from the final result event. A `permissionMode` in a `system/init` or `system/status` event other than the mode the command asked for is a fallback: Claude Code doesn't offer auto mode on every model, and it falls back without an error. The mode asked for is `auto` unless the Step's `args` choose another: the last `--permission-mode` wins, and `--dangerously-skip-permissions` asks for `bypassPermissions`. A `system/permission_denied` event is a refused tool call. Its resume hint is `claude --resume <session_id>`. It never adds `--dangerously-skip-permissions`.
- **Progress printer.** Prints one line when a Step starts and one when it ends, in aligned columns: timestamp, Ticket number and slug, Step id, outcome, duration, cost. A blank line sets each Ticket's lines apart. On exit it prints a Goal summary: a table of each Ticket with its status, Runs, time and cost, and a total row. On a terminal the start lines are dimmed, `ok` is green, and a failed Step and the `stuck` message are red. Piped output, or any output with `NO_COLOR` set, is plain text in the same columns. On `stuck` it also prints the failed Run's outcome, the log path, the resume hint and the reset command. It never prints agent text. Live following is `tail -f` on the log.
- **Init.** Copies every file of the embedded starter (both Workflows under `workflows/`, prompts, scripts) into `.vago/` verbatim, and the starter's three `vago-` skills into `.claude/skills/`, where Claude Code finds them. It refuses, before writing anything, if any of those files already exists. It adds `.vago-goals/` to `.git/info/exclude`, asks whether the Workflow should be committed, and if not excludes all of `.vago/` and each `vago-` skill's folder, leaving the rest of `.claude/` as git saw it.

### Contracts

The Workflow format, as agreed in "How a Project defines its Workflow". Alpha ships `claude-code` only, so the starter uses it for every Step:

```toml
harness = "claude-code"
model   = "opus"
# args = [...]          # optional, appended to the Harness command; overridable per Step
# idle_timeout = "30m"  # optional; overridable per Step

[include]
style = "docs/code-style.md"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"

[[steps]]
id      = "check"
type    = "shell"
run     = "bun run check"
on_fail = "continue"     # default "stop"

[[steps]]
id     = "review"
type   = "agent"
prompt = "prompts/review.md"   # reads {{steps.check.output}}, fixes, never rejects
include.architecture = "docs/architecture.md"

[[steps]]
id     = "merge"
type   = "agent"
prompt = "prompts/merge.md"
```

The Ticket file and its Run history, as agreed in "Where Vago keeps Goals and Tickets" and "How a Run fails and what Alpha does next":

```markdown
+++
status     = "ready"        # ready | running | done | stuck
blocked_by = [1]            # Ticket numbers in the same Goal

[[runs]]
step       = "implement"
harness    = "claude-code"
model      = "opus"
session_id = "3f2a…"
started    = 2026-10-01T09:12:03Z
ended      = 2026-10-01T09:31:40Z
outcome    = "ok"           # ok | exit <n> | permission-mode <mode> | permission-denied | idle-timeout | interrupted | lost
cost_usd   = 1.84
tokens     = { input = 412000, output = 18300 }
log        = "logs/01-implement-1.jsonl"
+++

# Ticket title

Body…
```

- **Every `[[runs]]` entry** has `step`, `started`, `ended`, `outcome` and `log`. Agent Steps also get `harness`, `model` and `session_id`. `tokens` and `cost_usd` appear only when the Harness reports them.
- **Logs** are named `<NN>-<step>-<k>.jsonl`, where `k` is the Run's position in the Ticket's `[[runs]]`. Shell Steps use `.log`. Logs are never cleaned up.
- **Ticket readiness:** a Ticket is ready when its status is `ready` and every Ticket in its `blocked_by` is `done`.
- **Goal state:** a Goal has no status of its own. It's done when every Ticket is `done`.
- **Path resolution:** prompt paths resolve relative to `.vago/`, and include and shell paths relative to the repo root.

### Bootstrap

- The human builds all of Alpha by hand with Sandcastle. No Vago Tickets are planned for that phase.
- **Contents of Vago's own repo:**
  - `bun run check`;
  - the reinstall script (`bun build --compile`, then copy onto `PATH`), run by hand between Goals and never from a Workflow step. Don't name the package script `install`: that name is a package-manager lifecycle hook.
  - the starter Workflow source, which is embedded in the binary;
  - Vago's code-style file;
  - Vago's own Workflow in `.vago/`, committed as the reference copy of the starter.
- **The bar:** on Vago's own repo, a Goal of two Tickets, where the second is blocked by the first, reaches `done` in one `vago run <goal>`. Each Ticket goes through every Step, serially, with no human touching anything. Smoke runs against throwaway repos don't count.

## Testing Decisions

- **One seam: the `vago` CLI.**
  - **Setup:** each test makes a throwaway git repo in a temp directory, writes `.vago/workflows/<name>.toml`, prompts, a `goal.md` with its header, and Ticket files, and runs `vago <command>` as a child process.
  - **What tests check:** the exit code; stdout (the Step lines, the `stuck` message, refusals to start); Ticket files on disk (`status`, `[[runs]]`, a body that hasn't changed); log files. Nothing below the CLI gets its own test seam: not the Workflow loader, the Ticket store, the prompt builder or the Harness registry.
- **A fake `claude` on `PATH`.**
  - **Scripting:** each test controls the fake. It replays a recorded `stream-json` fixture, then exits 0, exits non-zero, sleeps past a tiny `idle_timeout`, or touches files in the checkout.
  - **Argv:** it records the argv and stdin it received, so tests can check guarded mode, `model`, `args` and the prompt Alpha built (substitutions and include slots).
  - **Coverage:** this exercises the real Claude Code module end to end. Fixtures should be recorded from a real `claude -p --output-format stream-json --verbose` session so stream reading matches the real format.
- **Shell Steps** use real commands (`true`, `false`, `echo`). They need no fake.
- **Failure cases:** interrupt tests send SIGINT to the `vago run` child and check that the fake's process group is gone, the Ticket is `stuck` with outcome `interrupted`, and the exit code is non-zero. Lost tests write a Ticket that's already `running` before `vago run`.
- **What makes a good test:** it describes behaviour the human could see, for example "a failing check with `on_fail = continue` still reaches review, and review's prompt contains the check output". It never reaches into internal modules. Tests should survive any refactor that keeps the CLI's behaviour.
- **Prior art:** none in this repo yet. Sandcastle's tests are a reference for driving a Harness CLI with scripted output, to borrow ideas from, not code.
- `bun test` runs these, and `bun run check` includes them.

## Out of Scope

- **Other Harnesses:** any Harness other than Claude Code, including the Codex module, and user-supplied Harness plugins. Codex comes once Alpha works.
- **Viewers:** any TUI or viewer, including watching a Run live beyond `tail -f`. Also out: a `vago status` command and similar small CLI extras.
- **Planning work:** creating or breaking down Goals and Tickets inside Vago (beyond `goal new` and `ticket add`), a planner that sequences Tickets, Missions and nested Goals.
- **Scale:** a view across Projects, several Goals at once, and parallel Tickets.
- **Retries and run states:** retrying provider errors, and explicit terminal reasons for a Run.
- **New Step types:** Gate and merge Step primitives, and a worktree per Goal.
- **Running environment:**
  - a container sandbox for Steps;
  - detaching `vago run` (daemon, `--detach`) or keeping the machine awake;
  - iOS or macOS sandboxes, or a macOS app.
- **Other out-of-scope items:**
  - notifications;
  - validating Goals as a whole;
  - a library of default Workflows (Alpha ships exactly one starter);
  - user docs for writing Workflows;
  - branding and the final name.

## Further Notes

- "Vago" is a provisional name. Use the vocabulary in `CONTEXT.md` (Vago, Alpha, Project, Workflow, Step, Goal, Ticket, Run, Harness) throughout code and messages.
- **Assumed during synthesis.** The map's tickets didn't spell these out. They're reasonable defaults, cheap to change:
  - `vago init` refuses to overwrite an existing Workflow;
  - an agent Step's output is the Harness's final result text;
  - include slots are appended after the prompt;
  - `idle_timeout` is a duration string like `"30m"`;
  - the Workflow check rejects `{{steps.<id>.output}}` references to later or unknown Steps.
- The starter prompts carry the git opinion (for example, a branch per Ticket and merging into `main` in the merge Step). The kernel doesn't know about it.
- Readiness ("run the whole Goal, lowest number first") will likely need revisiting after Alpha.
