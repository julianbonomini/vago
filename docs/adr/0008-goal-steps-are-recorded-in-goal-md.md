# Goal Steps are recorded in goal.md

A Workflow's `[[before_all]]` and `[[after_all]]` Steps run once for the whole Goal, and their Runs go in `goal.md`'s header as `[[runs]]` tables, in the same format as a Ticket's. A Goal has no status field. Whether `before_all` has succeeded, and where a stuck one picks up, come from those Runs, the way a picked-up Ticket's place comes from its own (ADR 0007): `before_all` has succeeded when its latest pass ends with a closed Run of its last Step that the pass goes on from, and otherwise the next `vago run` picks it up at the Step of its last Run.

A Goal Step's log is `logs/<group>-<id>-<position>`, like `logs/before_all-setup-1.log`, so it names its group and can't collide with a Ticket's `NN-` logs. Step ids are unique across a Workflow's three lists, which is how a Run in `goal.md` is tied to its group.

## Considered options

- **A `status` field in `goal.md`.** It would be a second source of truth beside the Runs, and the two could disagree after a crash between writes.
- **A hidden "Goal Ticket" file holding the Goal Steps' Runs.** It would be a Ticket the human didn't write, which every Ticket count, the summary, the report and the TUI would have to skip.

## Consequences

- A Goal Step that ended `ok` just before `vago run` died doesn't run again, unlike a Ticket's last Step, because no `running` status marks the pass as cut off.
- There is no Goal Step reset yet. When a `before_all` pass can't be picked up, for example because an earlier Step's log was deleted, every `vago run` refuses it the same way until the human deletes its `[[runs]]` tables from `goal.md` by hand.
- `{{steps.<id>.output}}` never crosses groups: a Goal Step reads only the outputs of earlier Steps in its own list, and a Ticket Step only those of its Workflow's `[[steps]]`.
