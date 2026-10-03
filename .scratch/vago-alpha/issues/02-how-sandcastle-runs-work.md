# How Sandcastle runs work

Type: research
Status: resolved

## Question

How does Sandcastle (github.com/mattpocock/sandcastle) actually turn Tickets into finished work, concretely enough that we can copy the lean parts? Specifically:
- How does a Run execute in Docker, and in what sense is it detached from the terminal?
- How does it loop over issues?
- How does it split one Ticket into sessions (implement, review, discuss)?
- How is that Workflow defined and edited, and what are its defaults?
- How does it do parallelism, and how do Harness auth and credentials reach the sandbox?
- How does it commit and merge?
- How much code is it, and how hard would it be to replicate?

## Answer

Sandcastle is a library, not a daemon. The Workflow is a user-owned TypeScript script (`.sandcastle/main.mts` plus prompt files) that loops plan → implement → review → merge. Each Run is `docker run -d … sleep infinity` followed by `docker exec claude --print --dangerously-skip-permissions`. Runs end on `<promise>COMPLETE</promise>`, process exit or a 10-minute idle timeout.
Issues come from a shell command inlined into the prompt (`gh issue list` / `bd ready`). The agent commits. Sandcastle then runs `git merge` on the host, or a merger Run merges branches and closes issues. Parallelism is `Promise.allSettled` with one worktree and one container per branch.
Credentials are env vars declared in `.sandcastle/.env` and passed as `-e`. Claude Code uses `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, and `gh` uses `GH_TOKEN`. "Detached" only means headless: the host process must stay alive. Real detachment comes from GitHub Actions or an external daemon.
Size: ~15k LOC library, 50–230 LOC Workflows. A lean Vago kernel copy is a few hundred lines. Vago must add Gates, Ticket state, retries and detachment itself.
Findings: [research/how-sandcastle-runs-work.md](../research/how-sandcastle-runs-work.md)
