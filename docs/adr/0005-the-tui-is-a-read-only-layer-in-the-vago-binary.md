# The TUI is a read-only layer in the `vago` binary

`vago` with no command opens a full-screen TUI on a terminal, and `vago <command>` stays the CLI it is today. The TUI ships in the same binary, reads Goals, Tickets and Run logs through the kernel's modules, and writes nothing: it doesn't start, stop or reset anything. The kernel doesn't import the TUI, so every command, and every test that runs one, behaves as if the TUI weren't there. A reader might expect the TUI to drive `vago run`, the way Factory's Mission Control sits on its running session. Vago keeps Runs in their own `vago run` processes, so closing the TUI or a bug in it can't stop a Goal.

## Considered options

- A separate program that parses `.vago-goals/` itself, or shells out to `vago` and parses its output: rejected. It would hold a second copy of the Ticket header format, and the two would drift whenever the header changes.
- The TUI owns the `vago run` processes: rejected. Closing it would kill or orphan Goals, and Vago has no daemon to hand them to.
- `vago run` shows the TUI in place of its progress lines: not now. The read-only view comes first.

## Consequences

- To show which Goals are running, the TUI reads the lock that `vago run` holds in `.vago-goals/<goal>/running.lock`, through `tickets.ts`. While the process in the lock lives, the TUI trusts the Ticket files. A Ticket whose file says `running` after its process is gone is shown as `lost`, the outcome the next `vago run` gives its open Run.
- Actions (start, stop, reset, steering) need their own decision before the TUI gets any.
- Claude Code's `stream-json` stays inside its Harness module (architecture rule 4). The TUI renders Run activity that doesn't depend on the Harness, so a second Harness needs no TUI change.
