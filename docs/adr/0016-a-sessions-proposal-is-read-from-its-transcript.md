# A session's Proposal is read from its transcript

In a planning session (ADR 0015) the agent writes the same `<vago-plan>` block as before (ADR 0012), in its messages. An interactive `claude` streams nothing to Vago, so `vago plan session` reads Claude Code's own transcript of the session: `$CLAUDE_CONFIG_DIR/projects/<folder>/<sessionId>.jsonl`, or `~/.claude/projects/…` without `CLAUDE_CONFIG_DIR`, where `<folder>` is the real path of the session's working directory with every character other than a letter or a digit replaced by `-`. It reads the file every second while the session runs and once more after it ends, however it ended, before the item's lock is released. Of the agent's messages, subagents' left out, the latest one holding a closed block gives its last closed block. When that block is valid TOML and fits the format, it becomes `planning/proposal.toml`, with no `turn`.

This supersedes ADR 0012 for planning sessions. ADR 0012 still holds for `vago plan say` until Ticket 04 removes it.

Only `harness/claude-code.ts` knows the transcript's path and line shapes; `step-runner.ts` reads the file, and `tickets/` picks the block.

## Considered options

- **A Write tool limited to one drop file outside the Project.** The agent writes its Proposal to a file Vago names. It breaks ADR 0011 and 0015's guard that the agent has only reading tools, depends on an unverified `Write(//…)` permission rule, puts a runtime path in the system prompt, and leaks a temp folder when the session is killed.
- **An MCP `propose` tool.** Vago serves a tool the agent calls with the block. It breaks the guard that the session has no MCP server, and adds a hand-written JSON-RPC server, a new module and a hidden command that relays the Proposal through `vago plan session`.

Reading the transcript keeps both guards as they are, and keeps the block format and Accept unchanged.

## Consequences

- Vago depends on Claude Code's transcript path and line shapes, which Claude Code doesn't document or promise to keep. A release that moves or reshapes them stops Proposals from arriving, with no error. Only `claude-code.ts` changes when they do, and `test/fixtures/claude-code-transcript.jsonl`, recorded from a real session, is what to record again to check.
- Claude Code shortens a folder name longer than about 200 characters and adds a hash, which Vago doesn't compute. A Project that deep gets no Proposal.
- A block in any of the agent's messages counts, not only a final answer, since the transcript marks none as final. This reverses ADR 0012's "only the final answer is read".
- A bad block leaves the Proposal as it was and records nothing; neither the human nor the agent hears why.
- A save that fails is retried a second later, without a word to the human.
- Each resume reads the whole transcript again and saves the same block again, which changes nothing.
- It assumes `claude --resume <id>` appends to the same `<id>.jsonl`, as its `--fork-session` opt-out suggests. If it doesn't, blocks written after a resume aren't picked up.
- Codex keeps its transcript under `$CODEX_HOME/sessions/`, named by date and time as well as the session id. Locating it is Ticket 03's.
