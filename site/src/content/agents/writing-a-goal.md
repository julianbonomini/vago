---
title: Writing a Goal
description: Rules for the goal.md an agent writes, which every agent Step of every Ticket reads with no human to ask.
order: 2
---

A [Goal](/docs/glossary/#goal) is the spec its Tickets build. Every agent Step of every Ticket can read it through `{{goal}}`, and none of them can ask the human a question, so the Goal carries everything the Steps share. The format is in [Goals and Tickets](/docs/goals-and-tickets/).

## Rules

- **Open with a `# ` heading that says what is true when the Goal is done.** The TUI and `vago goal report` show it as the Goal's title. "# Search ranks by relevance", not "# Search work".
- **Write the problem from the user's side, then the solution from the user's side.** Code comes later, under implementation decisions.
- **Put down only decisions the human made.** What nobody decided stays open for the Workflow's Steps to decide. A Goal that invents decisions binds every Ticket to a guess.
- **Name the seam the Tickets test through.** Prefer one that exists, and the highest one the code offers.
- **Say what is out of scope.** An agent without a boundary builds past it.
- **Say what the human checks after merging:** what only a real run or a person can see, and any change to what drives the Goal (`.vago/`, the installed `vago`, the scripts its Workflow calls). Those take effect only once the Goal is merged.
- **Use the Project's domain words** as its glossary spells them, and file paths where they save a Step from searching. A Goal runs within hours, so paths stay true.
- **Name the Goal** with letters, digits, `-` and `_` only. It is the folder name and part of the branch `vago/<goal>`.

## Template

The starter skill `vago-to-goal` writes a Goal in this shape:

```markdown
# <What's true when the Goal is done>

## Problem Statement
## Solution
## User Stories
## Implementation Decisions
## Testing Decisions
## Out of Scope
## After Merging
## Further Notes
```

## Creating it

Write the text to a file outside the Project's tree, then:

```sh
vago goal new <goal> --workflow <name> --body-file <file>
```

`--workflow` names a file in `.vago/workflows/` without `.toml`. Recommend one to the human by the Goal's size: `small` when the Tickets are small and clear, `try-hard` when a Ticket leaves design questions open. [`vago goal new`](/docs/cli-reference/#vago-goal-new) refuses an existing Goal and a Workflow `vago run` would refuse, and creates nothing.

In a Vago planning chat you don't run `vago` and can't write files. Put the Goal in the `goal` field of the proposal block the planning instructions describe, and the human accepts it. See [Planning a Goal in the TUI](/docs/planning-a-goal/).

## Changing it

- The text below the header is the human's. Change it only when they ask.
- Only Vago writes the header. The one line the human may change by hand between runs is `workflow`.
- A Goal can't be renamed or deleted with `vago`.
