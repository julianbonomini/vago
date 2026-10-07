# A planning item runs its Harness's own session in the planning view

Opening a planning item runs its agent as the Harness's own interactive session, `claude` with its own UI, in a pane of the planning view beside the Preview. The kernel runs it in a `vago plan session <item>` command: `planning-runner.ts` holds the item, picks a fresh start or a resume and adds the planning prompt to the agent's system prompt, and `step-runner.ts` runs the Harness's interactive read-only command in the sandbox on the terminal it was given. The TUI runs that command on a pseudo-terminal it holds, for as long as the view is open, and draws it with OpenTUI's `EmbeddedTerminalRenderable`. While the pane has the focus every key and paste goes to the session, `q` and Ctrl-C included, and Ctrl-] moves the focus to the Preview.

This amends ADR 0005. The TUI now owns one process: a planning item's session, which ends when the view closes or the TUI quits. A `vago run` the TUI starts still outlives it.

`vago plan session` holds the item's `running.lock` for the whole session, as a response does (ADR 0014). Rename, accept and discard are refused or stop it as they do a response, and `vago plan discard` stops the `vago plan session` process, not the TUI that drew it. The planning view ends the session and waits for it to exit before it runs `vago plan accept`, and starts it again, resuming it, when the acceptance is refused.

An interactive `claude` doesn't report its session id, so Vago makes one, saves it in `chat.toml` before the session starts, and passes `--session-id <id>`; reopening the item passes `--resume <id>`. Codex can't start a session under an id Vago picks, so a Codex item's id is saved once its transcript names it (ADR 0017).

Claude Code saves a conversation only once the human sends a message. An item opened and left before that has a saved id with nothing behind it, and resuming it fails. So a resume that ends `exit N` on its own is followed, once, by a fresh start, whose new id replaces the saved one. That happens every time the human opens an item and leaves before typing.

The session runs read-only under the same guard as a planning turn (ADR 0011): the OS sandbox from `sandbox.ts` denies every write under the Project root, and Claude Code's `dontAsk` mode with only reading tools and no MCP server is the second guard. The agent's Proposal reaches Vago through its Harness's own transcript, outside the Project, so neither guard is loosened (ADR 0016).

No terminal-emulator package was added. `@opentui/core` 0.5.14, already pinned by ADR 0006, has `EmbeddedTerminalRenderable`: a native VT emulator with key and paste encoding, focus and resize, drawn into the frame buffer that the view tests read.

## Considered options

- **The TUI process runs the session and holds the lock.** The kernel would hand the TUI a terminal session and its output, so an agent's lifecycle would cross into `tui/`, against ADR 0005's split. The TUI would hold the item's lock, so `vago plan discard` from a second TUI would stop the first TUI. The sandbox and the resume could be tested only through a rendered view.
- **The kernel returns the session's argv and the TUI spawns it.** The kernel would hold no part of the session's life, so it couldn't fall back to a fresh start when a resume fails, which reopening an item left before its first message needs.

## Consequences

- Each open planning item runs one more process, a `vago plan session`, and a pseudo-terminal.
- `vago plan session <item>` also works from a plain terminal, without the TUI.
- Leaving the view or quitting the TUI stops the session: the pane's cleanup sends SIGTERM to the session's process group and closes its pseudo-terminal. A SIGKILLed TUI closes the pseudo-terminal too, which sends the session SIGHUP. `vago plan session` stops its Harness on SIGHUP, SIGTERM or SIGINT.
- A resume that had a conversation and then crashed also gets one fresh start, so the pane shows the crash, then a new conversation, and the old one is no longer the item's. Telling the two cases apart would mean reading Claude Code's own session files.
- Sessions record no turns, so the Goals list reads "no chat yet" for an item planned this way until Ticket 04 changes planning status and cost.
- `vago plan say` and `vago plan retry` stay until Ticket 04, refused while a session holds the item.
- Claude Code's first-run folder trust prompt shows in the pane, and Claude Code saves the answer outside the Project.
- An OpenTUI upgrade must keep `EmbeddedTerminalRenderable`.
