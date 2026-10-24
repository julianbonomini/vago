---
title: Limits
description: What Vago Alpha doesn't do, so an agent doesn't plan a Goal or Workflow around it.
order: 6
---

Vago is in its Alpha. Don't write a Goal, Ticket, Workflow or prompt that counts on any of these.

## Running

- **One Ticket at a time per Goal.** Blockers order the Tickets; nothing runs in parallel within a Goal. Two Goals can run side by side, each in its own `vago run`.
- **`vago run` runs in the foreground.** It has no detach mode and doesn't keep the machine awake; the Goal stops when the process does, and the next `vago run` picks it up.
- **No step that waits for the human.** A Workflow has no approval Step. An agent Step can't ask a question; it ends, and a later Step or the human reads what it said.
- **Retries are fixed:** three, after 1, 1 and 5 minutes, for agent Steps only. Then the Ticket is `stuck` and the Goal stops until the human runs it again.
- **A Step runs on the machine,** in the Goal's worktree, with the human's environment and credentials. There is no container. The Harness's own guard, Claude Code's `auto` mode or Codex's `workspace-write` sandbox, is the only check on what an agent Step does.
- **Two Harnesses:** Claude Code and Codex. Codex reports no cost, so Vago prices its Runs from tokens and shows no cost for a model it has no price for.
- **An idle Harness is killed** after `idle_timeout`, 30 minutes unless the Workflow sets another, and the Step fails.

## Goals and Tickets

- **No nesting.** A Goal has Tickets; there is no larger unit above a Goal and no sub-Ticket.
- **No rename, removal or renumbering** of a Goal or Ticket through `vago`. A planning item can be renamed and discarded before it is accepted.
- **Blockers point back.** A Ticket can only be blocked by a Ticket the Goal already has.
- **A Goal Step has no reset.** `vago ticket reset` resets Tickets only.

## The Project

- **A git repo** with a default branch. Vago cuts `vago/<goal>` from it without fetching first, so a Goal starts from the checkout's default branch as it was last pulled. It does no git work beyond that branch and its worktree; the Workflow does the rest.
- **The starter Workflows assume `bun run check`, `origin` and `gh`.** In a Project without them, the human changes the Workflow before the first Goal.
- **No notifications from Vago itself.** The starter's `ready.sh` mentions the human on the PR; anything else is a Step the Workflow adds.
- **No release binaries.** `vago` is built from its repo with Bun. See [Install](/docs/install/).

Vago is MIT licensed.
