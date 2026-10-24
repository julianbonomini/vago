---
title: Review on Codex
description: Claude Code builds each Ticket and Codex reviews it, by giving the review Step its own harness and model.
order: 3
---

To have Codex review what Claude Code built, give `small`'s review Step its own [`harness` and `model`](/docs/workflows/#harnesses-and-models), and the rest of the Workflow stays on Claude Code:

```toml
# In a copy of .vago/workflows/small.toml
[[steps]]
id      = "review"
name    = "Review"
type    = "agent"
prompt  = "prompts/small-review.md"
harness = "codex"
model   = "gpt-6-sol"
```

A Step that sets `harness` sets `model` too, since a model belongs to one Harness. The same works for the Goal review, with `id = "goal-review"`, or any other agent Step.

The starter prompts work on either Harness. `vago init` puts the `vago-` skills they run in `.agents/skills/`, where Codex reads them, as well as in `.claude/skills/`.

## Caveats

- `codex` must be on your `PATH`, logged in, at a version whose `codex exec` has `--approve-for-me`.
- A Step without its own [`args`](/docs/workflows/#args) gets the Workflow's. If the Workflow sets `args` for Claude Code, give the Codex Step its own, or `args = []`.
- Codex reports no cost. Vago prices a Codex Run from its tokens and the model's list price, and shows no cost for a model it has no price for.
