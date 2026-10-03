# How other orchestrators work

Type: research
Status: resolved

## Question

What do cyrus, vibe-kanban, openai/symphony, agent-orchestrator (Untrivial-ai), warren (github.com/jayminwest/warren) and Factory Missions actually do? For each one, cover:
- What it is and its core loop, from work item to merged code.
- How it structures Runs per Ticket.
- How it keeps work running detached.

Report facts only. Choosing what Vago borrows is the human's call: see "What Vago borrows from other orchestrators".

## Answer

- **Symphony:** a spec plus an Elixir reference build. It has a Project-owned `WORKFLOW.md` (YAML front matter plus a prompt), and the path to merge is expressed as tracker states. A stateless poll tick reconciles, then dispatches. Runs are immutable with explicit terminal reasons, retries use backoff and a stall timeout, and a restart rebuilds from the tracker and workspaces.
- **warren:** a self-hosted control plane. Its only guaranteed output is a pushed branch, and PR/merge is opt-in policy read from the base branch. PlanRun walks a plan's child tickets one at a time, each waiting for the previous one to merge, with one retry only for provider errors.
- **Cyrus:** watches Linear and GitHub issues and uses a worktree per issue. In v0.2.41 it swapped fixed procedures for skills plus a Stop hook that blocks ending a session while work is unpushed. Follow-ups resume the same Harness session.
- **agent-orchestrator:** a Go daemon with one long session per task. CI and review feedback go back into that session. It stores facts and derives status when read.
- **vibe-kanban:** human-driven, and sunsetting. It has attempts → sessions (shared files, separate context) → execution processes, and orphaned Runs are marked failed on restart.
- **Factory Missions:** an orchestrator plus fresh workers per feature, with git as the handoff and validators per milestone. Where it stores mission state on disk isn't documented.
- Findings: [research/how-other-orchestrators-work.md](../research/how-other-orchestrators-work.md)
