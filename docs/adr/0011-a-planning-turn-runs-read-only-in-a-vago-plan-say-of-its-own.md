# A planning turn runs read-only in a `vago plan say` of its own

Each message the human sends a planning item's agent is a `vago plan say <item>` process of its own. The TUI starts it detached, with the message on stdin, as it starts `vago run` (ADR 0005), and reads the response from the turn's log under the item's `planning/` folder. `step-runner.ts` spawns the agent, as it spawns every Step's, on the Harness's read-only command, inside an OS sandbox that denies every write under the Project root: `sandbox-exec` on macOS, `bwrap` on Linux. The Harness's read-only tools are a second guard. With neither sandbox program on `PATH`, planning is refused, never run unsandboxed.

A planning turn is not a Run. It has no Step, Ticket or Goal, no retry and no idle timeout, so it is recorded in the item's `planning/chat.toml`, not in any `[[runs]]`.

## Considered options

- **The TUI holds the agent's session.** Quitting would kill a response in progress, and the TUI would own a process, which ADR 0005 rules out.
- **A planning turn as a Run of a built-in Step.** `RunOwner` would gain a planning owner with pass, retry and Goal semantics that mean nothing for a chat, and code asking a Run for its Goal would get a planning item.
- **The Harness's flags alone, with no sandbox.** Read-only would rest on the CLI honouring its tool list. A test with a fake CLI could not show it, and neither the human nor Vago could check it.

## Consequences

- Linux needs `bwrap` to plan.
- The guard is the same for every Harness: the sandbox wraps Codex's `--sandbox read-only` command as it wraps Claude Code's read-only tools. An item records its Harness when it is made, so every turn of its chat resumes the same Harness's session.
- The sandbox covers the Project root only. A Goal's worktree under `VAGO_HOME` is guarded by the Harness's read-only tools alone.
- The sandboxed agent can't write the log or `chat.toml`, since both sit under the Project root. The unsandboxed `vago plan say` writes them from the agent's stdout.
- A `vago plan say` that dies leaves its turn open, which reads as interrupted once no live process holds the item. Retry response or a new message continues from there (ADR 0014).
