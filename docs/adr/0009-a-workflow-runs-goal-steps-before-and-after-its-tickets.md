# A Workflow runs Goal Steps before and after its Tickets

A Workflow can list two groups of Goal Steps beside its `[[steps]]`: `[[before_all]]` runs once before the Goal's first Ticket, and `[[after_all]]` runs once every Ticket is done. They take the same Step types and options as Ticket Steps, run in the Goal's worktree on `vago/<goal>`, and fail and get picked up the way a Ticket's Steps do. Their Runs are recorded in `goal.md` (ADR 0008).

Before this, a Workflow listed only the Steps each Ticket goes through, so work for the whole Goal had to ride on a Ticket. The starter's `merge.sh` checked `$VAGO_LAST_TICKET` to add the `ready-for-review` label and ping the human, and a Slack notification, an agent that rewrites the PR description, or setup when a Goal starts had no place that wouldn't run on every Ticket. The names follow test frameworks' `beforeAll` and `afterAll`.

- `before_all` runs on the first `vago run` that has a Ticket to take, and not again once it has gone through.
- `after_all` runs once every Ticket is done. When one of its Steps adds Tickets, they run, and then the whole `after_all` list runs again, so an agent that finds more work at the Goal's end leads to a real finish. A Step that mustn't repeat, like the starter's ping in `ready.sh`, checks for itself.
- A failed Goal Step leaves the Goal stuck, and the next `vago run` picks its group's pass up at that Step under ADR 0007's rules: a shell Step runs again, an agent Step resumes its session, and a failed agent Step is retried after 1, 1 and 5 minutes. A Goal Step has no reset.
- Shell Goal Steps get `$VAGO_GOAL` and `$VAGO_PROJECT_ROOT`, not `$VAGO_TICKET` or `$VAGO_LAST_TICKET`. An agent Goal Step's prompt gets `{{goal}}` and `{{goal_name}}`, and `loadWorkflow` refuses one that reads `{{ticket}}`.
- `{{steps.<id>.output}}` reads only Steps of the same group, and `loadWorkflow` refuses a reference to another group's Step, so no prompt depends on a Step that ran for something else.
- Only the Goal's Workflow's Goal Steps run. `vago ticket add --workflow` refuses a Workflow other than the Goal's that has Goal Steps, since a Ticket's own Workflow would otherwise seem to bring them along.

## Considered options

- **Keep Goal work in Ticket Steps with `when = "last-ticket"`, and add a `first-ticket`.** Such a Step runs on a Ticket's branch and is recorded as that Ticket's, and a script every Ticket runs, like `merge.sh`, has to branch on `$VAGO_LAST_TICKET` to do Goal work once.
- **Per-Ticket `before_each` and `after_each` groups.** A Ticket's first and last Steps already do that.
- **Move the Goal review into `after_all`.** Left for later. The Goal review stays a `last-ticket` Ticket Step, as it was, so nothing that worked before changes.

## Consequences

- The starter Workflows' `after_all` holds one shell Step, `ready`, which runs `ready.sh` to add the label and post the ping once. `merge.sh` only merges, pushes and keeps the PR and its body current. The starter's `before_all` is empty.
- `when = "last-ticket"` and `$VAGO_LAST_TICKET` stay for Ticket Steps. A Goal Step runs whatever its `when` says.
- A Goal with every Ticket done isn't done until `after_all` has gone through, so a stuck `after_all` Step makes `vago run` exit non-zero and shows the Goal stuck in the TUI.
- Goal Steps' Runs count in the Goal's totals and per-Step totals, and the Goal report and the Goal view list them before and after the Tickets.
