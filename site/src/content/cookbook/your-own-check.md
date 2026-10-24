---
title: Your own check Step
description: Run your Project's lint, typecheck and tests in the check Step, every one even when an earlier one fails, for the review Step to read.
order: 4
---

The starter's check Step runs `bun run check`. In a Project that checks itself some other way, point the Step at a script that runs your checks:

```toml
# In a copy of .vago/workflows/small.toml
[[steps]]
id      = "check"
name    = "Checks"
type    = "shell"
run     = "sh .vago/scripts/check.sh"
on_fail = "continue"
```

`.vago/scripts/check.sh` runs each check even when one before it failed, so the log holds every failure, and exits non-zero if any did:

```sh
set -u

failed=0
npm run lint || failed=1
npx tsc --noEmit || failed=1
npm test || failed=1
exit "$failed"
```

With [`on_fail = "continue"`](/docs/workflows/#on_fail) a failed check doesn't stop the Ticket: the review Step reads the whole log through [`{{steps.check.output}}`](/docs/workflows/#step-outputs), which starts with the exit code, and fixes what failed. With `on_fail = "stop"`, a failed check leaves the Ticket stuck at this Step for you to look at.

Keep the id `check`. The starter's review prompt reads `{{steps.check.output}}`, and Vago refuses a Workflow whose prompt reads a Step it doesn't have.

## Caveats

- The starter's prompts tell the agents to run `bun run check` before they finish. Copy `small-implement.md`, `small-review.md` and `goal-review.md` under new names, change `bun run check` to `sh .vago/scripts/check.sh` in each, and point your Workflow's Steps at the copies. A `check` script in `package.json` that runs all three also works, since `bun run check` runs it.
- A check that runs for long without printing anything is fine: [`idle_timeout`](/docs/workflows/#idle_timeout) applies to agent Steps, not shell Steps.
