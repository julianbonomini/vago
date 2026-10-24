---
title: Chain Goals back to back
description: An after_all Step that merges the Goal's PR, pulls the main checkout and starts vago run on the next Goal in a queue.
order: 1
---

`vago run` takes one Goal. To have the next Goal start when one ends, add an [`after_all`](/docs/workflows/#goal-steps) Step that merges the finished Goal's PR, brings the main checkout up to date and starts the next `vago run` in the background:

```toml
# In a copy of .vago/workflows/small.toml
[[after_all]]
id   = "next-goal"
name = "Next Goal"
type = "shell"
run  = "sh .vago/scripts/next-goal.sh"
```

It runs after `small`'s two `after_all` Steps, PR description and Ready for review, so the PR has its description when it's merged. The script, `.vago/scripts/next-goal.sh`:

```sh
# Merges this Goal's PR, pulls the main checkout, and starts `vago run` on the
# first Goal in .vago-goals/queue, then takes that Goal off the queue. Safe to
# run again: a merged PR isn't merged twice.
set -eu

root="$VAGO_PROJECT_ROOT"
queue="$root/.vago-goals/queue"

if [ "$(gh pr view "vago/$VAGO_GOAL" --json state --jq .state)" != MERGED ]; then
	gh pr merge "vago/$VAGO_GOAL" --squash
fi
git -C "$root" pull --ff-only

next="$(head -n 1 "$queue" 2>/dev/null || true)"
[ -n "$next" ] || exit 0
cd "$root"
nohup vago run "$next" >"$root/.vago-goals/$next/vago-run.log" 2>&1 &
sed -i.bak 1d "$queue" && rm "$queue.bak"
```

The queue is a plain file, `.vago-goals/queue`, with one Goal name per line, in the order they should run. Each Goal in it needs its Tickets written before its turn comes. `vago init` lists `.vago-goals/` in `.git/info/exclude`, so the queue never lands in a commit.

Pick this Workflow for each Goal in the chain: `vago goal new <goal> --workflow chain` for a copy named `chain.toml`. A Goal on another Workflow ends the chain.

## Caveats

- Vago doesn't fetch before it cuts a Goal's branch. It cuts `vago/<goal>` from the main checkout's default branch as it is, which is why the script pulls before it starts the next Goal. Without the pull, the next Goal starts from a `main` that lacks the Goal just merged.
- `git pull --ff-only` needs the main checkout on its default branch, with no change to a tracked file that the pull would overwrite. Otherwise the Step fails and the Goal goes stuck with its PR merged; fix the checkout, then `vago run` the Goal again to finish the chain.
- The PR is merged without a human reading it. Chain only Goals whose checks you trust, and expect `gh pr merge` to fail when the repo requires an approving review.
- The next `vago run` writes to `.vago-goals/<next>/vago-run.log`, not your terminal. Open `vago` to watch it in the TUI.
