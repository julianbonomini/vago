---
title: Contribute to someone else's repo
description: Run Goals in a repo you don't own with no Vago file, Goal, prompt or Run report in any commit or PR.
order: 5
---

In a repo you don't own, such as an open-source project you're sending a PR to, your Workflow, prompts, skills and Goals are yours and stay out of the history. Three things keep them out.

First, answer no when [`vago init`](/docs/cli-reference/#vago-init) asks `Commit the Workflow? [y/N]`. It then lists `.vago/` and each `vago-` skill's folder in `.git/info/exclude`, next to `.vago-goals/`, which it lists either way. `.git/info/exclude` is your clone's own ignore file and is never committed, so the files stay in your checkout and out of `git status`, in the main checkout and in each Goal's worktree. Vago copies `.vago/` into the worktree on every `vago run` and hides it from git there too.

Second, use a Workflow that merges each Ticket locally and opens no PR, since the starter's `merge.sh` makes the PR's body the Goal report, with every Run's time and cost:

```toml
# .vago/workflows/contribute.toml
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
run     = "sh .vago/scripts/check.sh"
on_fail = "continue"

[[steps]]
id     = "review"
name   = "Review"
type   = "agent"
prompt = "prompts/small-review.md"

[[steps]]
id   = "merge"
name = "Squash merge"
type = "shell"
run  = "sh .vago/scripts/merge-local.sh"
```

`merge-local.sh` is `merge.sh` up to its push, as in [Solo](/cookbook/solo/), and `check.sh` runs the project's own checks, as in [Your own check Step](/cookbook/your-own-check/). With no [`after_all`](/docs/workflows/#goal-steps) Steps, the Goal ends with its work squashed into `vago/<goal>`, one commit per Ticket.

Third, read the branch before it leaves your machine, then push it to your fork under the name you want and open the PR yourself:

```sh
git log -p main..vago/<goal>
git push origin vago/<goal>:fix-parser-crash
gh pr create --head fix-parser-crash
```

## Caveats

- Vago doesn't fetch before it cuts a Goal's branch: it cuts `vago/<goal>` from your clone's default branch as it is. Pull the upstream repo into it before `vago goal new`, as in `git pull upstream main`.
- Each Ticket's commit message is its name with spaces, such as `03 fix parser crash` for the Ticket `03-fix-parser-crash`. Reword them before you push if the project has its own commit style.
- The agents commit with your git identity, and the Harness may add its own trailer to their commits, such as a `Co-Authored-By` line. Check the log, and the Harness's own settings, if the project has rules about either.
