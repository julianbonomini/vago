# A planning session records its runs, and reopens read-only once accepted

The headless chat is gone: `vago plan say`, `vago plan retry`, planning turns, their logs and Retry response. A planning item talks to its agent only in its planning session (ADR 0015), so the session is what the Goals list, the planning cost and an accepted Goal read.

Each `vago plan session` of a planning item appends a `[[sessions]]` table to `planning/chat.toml` as it starts, under the item's lock: when it started, the Harness session it runs once that id is known, what that Harness session has cost so far, and when it ended. The cost is the session's transcript priced with the Harness module's prices: Claude Code's usage of each message, subagents' included, and Codex's latest token count, priced by the model of its latest turn. A resumed session's transcript holds its earlier runs, so each run records the session's total so far, and the item's planning cost adds up the latest run of each Harness session. Its planning time adds up how long each run was open, the open one up to when the chat is read.

The Goals list reads the planning activity from that table, the lock and the Proposal: `session open` while a live vago holds the item with its last run open, `proposal ready` once the Proposal is ready to accept, `no session yet` before any session id or Proposal, and `waiting for your reply` otherwise.

An accepted Goal's session reopens from the Goal view. `vago plan session` resumes its saved session without taking the lock, which `vago run` takes on the Goal, and saves nothing it reads: no run, no id and no Proposal. An accepted Goal with no saved session is refused.

## Considered options

- **Time and cost from the transcript alone.** The transcript tells when messages were written, not how long the session was open, and a run that sent nothing would count no time.
- **The cost of each run apart, the session's total at its start subtracted.** The first read can come after the human's first message, so the subtraction would drop part of a run's cost.
- **An accepted Goal's session under the lock.** A `vago run` of the Goal would be refused while the human reads why it was planned.
- **An accepted Goal's planning read from the Proposal only.** The Proposal says what was chosen, not why.

## Consequences

- This supersedes ADR 0011's `vago plan say`; its sandbox stays as ADR 0015 uses it. It amends ADR 0014: no response holds the lock, and nothing reads as interrupted.
- The cost depends on each Harness's transcript shapes, which neither documents (ADR 0016, 0017), and on Vago's price lists. A model with no price counts nothing. Codex prices the whole session by its latest model.
- A `vago plan session` that is SIGKILLed leaves its run open, which counts no time once no live vago holds the item, and keeps the cost of its last read.
- A fresh start after a refused resume (ADR 0015) records its new id on the same run, so the old session's cost drops out. A resume that is refused had no conversation behind it, so that cost is nothing.
- Two TUIs can reopen an accepted Goal's session at once, since nothing holds it. Both resume the same Harness session.
- The agent of an accepted Goal's session still answers, and may write a proposal block. Nothing saves it, and the planning view shows no Accept.
- A `chat.toml` saved by the headless chat keeps its `[[turns]]`, which nothing reads.
