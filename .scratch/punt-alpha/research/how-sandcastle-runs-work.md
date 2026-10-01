# How Sandcastle runs work

Research for ticket `issues/02-how-sandcastle-runs-work.md`. Vocabulary follows `CONTEXT.md` (Punt, Project, Workflow, Ticket, Run, Harness, Gate).

**Source:** shallow clone of github.com/mattpocock/sandcastle at commit `e99f832f` (2026-06-29), package version 0.12.0. Every `path:line` below is relative to that repo root. Sandcastle's own words for things: "issue" = Ticket, "agent provider" = Harness, "iteration" = one Harness invocation, and "template" / `main.mts` = Workflow.

## TL;DR

Sandcastle is a **library, not a daemon**. It exposes `run()`, `createSandbox()` and `createWorktree()`. Each call starts a container, git worktree or branch, runs a Harness CLI headless (`claude --print ...`) inside it, collects the commits and tears everything down. The **Workflow is a plain TypeScript script** (`.sandcastle/main.mts`) that the user owns and edits. It loops over issues, chains implement, review and merge calls, and handles parallelism with `Promise.allSettled`. Sandcastle supplies no state machine, Ticket store, retries or scheduler. The issue tracker appears only as three shell commands substituted into prompts. That makes the core idea cheap to copy: the bundled Workflows are 50–230 lines. The library is ~15k LOC of non-test TypeScript built on Effect, but most of that is provider breadth and edge-case hardening.

## 1. How a Run executes in Docker, and in what sense it is "detached"

- **Image.** `sandcastle docker build-image` builds `.sandcastle/Dockerfile`: node:22 + git, curl, jq, gh, and the Harness CLI. The user is renamed to `agent`, with the UID/GID aligned to the host through build args. `ENTRYPOINT ["sleep", "infinity"]` keeps the container idle so Sandcastle can `docker exec` into it (`.sandcastle/Dockerfile`; templates in `src/InitService.ts:~400-407`).
- **Container start.** `docker run -d --name sandcastle-<uuid> -e K=V... -v <worktree>:/home/agent/workspace -v <.git mounts> -w ... --user uid:gid <image>` (`src/DockerLifecycle.ts:101-170`, called from `src/sandboxes/docker.ts:154-198`). Before starting, Sandcastle checks that the image exists and that the UID matches (`docker.ts:176`).
- **Harness invocation.** The orchestrator runs `provider.buildPrintCommand({ prompt, dangerouslySkipPermissions: true })` through `sandbox.exec`, which is `docker exec` (`src/Orchestrator.ts:140-189`). For Claude Code the command is `claude --print --verbose --dangerously-skip-permissions --output-format stream-json --model <m> -p -`, with the prompt passed on stdin (`src/AgentProvider.ts:1181-1213`). Each stdout line is parsed into text, tool_call, session_id or usage events (`Orchestrator.ts:159-173`).
- **Ending an iteration.** An iteration ends when the process exits, when the completion signal `<promise>COMPLETE</promise>` appears in the output (then a 60 s grace window starts, ADR 0019), or when the idle timeout fires (600 s with no output, which fails the Run) (`Orchestrator.ts:89-121, 177-185, 246-248`). A non-zero exit is an `AgentError` (`Orchestrator.ts:191-206`).
- **Teardown.** Teardown is tied to the host process. Every container registers `docker rm -f` in a shared SIGINT/SIGTERM/exit handler (`docker.ts:236-246`, `src/shutdownRegistry.ts:41-61`). If the worktree has uncommitted changes at close, it is kept on disk (README, "Automatic cleanup with `await using`").
- **"Detached" means headless, not daemonised.** The Harness runs non-interactively with permissions skipped, and output goes by default to a log file under `.sandcastle/logs/` (`src/run.ts:363`). The `npx tsx .sandcastle/main.mts` process, though, must stay alive for the whole Workflow, and killing it kills the containers. The repo has two ways to get real detachment, both outside the library:
  - **GitHub Actions.** `.github/workflows/agent-implement.yml` triggers on an `agent:implement` label and runs `.sandcastle/agent-workflows/implement/implement.ts` with `noSandbox()`, so the CI runner is the sandbox. There are sibling workflows for review, explore and update-branch.
  - **An external "factory daemon".** `.factory/run-daemon.sh` runs `factory daemon` from a separate `~/repos/ai/software-factory` repo, which is not public here. That daemon spawns `.factory/implement-task.ts` once per task, passing the context in `FACTORY_*` env vars (`.factory/implement-task.ts:1-20`). Pushing and opening the PR is the daemon's job, not Sandcastle's.

## 2. How it loops over issues

- **Two loop levels.** `maxIterations` (default 1) re-invokes the Harness in a *fresh sandbox per iteration* until the completion signal fires (`Orchestrator.ts:355-...`; the early exit is around `Orchestrator.ts:575-585`). The outer loop over issues is ordinary `for` code in the Workflow script.
- **Issue discovery is a prompt-time shell call.** Prompts contain `` !`{{LIST_TASKS_COMMAND}}` ``. The `!` block runs *inside the sandbox* before each iteration and its stdout is inlined (`src/PromptPreprocessor.ts:11-75`). A non-zero exit fails the Run (ADR 0020).
- **Trackers are three strings chosen at `init`** (`src/InitService.ts:~531-570`):
  - GitHub: `gh issue list --state open --label Sandcastle ...`, `gh issue view <ID>`, `gh issue close <ID> ...`
  - Beads: `bd ready --json`, `bd show`, `bd close`
  - Custom: a broken-until-configured sentinel, plus a setup prompt for the Harness to fill in.
- **The agent picks the Ticket.** In `simple-loop` the agent picks the highest-priority unblocked issue, commits with a `RALPH:` prefix, closes the issue itself, and emits COMPLETE when the list is empty (`src/templates/simple-loop/prompt.md:5-53`). In the planner templates an Opus "planner" Run returns `<plan>{"issues":[...]}</plan>`, which is parsed with `Output.object` and a Zod schema (`src/templates/parallel-planner-with-review/main.mts:32-36, 73-95`). The planner assigns deterministic `sandcastle/issue-{id}` branches so that progress builds up across re-plans (`plan-prompt.md:25`).
- **Stop conditions are in the Workflow.** The loop stops on an empty plan, on "implementer made no commits" (`sequential-reviewer/main.mts`, around line 87), or when `MAX_ITERATIONS = 10` is reached.

## 3. How one Ticket is split into Runs (implement, review, merge)

- `createSandbox({ branch })` creates **one container and worktree per Ticket**. Several `sandbox.run()` calls then share it, so dependencies and build artifacts persist and the commits pile up on one branch (README, "Multi-run implement-then-review").
- The pattern is implement, then review only if there are commits (`parallel-planner-with-review/main.mts:116-160`):
  - The implementer gets `maxIterations: 100` and the prompt args `TASK_ID`, `ISSUE_TITLE` and `BRANCH`. Its prompt says to use TDD, run typecheck and tests, commit, comment on the issue if unfinished, and *not* close it (`implement-prompt.md:1-62`).
  - The reviewer gets 1 iteration. Its prompt inlines `git diff {{TARGET_BRANCH}}...{{BRANCH}}` and edits the code directly rather than producing a verdict (`review-prompt.md:1-55`). `SOURCE_BRANCH` and `TARGET_BRANCH` are built-in prompt args (`src/PromptArgumentSubstitution.ts:19-21`, `run.ts:724-725`).
- **Merge is a separate Run.** It happens after all Tickets in the batch finish (section 6).
- **There is no "discuss" step, no Gate and no reject loop.** The reviewer cannot send work back. It fixes things or does nothing. `sandbox.exec("npm test")` can be used as a deterministic check between Runs (README). Sandcastle deliberately does not retry Harness errors: it fails fast (`.out-of-scope/provider-error-retry.md`).

## 4. How the Workflow is defined and edited, and its defaults

- `npx @ai-hero/sandcastle init` asks for a Harness, sandbox provider, issue tracker and template. It then copies `src/templates/<name>/` verbatim into `.sandcastle/` and writes `Dockerfile` and `.env.example` (`src/cli.ts:86-455`; ADR 0009, "init remains a verbatim copy").
- The **Workflow is the copied `main.mts` plus its prompt `.md` files**. The user edits them directly. Templates are self-contained and never share code, so drift between them is intended (`docs/adr/0009-templates-no-shared-code.md`).
- The bundled templates:

  | Template | Shape |
  |---|---|
  | `blank` | One Run with one prompt |
  | `simple-loop` | One `run()` with Sonnet, `maxIterations: 3`, `merge-to-head`; the agent picks, commits and closes |
  | `sequential-reviewer` | Implement, then review, one issue per outer pass, up to 10 passes, serial |
  | `parallel-planner` | Plan, then parallel implement, then merge |
  | `parallel-planner-with-review` | Plan, then parallel (implement, then review), then merge |

  Large opinionated templates are out of scope (`.out-of-scope/bundled-workflow-templates.md`).
- **`run()` defaults** (README "All options", `Orchestrator.ts:246-248`, `run.ts:507-512`):

  | Option | Default |
  |---|---|
  | `maxIterations` | 1 |
  | Completion signal | `<promise>COMPLETE</promise>` |
  | Idle timeout | 600 s |
  | Completion grace | 60 s |
  | Logging | File under `.sandcastle/logs/` |
  | Branch strategy | `head` for bind-mount providers (Docker, Podman); `merge-to-head` for isolated ones (Vercel) |
  | Lifecycle timeouts | copyToWorktree 60 s, gitSetup 10 s, commitCollection 30 s, mergeToHost 30 s |

  Harness default models are `claude-opus-4-8` for Claude Code and `gpt-5.4` for Codex (`InitService.ts:409-...`).
- **Hooks.** `hooks.host.onWorktreeReady`, `hooks.host.onSandboxReady` and `hooks.sandbox.onSandboxReady` (for example `npm install`). `copyToWorktree` copies files such as `node_modules` or `.env` into the worktree.

## 5. Parallelism, Harness choice and credentials

- **Parallelism is the user's code.** The templates use `Promise.allSettled(issues.map(...))` with no cap (`parallel-planner-with-review/main.mts:114`). The repo's own `.sandcastle/run.ts:5, 42-55` adds a 15-line semaphore with `MAX_PARALLEL = 4`. Isolation comes from one worktree under `.sandcastle/worktrees/` plus one container per branch. Worktrees are locked (ADR 0007) and reused by default (ADR 0003).
- **The Harness is a factory function.** The Harness is picked per Run in code: `claudeCode(model, opts)`, `codex(model)`, `pi`, `cursor`, `opencode` or `copilot` (`src/AgentProvider.ts:628-1213`). Each one supplies `buildPrintCommand`, `parseStreamLine` and an optional `env`; for example, Codex runs `codex exec --json --dangerously-bypass-approvals-and-sandbox -m <model>` (`AgentProvider.ts:773-811`). Sandcastle is Harness-agnostic in the same way Punt needs to be. The Harness CLI must be installed in the image, and `init` writes a Harness-specific Dockerfile.
- **Credentials travel as env vars, never as mounted config.**
  - `.sandcastle/.env` declares the keys. Each declared key takes its value from the file or, if that is empty, from host `process.env`. Undeclared host env never leaks into the sandbox (`src/EnvResolver.ts:49-73`).
  - The result is merged with the agent-provider and sandbox-provider `env`, with the providers winning (`src/mergeProviderEnv.ts:8-30`). It is passed as `docker run -e K=V` (`DockerLifecycle.ts:126-129`).
  - Claude Code uses `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, which works on a subscription, or `ANTHROPIC_API_KEY` (`InitService.ts:409-420`). Codex uses `OPENAI_KEY`.
  - `gh` uses `GH_TOKEN`, a fine-grained PAT with Issues read/write (`InitService.ts:~540`).
  - The host's git `user.name`/`user.email` is copied into the container's global git config, and the worktree is added to `safe.directory` (`src/SandboxLifecycle.ts:200-255`).

## 6. How it commits and merges

- **The agent commits.** The prompts tell it to `git commit` inside the sandbox. Sandcastle never writes commits, except the host-side merge below.
- **Branch strategies** (`run.ts:385, 507-525`; `SandboxLifecycle.ts:404-543`):
  - `head`: bind-mounts the host checkout itself, so commits land on the current branch directly. Not allowed with `copyToWorktree` or isolated providers.
  - `merge-to-head`: makes a temporary `sandcastle/<ts>-<rand>` branch in a worktree. Afterwards it runs `git merge <temp>` on the host, then `git branch -D` (`SandboxLifecycle.ts:409-483`). It uses merge rather than cherry-pick so that merge commits made by a merge agent survive. A conflict fails with a "To retry: git merge ..." message.
  - `branch`: an explicit named branch; the commits just stay on it (`SandboxLifecycle.ts:513-530`).
- **Commit collection.** Commits are found with `git rev-list <baseHead>..<branch>` and returned as `result.commits`. Isolated providers sync the commits out through format-patch/am (`src/syncOut.ts`).
- **Merging several Tickets is a Harness Run.** In the planner templates a "merger" agent receives `{{BRANCHES}}` and `{{ISSUES}}`. It runs `git merge <branch> --no-edit` for each, resolves conflicts, runs typecheck and tests, and then closes the issues with `CLOSE_TASK_COMMAND` (`parallel-planner-with-review/merge-prompt.md:1-26`, `main.mts:208-221`). So "done" for a Ticket means merged into the host's current branch and closed by the merger. The default path has no PR and no push. The CI workflows and the factory daemon do open PRs.

## 7. Size, and how hard it would be to replicate

- **Library:** ~15,000 lines of non-test TypeScript in `src/`, plus ~29,000 lines of tests. Its runtime is built on Effect (`effect`, `@effect/platform`, `@effect/cli`). The biggest files are `AgentProvider.ts` (1,267 lines, six Harnesses), `createSandbox.ts` (1,136), `InitService.ts` (1,109), `run.ts` (894), `createWorktree.ts` (764), `SandboxFactory.ts` (691), `Orchestrator.ts` (604), and `docker.ts`/`podman.ts`/`vercel.ts`/`daytona.ts` (~1,500 together).
- **Workflows:** `simple-loop/main.mts` is 50 lines, `sequential-reviewer/main.mts` ~120 and `parallel-planner-with-review/main.mts` 226. Prompts are 25–60 lines each.
- **The lean kernel Punt would need**, roughly:
  - Worktree create/remove.
  - `docker run -d ... sleep infinity`, then `docker exec <harness> --print` with a stream parser, then `docker rm -f`.
  - Env file to `-e` flags.
  - An idle timeout and a completion-signal check.
  - `git rev-list` and `git merge` on the host.
  - A Workflow script that loops `list -> implement -> review -> merge`.

  That is a few hundred lines. The rest of Sandcastle's code handles concerns Alpha can skip: Windows paths, Podman, SELinux, Vercel/Daytona, session resume and fork, structured output, the interactive mode, the `init` wizard, UID alignment pre-flights, and hanging-process handling. Sandcastle also leaves gaps that Punt has to fill itself: daemon or detach, Ticket state and readiness, retries and parking, Gates, and a review verdict that can reject work.

## Implications for Punt Alpha (observations, not decisions)

- Sandcastle's "Workflow" is code plus prompts. It has no declarative step list, no Gates and no per-Ticket state. If Punt wants a per-Project editable Workflow with Gates and a "done" definition, Punt has to add that layer. Sandcastle could still serve as the Run executor for each step.
- **Detachment is the missing piece.** It would come from launching the Workflow script under `nohup`/tmux/launchd, or from CI-label triggers as in this repo, or from a daemon like the private `software-factory`.
- **Auth can be copied directly.** A per-Project env file with a declared-key allowlist, passed as `-e` flags, plus `claude setup-token` so a subscription works headless.
