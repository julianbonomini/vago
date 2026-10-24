---
title: Cookbook
description: Example Workflows, each a short TOML file you copy into .vago/workflows/ and change.
order: 0
---

A Workflow is a TOML file in your Project's `.vago/workflows/`, and every recipe here is one. Each shows the Workflow, or the part of it that changes, and says what it's for. The [Workflows](/docs/workflows/) page has every key they use.

The first line of each TOML block says where it goes:

- `# .vago/workflows/solo.toml` is that whole file.
- `# In a copy of .vago/workflows/small.toml` changes the starter Workflow `small`. A Step in it replaces the Step with the same `id` in the same list, or goes at the end of that list when `small` has no such Step. A top-level key, such as `model`, replaces `small`'s.

Make the copy before you change it, as in `cp .vago/workflows/small.toml .vago/workflows/mine.toml`. [`vago update`](/docs/cli-reference/#vago-update) overwrites a starter file that differs from Vago's, so a change made to `small.toml` itself is gone after the next update. The same goes for the starter's prompts and scripts: copy one under a new name before you change it.

The recipes:

- [Chain Goals back to back](/cookbook/chain-goals/): merge the Goal's PR and start the next Goal when one ends.
- [Solo: merge straight to main](/cookbook/solo/): no PR, the Goal's work goes onto `main` when it ends.
- [Review on Codex](/cookbook/review-on-codex/): Claude Code builds each Ticket and Codex reviews it.
- [Your own check Step](/cookbook/your-own-check/): run your lint, typecheck and tests in place of `bun run check`.
- [Contribute to someone else's repo](/cookbook/contribute-to-open-source/): no Vago file, Goal or Run report in any commit or PR.
- [Give one Ticket another Workflow](/cookbook/one-ticket-another-workflow/): a docs-only Ticket in a Goal of code Tickets.
- [Run Steps once per Goal](/cookbook/once-per-goal/): `before_all` and `after_all`.
