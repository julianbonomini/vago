# How other orchestrators work

Research for ticket `03-how-other-orchestrators-work`. Facts only: what each tool does. Choosing what Vago borrows is the human's decision (ticket 07). Vocabulary follows `CONTEXT.md` (Vago, Alpha, Project, Workflow, Goal, Ticket, Run, Gate, Harness). Sandcastle is covered elsewhere and skipped here. UI, team and SaaS features are skipped.

Sources were read on 2026-10-01 from shallow clones (commit in brackets) and Factory's own docs:

- cyrus [`a9502dd`]: https://github.com/cyrusagents/cyrus
- vibe-kanban [`d5cbb53`]: https://github.com/BloopAI/vibe-kanban
- openai/symphony [`be10a1b`]: https://github.com/openai/symphony
- agent-orchestrator (AO) [`53ba1e8`]: https://github.com/Untrivial-ai/agent-orchestrator
- warren [`8a439fe`]: https://github.com/jayminwest/warren
- Factory Missions: https://factory.com/news/missions, https://docs.factory.com/missions/overview.md, `/missions/planning.md`, `/missions/running-cli.md`, `/missions/reference.md`

## 1. OpenAI Symphony

**What it is.** It is a language-agnostic spec (`SPEC.md`, about 2,300 lines) plus an experimental Elixir reference implementation. It describes "a long-running automation service that continuously reads work from a configured issue tracker, creates an isolated workspace for each issue, and runs a coding agent session for that issue inside the workspace" (SPEC §1). The README suggests asking your own coding agent to implement it from the spec.

**Core loop, work item to merged code.** Every `polling.interval_ms` (default 30s) a tick runs: reconcile running issues, validate config, fetch candidates in `active_states`, sort by priority, then age, then identifier, and dispatch while slots remain (§8.1–8.2). The worker creates or reuses the workspace, renders the prompt from `WORKFLOW.md`, and drives Codex app-server turns (§16.5). The path to merge is written as **tracker states plus prompt**, not as kernel code. The example `elixir/WORKFLOW.md` uses `Todo → In Progress → Human Review → Merging → Done`, with `Rework` for requested changes. The agent itself moves the ticket, keeps a single "Codex Workpad" comment as its running log, and runs a `land` skill on `Merging`. `Human Review` is a state the human moves the ticket out of, which makes it a Gate in Vago terms. "A successful run can end at a workflow-defined handoff state (for example `Human Review`), not necessarily `Done`" (§1).

**Runs per Ticket.** A "Run Attempt" is one execution for one issue, with `attempt` set to null on the first run and to an integer after that (§4.1.5). Inside one worker, the agent may take up to `max_turns` (default 20) back-to-back turns on the same thread. After each turn the worker re-checks tracker state and continues while the issue is still active (§7.1). After a clean exit the orchestrator schedules a 1s continuation re-check. After a failure it backs off exponentially: `min(10000 * 2^(attempt-1), max_retry_backoff_ms)`, default cap 5 minutes (§8.4). Attempt phases end in distinct terminal reasons: `Succeeded, Failed, TimedOut, Stalled, CanceledByReconciliation`, because "retry logic and logs differ" (§7.2). The prompt template gets `attempt`, so a retry is told to resume from workspace state instead of starting over (`WORKFLOW.md`).

**Running detached.** It runs as a daemon. The scheduler state is deliberately in memory only: "Restart recovery is tracker-driven and filesystem-driven (without a durable orchestrator DB)" (§7.4). After a restart no timers or sessions are restored. The service cleans workspaces of terminal issues, polls, and re-dispatches (§14.3). Stall detection kills a run with no agent events for `stall_timeout_ms` (default 5m) and retries it (§8.5). Changing a ticket's state in the tracker is the operator's control surface. Moving it to a terminal state stops the run and cleans the workspace; moving it to a non-active state stops the run but keeps the workspace (§14.4). User-input requests "MUST NOT leave a run stalled indefinitely" (§10.5).

## 2. warren (jayminwest)

**What it is.** It is a self-hosted control plane that "runs agent harnesses as isolated, observable workloads on infrastructure you control. It owns the workspace, run lifecycle, spend limits, live events, intervention, recovery, and Git delivery" (README). Its PHILOSOPHY names it a minimal kernel: "project registry → dispatch → sandboxed run → event stream → steer/pause → reap → push branch".

**Core loop, work item to merged code.** A Run is dispatched manually, by cron (`.warren/triggers.yaml`) or from a scheduled seed, into a fresh worktree on branch `${prefix}/${run.id}`, and runs in a `bwrap` or `sandbox-exec`, docker or k8s sandbox. Events stream until the Run ends, then **reap** finalises: it salvages work, pushes the branch, and optionally opens a PR (`docs/architecture.md`). Auto-merge is opt-in via `pr.autoMerge` in `.warren/config.yaml`, with `protectedPaths`. The merge policy "resolves from the base branch, never the run branch — an agent must not be able to edit its own merge policy" (`docs/design/warren-config.md`). "The kernel's guaranteed output is a pushed workspace branch. Everything past that point — open a PR, close an issue, sync a tracker — is extension behavior" (PHILOSOPHY).

**Runs per Ticket.** By default one Run is one Ticket. **PlanRun** walks a plan's child tickets in order, one Run per child, and the next child is dispatched only after the previous child's PR has **merged**. There is never more than one child in flight (`docs/design/plan-run-coordinator.md`). The coordinator is a pure function returning `dispatched | waiting_for_run | waiting_for_merge | advanced | plan_failed | plan_succeeded | noop`. A child that succeeded with zero commits counts as merged ("trivial-merge"), so no-op steps don't deadlock. A failed child gets **one** automatic re-dispatch, and only when the cause is retryable (today only `provider_error`). The retry count is persisted, so a restart can't grant another one. Runs are immutable: `queued → running → succeeded | failed | cancelled`, and "a Run … never returns to `running` after reaching a terminal state" (`resumable-agent-environments.md`). The run row "freezes the resolved agent, provider, model, limits, and workspace intent at dispatch" (`architecture.md`).

**Running detached.** It runs as one long-lived Bun server plus a supervisor that forwards signals. The scheduler is an in-process, single-flight 60s tick (`scheduler.md`). For the `local` runtime, warren dropped a separate daemon: "a warren restart reconciles live rows as lost", which they accept for local use. Only k8s pods outlive the control plane (`runtime-and-supervisor.md`). Cron has no catch-up after downtime. Spend caps (`maxCostUsd`) cancel a Run in flight. A malformed guardrail config fails **closed** before any run row exists (`warren-config.md`).

## 3. Cyrus

**What it is.** "Your (Claude Code|Codex|Cursor|Gemini|Opencode) powered (Linear|GitHub|GitLab|Slack) agent. Cyrus monitors … issues assigned to it, creates isolated Git worktrees for each issue, runs … sessions to process them, and streams detailed agent activity updates back" (README). It is BYOK and self-hostable.

**Core loop, work item to merged code.** A Linear webhook (assignment or @mention) is routed to a repository by labels, by description selectors like `[repo=…]`, or by asking the user. Cyrus then creates `worktrees/<ISSUE-ID>/` from `origin/main` and starts a Harness session (`CLAUDE.md`). Comments the human posts mid-run are streamed into the live session. The flow used to be a hard-coded **procedure** of **subroutines** (`coding-activity → verifications → git-gh → concise-summary`, with a fixer loop that re-ran verification up to 4 times). In v0.2.41 (2026-04-06), "Skills replace rigid procedure workflows … A Stop hook ensures PRs and summaries are always created before sessions end" (CHANGELOG). The bundled skills are `implementation`, `verify-and-ship`, `investigate`, `debug` and `summarize` (`skills/`). The Stop hook blocks the agent's first attempt to stop if the worktree has uncommitted tracked changes or unpushed commits (`RunnerConfigBuilder.ts`, `buildStopHook` and `inspectGitGuardrail`). Merging is left to the human on GitHub.

**Runs per Ticket.** It keeps one agent session per Linear "agent session". Follow-ups resume the same Harness session via `resumeSessionId`, i.e. Claude `--continue` or `resume` (`ClaudeRunner.ts`). The repository chosen for an issue is cached, and an issue never switches repo (`CLAUDE.md`). Changelog entries record lessons from the subroutine era: run transitions serially (a race let a new subroutine start before the old runner cleaned up), and when a subroutine hits max turns, carry on from the last good result instead of failing the whole procedure.

**Running detached.** It runs as a persistent process under tmux, pm2 or systemd (README), and receives webhooks through a public URL or Cloudflare tunnel. Session state is saved to `~/.cyrus/state/edge-worker-state.json` with write-then-rename so a crash can't leave truncated JSON (`PersistenceManager.ts`). An internal `idle | busy` status reports whether the process is safe to restart (`EdgeWorker.ts`).

## 4. Agent Orchestrator (AO, Untrivial-ai)

**What it is.** "A local desktop workspace" backed by a Go daemon on `127.0.0.1` that supervises parallel coding-agent sessions, each in its own branch and worktree, with 32 supported agents (README; `docs/architecture.md`). A project-level "orchestrator" agent plans and spawns **workers**: "The orchestrator owns planning and delegation; workers own implementation, tests, commits, and pull requests" (README).

**Core loop, work item to merged code.** A task becomes a worker session in its own worktree, which opens a PR. An **SCM observer** polls GitHub every 30s for PRs, CI checks and review threads, writes them as facts, and the lifecycle manager **routes actionable feedback** (CI failure, review comment, merge conflict) back into the *same* worker session (architecture, "Feedback Routing Flow"). The PR moves through derived states `ci_failed → changes_requested → merge_conflict → mergeable → approved` until it merges.

**Runs per Ticket.** One long-lived session per task does all the work: implementation, CI fixes and review fixes are follow-up turns in the same agent. It does not split work into separate Runs per step.

**Running detached.** The daemon is long-lived. Agents run in tmux or conpty, or in "detached per-session hosts so daemon/desktop replacement reconnects without stopping an in-flight turn" (architecture intro). Persistence is SQLite. Its load-bearing rules include: "Never store display status — Status is derived from durable facts at read time", "Never treat failed probes as death", "Never force-delete dirty worktrees", and "All app state under ~/.ao". A session is terminated only when runtime and process are both dead and no recent activity contradicts that ("Termination Guardrails").

## 5. Vibe Kanban (BloopAI)

**What it is.** It is a local web app (`npx vibe-kanban`) for planning work as kanban issues and running coding agents in **workspaces**, each with "a branch, a terminal, and a dev server" (README). **It is sunsetting** (README banner), so treat it as prior art, not as a living reference.

**Core loop, work item to merged code.** It is human-driven. An issue gets a workspace (git worktree on a new branch). The repo's **setup script** runs once, then the coding agent runs. The human reviews diffs, leaves inline comments that go back to the agent, and opens a PR and merges (docs `workspaces/index.mdx`, `settings/projects-repositories.mdx`). "Nothing is pushed to remote until you explicitly create a PR."

**Runs per Ticket.** It has three levels. A task has **attempts**, each a fresh start with possibly a different agent or base branch (`core-features/new-task-attempts.mdx`). A workspace has **sessions**: "Sessions share files but not conversation context", which is useful for a fresh context window or a different agent (`workspaces/sessions.mdx`). Each session has **execution processes** with a `run_reason` of `SetupScript | CleanupScript | ArchiveScript | CodingAgent | DevServer` (`crates/db/src/models/execution_process.rs`). Actions chain: `ExecutorAction { typ, next_action }`, where `typ` is one of `CodingAgentInitialRequest | CodingAgentFollowUpRequest | ScriptRequest | ReviewRequest` (`crates/executors/src/actions/mod.rs`).

**Running detached.** It is a local server with SQLite. On startup, any execution process still marked running is marked failed as orphaned (`crates/services/src/services/container.rs`, `cleanup_orphan_executions`). Agents are not re-attached.

## 6. Factory Missions

Per the map, only orchestration ideas are in scope. Goal-level validation is out of scope for Alpha, so validation appears here only for context.

**What it is.** It is a Droid mode for "large, multi-feature work": plan with the human, then hand off to **Mission Control** (docs overview). "Droid breaks the project into features, spawns worker sessions for each one, coordinates handoffs through git, validates at every step, and recovers from failures automatically" (news post).

**Core loop, work item to merged code.** The human and Droid plan **features grouped into milestones**. Execution starts once the human approves the plan. An **orchestrator** (planning, coordination, re-scoping) spawns **workers** with fresh context per feature. **Validators** run at the end of each milestone (news post; `/missions/planning.md`). The orchestrator can add **fix features** when validation surfaces problems. Factory's cost heuristic is "`total runs ≈ #features + 2 * #milestones`", and they call it "a floor rather than a ceiling" (`/missions/planning.md`). Factory does not document where the merge happens.

**Runs per Ticket.** It runs roughly one worker Run per feature, plus 2 validator Runs per milestone, plus fix features. There is a "feature retry limit warning" when a feature keeps failing (overview, Troubleshooting).

**Running detached.** It runs locally or in cloud containers. Headless mode is `droid exec --mission -f mission.md` for CI or scheduled jobs. `keepSystemAwakeDuringMissions` defaults to `true` (`/missions/reference.md`). The median mission runs about 2 hours, 14% run longer than 24 hours, and the longest ran 16 days (news post). Factory insists it is "not fire-and-forget": the human pauses the orchestrator and talks to it to unstick it (`/missions/running-cli.md`). Their stated failure mode: "the orchestrator still scopes too broadly sometimes, and workers get stuck on edge cases" (news post). The on-disk mission state format is not documented publicly.
