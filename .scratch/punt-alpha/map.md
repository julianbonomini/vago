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
  - **Sandcastle** (github.com/mattpocock/sandcastle) is the tool we use to build Alpha and one reference among many. Whether Alpha *depends* on it at runtime is open.
  - **Other references**: Factory Missions (orchestration and validation ideas only), cyrus, vibe-kanban, openai/symphony, agent-orchestrator, warren (github.com/jayminwest/warren), awesome-agent-orchestrators.
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

## Not yet specified

- **Run lifecycle and failure**: what happens when a Run fails, a review rejects, or a Ticket gets stuck (retry limits, parking it, surfacing it). How the other tools handle this is in "How other orchestrators work".
- **Seeing progress without a TUI**: Alpha has no viewer, but the human still needs some way to see what happened (logs, git history, ticket status). How the other tools handle this is in "How other orchestrators work".
- **Harness and credentials in the sandbox**: how a Project picks its Harness and how auth reaches the sandbox. Likely falls out of the Sandcastle research.
- **Bootstrap steps**: the concrete manual work, from "Sandcastle running on this repo" to "Alpha takes over its own Goals".

## Out of scope

- TUI or any viewer (comes after Alpha, built by Punt itself).
- Creating Goals and Tickets inside Punt; decomposing Goals automatically.
- Missions and nested Goals.
- Goal-level validation and Factory Missions' validation approach.
- Notifications (ntfy, Slack, push).
- iOS / macOS sandboxes; a macOS app.
- Default Workflows shipped with Punt.
- Replacing Sandcastle with our own engine (later Goal, if Alpha depends on it).
- Branding and the final name.
