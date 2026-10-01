# 04: Goals of several Tickets

**What to build:** `punt run <goal>` works through a whole Goal:

- **Order:** a Ticket is ready when it's `ready` and every Ticket in `blocked_by` is `done`. The lowest number goes first, one Ticket at a time.
- **Format checks before any Run:** the Goal exists, every header parses, every blocker exists, there are no cycles. A bad file means nothing runs.
- **Finishing:** Alpha exits when no Ticket is ready, with exit code 0 only if every Ticket is `done`, and prints a Goal summary.

Spec: [Punt Alpha](../../punt-alpha/spec.md).

**Blocked by:** 02 (Tracer bullet).

**Status:** ready-for-agent

- [ ] Two Tickets, the second blocked by the first, run in that order and both end `done`.
- [ ] With no blockers, the lower-numbered Ticket runs first.
- [ ] A missing Goal, an unparsable header, an unknown blocker or a cycle exits non-zero with a message naming the problem, and no Ticket changes.
- [ ] The Goal summary is printed on exit.
- [ ] Header rewrites leave every Ticket body byte-for-byte unchanged.
