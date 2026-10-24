---
title: Splitting a Goal into Tickets
description: Rules for cutting a Goal into Tickets that agents build one at a time, each reading only the Goal and itself.
order: 3
---

`vago run` takes a Goal's [Tickets](/docs/glossary/#ticket) one at a time, the lowest-numbered `ready` or `stuck` Ticket whose blockers are all `done` first. Every agent Step of a Ticket reads the Goal and that Ticket, and nothing of the other Tickets. A stuck Ticket stops the whole Goal.

## Rules

- **Cut vertical slices.** Each Ticket makes one behaviour work end to end, through every layer it touches, with its tests. A Ticket that does one layer for every feature leaves nothing to check until the last one lands.
- **Each Ticket is checkable on its own.** When its Steps end, its acceptance criteria can be checked against the code without any later Ticket.
- **Each Ticket fits one agent's context.** A Ticket too big for one session gets split.
- **Each Ticket stands alone.** Its Steps don't read the other Tickets, so a Ticket never says "as in the previous Ticket". What the Tickets share goes in the Goal.
- **Prefactor first.** A change that makes the rest easy is its own Ticket, numbered before the Tickets it helps.
- **Block only on real dependencies.** `--blocked-by` names a Ticket that must be `done` before this one starts. Tickets run one at a time, so a blocker orders them; it runs nothing in parallel.
- **Keep file paths and code out of a Ticket.** The Goal's further notes hold where the code lives. Keep a snippet only when it states a decision more precisely than prose, such as a type's shape.
- **Write the slug** with letters, digits, `-` and `_` only.

A wide refactor, one mechanical change that breaks every caller at once, can't be a vertical slice. Split it expand, migrate, contract: add the new form beside the old, move callers over in batches, one Ticket each, then remove the old form in a Ticket blocked by every batch.

## Template

```markdown
# <Ticket title>

## What to build

The behaviour this Ticket makes work, from the user's side.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
```

## Adding them

Add the Tickets blockers first, so each `--blocked-by` names a Ticket that exists. Vago numbers them from `01`:

```sh
vago ticket add <goal> <slug> --blocked-by 1 --blocked-by 2 --body-file <file>
```

Write each body to a file outside the Project's tree. Blockers go in `--blocked-by`, never in the body. [`vago ticket add`](/docs/cli-reference/#vago-ticket-add) writes the header; don't write one yourself, and don't change the Goal while you add Tickets.

`--workflow <name>` gives one Ticket another Workflow than its Goal's, for the one Ticket that leaves design questions open. It is refused for a Workflow with Goal Steps, unless that Workflow is the Goal's.

In a Vago planning chat, put the Tickets in the proposal block's `tickets` in order instead, each with its `slug`, `body` and `blocked_by` by place in the list from 1.

## After they run

- A Ticket's body stays editable at any time. Each Step reads it when it starts, so fixing a stuck Ticket's text and running `vago run` again builds against the new text.
- A Ticket can't be removed or renumbered with `vago`. Rewrite the body of one that hasn't run yet; fix the work of a `done` one with a new Ticket.
- A Ticket added to a Goal whose Tickets are all done runs on the next `vago run`, and the Goal's `after_all` Steps run again after it.
