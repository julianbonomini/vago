# 06: Prompt composition: includes and Step outputs

**What to build:**

- **Include slots:** `[include]` at Workflow level and `include.<name>` per Step. They merge shallowly: a Step's slot is added, or replaces one with the same name. Each file is appended to agent prompts under a heading with the slot's name.
- **Step outputs:** `{{steps.<id>.output}}` substitutes an earlier Step's output from the same Ticket. For shell Steps that's stdout, stderr and the exit code; for agent Steps it's the Harness's final result text.
- **Checks:** a reference to an unknown or later Step, or a missing include file, fails the Workflow check.

Spec: [Punt Alpha](../../punt-alpha/spec.md).

**Blocked by:** 05 (Workflow checks and per-Step settings).

**Status:** ready-for-agent

- [ ] The prompt received has each include file under its slot heading.
- [ ] A per-Step include adds to the Workflow's slots and replaces one with the same name.
- [ ] A shell check's output, failures included, appears in a later review prompt through `{{steps.check.output}}`.
- [ ] An agent Step's result text appears in a later prompt.
- [ ] A reference to an unknown or later Step, or a missing include file, fails before any Run.
