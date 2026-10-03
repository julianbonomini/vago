# Alpha's kernel owns no git and no workspace

Alpha runs a Project's Workflow Steps in the human's own checkout, and it never creates branches, worktrees, commits or merges itself. Every git action is a Step's job, done through an agent prompt or a shell command. The kernel stays a primitive with only `agent` and `shell` Steps, and opinions such as a branch per Goal live in the starter Workflow that `vago init` copies into the Project. A reader might expect an orchestrator to own its workspace and branches, as warren and Sandcastle do. Alpha doesn't, so the kernel stays small and Projects stay free to choose.

## Consequences

- Alpha can't tell a human's edit to `.vago/` from an agent's, so it can't read merge rules from a base branch the way warren does. Instead the Workflow is frozen when Alpha starts a Goal, and a change applies only after a restart.
- The human must leave their checkout alone while a Goal runs. A worktree per Goal, and gate and merge Step primitives, are the expected next steps after Alpha.
