# Map: Vago Alpha

Label: wayfinder:map

## Destination

**A decision: the boundary of the Alpha kernel and the manual bootstrap path to it**, clear enough to hand to `/to-spec`.
Alpha: point it at a Project and it picks up that Project's ready Tickets and pushes each through the Project's own Workflow (e.g. implement → review → merge) on a Harness in its own guarded mode on the human's machine, without the human present, until the Goal is done. Project setup (conventions, code style, Workflow definition) is the only other piece. Bar: Alpha can finish a Goal against its own repo.

## Notes

- Domain: agent orchestration for solo, company and open-source repos. Vocabulary lives in `CONTEXT.md` (Vago, Alpha, Project, Workflow, Mission, Goal, Ticket, Run, Gate, Harness). Use it.
- Skills to consult: `grilling` + `domain-modeling` for grilling tickets; `research` for research tickets. Research reports facts only, never what Vago should do: every "what do we take" call is the human's, made in a grilling ticket.
- Settled while charting:
  - **Build our own**; don't adopt an existing tool. Borrow or copy ideas freely.
  - **References: Sandcastle, warren and Factory Missions only.** Borrow ideas, not code, in Vago's own opinionated way. warren (github.com/jayminwest/warren) is the closest match and the first place to look for "how". Sandcastle (github.com/mattpocock/sandcastle) may be used as a developer tool to build Alpha, but Alpha never depends on it. Factory Missions: orchestration ideas only.
  - **Alpha is self-contained to one Project's repo**: its own config and CLI live there; no view across Projects.
  - **One Goal at a time per Project.**
  - **Goals are flat** (no nesting); Missions exist in the vocabulary but not in Alpha.
  - The human creates Goals and Tickets outside Vago and loads them through `vago goal new` and `vago ticket add`. Alpha only picks up ready Tickets.
  - **Workflow is per Project and editable**, including merge policy and what "done" means for a Ticket. A Goal is done when all its Tickets are done.
  - **Harness-agnostic by design**, running on the human's machine. Alpha ships the Claude Code Harness only; Codex comes once Alpha works.
  - **Parallelism**: whatever comes free; serial is fine.
  - **Name**: "Vago" is provisional until branding.
- Standing preference: **lean**. Bare bones that can then improve itself; push everything else out of scope.

## Decisions so far

<!-- research tickets record facts here; the human's choices come from the grilling tickets -->

- [How Sandcastle runs work](issues/02-how-sandcastle-runs-work.md) (research): a library, not a daemon. The Workflow is a TypeScript script the user owns, chaining headless implement, review and merge Harness calls in a container per branch. It has no Ticket state, Gates, retries or detachment of its own.
- [Where Goals and Tickets live](issues/01-where-goals-and-tickets-live.md) (research): tools use four places: hosted trackers, files in the repo, files outside the repo, or their own database. Most put a small tracker seam in front of the store. Hosted trackers need write access to repos the human may not own.
- [How other orchestrators work](issues/03-how-other-orchestrators-work.md) (research): how Symphony, warren, Cyrus, agent-orchestrator, vibe-kanban and Factory Missions each define their Workflow, structure Runs per Ticket, and keep running detached.
- [What Vago borrows from other orchestrators](issues/07-what-vago-borrows-from-other-orchestrators.md): only Sandcastle, warren and Missions are references. One fresh Run per Workflow step, no loops, no planner, the reviewer fixes the code itself. Terminal reasons and the planner come later.
- [Does Alpha run on Sandcastle?](issues/05-does-alpha-run-on-sandcastle.md): no. Alpha owns its engine and copies Sandcastle's ideas, not its code. Sandcastle is at most a developer tool for building the kernel and has no effect on Alpha. The language question was split out into its own ticket.
- [What Agent SDKs add over Harness CLIs](issues/09-what-agent-sdks-add-over-harness-clis.md) (research): official SDKs are Python and TypeScript only (pi: TypeScript only), and the Claude and Codex SDKs wrap the CLI binary. They add in-process callbacks (permissions, hooks, MCP tools) and mid-session control. Go has only community ports. Most orchestrators drive CLIs or Codex app-server directly.
- [What Alpha is written in](issues/10-what-alpha-is-written-in.md): TypeScript on Bun, compiled to one binary. Harnesses are driven through their headless CLIs, Workflows are declarative, and Alpha runs a pinned binary. Vago's repo has `bun run check` and its own code-style file. ADR 0001.
- [How a Project defines its Workflow](issues/04-how-a-project-defines-its-workflow.md): `.vago/workflow.toml` holds a linear list of agent and shell Steps, frozen when Alpha starts a Goal. Prompts call your own skills, and include slots carry docs into prompts. All git work happens inside Steps, and Runs use the human's checkout as-is. `vago init` copies one starter Workflow. ADR 0002.
- [Where Vago keeps Goals and Tickets](issues/08-where-vago-keeps-goals-and-tickets.md): Markdown files with a TOML header in `.vago/goals/<goal>/tickets/`, always untracked via `.git/info/exclude`. Only Alpha writes status (ready, running, done, stuck). `vago run <goal>` makes the Goal's Tickets fair game after a format check. `vago goal new` and `vago ticket add` are in scope. ADR 0003.
- [What Alpha's runtime is](issues/11-what-alphas-runtime-is.md): there's no Vago sandbox. Steps run on the host in the human's checkout, and agent Steps run in their Harness's guarded mode, with an optional `args` key in `workflow.toml` to change the flags. Alpha uses the host's own credentials and kills the Run's process group on exit. `vago run` runs in the foreground only.
- [How a Run fails and what Alpha does next](issues/12-how-a-run-fails-and-what-alpha-does-next.md): no retries. A Step fails on a non-zero exit or a 30-min idle timeout on the Harness's JSONL stream. The first `stuck` Ticket stops the Goal, and interrupted or lost Tickets go `stuck` too. `vago run` refuses to start while a Ticket is stuck, and the human fixes the checkout, then runs `vago ticket reset`. Each Step's session, outcome, tokens and cost are recorded as `[[runs]]` in the Ticket header.
- [Alpha kernel boundary and bootstrap path](issues/06-alpha-kernel-boundary-and-bootstrap.md): all of Alpha is built by hand with Sandcastle and ships Claude Code only, behind a compiled-in Harness module. The starter Workflow ships inside the binary. `vago run` prints one line per Step start and end, and logs go to `goals/<goal>/logs/`. The bar is a 2-Ticket Goal on Vago's own repo going `done` one Ticket after the other.

## Not yet specified

_Nothing left: the way to the destination is clear. Hand off to `/to-spec`._

## Out of scope

- TUI or any viewer (comes after Alpha, built by Vago itself), including watching a Run live; Alpha only logs the Harness event stream for it.
- Creating Goals and Tickets inside Vago; decomposing Goals automatically.
- Missions and nested Goals.
- A view across Projects; running several Goals of one Project at once.
- A planner that sequences Tickets; explicit terminal reasons for a Run.
- Goal-level validation and Factory Missions' validation approach.
- Notifications (ntfy, Slack, push).
- iOS / macOS sandboxes; a macOS app.
- A library of default Workflows. Alpha ships exactly one starter Workflow.
- User docs for writing Workflows and bringing your own skills (after Alpha works).
- A container sandbox for Steps (Docker or Podman, image, mounts, credential passing); it can be added later at the single point where Steps run.
- Detaching `vago run` (daemon, `--detach`, keeping the machine awake); the human uses tmux and the like themselves.
- Retrying provider errors (warren's one retry); it needs per-Harness error classification.
- Gate and merge Step primitives, and a worktree per Goal (after Alpha).
- Branding and the final name.
- Harnesses other than Claude Code (Codex adapter, user-supplied Harness plugins); added once Alpha works.
- A `vago status` command and similar small CLI extras.
