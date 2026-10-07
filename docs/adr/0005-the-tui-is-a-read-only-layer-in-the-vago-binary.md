# The TUI is a read-only layer in the `vago` binary

`vago` with no command opens a full-screen TUI on a terminal, and `vago <command>` stays the CLI it is today. The TUI ships in the same binary, reads Goals, Tickets and Run logs through the kernel's modules, and writes no Goal or Ticket. Its one action on a Goal is starting a ready one: it starts `vago run <goal>` as a process of its own, in its own process group with its output discarded, and lets go of it. It never stops or resets a Goal, and never owns the run it started. The kernel doesn't import the TUI, so every command, and every test that runs one, behaves as if the TUI weren't there. A reader might expect the TUI to drive `vago run`, the way Factory's Mission Control sits on its running session. Vago keeps Runs in their own `vago run` processes, so closing the TUI or a bug in it can't stop a Goal.

## Considered options

- A separate program that parses `.vago-goals/` itself, or shells out to `vago` and parses its output: rejected. It would hold a second copy of the Ticket header format, and the two would drift whenever the header changes.
- The TUI owns the `vago run` processes: rejected. Closing it would kill or orphan Goals, and Vago has no daemon to hand them to.
- `vago run` shows the TUI in place of its progress lines: not now. The read-only view comes first.

## Consequences

- To show which Goals are running, the TUI reads the lock that `vago run` holds in `.vago-goals/<goal>/running.lock`, through `tickets.ts`. While the process in the lock lives, the TUI trusts the Ticket files. A Ticket whose file says `running` after its process is gone is shown as `lost`, the outcome the next `vago run` gives its open Run.
- A Goal the TUI started shows as running through its lock, like one started from a terminal, and keeps running when the TUI quits or its terminal closes. Two starts of one Goal race for its lock, and the loser exits, so the TUI needs no guard of its own beyond refusing a Goal that isn't ready.
- The TUI also makes and renames planning items (ADR 0010), through `tickets.ts` as `vago plan new` and `vago plan rename` do, and discards them by running `vago plan discard <item>` and waiting for it. Discarding stops a response in progress (ADR 0014); the CLI stops it, so the TUI still stops no process itself. These write only a planning item's own folder, and `tickets.ts` refuses them for a Goal, so they never change a Goal or start a Run. A planning item is never started: Start refuses anything but a ready Goal.
- The TUI also sends a planning item's agent the human's message (ADR 0011): it starts `vago plan say <item>` with the message on stdin, cut loose like `vago run`, and never owns the response. Quitting the TUI leaves the response being written. It starts `vago plan retry <item>` for Retry response the same way.
- The TUI also records the human's Workflow choice for a planning item's Proposal (ADR 0012) through `tickets.ts`, as `vago plan workflow` does. It writes only that item's `planning/workflow.toml`.
- The TUI accepts a planning item's Proposal by running `vago plan accept <item>` in a process of its own and waiting for its answer, so it still writes no Goal or Ticket itself and a quit can't cut acceptance short. Accepting starts nothing; only Start does. An accepted Goal's planning chat opens read-only from its Goal view.
- Other actions (stop, reset, steering) need their own decision before the TUI gets any.
- Claude Code's `stream-json` stays inside its Harness module (architecture rule 4). The TUI renders Run activity that doesn't depend on the Harness, so a second Harness needs no TUI change.
