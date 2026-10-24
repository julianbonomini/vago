---
title: "Solo: merge straight to main"
description: A Workflow with no PR, which squash-merges each Ticket on the Goal's branch and fast-forwards main to it when the Goal ends.
order: 2
---

When you work alone and don't want a PR, merge each Ticket into the Goal's branch locally, and move `main` to that branch in an [`after_all`](/docs/workflows/#goal-steps) Step when the Goal ends. This is `small` without its push, its PR and its two PR Steps:

```toml
# .vago/workflows/solo.toml
harness      = "claude-code"
model        = "claude-opus-5-5"
idle_timeout = "10m"

[[steps]]
id   = "branch"
name = "New branch"
type = "shell"
run  = "sh .vago/scripts/branch.sh"

[[steps]]
id     = "implement"
name   = "Build"
type   = "agent"
prompt = "prompts/small-implement.md"

[[steps]]
id      = "check"
name    = "Checks"
type    = "shell"
run     = "bun run check"
on_fail = "continue"

[[steps]]
id     = "review"
name   = "Review"
type   = "agent"
prompt = "prompts/small-review.md"

[[steps]]
id     = "goal-review"
name   = "Goal review"
type   = "agent"
prompt = "prompts/goal-review.md"
when   = "last-ticket"

[[steps]]
id   = "merge"
name = "Squash merge"
type = "shell"
run  = "sh .vago/scripts/merge-local.sh"

[[after_all]]
id   = "to-main"
name = "Onto main"
type = "shell"
run  = "sh .vago/scripts/to-main.sh"
```

`merge-local.sh` is the starter's `merge.sh` up to its push. Copy it and delete everything from the line `doing="pushing $goal to origin"` to the end:

```sh
cp .vago/scripts/merge.sh .vago/scripts/merge-local.sh
```

What's left squashes the Ticket's branch into `vago/<goal>` as one commit and deletes the branch, and is safe to run again, as `merge.sh` is. `.vago/scripts/to-main.sh` moves `main` in the main checkout to the Goal's branch and pushes it:

```sh
# Fast-forwards main in the main checkout to vago/<goal> and pushes it.
set -eu

cd "$VAGO_PROJECT_ROOT"
if [ "$(git branch --show-current)" != main ]; then
	echo "The main checkout isn't on main."
	exit 1
fi
git merge --ff-only "vago/$VAGO_GOAL"
git push origin main
```

Start a Goal on it with `vago goal new <goal> --workflow solo`.

## Caveats

- The fast-forward fails when `main` has moved since the Goal's branch was cut, and the Goal goes stuck. Rebase `vago/<goal>` onto `main` in the Goal's worktree, whose path `vago run` prints, then `vago run` the Goal again.
- Drop the `git push` line if the repo has no remote. Vago keeps a done Goal's worktree while its branch has commits on no remote branch, and removes it once they're pushed, so without the push the worktree stays.
- With no PR there is no Goal report on GitHub. Run [`vago goal report`](/docs/cli-reference/#vago-goal-report) to read it.
