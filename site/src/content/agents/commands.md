---
title: Commands to run and to leave
description: Which vago commands an agent runs on its own, and which it leaves to the human, with the reason for each.
order: 5
---

An agent runs the `vago` commands that write a Goal or Ticket the human asked for, or only read. It leaves to the human every command that starts agents, spends money, asks a question, or overwrites or discards their work. Every command works from the Project's root or from inside a Goal's worktree, where it acts on the main checkout's Goals.

## Run them

| Command | When |
|---|---|
| `vago --help`, `vago <command> --help` | Before using a command, for its arguments and flags. |
| [`vago goal new`](/docs/cli-reference/#vago-goal-new) | The human asked for a Goal and agreed on its text and Workflow. |
| [`vago ticket add`](/docs/cli-reference/#vago-ticket-add) | The human approved the split. A Workflow Step may add Tickets when its prompt says to, as the starter's Goal review does. |
| [`vago goal report`](/docs/cli-reference/#vago-goal-report) | To read a Goal's Tickets, Runs, times and costs. It changes nothing. |

Reading `.vago-goals/` and `.vago/` is always fine, and so is editing a Ticket's or Goal's text below its header when the human asks.

## Leave them to the human

| Command | Why |
|---|---|
| [`vago run`](/docs/cli-reference/#vago-run) | It starts agents that work for hours and cost money, and it refuses a Goal another `vago run` is running. Tell the human the command instead. |
| `vago` | The TUI needs a person at the terminal. |
| [`vago init`](/docs/cli-reference/#vago-init) | It asks whether the Workflow goes into git, which is the human's call. |
| [`vago update`](/docs/cli-reference/#vago-update) | It overwrites every starter file that differs, including prompts the human tuned. |
| [`vago ticket reset`](/docs/cli-reference/#vago-ticket-reset) | It makes a stuck Ticket start over from its first Step instead of where it stopped. |
| `vago plan new`, `rename`, `session`, `workflow`, `accept`, `discard` | Planning is the human's conversation with its own agent in the TUI. `discard` removes everything the item holds. |

## Never

- Don't write or edit a Ticket's or Goal's `+++` header. Only Vago writes it; status and Runs there are what `vago run` decides from. The human may change the `workflow` line of a Goal or a Ticket by hand between runs.
- Don't set a Ticket to `done` by any means. A Ticket is done when it reaches the end of its Workflow.
- Don't change `.vago/` from inside a Goal's worktree. Git there won't stage it, and `vago run` reads the main checkout's.
- In a Vago planning chat, run no `vago` command and write no file: the session is read-only, and the proposal block is how the Goal and Tickets reach the human.
