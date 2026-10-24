---
title: Give one Ticket another Workflow
description: A Workflow for one Ticket of a Goal, such as a docs Ticket in a Goal of code Tickets, named with vago ticket add --workflow.
order: 6
---

Each Ticket goes through its Goal's Workflow unless it names another. A Goal of code Tickets can have one docs Ticket that needs no tests and a writer's prompt in place of a builder's. Write that Workflow next to the Goal's:

```toml
# .vago/workflows/docs.toml
harness      = "claude-code"
model        = "claude-opus-5-5"
idle_timeout = "10m"

[[steps]]
id   = "branch"
name = "New branch"
type = "shell"
run  = "sh .vago/scripts/branch.sh"

[[steps]]
id     = "write"
name   = "Write"
type   = "agent"
prompt = "prompts/docs-write.md"

[[steps]]
id     = "review"
name   = "Review"
type   = "agent"
prompt = "prompts/docs-review.md"

[[steps]]
id   = "merge"
name = "Squash merge"
type = "shell"
run  = "sh .vago/scripts/merge.sh"
```

The two prompts are yours to write, in `.vago/prompts/`. A writer's prompt might say:

```markdown
You write the docs this Ticket asks for, on the branch that is already
checked out. Change only files under docs/. Commit with short imperative
messages. Your final message lists each page you changed.

# Ticket

{{ticket}}
```

Then add the Ticket with [`--workflow`](/docs/cli-reference/#vago-ticket-add):

```sh
vago ticket add search usage-docs --blocked-by 2 --workflow docs --body-file usage-docs.md
```

This writes `workflow = "docs"` into the Ticket's header. The Ticket goes through `docs`, and the Goal's other Tickets keep the Goal's Workflow. [Goals and Tickets](/docs/goals-and-tickets/#a-ticket-with-its-own-workflow) has the details.

The Ticket keeps the same branch and the same `merge.sh` as the rest of the Goal, so its commit lands on `vago/<goal>` and in the Goal's PR like any other.

## Caveats

- `vago ticket add --workflow` refuses a Workflow with [`before_all` or `after_all`](/docs/workflows/#goal-steps) Steps unless it is the Goal's own. Only the Goal's Workflow runs Goal Steps.
- A Step with [`when = "last-ticket"`](/docs/workflows/#when) runs only in the Workflow of the Ticket it lands on. If the docs Ticket is the Goal's last, the Goal review in the Goal's Workflow never runs. Give `docs` its own Goal review Step with `when = "last-ticket"` if the docs Ticket may end the Goal.
