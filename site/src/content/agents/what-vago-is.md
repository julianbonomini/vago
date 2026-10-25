---
title: What Vago is and isn't
description: What Vago does in a Project, what it leaves to the Workflow and the human, and the words it uses.
order: 1
---

Vago is a CLI, `vago`, that takes a [Goal](/docs/glossary/#goal)'s [Tickets](/docs/glossary/#ticket) through a [Workflow](/docs/glossary/#workflow) with no human present. The human writes the Goal and its Tickets, `vago run` takes them one at a time through the Workflow's [Steps](/docs/glossary/#step), and the Goal ends as a branch, usually a PR, for the human to review and merge.

## What Vago does

- Reads Goals and Tickets from `.vago-goals/<goal>/` and Workflows from `.vago/workflows/`, both at the root of the Project.
- Cuts the Goal's branch `vago/<goal>` from the default branch, in a [worktree](/docs/glossary/#worktree) of its own outside the Project, and runs every Step there.
- Runs an agent Step as one [Run](/docs/glossary/#run) of a [Harness](/docs/glossary/#harness), Claude Code or Codex, with the Step's prompt. It runs a shell Step with `sh -c`.
- Writes each Ticket's status and Runs into the Ticket's header. Only Vago writes a header.
- Retries a failed agent Step three times, then marks the Ticket `stuck` and stops the Goal. The next `vago run` picks it up at that Step.
- Shows Goals, Tickets and Runs in a TUI, `vago` with no command, where the human watches a Goal, starts one, and plans one with an agent.

## What Vago leaves to others

- **Git beyond the Goal's worktree and branch.** Ticket branches, commits, merges, pushes and the PR are Steps of the Workflow, mostly scripts in `.vago/scripts/`. Without them, nothing commits or pushes the work unless a prompt tells the agent to.
- **What a Step does.** The prompts in `.vago/prompts/` and the commands in the Workflow belong to the Project. Vago fills a prompt's placeholders, appends its include files and sends it. The only text of its own it sends is the message that resumes an interrupted Run.
- **Deciding that work is good.** A Ticket is `done` when it reaches the end of its Workflow. A check Step, a review Step or the human decides whether the code is right.
- **Merging the Goal.** The human reads the PR and merges it.

## The words

Use these exactly as the [glossary](/docs/glossary/) defines them, in Goals, Tickets, prompts and messages to the human:

| Word | Not |
|---|---|
| Goal | epic, mission |
| Ticket | issue, task, story |
| Workflow | pipeline, process |
| Step | stage, phase, task |
| Run | session, job, attempt |
| Harness | runtime, worker |
| Project | repo, app |

A Run is one Harness session performing one agent Step. The Harness's own ID for that session is its session id.

## Where things live

| Path | What | Tracked by git |
|---|---|---|
| `.vago/workflows/<name>.toml` | A Workflow, named by its file | if the human answered `y` to `vago init` |
| `.vago/prompts/`, `.vago/scripts/` | The prompts and scripts the Workflows name | as above |
| `.vago-goals/<goal>/goal.md` | The Goal: a header, then its text | never |
| `.vago-goals/<goal>/tickets/NN-<slug>.md` | A Ticket: a header, then its text | never |
| `.vago-goals/<goal>/logs/` | One log per Run | never |
| `.claude/skills/vago-*`, `.agents/skills/vago-*` | The skills the starter prompts load | as `.vago/` |
