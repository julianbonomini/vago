# AFK

A personal software factory called Vago: the human defines what gets built, and coding agents build it detached while the human is away.

## Language

**Vago**:
The whole system the human drives, spanning every Project it serves.
_Avoid_: factory, orchestrator, platform, AFK

**Vago Alpha**:
The first, kernel-only release of Vago: it takes a Goal's ready Tickets through the Workflow that Goal names on a Harness without the human present. Inside Vago docs it may be shortened to "alpha".
_Avoid_: v1, MVP

**Project**:
One repository Vago builds for, such as a TUI, a mini project or an iOS app.
_Avoid_: repo, app

**Workflow**:
One of a Project's named lists of ordered Steps, defined inside that Project. Each Goal names the Workflow its Tickets pass through.
_Avoid_: pipeline, process

**Step**:
One entry in a Workflow, either an agent Step, which a Harness performs as one Run, or a shell Step, which runs a command.
_Avoid_: stage, phase, task

**Mission**:
A large outcome made of several Goals, such as "build a Slack clone".
_Avoid_: epic, initiative

**Goal**:
An outcome the human wants for a Project, from a one-Ticket feature to a whole app launch; done when all its Tickets are done. Goals do not nest.
_Avoid_: epic, milestone

**Run**:
One Harness session performing one agent Step on one Ticket, such as implement, review or discuss; a Ticket usually takes several.
_Avoid_: session, job, attempt

**Ticket**:
One unit of work that belongs to a Goal; done when it reaches the end of its Goal's Workflow.
_Avoid_: issue, task, story

**Gate**:
A Workflow Step that pauses work until the human approves it. Not part of Alpha.
_Avoid_: checkpoint, approval step

**Harness**:
The coding agent that does the work on a Ticket, such as Claude Code or Codex; Vago is agnostic to which.
_Avoid_: runtime, worker, droid

**Worktree**:
A Goal's own checkout of the Project, outside it, on branch `vago/<goal>`, where the Goal's Steps run.
_Avoid_: workspace, sandbox
