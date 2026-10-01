# 12: The bar: Punt finishes its own 2-Ticket Goal

**What to build:** proof that Alpha meets its bar. On Punt's own repo, with the installed binary and the committed Workflow, the human writes a Goal of two real Tickets, the second blocked by the first, and runs `punt run <goal>` once. Alpha takes the first Ticket through every Step, then the second, with no human touching anything.

Spec: [Punt Alpha](../../punt-alpha/spec.md).

**Blocked by:** 01–11.

**Status:** ready-for-human

- [ ] Both Tickets end `done` in one `punt run`, serially, each with a `[[runs]]` entry for every Step.
- [ ] The work is merged as the Workflow says, and `bun run check` passes afterwards.
- [ ] `punt run` exits 0 and prints the Goal summary.
- [ ] A smoke run on a throwaway repo doesn't count.
