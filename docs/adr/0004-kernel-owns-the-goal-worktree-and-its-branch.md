# The kernel owns each Goal's worktree and its branch

Vago runs each Goal's Steps in the Goal's own git worktree, outside the repo, under `$VAGO_HOME/worktrees/` (`~/.vago` by default). The worktree checks out `vago/<goal>`, which Vago cuts from the repo's default branch, and holds a copy of every untracked and ignored file of the main checkout except `.vago-goals/`: `node_modules/`, `.env`, local settings and an untracked `.vago/`. Steps run there as they would in the main checkout, with no install Step. The kernel owns that worktree and that one branch. Every other git action stays the Workflow's: Ticket branches, commits, merges, pushes and PRs.

This supersedes ADR 0002, which kept the kernel free of git. With Steps in the human's checkout, the human couldn't touch it while a Goal ran, and two Goals couldn't run at once. A worktree per Goal costs a small amount of git in the kernel: one `git worktree add` per Goal and a few reads.

## Consequences

- The human may use the main checkout while Goals run, and its branch and files never change.
- Goal and Ticket state, `[[runs]]` and logs stay in the main checkout's `.vago-goals/`. A `vago` command started inside a Goal's worktree finds the main checkout, and shell Steps get its path in `VAGO_PROJECT_ROOT`.
- `.git/info/exclude` and git config are shared by every worktree of the repo.
- Running a Goal again reuses its worktree with the work in it. Untracked files are copied only when the worktree is created, except an untracked `.vago/`, which is copied again on every run so its scripts and prompts match the Workflow read from the main checkout.
- `vago/<goal>` is cut with no upstream, so a Workflow's `git push` never aims at the default branch by accident.
- `VAGO_HOME` moves the folder, which the tests use to stay out of the real home folder.
