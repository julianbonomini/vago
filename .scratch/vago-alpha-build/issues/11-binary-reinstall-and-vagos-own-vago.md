# 11: Binary, reinstall and Vago's own `.vago/`

**What to build:** a `bun build --compile` binary that embeds the starter Workflow, and a `reinstall` package script, not named `install`, that builds it and puts it on `PATH`. The human runs the script between Goals, and no Workflow Step ever runs it. Then Vago's own `.vago/workflow.toml` is made by running `vago init` on Vago's repo and committed as the reference copy of the starter.

Spec: [Vago Alpha](../../vago-alpha/spec.md).

**Blocked by:** 10 (`vago init` and the starter Workflow).

**Status:** done

- [x] `bun run reinstall` produces a working `vago` on `PATH`, and the binary has no runtime dependency on the repo.
- [x] The compiled binary's `vago init` writes the same starter files as the source.
- [x] Vago's repo has a committed `.vago/workflow.toml`, and `.vago/goals/` is excluded.
- [x] `bun run check` passes.
