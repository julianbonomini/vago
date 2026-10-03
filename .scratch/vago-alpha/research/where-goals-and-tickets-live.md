# Where Goals and Tickets live

Research for ticket `01-where-goals-and-tickets-live`. Question: where do these tools keep work items, and how does each option fare, given that it must work for solo indie repos, company repos, and open-source repos the human doesn't own, without forking or polluting someone else's tracker?

Sources are the tools' own READMEs, docs, and source code on GitHub, read 2026-10-01. Factory Missions is closed source, so its storage claims come from a reverse-engineered prompt dump and are lower trust (marked below).

## TL;DR

- There are four places work can live: **a hosted tracker** (GitHub Issues, Linear, Jira, GitLab), **files in the repo** (Beads, Seeds, Markdown), **files outside the repo** (Beads stealth/contributor mode, warren's untracked host-clone config, Factory's missionDir), and **the tool's own database** (vibe-kanban and agent-orchestrator use SQLite, warren keeps run history in its own store).
- The tools that last and spread all **put a tracker seam in front of storage** instead of picking one store. Symphony specifies a tracker adapter (Linear, GitHub Issues, Jira, Asana and GitLab in the reference build). Sandcastle reduces a tracker to three shell commands: list, view, close. warren has an `IssueTracker` seam with Seeds built in and remote adapters for everything else. agent-orchestrator has a multi-provider `Tracker` port.
- A hosted tracker fails the open-source constraint. Labels, assignment and closing need write or triage access on someone else's repo, and creating issues there is exactly the pollution the constraint rules out. Linear needs a workspace and webhooks the human may not control.
- Only local files work for all three repo kinds. In-repo files suit repos the human owns. A directory outside the repo suits repos the human doesn't own. Beads (`--stealth`, `--contributor`) and warren (untracked `.warren/config.yaml` in the host clone) both ship this split.

Facts only. Where Vago keeps Goals and Tickets is the human's decision (ticket 08).

## Per tool

### Sandcastle (mattpocock/sandcastle)

- **Store:** none of its own. "Sandcastle does not embed any issue tracker itself." An issue-tracker entry is a scaffold that fills `LIST_TASKS_COMMAND`, `VIEW_TASK_COMMAND` and `CLOSE_TASK_COMMAND` into the generated prompt and installs the CLI in the sandbox. "Sandcastle is not in the loop at runtime." ([docs/agents/adding-an-issue-tracker.md](https://github.com/mattpocock/sandcastle/blob/main/docs/agents/adding-an-issue-tracker.md))
- **Choices at `sandcastle init`:** GitHub Issues, Beads, or Custom ([README](https://github.com/mattpocock/sandcastle#readme)). The concrete commands are in [`src/InitService.ts`](https://github.com/mattpocock/sandcastle/blob/main/src/InitService.ts):
  - GitHub: `gh issue list --state open --label Sandcastle ...`, `gh issue view <ID>`, `gh issue close <ID> --comment "Completed by Sandcastle"`.
  - Beads: `bd ready --json`, `bd show <ID>`, `bd close <ID>`.
  - Custom: a deliberately failing placeholder plus `.sandcastle/SETUP_ISSUE_TRACKER.md`, which the coding agent follows to wire up any tracker.
- **How it finds ready work:** the prompt runs `` !`gh issue list ... --label Sandcastle` `` and pastes the output in before the agent starts (README, "Dynamic context"). "Ready" is a label (GitHub) or `bd ready`, meaning open and unblocked (Beads).
- **Requirements for a new tracker:** a first-party CLI, auth through an environment variable, non-interactive list, view and close commands, and installable in Debian. "MCP server only" is not enough (adding-an-issue-tracker.md).

### cyrus (ceedaragents/cyrus)

- **Store:** Linear, or optionally GitHub, GitLab or Slack. It "monitors (Linear|GitHub|GitLab|Slack) issues assigned to it" ([README](https://github.com/ceedaragents/cyrus#readme)).
- **How it finds work:** Linear webhooks to a public URL. Setup needs "Linear workspace with admin access (required to create OAuth apps)" and "A public URL for receiving Linear webhooks". Issues must be "assigned to Cyrus in Linear" ([docs/SELF_HOSTING.md](https://github.com/ceedaragents/cyrus/blob/main/docs/SELF_HOSTING.md)). Routing to repos uses `routingLabels`, `projectKeys` and `teamKeys`, and `labelPrompts` picks a mode per label ([docs/CONFIG_FILE.md](https://github.com/ceedaragents/cyrus/blob/main/docs/CONFIG_FILE.md)).
- The GitHub path is a GitHub App webhook transport for comments and PRs (`packages/github-event-transport`: "receiving and verifying forwarded GitHub webhooks"). That means installing an App on the repo.
- **Fit:** company repos already on Linear. It doesn't fit open-source repos the human doesn't own, because that needs admin access, a webhook and an App install.

### vibe-kanban (BloopAI/vibe-kanban)

- **Store:** its own. Local issues live in SQLite at `<data_dir>/db.v2.sqlite`, where `data_dir` is `~/Library/Application Support/...vibe-kanban` on macOS ([`crates/db/src/lib.rs`](https://github.com/BloopAI/vibe-kanban/blob/main/crates/db/src/lib.rs), [`crates/utils/src/assets.rs`](https://github.com/BloopAI/vibe-kanban/blob/main/crates/utils/src/assets.rs)). There is also a hosted "remote" backend (`crates/remote`, Postgres plus Electric sync) for shared kanban issues and projects.
- **How it finds work:** none. The human plans "with kanban issues" on its board and starts workspaces by hand ([README](https://github.com/BloopAI/vibe-kanban#readme)).
- **Status:** "Vibe Kanban is sunsetting." The cloud service, covering "kanban issues, comments, projects and organisations", was discontinued 30 days after 2026-04-10. "Local workspaces will continue to function." ([shutdown post](https://www.vibekanban.com/blog/shutdown))
- **Lesson:** a tool-owned store, especially a hosted one, leaves the work stranded when the tool dies. Data outside the repo and outside git can't be seen without the tool.

### Symphony (openai/symphony)

- **Store:** an external tracker behind an adapter. The spec defines an "Issue Tracker Adapter" that "Fetches candidate issues in active states" and "Normalizes tracker payloads into a stable issue model". It also says "The name `Issue` is generic ... an adapter MAY map it from a ticket, card, ..." ([SPEC.md](https://github.com/openai/symphony/blob/main/SPEC.md) §3, §4).
- The reference build ships adapters for "Linear, GitHub Issues, Jira Cloud, Asana, and GitLab" ([elixir/README.md](https://github.com/openai/symphony/blob/main/elixir/README.md)). The demo uses Linear.
- **How it finds ready work:** it polls on a fixed cadence. `WORKFLOW.md` in the repo sets `tracker.kind`, `active_states`, `terminal_states` and optional `required_labels`. The orchestrator keeps an in-memory `claimed` set, and restart recovery is "tracker/filesystem-driven ... without requiring a persistent database" (SPEC §2, §5.3.1, §7).
- **Writes:** "Symphony is a scheduler/runner and tracker reader. Ticket writes (state transitions, comments, PR links) are typically performed by the coding agent" (SPEC §1).
- **Lesson:** the tracker is the source of truth and the scheduler holds no state worth keeping. Workflow policy lives in the repo while work items live in the tracker.

### agent-orchestrator (ComposioHQ/agent-orchestrator, "AO")

- **Store:** its own SQLite holds projects, sessions, PRs and so on ([docs/architecture.md](https://github.com/ComposioHQ/agent-orchestrator/blob/main/docs/architecture.md)). Work comes in from tasks typed into the app or from a tracker.
- **Tracker adapters:** GitHub and GitLab, routed through a `multi` tracker (`backend/internal/adapters/tracker/{github,gitlab,multi}`). The GitHub adapter "v1 is read-only". It maps open, closed and `state_reason` plus the `in-progress` and `in-review` labels to normalized states ([github/doc.go](https://github.com/ComposioHQ/agent-orchestrator/blob/main/backend/internal/adapters/tracker/github/doc.go)).
- **How it finds ready work:** an opt-in intake observer (`AO_TRACKER_INTAKE=on`, enabled per Project) "polls a project's configured tracker for eligible issues and starts one worker session per issue". It runs every minute and filters on open state and assignee (`""`, `*`, `none` or a name) ([observe/trackerintake/observer.go](https://github.com/ComposioHQ/agent-orchestrator/blob/main/backend/internal/observe/trackerintake/observer.go)).
- **Lesson:** a read-only tracker plus assignee filtering is a cheap intake. It still needs the tracker to hold the work.

### warren (jayminwest/warren)

- **Store:** an `IssueTracker` seam. "Seeds is the in-process implementation. `RemoteTracker` bridges to external tracker containers through `warren-tracker/v1`." Also: "Optional Seeds and Mulch data also remain project files rather than warren database mirrors." ([docs/architecture.md](https://github.com/jayminwest/warren/blob/main/docs/architecture.md)) The extensions ship Jira and Azure DevOps, and "Linear remains the intended first external tracker" ([docs/design/extensions.md](https://github.com/jayminwest/warren/blob/main/docs/design/extensions.md)). Run history lives in warren's own store under `~/.warren/` ([README](https://github.com/jayminwest/warren#readme)).
- **Seeds:** a "Git-native issue tracker for AI agent workflows ... The JSONL file IS the database." It lives in `.seeds/issues.jsonl` in the repo, `sd ready` lists open, unblocked issues, and branches merge with `merge=union` plus dedup-on-read ([seeds README](https://github.com/jayminwest/seeds#readme)).
- **Repos you don't own:** this is the most direct treatment of the constraint. [docs/onboarding-external-repos.md](https://github.com/jayminwest/warren/blob/main/docs/onboarding-external-repos.md) says warren keeps a host clone and "never runs `git clean`", so "an **untracked** `.warren/config.yaml` you write into the host clone survives every refresh". Its `repoContext` can say "There is no issue tracker here — take the task statement in the prompt as the whole spec". Its limits: "No in-repo `.seeds/` / `.mulch/` ... On a foreign mirror they stay off unless you own a fork". "No upstream PRs from warren's identity" without a fork.
- The campaign-controller extension handles upstream contributions. It dispatches "explicit approved issue work ... against the bot-owned fork". It also renders "cross-fork pull-request intents without ever posting them" ([extensions/campaign-controller/README.md](https://github.com/jayminwest/warren/blob/main/extensions/campaign-controller/README.md)).

### Factory Missions (closed source)

- The official docs ([missions overview](https://docs.factory.com/missions/overview), [CLI missions](https://docs.factory.com/cli/features/missions)) describe a plan of features and milestones agreed in `/missions` and run by Mission Control. They say nothing about where the plan is stored and mention no tracker integration.
- *Lower trust, from a reverse-engineered prompt dump* ([gist](https://gist.github.com/V1ki/356b121038722ebf32b5aac85482c113)): mission state (`mission.md`, `features.json`, `validation-contract.md`, `validation-state.json`) lives in a `missionDir` outside the repo. Repo-scoped assets (`.factory/skills/`, `.factory/services.yaml`, `.factory/init.sh`) live in the repo. "These are DIFFERENT locations."
- **Lesson:** this is the same split again. Ephemeral work state lives outside the repo and durable project conventions live inside it.

### Beads (referenced by Sandcastle)

- A Dolt-backed local tracker in `.beads/`. Its modes map directly onto the constraint ([gastownhall/beads README](https://github.com/gastownhall/beads#readme)):
  - "Stealth Mode: Run `bd init --stealth` to use Beads locally without committing files to the main repo. Perfect for personal use on shared projects."
  - "Contributors (forked repos): Run `bd init --contributor` to route planning issues to a separate repo (e.g., `~/.beads-planning`). Keeps experimental work out of PRs."
  - `BEADS_DIR` points the database anywhere and "bypass[es] git repo discovery".
- Its dependency on Dolt makes it heavyweight compared with Markdown or JSONL.

## Who uses which

| Tool | Hosted tracker | In-repo files | Outside-repo files | Own DB |
|---|---|---|---|---|
| Sandcastle | GitHub Issues (label `Sandcastle`) | Beads `.beads/` | Beads stealth (via Custom) | no |
| cyrus | Linear (primary), GitHub/GitLab via App | no | no | config only (`~/.cyrus/`) |
| vibe-kanban | no (own cloud, now shut down) | no | no | SQLite (local) plus remote Postgres |
| Symphony | Linear, GitHub, Jira, Asana, GitLab adapters | `WORKFLOW.md` (policy only) | no | no (in-memory) |
| agent-orchestrator | GitHub, GitLab (read-only intake) | no | no | SQLite |
| warren | Jira, ADO via RemoteTracker (Linear planned) | Seeds `.seeds/` | untracked host-clone `.warren/` config | run history |
| Factory Missions | none documented | `.factory/` (conventions) | missionDir (work state, low trust) | presumably |

## Trade-offs against the three-repo constraint

| Option | Solo indie repo | Company repo | OSS repo the human doesn't own | Other costs |
|---|---|---|---|---|
| GitHub Issues | Good: free, visible, `gh` everywhere | OK if the company uses GH Issues | **Fails.** Labels, assign and close need triage or write access, and filing issues upstream is pollution. Using a fork's issues means forking. | Network and auth inside the sandbox; rate limits |
| Linear / Jira | Overkill | Good if already in use | **Fails.** It's the human's own workspace, so no pollution, but it needs an account, webhooks or polling, and an API key | Paid SaaS, auth, adapter work |
| In-repo files (Markdown, JSONL, Beads) | **Best.** Versioned with the code, readable without a tool, agents can edit them | OK if the team accepts the files, otherwise pollution | **Fails** if committed. Works only if untracked or gitignored locally, which is fragile with `git clean` and fresh worktrees | Merge conflicts on parallel writes (Seeds uses `merge=union`) |
| Outside-repo files (`~/.vago/projects/<p>/`, Beads `--contributor`, warren host clone) | Good, but loses the history living next to the code | Good, with no friction for the team | **Best.** Nothing touches upstream | Worktrees and sandboxes can't see it unless mounted or passed in the prompt (warren injects `repoContext` into the prompt for this reason) |
| Tool-owned DB (SQLite) | Works | Works | Works | Opaque to agents and the human without a viewer, and Alpha has no viewer. Strands data when the tool changes (vibe-kanban) |

Two consequences for Alpha that follow from the sources:

1. **Work state must reach the sandbox.** Sandcastle runs `` !`list command` `` inside the sandbox, Symphony gives the agent provider-native tracker tools, and warren puts context into the prompt. With outside-repo files, Vago reads the Ticket on the host and passes it in through prompt arguments (Sandcastle's `promptArgs` / `{{KEY}}`) or a mount. Without that, the Harness can't see the Ticket.
2. **Who writes status matters.** Symphony and Sandcastle let the agent close the ticket. With local files, the orchestrator on the host can own `Status:` transitions such as claimed, in-progress and done. This avoids sandboxed writes to a directory outside the repo, and it gives the human git history or a plain file to look at, which answers part of the open "seeing progress without a TUI" question.

## Open follow-ups

- Exact file format: front-matter fields, how a Ticket names its Goal, and `Blocked by:` for readiness. Beads and Seeds both define "ready" as open and unblocked.
- Whether committed in-repo Tickets are acceptable on company repos. That is a per-Project choice, which the setting above already allows.
