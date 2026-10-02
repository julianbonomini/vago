# 05: Workflow checks and per-Step settings

**What to build:**

- **Fail-closed checks:** `punt run` checks `.punt/workflow.toml` before any Run and names the problem: unparsable TOML, a duplicate Step `id`, an unknown `type` or `harness`, a missing prompt file, an invalid `on_fail` or `idle_timeout`, a key the Workflow or Step doesn't take.
- **Overrides:** `harness` and `model` per Step.
- **`args`:** set for the Workflow and per Step, appended to the Harness command. A Step's own `args` replace the Workflow's.
- **Freezing:** the Workflow is frozen when `punt run` starts, so edits to `.punt/` during the Goal don't apply.

Spec: [Punt Alpha](../../punt-alpha/spec.md).

**Blocked by:** 03 (Agent Steps on Claude Code).

**Status:** done

- [x] Each invalid Workflow case exits non-zero with a message naming the problem, before any Ticket changes.
- [x] A Step's `model` override reaches the fake `claude`, and other Steps keep the Workflow's model.
- [x] Workflow-level `args` are appended to the command, and a Step's own `args` replace them.
- [x] A Step that edits `workflow.toml` mid-Goal doesn't change later Steps or Tickets in the same run.
