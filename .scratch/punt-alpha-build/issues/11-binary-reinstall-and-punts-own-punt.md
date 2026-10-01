# 11: Binary, reinstall and Punt's own `.punt/`

**What to build:** a `bun build --compile` binary that embeds the starter Workflow, and a `reinstall` package script, not named `install`, that builds it and puts it on `PATH`. The human runs the script between Goals, and no Workflow Step ever runs it. Then Punt's own `.punt/workflow.toml` is made by running `punt init` on Punt's repo and committed as the reference copy of the starter.

Spec: [Punt Alpha](../../punt-alpha/spec.md).

**Blocked by:** 10 (`punt init` and the starter Workflow).

**Status:** ready-for-agent

- [ ] `bun run reinstall` produces a working `punt` on `PATH`, and the binary has no runtime dependency on the repo.
- [ ] The compiled binary's `punt init` writes the same starter files as the source.
- [ ] Punt's repo has a committed `.punt/workflow.toml`, and `.punt/goals/` is excluded.
- [ ] `bun run check` passes.
