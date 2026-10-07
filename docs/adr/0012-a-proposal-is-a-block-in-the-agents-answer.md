# A Proposal is a block in the agent's answer

Superseded by ADR 0016. `vago plan say` is gone (ADR 0018). The block's format and the files it is saved to still hold.

A planning item's agent ends an answer with a `<vago-plan>` block whenever its Proposal changes: TOML holding the Goal, the ordered Tickets with their blockers, the recommended Workflow with its reason, and the decisions still open. `starter/prompts/planning.md` teaches the format. When the turn ends `ok`, the unsandboxed `vago plan say` reads the last block of the final answer, checks it, and saves it to the item's `planning/proposal.toml` with the number of the turn it came from. The human's Workflow choice lives in `planning/workflow.toml`, written only by `vago plan workflow` and the TUI's picker, so the two writers never share a file. No Goal or Ticket file exists until the Proposal is accepted.

## Considered options

- **Read the Proposal from the turn logs.** Accepted data would depend on each Harness's stream format, which only its Harness module should know (architecture rule 4).
- **Ask for structured output from a second, resumed session.** It doubles the sessions per turn, puts turns the human never sent into their session, widens the Harness interface, and depends on CLI flags for schema-checked output on resume that nobody has verified.

## Consequences

- The format is known in two places: the parser in `tickets/` and `planning.md`, which each Project can edit. A Project that edits the format out of its prompt gets no Proposal.
- A block that isn't valid TOML or doesn't fit the format leaves the Proposal as it was, and its reason is recorded on the turn and shown in the chat. It never fails the turn.
- Only the final answer is read. A block in an earlier text block, before a later tool call, isn't saved.
- An old chat keeps the Proposal it saved; nothing rebuilds it from the logs.
- The format is hard to change once Projects have edited `planning.md`.
