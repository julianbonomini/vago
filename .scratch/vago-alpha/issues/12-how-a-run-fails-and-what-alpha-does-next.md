# How a Run fails and what Alpha does next

Type: grilling
Status: resolved

## Question

What happens when a Step fails, a Run times out or stalls, or Alpha itself is stopped? Inputs: [How other orchestrators work](03-how-other-orchestrators-work.md), the warren pointers in [What Vago borrows from other orchestrators](07-what-vago-borrows-from-other-orchestrators.md), and the fog left by [Where Vago keeps Goals and Tickets](08-where-vago-keeps-goals-and-tickets.md).

To decide:

- Retries: none, or warren's one retry for provider errors only; how a provider error is told apart from a failing Step.
- What `stuck` means for the Ticket's dependants, and whether Alpha keeps going on other ready Tickets or stops the Goal.
- What a Ticket still `running` at startup means (warren: marked lost), and what happens to an in-flight Ticket when the human stops Alpha to edit the Workflow.
- What Run metadata Alpha records when a Ticket goes `running` (Harness session ID, start time) and where.
- How the human un-sticks a Ticket, given the CLI has no command to set status.

Explicit terminal reasons for a Run stay out of scope.

## Answer

**Alpha never retries, resumes or restarts a Ticket on its own. A Ticket that ends `stuck` stops the Goal, and the human fixes the checkout, then resets the Ticket.** No ADR, because each piece is cheap to reverse. Inputs: [How other orchestrators work](03-how-other-orchestrators-work.md), [What Vago borrows from other orchestrators](07-what-vago-borrows-from-other-orchestrators.md), and a research pass on what the Harness CLIs stream in headless mode (Claude Code 2.1.286, codex-cli 0.159.3), summarised below.

- **What fails a Step.** An agent Step succeeds on exit 0 and fails on a non-zero exit or an idle timeout. There's no completion signal: both CLIs exit 1 on failures such as auth, a bad model or max turns. A shell Step fails on a non-zero exit, `on_fail` still applies, and it has no timeout because the human wrote the command.
- **Idle timeout.** It resets on every line the Harness streams. The default is 30 min, and `idle_timeout` can override it for the whole Workflow or per Step, frozen with the rest of the Workflow. The default is generous because Codex emits nothing while a command runs (Claude Code sends a heartbeat about every 30 s). Following Codex's in-progress command items per Harness can come later if stalls turn out to be a real problem.
- **Live feedback.** Alpha drives each Harness's JSONL stream (`claude -p --output-format stream-json --verbose`, `codex exec --json`), reads it line by line for the idle timer and the session ID, and logs it. How the human views it belongs to [Alpha kernel boundary and bootstrap](06-alpha-kernel-boundary-and-bootstrap.md).
- **No retries.** Sandcastle's fail-fast. warren's one retry for provider errors needs per-Harness error classification and moves to Out of scope.
- **`stuck` stops the Goal.** All Tickets share one checkout, git happens inside Steps, and Alpha owns no git (ADR 0002), so after a failure Alpha can't know what state the checkout is in. The first `stuck` makes `vago run` exit. It never runs another Ticket on top, so "what stuck means for dependants" doesn't come up.
- **Interrupted.** On SIGINT or SIGTERM, Alpha kills the Run's process group (per [What Alpha's runtime is](11-what-alphas-runtime-is.md)), marks the one running Ticket `stuck` with outcome `interrupted`, and exits. Runs are serial, so at most one Ticket is ever `running`. Stopping to edit the Workflow means: Ctrl-C, edit, reset, `vago run`.
- **Lost.** If Alpha finds a Ticket still `running` at startup (kill -9, a crash, the machine died), it marks it `stuck` with outcome `lost` and stops, as warren marks Runs lost on restart. Setting it back to `ready` was rejected: the Ticket would restart at Step 1 on top of its own partial work, and later Steps couldn't tell old work from new.
- **Refuses to start while stuck.** `vago run` refuses to start a Goal that has any `stuck` Ticket, names them and prints the reset command. The reset is the human saying "I've checked the checkout".
- **Un-sticking.** The human sorts out the branch and the unfinished work by hand, then runs `vago ticket reset <goal> <NN>`, which sets the Ticket to `ready` and keeps its run history. That command is part of Alpha's CLI, so ADR 0003 ("only Alpha writes status") holds.
- **Run history.** The Ticket's TOML header gets a `[[runs]]` entry for every Step, agent or shell. It's appended when the Step starts and filled in when it ends. Agents never see it. That lets the human inspect or resume any session (`claude --resume <id>`, `codex exec resume <id>`).
  - Always: `step`, `started`, `ended`, `outcome` (`ok`, `exit <n>`, `idle-timeout`, `interrupted`, `lost`). Alpha measures the duration itself.
  - Agent Steps also get `harness`, `model` and `session_id` (from Claude's `system/init` or Codex's `thread.started`).
  - When the Harness reports them: `tokens` (both Harnesses) and `cost_usd` (Claude's `total_cost_usd` only). Alpha keeps no price table, so Codex Runs carry no cost.
  - The record is a history, not a state machine. Explicit terminal reasons for a Run stay out of scope.

  ```toml
  [[runs]]
  step       = "implement"
  harness    = "claude-code"
  model      = "opus"
  session_id = "3f2a…"
  started    = 2026-10-01T09:12:03Z
  ended      = 2026-10-01T09:31:40Z
  outcome    = "ok"
  cost_usd   = 1.84
  tokens     = { input = 412000, output = 18300 }
  ```
- **Exit code.** `vago run` exits 0 when the Goal is done and non-zero otherwise. Which non-zero number it uses carries no meaning.
