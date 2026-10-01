# Where Punt keeps Goals and Tickets

Type: grilling
Status: resolved

## Question

Given the options in "Where Goals and Tickets live" (hosted tracker, files in the repo, files outside the repo, Punt's own store), where does Alpha keep a Project's Goals and Tickets, and how does it tell which Tickets are ready? It must work for solo, company and open-source repos the human doesn't own. The human decides.

## Answer

**Punt owns a local store of Markdown files in `.punt/goals/`. Tickets are never tracked by git, and only Alpha writes their status.** The boundary is recorded as [ADR 0003](../../../docs/adr/0003-tickets-are-untracked-files-only-alpha-writes-status.md). Inputs: [Where Goals and Tickets live](01-where-goals-and-tickets-live.md) and [research/how-warren-keeps-tickets.md](../research/how-warren-keeps-tickets.md) (warren's Seeds).

- **Own store, local.** Punt's Tickets have nothing to do with `.scratch/` or any tracker skill. Hosted trackers (GitHub Issues, Linear) are out for Alpha: they annoy shared and open-source repos, or need a fork. SQLite was the gut choice, but Markdown wins for Alpha: it reads well for LLMs, and it's easy for Alpha to strip the header and substitute the rest. SQLite can come later behind the CLI.
- **Layout.** `.punt/goals/<goal-slug>/goal.md` describes the Goal, and its body is what `{{goal}}` substitutes. Each Ticket is `.punt/goals/<goal-slug>/tickets/NN-<slug>.md`. A Goal has no status of its own: it's done when all its Tickets are `done`, worked out on demand.
- **Ticket file.** A TOML front-matter header (`+++`) holding `status` and `blocked_by`, then a title and a body. TOML was chosen over YAML because agents never see the header, so how familiar the format is doesn't matter. TOML matches `workflow.toml` and is stricter for validation.

  ```markdown
  +++
  status     = "ready"
  blocked_by = [1, 2]
  +++

  # Ticket validation

  `punt run` checks every Ticket in the Goal before the first Run…
  ```
- **Git: Punt leaves no trace in the repo.** Punt is a tool for one developer, and several developers can each use it on the same repo without bothering one another. `punt init` keeps uncommitted parts out of git with `.git/info/exclude`, never `.gitignore`.
  - **Tickets are always untracked**, and init doesn't ask about them. Status lives in the Ticket file, so committed Tickets would push Alpha's status writes into the Workflow's commits and branch switches mid-Goal.
  - **The Workflow is private by default.** Init asks whether to commit it and explains what that means, e.g. a team sharing one Workflow.
- **Writing Tickets.** In scope: `punt goal new` and `punt ticket add`, which assigns the next `NN`. How Tickets reach the store (by hand, or a skill of the human's) is outside Alpha. The out-of-scope line "Creating Goals and Tickets inside Punt" stands.
- **Status.** Only Alpha writes status, from the host, and the CLI has no command to set it. The statuses:
  - `ready`: no Workflow has started on the Ticket;
  - `running`: a Workflow has started;
  - `done`: the Workflow finished; whatever its Steps did (PRs, merges, releases) doesn't matter;
  - `stuck`: a Step stopped it.
- **Readiness.** Running `punt run <goal-slug>` is the human's signal that every Ticket in that Goal is fair game, and there's no marker per Ticket. A Ticket is ready when it's `ready` and every Ticket in its `blocked_by` (numbers within the same Goal) is `done`. The lowest number goes first. This will likely need revisiting after Alpha.
- **Validation.** Before the first Run, `punt run` checks format only, never content: the Goal exists, every header parses, every blocker exists and there are no cycles. Bad format means Alpha doesn't start. Alpha exits when no Ticket is ready.
- **Prompt.** `{{ticket}}` substitutes the title and body. The header (status, Run metadata) never reaches the agent.
- **Fog for "Run lifecycle and failure":**
  - recording the Harness session ID and start time when a Ticket goes `running`;
  - what to do with a Ticket that's `running` when Alpha starts;
  - what a `stuck` Ticket means for its dependants beyond never becoming ready.
