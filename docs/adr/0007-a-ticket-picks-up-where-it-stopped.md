# A Ticket picks up where it stopped

`vago run` continues a stuck, interrupted or lost Ticket at the Step it stopped on, instead of refusing the Goal until the human resets the Ticket. The Steps before that one don't run again. Their outputs, which the later Steps' prompts read as `{{steps.<id>.output}}`, are rebuilt from the Ticket's latest pass: for each earlier Step, its latest Run since the last Run of the Workflow's first Step, read back from the Ticket file and the Run's log. An agent Step gives its result text, a shell Step its exit code and log. When one can't be rebuilt, because its log is gone or its Run didn't end in a way the Ticket went on from, `vago run` refuses that Ticket, names the Step and leaves the Ticket file as it was. `vago ticket reset` now means start over from the first Step. The Ticket's status is the only signal: a `ready` Ticket starts at its first Step and a `stuck` one is picked up. No header field records which.

Starting over cost work. In 10 Goals and 352 Runs, all 6 `branch` failures came from changes an interrupted Run left behind on a Ticket that then started over, and 2 of the 5 `merge` failures happened after the push had gone through. Starting at the failed Step keeps what the earlier Steps built and runs only the Step that failed.

## Considered options

- **Start over, and refuse a Goal with a stuck Ticket until it's reset.** What Vago did before. It throws away the earlier Steps' work and caused the `branch` failures above.
- **A `--from <step>` flag on `vago run`.** The human would have to look up and type the Step every time, when the Ticket file already says which Step stopped.
- **Persist each Step's output to a new file as it ends.** Tickets stuck before the upgrade have no such file, so they couldn't be picked up. The Ticket's `[[runs]]` and logs already hold everything needed.

## Consequences

- A Step can run twice: the Step a Ticket stopped on runs again on top of whatever its first Run left in the Goal's worktree. Steps should be safe to run twice, and Vago doesn't enforce it. The starter's `branch.sh` and `merge.sh` are.
- A Step that ended `ok` just before `vago run` died runs again, since the Ticket is picked up at the Step of its last Run.
- A picked-up agent Step on Claude Code resumes the Harness session its last Run had, with a fixed message to continue, and starts a fresh session with its prompt when there is none or the resume fails to start.
