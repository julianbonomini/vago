---
title: Run Steps once per Goal
description: before_all Steps that set up the Goal's worktree before its first Ticket, and after_all Steps that run once every Ticket is done.
order: 7
---

[Goal Steps](/docs/workflows/#goal-steps) run once for the whole Goal instead of once per Ticket. `[[before_all]]` Steps run before the Goal's first Ticket; `[[after_all]]` Steps run once no Tickets are left. This adds one of each to `small`:

```toml
# In a copy of .vago/workflows/small.toml
[[before_all]]
id   = "install"
name = "Install"
type = "shell"
run  = "npm ci"

[[after_all]]
id   = "notify"
name = "Notify"
type = "shell"
run  = "sh .vago/scripts/notify.sh"
```

`install` installs the dependencies the Goal's branch locks, in the Goal's worktree, where the Steps run. It runs once, on the first `vago run` that has a Ticket to take, and not again once it has gone through.

`notify` runs after `small`'s PR description and Ready for review. `.vago/scripts/notify.sh` posts to a Slack webhook whose URL is in your environment:

```sh
set -eu
curl -fsS -X POST -H 'Content-Type: application/json' \
	-d "{\"text\": \"Goal $VAGO_GOAL is done.\"}" \
	"$SLACK_WEBHOOK_URL"
```

Shell Steps get the environment `vago run` has, so `SLACK_WEBHOOK_URL` must be set where you start it.

## Caveats

- `after_all` runs again after any Ticket added since its last pass is done, including one a Goal review adds, so `notify.sh` can post twice. A Step that mustn't repeat checks for itself, as the starter's `ready.sh` checks for its comment before posting it.
- A Goal Step has `$VAGO_GOAL` and `$VAGO_PROJECT_ROOT` but no Ticket: no `$VAGO_TICKET`, and a Goal Step whose prompt reads `{{ticket}}` is refused.
- A failed Goal Step leaves the Goal stuck, and the next `vago run` picks it up at that Step. There is no reset; to run `before_all` again from its first Step, delete its `[[runs]]` tables from `goal.md`'s header.
