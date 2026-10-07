# A Codex planning session runs in Vago's sandbox alone

A planning item on Codex runs the interactive `codex` in the planning view, as an item on Claude Code runs `claude` (ADR 0015), with three differences.

Codex picks a fresh session's id itself and prints it nowhere Vago can read. It writes each session to rollout files under `$CODEX_HOME/sessions/` (or `~/.codex/sessions/`), `<yyyy>/<mm>/<dd>/rollout-<time>-<id>.jsonl`, whose first line, `session_meta`, holds the id, the real path of the working directory and the start time. Until the id is known, `vago plan session` looks every second, and once after the session ends, at each rollout file written since the session started, and takes the first whose `session_meta` names the Project root and a start no earlier than the session's. It saves that id in `chat.toml`, and reopening the item runs `codex resume <id>`. An item left before Codex wrote its rollout has no id saved and starts fresh next time.

Codex's own sandbox is off: `--sandbox danger-full-access` with `--ask-for-approval never`. On macOS Codex runs each command under `sandbox-exec`, and macOS refuses to apply a sandbox inside another, so under Vago's sandbox (ADR 0011) every command the agent runs fails with `sandbox_apply: Operation not permitted`. Codex reads files only through commands, so the agent could read nothing. Vago's sandbox stays the guard that keeps every write out of the Project root.

The session runs with `--no-daemon`. Without it, `codex` hands the session to the shared app server when one is running, a process started outside Vago's sandbox, and the agent's commands would run there.

The planning prompt goes in as `-c developer_instructions=<prompt as a TOML string>` on every start, resumes included. The agent's messages are the `response_item` lines of role `assistant`, read from every rollout file of the session in name order: editing an earlier message starts a new file, `rollout-<time>-<id>_<branch>.jsonl`, and the latest file holds the conversation as it now stands.

## Considered options

- **Codex's read-only sandbox inside Vago's.** Every command fails on macOS, as above.
- **Codex's read-only sandbox and no sandbox of Vago's.** Only Codex's own rules would then keep a write out of the Project, and ADR 0011 requires an OS sandbox around the whole session.

## Consequences

- The Codex agent can write outside the Project root: to `/tmp`, the home folder, and the worktrees of Goals under `VAGO_HOME`. Claude Code's agent can't, since it has only reading tools. Its planning prompt is the only thing that asks it not to.
- Vago depends on Codex's rollout layout and `session_meta` line, which Codex doesn't document. A release that changes them stops ids and Proposals from arriving, with no error. Only `harness/codex.ts` changes when they do.
- A second Codex session the human starts in the Project root while the item's session waits for its first message can be taken for the item's.
- The headless read-only command (`codex exec --sandbox read-only`) of `vago plan say` hits the same nested-sandbox failure. It is removed with `vago plan say` in Ticket 04.
