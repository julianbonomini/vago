# What Punt borrows from other orchestrators

Type: grilling
Status: resolved

## Question

Having seen how Sandcastle, Symphony, warren, Cyrus, agent-orchestrator, vibe-kanban and Factory Missions work (see "How Sandcastle runs work" and "How other orchestrators work"), which of their ideas does the human want in Punt Alpha, which are for later, and which are rejected? Go through the research tool by tool. The agent presents what each one does; the human decides.

## Answer

- **References:** only Sandcastle, warren and Factory Missions. Borrow their ideas, not their code, and apply them in Punt's own opinionated way. warren is the closest match and the first place to look when a "how do we do X" question comes up. Symphony, Cyrus, agent-orchestrator and vibe-kanban are rejected.
- **In Alpha (from Sandcastle):** a Run ends on a completion signal or an idle timeout. Credentials come from an env-file allowlist. The agent commits and opens the PR or merges, as the Workflow says. A reviewer fixes the code itself and never rejects. There's no planner: code picks whatever Ticket is ready.
- **Runs:** each Workflow step is its own Run with a fresh Harness session; nothing carries over except git. The Workflow decides whether steps share a sandbox or worktree. There are no loops. Repeated review means listing more review steps in the Workflow.
- **Serial:** one Goal at a time per Project.
- **Self-contained:** Alpha lives inside one Project's repo, with that repo's own config and CLI. There's no view across Projects.
- **Fresh context per unit of work, with git as the handoff** (Missions, warren): agreed.
- **Later:**
  - Explicit terminal reasons for a Run (succeeded, failed, timed out, stalled, cancelled).
  - A planner that sequences the work.
  - A planning session in Punt that turns an intent into a Goal and its Tickets, the way warren and Missions do. This one is already out of scope.
- **Rejected:**
  - The agent moving tracker states itself (Symphony).
  - One long session per task (agent-orchestrator).
  - Attempt and session hierarchies (vibe-kanban).
  - An orchestrator *agent* (Missions).
  - Keeping the machine awake.
- **warren mechanisms kept as pointers, not decisions:** one retry for provider errors only, immutable Runs, Runs marked lost on restart, bad config failing closed, merge policy read from the base branch.
