# 05: Workflow checks and per-Step settings

**What to build:**

- **Fail-closed checks:** `vago run` checks `.vago/workflow.toml` before any Run and names the problem: unparsable TOML, a duplicate Step `id`, an unknown `type` or `harness`, a missing prompt file, an invalid `on_fail` or `idle_timeout`, a key the Workflow or Step doesn't take.
- **Overrides:** `harness` and `model` per Step.
- **`args`:** set for the Workflow and per Step, appended to the Harness command. A Step's own `args` replace the Workflow's.
- **Freezing:** the Workflow is frozen when `vago run` starts, so edits to `.vago/` during the Goal don't apply.

Spec: [Vago Alpha](../../vago-alpha/spec.md).

**Blocked by:** 03 (Agent Steps on Claude Code).

**Status:** done

- [x] Each invalid Workflow case exits non-zero with a message naming the problem, before any Ticket changes.
- [x] A Step's `model` override reaches the fake `claude`, and other Steps keep the Workflow's model.
- [x] Workflow-level `args` are appended to the command, and a Step's own `args` replace them.
- [x] A Step that edits `workflow.toml` mid-Goal doesn't change later Steps or Tickets in the same run.
