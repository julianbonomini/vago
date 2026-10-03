# How a Project defines its Workflow

Type: grilling
Status: resolved
Blocked by: 02, 07, 10

## Question

What is the shape of a Project's Workflow definition in Alpha? This covers where it lives in the Project, its format (code, config, prompt files, skills), which steps exist and how they chain, how merge policy and Ticket "done" are expressed, and how the Project's conventions and code style reach every Run.

It also covers whether steps share a sandbox or worktree (each step is always its own Run), and whether a Goal gets its own branch that Tickets merge into or each Ticket lands on main. If the Workflow decides the branch question, Project setup has to ask for it. One candidate from warren: read merge policy from the base branch, so an agent can't edit its own merge rules. See "What Vago borrows from other orchestrators".

Constraint from "Does Alpha run on Sandcastle?": the Workflow definition can't depend on Sandcastle.

Inputs from "What Alpha is written in":
- The Workflow is **declarative** (TOML/YAML steps plus prompt files, skills and shell steps), never TypeScript. Settle the format details here.
- Each Project keeps a **code-style MD** (style, quality, architecture) that agents read during implement and review. Decide how it, and other conventions, reach every Run.
- A Project's check command (Vago's own: `bun run check`) gates nothing by itself. The Workflow decides whether and how it gates a change: on a branch, behind human review, or automatically.

## Answer

**A declarative, linear list of agent and shell Steps in `.vago/workflow.toml`, frozen when Alpha starts a Goal. The kernel owns no git and no workspace.** The boundary is recorded as [ADR 0002](../../../docs/adr/0002-kernel-owns-no-git-and-no-workspace.md).

- **Location and format.** `.vago/` holds the Workflow (`workflow.toml`), its prompts and anything Alpha adds later. The format is TOML, not YAML.
- **Freeze point.** Alpha reads the Workflow and freezes it when it starts working on a Goal, and bad config fails closed before any Run. To change the Workflow mid-Goal, stop Alpha, edit `.vago/` and start it again. Done Tickets stay done and Alpha picks up the remaining ready ones. Agents may edit `.vago/`, but their edits apply only on the next start. Runs happen in the human's checkout, so Alpha can't tell a human edit from an agent edit, and warren's "read from the base branch" isn't available. Reading the Workflow again per Ticket was rejected because an agent could weaken later Tickets of the same unattended Goal.
- **Steps are strictly linear.** No branching, loops or parallel steps. A failing step stops the Ticket, and what happens next belongs to the "Run lifecycle and failure" fog.
- **Two Step types in Alpha.** `agent` runs a prompt file as one fresh Run. `shell` runs a command in the same sandbox, with `on_fail = "stop"` (the default) or `"continue"`. Every Step has an `id`. Gate and merge primitives come later, since deterministic gating and merging would earn their place then.
- **Skills come from prompts.** A prompt calls whatever skills the Project brings, so there's no `skill` key. Skills load differently per Harness, and the pitch is "bring your own skills".
- **Harness.** `harness` and `model` are set at Workflow level, and any agent Step can override them, e.g. review on another Harness.
- **What a prompt receives.** Alpha does plain substitution of `{{ticket}}`, `{{goal}}` and `{{steps.<id>.output}}`. A shell step's output is stdout and stderr plus the exit code. There's no templating logic.
- **Includes are named slots.** `[include]` at Workflow level and `include.<name>` per Step. Names are free, and a Step adds new names and replaces a clashing one, as a shallow merge. Alpha adds each file to agent prompts under its slot name as a heading. There's no way to remove a slot per Step. The kernel fixes no set of kinds; the starter Workflow picks them (`style`, `architecture`).
- **Git belongs to the Workflow.** Branches, commits, merges and PRs happen inside Steps, through prompts or shell. Alpha enforces no branch model, and the starter Workflow carries the opinion.
- **Workspace.** Runs happen in the human's checkout as it is, with no dirty-tree guard. The human leaves it alone during a Goal. A worktree per Goal comes after Alpha.
- **Done.** A Ticket is done when its last Step succeeds, and Alpha marks it, never an agent. Where it is marked is "Where Vago keeps Goals and Tickets". A Goal is done when all its Tickets are done.
- **Scaffold.** `vago init` copies one starter Workflow verbatim (Sandcastle's ADR 0009 pattern): `workflow.toml`, its prompts and a starter code-style file. It's tailored to the human and is the Workflow Vago builds itself with. The kernel imposes nothing, and the opinions live in the copy the user owns.

Shape agreed in the session:

```toml
harness = "claude-code"
model   = "opus"

[include]
style = "docs/code-style.md"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"

[[steps]]
id      = "check"
type    = "shell"
run     = "bun run check"
on_fail = "continue"

[[steps]]
id      = "review"
type    = "agent"
harness = "codex"
prompt  = "prompts/review.md"        # reads {{steps.check.output}}, fixes, never rejects
include.architecture = "docs/architecture.md"

[[steps]]
id     = "merge"
type   = "agent"
prompt = "prompts/merge.md"
```
