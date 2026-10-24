---
title: Writing a Workflow and its prompts
description: Rules for a Workflow file and the prompts of its agent Steps, which run with no human to answer a question.
order: 4
---

A [Workflow](/docs/glossary/#workflow) is a TOML file in `.vago/workflows/`, named by its file, listing the [Steps](/docs/glossary/#step) every Ticket goes through. Every key it takes is on [Workflows](/docs/workflows/). Vago decides how a Workflow runs; the Project decides what its Steps do.

## The Workflow

- **Start from a copy of a starter,** `small.toml` or `try-hard.toml`, under a new name. `vago update` overwrites the starter files that differ from Vago's, so a changed starter loses its changes.
- **Put the git work in Steps.** Vago cuts `vago/<goal>` and nothing else. Branching per Ticket, committing, merging, pushing and the PR are shell Steps or prompt instructions, or they don't happen.
- **Make every shell Step safe to run twice.** A stuck Ticket is picked up at the Step it stopped on, and a shell Step runs its command again from the start. Check before you create, push or post, as the starter's `branch.sh`, `merge.sh` and `ready.sh` do.
- **A shell Step that exits non-zero makes the Ticket stuck,** unless it has `on_fail = "continue"`. Use that for a check whose failure a later agent Step reads and fixes through `{{steps.<id>.output}}`.
- **Shell Steps are never retried; agent Steps are retried three times,** by resuming the same session.
- **Ids are for files, names are for people.** `id` appears in logs, Ticket headers and `{{steps.<id>.output}}`, and must be unique across `before_all`, `steps` and `after_all`. Don't change an `id` while a Ticket is stuck on it. `name` is what the TUI shows and is safe to change.
- **`when = "last-ticket"`** runs a Step only on the Ticket that starts with every other Ticket `done`.
- **`before_all` and `after_all` hold Goal Steps,** which run once per Goal in its worktree, with no Ticket. Their prompts may not read `{{ticket}}`. `after_all` runs again whenever a Ticket was added since its last pass, so a Goal Step that mustn't repeat checks for itself.
- **Set `harness` and `model` together.** A model belongs to one Harness: `claude-code` or `codex`. A Step that sets its own `harness` sets its own `model`, and its own `args` when the Workflow has any.
- **Never put a flag that turns a Harness's guard off in `args`.** Vago runs Claude Code in its `auto` permission mode and Codex in its `workspace-write` sandbox, and a refused tool call ends the Step `permission-denied`.
- **Check it before anyone runs it:** [`vago goal new --workflow <name>`](/docs/cli-reference/#vago-goal-new) refuses a Workflow `vago run` would refuse, naming the file and the problem.

Shell Steps get `$VAGO_GOAL`, `$VAGO_PROJECT_ROOT`, and for a Ticket `$VAGO_TICKET` and `$VAGO_LAST_TICKET`.

## The prompts

A prompt is a Markdown file under `.vago/`, named by the Step's `prompt`. The session that reads it works alone until it ends.

- **Say what done means.** The agent can't ask; it stops when it thinks it's finished. End each part with a "Done when" the agent can check, like "`bun run check` exits zero on a clean tree".
- **Say where it works and what it leaves.** The branch that is checked out, whether to commit, and that the tree ends clean when a later shell Step merges.
- **Name only the texts it needs:** `{{goal}}`, `{{ticket}}`, `{{goal_name}}` and `{{steps.<id>.output}}`, the last only for a Step earlier in the same list. A prompt gets nothing it doesn't name.
- **Ask for the output later Steps read.** An agent Step's output is its session's final answer. A Step whose output a review reads asks for a short report with fixed headings.
- **Point to the Project's docs instead of copying them.** Name them, or attach them with `include`, which appends whole files under a heading after the placeholders are filled.
- **Load skills by name,** like "Run the `vago-write-code` skill". `vago init` installs the starter skills for both Harnesses, so a prompt works on either.
- **Don't tell the agent to mark the Ticket done** or edit `.vago-goals/`. Vago sets status, and only Vago writes a header.

## Where changes take effect

Vago reads each Workflow, its prompts and include files once, when `vago run` starts. A Goal's worktree holds a copy of the main checkout's `.vago/`, which git there won't stage. So change `.vago/` in the main checkout, between runs; a change an agent makes to `.vago/` inside a Goal's worktree never reaches a commit or a run.
