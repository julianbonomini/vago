---
title: Goals and Tickets
description: The goal.md and Ticket file formats, how blockers order Tickets, and giving one Ticket its own Workflow.
order: 4
---

A [Goal](/docs/glossary/#goal) and its [Tickets](/docs/glossary/#ticket) are Markdown files under `.vago-goals/`, at the root of the Project. Git never tracks them: `vago init` lists `.vago-goals/` in `.git/info/exclude`, so the status Vago writes never lands in a commit or changes when a branch does.

```text
.vago-goals/
  search/
    goal.md
    tickets/
      01-index.md
      02-ranking.md
    logs/
      01-branch-1.log
      01-implement-2.jsonl
      ...
```

The folder's name is the Goal's name, and a Ticket's file name is its number and slug. Goal names and Ticket slugs may hold only letters, digits, `-` and `_`. Create them with [`vago goal new`](/docs/cli-reference/#vago-goal-new) and [`vago ticket add`](/docs/cli-reference/#vago-ticket-add), which number the Tickets and write their headers.

## The header and the body

Each file opens with a TOML header between two `+++` lines. Below it is the body, the text you write. Agents see only the body: a Step's prompt gets the Goal's body in `{{goal}}` and the Ticket's in `{{ticket}}`, never a header.

`goal.md`'s header names the Goal's [Workflow](/docs/glossary/#workflow) and when the Goal was created:

```markdown
+++
workflow = "small"
created = 2026-10-02T20:58:11.402Z
+++
# Search

Users can search their notes by title and body from the top bar.

Done when typing in the search box lists matching notes, best match first.
```

You may change `workflow` by hand between runs to move the Goal's remaining Tickets to another Workflow in `.vago/workflows/`. Once its [Goal Steps](/docs/glossary/#goal-step) run, Vago adds their Runs to this header too.

A Ticket's header holds its status, when it was created, its blockers and, once it has run, a `[[runs]]` table for each Step it ran. An agent Step's entry, a [Run](/docs/glossary/#run), also holds its Harness, model, session, tokens and cost:

```markdown
+++
status = "done"
created = 2026-10-02T20:59:40.118Z
blocked_by = [ 1 ]

[[runs]]
step = "branch"
started = 2026-10-02T21:22:28.904Z
log = "logs/02-branch-1.log"
ended = 2026-10-02T21:22:29.010Z
outcome = "ok"

[[runs]]
step = "implement"
harness = "claude-code"
model = "claude-opus-5-5"
started = 2026-10-02T21:22:29.012Z
log = "logs/02-implement-2.jsonl"
session_id = "3f2a9c1e-..."
ended = 2026-10-02T21:33:51.377Z
outcome = "ok"
cost_usd = 1.84

[runs.tokens]
input = 412000
output = 18300
+++
# Ranking

Rank search results by how well they match, best first.
```

Only Vago writes a Ticket's header. The body is yours to edit at any time, including a stuck Ticket's before you run it again: each Step reads it when it starts. A body of your own may not start with `+++`, since that would be a header.

The body's first `# ` heading is the title the TUI and `vago goal report` show; without one they show the slug, or the Goal's name. `vago goal new` and `vago ticket add` without `--body-file` write only such a title, for you to fill in.

## Status

A Ticket's status is one of:

- `ready`: waiting to run.
- `running`: a `vago run` is taking it through its Steps.
- `done`: it reached the end of its Workflow.
- `stuck`: a Step failed, after its retries for an agent Step, or you stopped `vago run` with Ctrl-C.

`vago run` sets every one of them, and an agent can't mark its own work done. A Goal has no status of its own: it is done when every Ticket is done and its `after_all` Steps have gone through.

## Blockers

`blocked_by` lists the numbers of Tickets that must be done before this one runs. Give them with `--blocked-by`, once for each:

```sh
vago ticket add search results-page --blocked-by 1 --blocked-by 2 --body-file results-page.md
```

A blocker must be a Ticket the Goal already has, so blockers always point back to earlier Tickets. `vago run` takes the lowest-numbered Ticket that is `ready` or `stuck` and whose blockers are all `done`. Tickets run one at a time, so a blocker sets which Ticket may go next; it doesn't run anything in parallel.

Before it runs anything, `vago run` checks the Goal: every header parses, no two Tickets share a number, every blocker is a Ticket of the Goal, blockers form no cycle, and every Workflow named exists. When a check fails it runs nothing and names the problem and the file.

## A Ticket with its own Workflow

A Ticket goes through its Goal's Workflow unless it names another. Pass `--workflow` to `vago ticket add`:

```sh
vago ticket add search ranking --blocked-by 1 --workflow try-hard --body-file ranking.md
```

This writes `workflow = "try-hard"` into the Ticket's header, and this Ticket alone goes through `try-hard` while the others keep `small`. Use it for the one Ticket in a Goal that leaves design questions open. You may also add or change that line by hand between runs.

`vago ticket add --workflow` refuses a Workflow that has [`before_all`](/docs/glossary/#before_all) or [`after_all`](/docs/glossary/#after_all) Steps, unless it is the Goal's own, since only the Goal's Workflow runs Goal Steps.
