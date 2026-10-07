# A planning response holds its item's lock

A `vago plan say <item>` or `vago plan retry <item>` holds the item's `running.lock`, the lock `vago run` takes on a Goal (ADR 0005) and `vago plan accept` takes on an item (ADR 0013), for the whole of the response, through `withPlanningItemClaimed` in `tickets.ts`. A second send while it holds the lock is refused. A planning turn whose last response is open while no live process holds the lock is interrupted: its `vago` died, was SIGKILLed or went down with the machine. `tickets.ts` reads that as `interrupted` and writes nothing, as it reads a running Ticket whose `vago run` is gone as lost. A `vago plan say` that is stopped with SIGTERM records the turn as `interrupted` itself.

Retry response reopens the same turn rather than appending a new one, so the human's message is never recorded twice. The interrupted attempt's log stays in the turn's `interrupted_logs`, and the turn gets a new log, `logs/turn-NN-retry-K.jsonl`. When the attempt reported a session id, the retry resumes that session and tells the agent to continue its answer. Otherwise the message never reached the agent, and the retry sends it as the first attempt did. A new message after an interruption closes the interrupted turn as `interrupted` and starts a turn of its own.

## Considered options

- **A second lock, `planning/answering.lock`, taken when a turn starts and released when it ends.** The lock's lifetime would be split across two calls that every caller must pair. Accept would hold `running.lock` while a send held the other, so a message could land in a Goal that was just accepted. Every write to a turn would also need a guard against a folder discarded meanwhile.
- **The worker's pid in `chat.toml`, checked for liveness.** That is a second lock format beside `running.lock`, with its own takeover rules.

## Consequences

- Rename, discard and accept take the same lock, so none of them overlaps a response or each other. A rename is refused while a response is being written, and an interrupted turn no longer blocks it.
- `vago plan discard` stops the holder first: SIGTERM, then SIGKILL after 10 seconds, then it takes the lock and removes the folder. Taking a lock never creates its folder, so a `vago plan say` that loses the race to a discard can't bring the item back as an empty folder.
- Accept is refused after an interrupted last response: the human's last message has no answer, and an accepted Goal must never keep an open turn, which would read as live while `vago run` holds the Goal.
- `running.lock` keeps its name though it now marks a run, an acceptance, a response, a rename or a discard. Renaming it would break the lock of a `vago run` still running across an upgrade.
- While a rename, accept or discard holds the lock for a moment, a dead open turn reads as being written.
- A pid reused after a restart can make a dead worker look alive, as it can for a Goal's `vago run`.
- A SIGKILLed `vago plan say` leaves its sandboxed Harness running in its own process group. A retry that resumes the same session can race it. The Harness can't write under the Project.
