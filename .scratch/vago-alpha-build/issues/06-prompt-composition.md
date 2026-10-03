# 06: Prompt composition: includes and Step outputs

**What to build:**

- **Include slots:** `[include]` at Workflow level and `include.<name>` per Step. They merge shallowly: a Step's slot is added, or replaces one with the same name. Each file is appended to agent prompts under a heading with the slot's name.
- **Step outputs:** `{{steps.<id>.output}}` substitutes an earlier Step's output from the same Ticket. For shell Steps that's stdout, stderr and the exit code; for agent Steps it's the Harness's final result text.
- **Checks:** a reference to an unknown or later Step, or a missing include file, fails the Workflow check.

Spec: [Vago Alpha](../../vago-alpha/spec.md).

**Blocked by:** 05 (Workflow checks and per-Step settings).

**Status:** done

- [x] The prompt received has each include file under its slot heading.
- [x] A per-Step include adds to the Workflow's slots and replaces one with the same name.
- [x] A shell check's output, failures included, appears in a later review prompt through `{{steps.check.output}}`.
- [x] An agent Step's result text appears in a later prompt.
- [x] A reference to an unknown or later Step, or a missing include file, fails before any Run.

## Comments

- A failing check can't reach review yet: `on_fail = "continue"` takes effect in ticket 07. Here the test reads a check's stdout, stderr and `exit code 0` in a later prompt. Ticket 07 tests the non-zero case.
