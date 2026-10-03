# 04: Goals of several Tickets

**What to build:** `vago run <goal>` works through a whole Goal:

- **Order:** a Ticket is ready when it's `ready` and every Ticket in `blocked_by` is `done`. The lowest number goes first, one Ticket at a time.
- **Format checks before any Run:** the Goal exists, every header parses, every blocker exists, there are no cycles. A bad file means nothing runs.
- **Finishing:** Alpha exits when no Ticket is ready, with exit code 0 only if every Ticket is `done`, and prints a Goal summary.

Spec: [Vago Alpha](../../vago-alpha/spec.md).

**Blocked by:** 02 (Tracer bullet).

**Status:** done

- [x] Two Tickets, the second blocked by the first, run in that order and both end `done`.
- [x] With no blockers, the lower-numbered Ticket runs first.
- [x] A missing Goal, an unparsable header, an unknown blocker or a cycle exits non-zero with a message naming the problem, and no Ticket changes.
- [x] The Goal summary is printed on exit.
- [x] Header rewrites leave every Ticket body byte-for-byte unchanged.
