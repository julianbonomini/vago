# Map: Punt Alpha

Label: wayfinder:map

## Destination

**A decision: the boundary of the Alpha kernel and the manual bootstrap path to it**, clear enough to hand to `/to-spec`.
Alpha: point it at a Project and it picks up that Project's ready Tickets and pushes each through the Project's own Workflow (e.g. implement → review → merge) on a Harness in a sandbox, without the human present, until the Goal is done. Project setup (conventions, code style, Workflow definition) is the only other piece. Bar: Alpha can finish a Goal against its own repo.

## Notes

- Domain: agent orchestration for solo, company and open-source repos. Vocabulary lives in `CONTEXT.md` (Punt, Alpha, Project, Workflow, Mission, Goal, Ticket, Run, Gate, Harness). Use it.
- Skills to consult: `grilling` + `domain-modeling` for grilling tickets; `research` for research tickets. Research reports facts only, never what Punt should do: every "what do we take" call is the human's, made in a grilling ticket.
- Settled while charting:
  - **Build our own**; don't adopt an existing tool. Borrow or copy ideas freely.
  - **References: Sandcastle, warren and Factory Missions only.** Borrow ideas, not code, in Punt's own opinionated way. warren (github.com/jayminwest/warren) is the closest match and the first place to look for "how". Sandcastle (github.com/mattpocock/sandcastle) may be used as a developer tool to build Alpha, but Alpha never depends on it. Factory Missions: orchestration ideas only.
  - **Alpha is self-contained to one Project's repo**: its own config and CLI live there; no view across Projects.
  - **One Goal at a time per Project.**
  - **Goals are flat** (no nesting); Missions exist in the vocabulary but not in Alpha.
  - The human creates Goals and Tickets outside Punt (Wayfinder, `/to-spec`, `/to-tickets`). Alpha only picks up ready Tickets.
  - **Workflow is per Project and editable**, including merge policy and what "done" means for a Ticket. A Goal is done when all its Tickets are done.
  - **Must be Harness-agnostic** (Claude Code, Codex) and run on the human's machine.
  - **Parallelism**: whatever comes free; serial is fine.
  - **Name**: "Punt" is provisional until branding.
- Standing preference: **lean**. Bare bones that can then improve itself; push everything else out of scope.

## Decisions so far

<!-- research tickets record facts here; the human's choices come from the grilling tickets -->

- [How Sandcastle runs work](issues/02-how-sandcastle-runs-work.md) (research): a library, not a daemon. The Workflow is a TypeScript script the user owns, chaining headless implement, review and merge Harness calls in a container per branch. It has no Ticket state, Gates, retries or detachment of its own.
- [Where Goals and Tickets live](issues/01-where-goals-and-tickets-live.md) (research): tools use four places: hosted trackers, files in the repo, files outside the repo, or their own database. Most put a small tracker seam in front of the store. Hosted trackers need write access to repos the human may not own.
- [How other orchestrators work](issues/03-how-other-orchestrators-work.md) (research): how Symphony, warren, Cyrus, agent-orchestrator, vibe-kanban and Factory Missions each define their Workflow, structure Runs per Ticket, and keep running detached.
- [What Punt borrows from other orchestrators](issues/07-what-punt-borrows-from-other-orchestrators.md): only Sandcastle, warren and Missions are references. One fresh Run per Workflow step, no loops, no planner, the reviewer fixes the code itself. Terminal reasons and the planner come later.
- [Does Alpha run on Sandcastle?](issues/05-does-alpha-run-on-sandcastle.md): no. Alpha owns its engine and copies Sandcastle's ideas, not its code. Sandcastle is at most a developer tool for building the kernel and has no effect on Alpha. The language question was split out into its own ticket.
- [What Agent SDKs add over Harness CLIs](issues/09-what-agent-sdks-add-over-harness-clis.md) (research): official SDKs are Python and TypeScript only (pi: TypeScript only), and the Claude and Codex SDKs wrap the CLI binary. They add in-process callbacks (permissions, hooks, MCP tools) and mid-session control. Go has only community ports. Most orchestrators drive CLIs or Codex app-server directly.
- [What Alpha is written in](issues/10-what-alpha-is-written-in.md): TypeScript on Bun, compiled to one binary. Harnesses are driven through their headless CLIs, Workflows are declarative, and Alpha runs a pinned binary. Punt's repo has `bun run check` and its own code-style file. ADR 0001.

## Not yet specified

- **Run lifecycle and failure**: what happens when a Run fails, a review rejects, or a Ticket gets stuck (retry limits, parking it, surfacing it). How the other tools handle this is in "How other orchestrators work". Pointers from warren to weigh: one retry only for provider errors, immutable Runs, Runs marked lost on restart, bad config fails closed. Explicit terminal reasons are deferred past Alpha.
- **Seeing progress without a TUI**: Alpha has no viewer, but the human still needs some way to see what happened (logs, git history, ticket status). How the other tools handle this is in "How other orchestrators work".
- **Harness and credentials in the sandbox**: how a Project picks its Harness and how auth reaches the sandbox. Alpha implements this itself; the Sandcastle research shows a pattern to copy (env-file allowlist, `claude setup-token`).
- **Bootstrap steps**: the concrete manual work, from building the kernel with ordinary developer tools (Sandcastle or manual sessions) to "Alpha takes over its own Goals". Includes: the explicit rebuild-and-reinstall step after Alpha merges changes to itself (Alpha runs a pinned binary), and writing Punt's own code-style file (plain TypeScript rules, *A Philosophy of Software Design*, *Designing Data-Intensive Applications*) and `bun run check`.

## Out of scope

- TUI or any viewer (comes after Alpha, built by Punt itself), including watching a Run live; Alpha only logs the Harness event stream for it.
- Creating Goals and Tickets inside Punt; decomposing Goals automatically.
- Missions and nested Goals.
- A view across Projects; running several Goals of one Project at once.
- A planner that sequences Tickets; explicit terminal reasons for a Run.
- Goal-level validation and Factory Missions' validation approach.
- Notifications (ntfy, Slack, push).
- iOS / macOS sandboxes; a macOS app.
- Default Workflows shipped with Punt.
- Branding and the final name.
