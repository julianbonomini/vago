---
title: Workflows
description: Write a Workflow, the TOML list of agent and shell Steps every Ticket goes through, with Goal Steps, prompts, outputs, Harnesses and models.
order: 5
---

A [Workflow](/docs/glossary/#workflow) is a TOML file in `.vago/workflows/` that lists the [Steps](/docs/glossary/#step) each Ticket goes through, in order. Its file name is its name: `.vago/workflows/small.toml` is the Workflow `small`, the one [`vago goal new --workflow small`](/docs/cli-reference/#vago-goal-new) names. A Step is either an agent Step, which a [Harness](/docs/glossary/#harness) such as Claude Code performs as one [Run](/docs/glossary/#run), or a shell Step, which runs a command.

This Workflow builds each Ticket with one agent, runs the tests, and has a second agent review:

```toml
harness = "claude-code"
model   = "claude-opus-5-5"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"

[[steps]]
id      = "check"
type    = "shell"
run     = "npm test"
on_fail = "continue"

[[steps]]
id     = "review"
type   = "agent"
prompt = "prompts/review.md"
```

Vago decides how a Workflow runs: one Ticket at a time, each Step in order, a failed agent Step retried, a stuck Ticket picked up where it stopped. What the Steps do is yours. Vago does no git work of its own beyond the Goal's worktree and its branch, so committing, branching, merging and opening a PR are Steps in the Workflow, written as scripts you can read and change.

## Where Workflows come from

[`vago init`](/docs/cli-reference/#vago-init) copies two starter Workflows into `.vago/workflows/`, with their prompts in `.vago/prompts/` and their scripts in `.vago/scripts/`:

| Workflow | Steps of each Ticket | Pick it when |
|---|---|---|
| `small` | New branch, Build, Checks, Review, Goal review, Squash merge | The Tickets are small and already clear. One agent builds each Ticket and a fresh one reviews it. |
| `try-hard` | New branch, Design, Product, Architecture, Design choices, Build, Checks, Review, Goal review, Squash merge | A Ticket leaves design questions open. Three agents design it before one builds it, which takes four more agent Runs per Ticket than `small`. |

Both run Claude Code with `claude-opus-5-5`, both run Goal review only on the Goal's last Ticket, and both end the Goal with two [`after_all`](/docs/glossary/#after_all) Steps: PR description and Ready for review. The files are yours to change, and a Workflow you add next to them, such as `.vago/workflows/docs.toml`, is the Workflow `docs`. [`vago update`](/docs/cli-reference/#vago-update) overwrites the starter files that differ from Vago's and leaves files you added alone, so give a Workflow you have changed a new name if you want to keep your version through updates.

The starter's `check` Step runs `bun run check`. In a Project without that script, change the command in both Workflows and in the prompts that name it.

Vago reads each Workflow once per `vago run`, prompts and include files included, so an agent that edits `.vago/` during a Goal changes nothing until the next `vago run`.

## The file

The top of the file sets what every agent Step uses unless the Step sets its own. Below it come up to three lists of Steps:

- `[[steps]]`: the Steps every Ticket goes through, in order. A Workflow needs at least one.
- `[[before_all]]`: [Goal Steps](/docs/glossary/#goal-step) that run once, before the Goal's first Ticket.
- `[[after_all]]`: Goal Steps that run once no Tickets are left.

Every key of the file and of a Step is below. Vago refuses a Workflow with a key it doesn't know, a value of the wrong kind, or a file it names that doesn't exist, and names the file and the problem. [`vago goal new`](/docs/cli-reference/#vago-goal-new), [`vago ticket add --workflow`](/docs/cli-reference/#vago-ticket-add) and [`vago run`](/docs/cli-reference/#vago-run) all make this check, so a bad Workflow is caught before anything runs.

| Key | Where | Default |
|---|---|---|
| `harness` | top, agent Step | none: an agent Step needs one from either place |
| `model` | top, agent Step | none: an agent Step needs one from either place |
| `args` | top, agent Step | `[]` |
| `idle_timeout` | top, agent Step | `"30m"` |
| `include` | top, agent Step | no include slots |
| `id` | every Step | required |
| `name` | every Step | the Step's `id` |
| `type` | every Step | required: `"agent"` or `"shell"` |
| `when` | every Step | every Ticket |
| `run` | shell Step | required |
| `on_fail` | shell Step | `"stop"` |
| `prompt` | agent Step | required |
| `goal_report` | agent Step | `false` |

A shell Step takes no agent keys and an agent Step no shell keys: `on_fail` on an agent Step, or `prompt` on a shell Step, is refused.

## Ids and names

Each Step has an `id`, and may have a `name`:

```toml
[[steps]]
id   = "check"
name = "Checks"
type = "shell"
run  = "bun run check"
```

The `name` is what the TUI, `vago run` and `vago goal report` show. A Step without one shows its `id`. The `id` is what the files use: a Run's `step` in a Ticket's `[[runs]]`, its log's file name, such as `logs/02-check-3.log`, and `{{steps.check.output}}` in a later prompt. Ids are unique across all three lists of a Workflow.

Renaming a Step's `name` is safe at any time. Changing its `id` while a Ticket is stuck on it means `vago run` can't find the Step it stopped on.

## Shell Steps

A shell Step runs its `run` command with `sh -c` in the Goal's worktree:

```toml
[[steps]]
id   = "branch"
name = "New branch"
type = "shell"
run  = "sh .vago/scripts/branch.sh"
```

The Step is `ok` when the command exits 0, and ends `exit <code>` otherwise. Its stdout and stderr go to the Run's log, interleaved as it wrote them, and that log is the Step's output for later prompts. Shell Steps are never retried, since running a command twice can do something twice; make a script safe to run again, as the starter's `branch.sh` and `merge.sh` are, because a stuck Ticket runs it again from the start.

### The environment

A shell Step gets the environment `vago run` has, plus:

| Variable | Value | In a Goal Step |
|---|---|---|
| `VAGO_GOAL` | The Goal's name, like `search` | yes |
| `VAGO_PROJECT_ROOT` | The main checkout's path, to reach `.vago-goals/`, which the worktree doesn't hold | yes |
| `VAGO_TICKET` | The Ticket's name, like `02-ranking` | no |
| `VAGO_LAST_TICKET` | `true` when every other Ticket of the Goal is `done`, `false` otherwise | no |

The worktree is the Goal's own checkout, on the branch `vago/<goal>` that Vago cuts from the repo's default branch. The starter's `branch.sh` puts each Ticket on `<goal>/<ticket>`, cut from `vago/<goal>`:

```sh
git switch -C "$VAGO_GOAL/$VAGO_TICKET" "vago/$VAGO_GOAL"
```

### `on_fail`

A shell Step that exits non-zero stops the Ticket's pass and leaves the Ticket `stuck`. With `on_fail = "continue"` the pass goes on to the next Step instead:

```toml
[[steps]]
id      = "check"
name    = "Checks"
type    = "shell"
run     = "bun run check"
on_fail = "continue"   # review reads a failed check and fixes it
```

The values are `"stop"`, the default, and `"continue"`. A later agent Step reads the failure through `{{steps.check.output}}`, which starts with the exit code. `on_fail` covers a command that exits non-zero, never one you stopped with Ctrl-C, and only shell Steps take it: a failed agent Step is retried, then stops.

## Agent Steps

An agent Step starts a fresh session of its Harness in the Goal's worktree, sends it the Step's prompt, and waits for it to end:

```toml
[[steps]]
id     = "implement"
name   = "Build"
type   = "agent"
prompt = "prompts/small-implement.md"
```

`prompt` is a path from `.vago/`, so this is `.vago/prompts/small-implement.md`. The session works without a human: it can't ask a question, so the prompt says what done means. The Step is `ok` when the session ends without an error. Its output, for later prompts and the Goal report, is the session's final answer.

A Step that fails, whatever the reason, is retried after 1 minute, again after 1 more and again after 5 more, each time by resuming the same session with a message telling the agent it was interrupted and to carry on. The Ticket goes `stuck` when the third retry fails too, and the next `vago run` picks it up at that Step.

### Templates

A prompt is Markdown with placeholders, which Vago fills before it sends the prompt:

| Placeholder | What it holds |
|---|---|
| `{{ticket}}` | The Ticket's title and body, without its header |
| `{{goal}}` | The Goal's `goal.md`, without its header |
| `{{goal_name}}` | The Goal's name, like `search` |
| `{{steps.<id>.output}}` | The output of Step `<id>`, run earlier on this Ticket |

A prompt gets only the texts it names. A prompt for a review Step could end like this:

```markdown
Review the work on `{{goal_name}}/<ticket>` against the Ticket below.
If the check output shows a failure, fix it first.

# Ticket

{{ticket}}

# Build's report

{{steps.implement.output}}

# Check output

{{steps.check.output}}
```

Vago fills them in one pass, so a `{{goal}}` written inside a Ticket's body reaches the agent as written. Text in braces that isn't one of these placeholders is left alone.

### Step outputs

`{{steps.<id>.output}}` reads a Step that runs before this one in the same list. Vago checks this when it reads the Workflow, and refuses a prompt that reads a Step that comes later, doesn't exist, or sits in another list:

```toml
[[steps]]
id     = "design"
type   = "agent"
prompt = "prompts/design.md"

[[steps]]
id     = "product"
type   = "agent"
prompt = "prompts/product.md"   # reads {{steps.design.output}}
```

An agent Step's output is its session's final answer, so a prompt whose output a later Step reads asks for the answer it needs, such as "end with the design you picked". A shell Step's output is `exit code <n>` and then everything the command printed.

When a stuck Ticket is picked up past a Step, Vago rebuilds that Step's output from the Ticket's `[[runs]]` and the Run's log, so later prompts still read it.

### Include slots

`include` appends whole files to the prompt, each under a `# <slot>` heading, after the placeholders are filled. Use it for docs every Step needs, such as an ADR or a style guide, without copying them into each prompt. Set slots for every agent Step at the top of the file:

```toml
[include]
architecture = "docs/architecture.md"
glossary     = "CONTEXT.md"
```

A Step's own `include` adds slots after these, or replaces a slot of the same name in place:

```toml
[[steps]]
id                  = "review"
type                = "agent"
prompt              = "prompts/review.md"
include.review-rules = "docs/review-rules.md"
```

Include paths resolve from the Project's root, not from `.vago/`. A slot whose name is a whole number, like `1`, goes before the named ones. An included file's text is never searched for placeholders, so a doc that mentions `{{ticket}}` reaches the agent as written.

### `goal_report`

An agent Step with `goal_report = true` puts its output in the Goal report, collapsed under its Ticket:

```toml
[[steps]]
id          = "design-choices"
name        = "Design choices"
type        = "agent"
prompt      = "prompts/design-choices.md"
goal_report = true
```

[`vago goal report`](/docs/cli-reference/#vago-goal-report) prints the report, and the starter's `merge.sh` makes it the PR's body after each Ticket, so a reviewer reads `try-hard`'s design choices on the PR. Shell Steps don't take it.

## Harnesses and models

`harness` names the coding agent that performs a Step, and `model` the model it runs. There are two Harnesses:

- `claude-code` runs `claude -p` in its `auto` permission mode.
- `codex` runs `codex exec --json --approve-for-me`, in Codex's `workspace-write` sandbox.

Vago never passes either one's flag that turns its guard off, `--dangerously-skip-permissions` or `--dangerously-bypass-approvals-and-sandbox`. A tool call the Harness refuses ends the Step `permission-denied`.

Set both at the top of the file for every agent Step:

```toml
harness = "claude-code"
model   = "claude-opus-5-5"
```

A Step's own `harness` and `model` replace the Workflow's for that Step. A model belongs to one Harness, so a Step that sets `harness` sets `model` too. An agent Step left with no Harness or no model after this is refused. The starter Workflows' comments show the common case, reviewing on Codex while Claude Code builds:

```toml
[[steps]]
id      = "review"
name    = "Review"
type    = "agent"
prompt  = "prompts/small-review.md"
harness = "codex"
model   = "gpt-6-sol"
```

To run a whole Workflow on Codex, change the top of the file to `harness = "codex"` and a Codex model. Codex reads its skills from `.agents/skills/`, where `vago init` puts the same skills it puts in `.claude/skills/`, so the starter prompts work on either Harness.

Codex reports no cost, so Vago prices a Codex Run from its tokens and the model's list price, and shows no cost for a model it has no price for. A Codex Step needs `codex` on your `PATH`, logged in, at a version whose `codex exec` has `--approve-for-me`.

### `args`

`args` are appended to the Harness's command, after Vago's own flags:

```toml
args = ["--append-system-prompt", "Write commit messages in English."]
```

A Step's own `args` replace the Workflow's, so a Step that moves to the other Harness sets its own when the Workflow has any, and `args = []` on a Step drops the Workflow's:

```toml
[[steps]]
id      = "review"
type    = "agent"
prompt  = "prompts/review.md"
harness = "codex"
model   = "gpt-6-sol"
args    = ["-c", "model_reasoning_effort=high"]
```

A `--permission-mode` in `args` replaces Claude Code's `auto`, but a headless session can't ask for approval, so in a mode such as `acceptEdits` the first command it refuses ends the Step `permission-denied`. A Claude Code session that runs in another permission mode than the one its command asked for ends the Step `permission-mode <mode>`.

### `idle_timeout`

`idle_timeout` is how long a Harness may print nothing before Vago kills the session and the Run ends `idle-timeout`:

```toml
idle_timeout = "10m"
```

It's a whole number with a unit: `ms`, `s`, `m` or `h`, like `"90s"` or `"1h"`. Without one it is 30 minutes; the starters set 10. A Step's own replaces the Workflow's, for a Step whose agent runs long commands that print nothing:

```toml
[[steps]]
id           = "e2e"
type         = "agent"
prompt       = "prompts/e2e.md"
idle_timeout = "45m"
```

An idle timeout is a failure like any other, so the Step is retried.

## `when`

A Step with `when = "last-ticket"` runs only on the Goal's last Ticket, the one that starts with every other Ticket of the Goal `done`:

```toml
[[steps]]
id     = "goal-review"
name   = "Goal review"
type   = "agent"
prompt = "prompts/goal-review.md"
when   = "last-ticket"   # skipped on every other Ticket
```

On every other Ticket, `vago run` prints the Step as skipped and goes on. `"last-ticket"` is the only value; a Step without `when` runs on every Ticket. The starter's Goal review uses it to read the whole Goal's diff once, and it may add Tickets to the Goal, which makes the Ticket it ran on no longer the last. A shell Step can ask the same question of `$VAGO_LAST_TICKET`.

## Goal Steps

`[[before_all]]` and `[[after_all]]` list [Goal Steps](/docs/glossary/#goal-step), which run for the whole Goal instead of for a Ticket. They take the same types and keys as `[[steps]]`. The starters end every Goal with these two:

```toml
[[after_all]]
id     = "describe"
name   = "PR description"
type   = "agent"
prompt = "prompts/describe.md"

[[after_all]]
id   = "ready"
name = "Ready for review"
type = "shell"
run  = "sh .vago/scripts/ready.sh"
```

[`before_all`](/docs/glossary/#before_all) runs on the first `vago run` that has a Ticket to take, before that Ticket, and not again once it has gone through. Use it for work the whole Goal needs once, such as installing dependencies in the new worktree:

```toml
[[before_all]]
id   = "install"
name = "Install"
type = "shell"
run  = "bun install"
```

[`after_all`](/docs/glossary/#after_all) runs once no Tickets are left. It runs again after any Ticket added since its last pass is done, including Tickets one of its own Steps adds, so a Step that mustn't repeat checks for itself, as `ready.sh` checks for its comment before posting it. A Goal whose Tickets are all done isn't done until `after_all` has gone through.

Goal Steps differ from Ticket Steps in a few ways:

- They run in the Goal's worktree on `vago/<goal>`, with `$VAGO_GOAL` and `$VAGO_PROJECT_ROOT` but no `$VAGO_TICKET` or `$VAGO_LAST_TICKET`.
- Their prompts get `{{goal}}` and `{{goal_name}}`, and a Workflow whose Goal Step reads `{{ticket}}` is refused.
- `{{steps.<id>.output}}` reads only earlier Steps of the same list: outputs never cross between `before_all`, `steps` and `after_all`.
- `when` makes no difference: a Goal Step runs once per pass.
- Their Runs go in `goal.md`'s header, and their logs are named for their list, like `logs/after_all-ready-1.log`.
- A failed Goal Step leaves the Goal stuck, and the next `vago run` picks it up at that Step. There is no reset; to run `before_all` again from its first Step, delete its `[[runs]]` tables from `goal.md`'s header.

Only the Goal's own Workflow runs Goal Steps. A Ticket can name its own Workflow, as [Goals and Tickets](/docs/goals-and-tickets/#a-ticket-with-its-own-workflow) shows, but [`vago ticket add --workflow`](/docs/cli-reference/#vago-ticket-add) refuses one that has Goal Steps unless it is the Goal's.
