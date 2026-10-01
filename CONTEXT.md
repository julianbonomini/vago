# AFK

A personal software factory, provisionally called Punt: the human defines what gets built, and coding agents build it detached while the human is away.

## Language

**Punt** (provisional name):
The whole system the human drives, spanning every Project it serves.
_Avoid_: factory, orchestrator, platform, AFK

**Alpha**:
The first, kernel-only release of Punt: it takes a Project's ready Tickets through that Project's Workflow on a Harness without the human present.
_Avoid_: v1, MVP

**Project**:
One repository Punt builds for, such as a TUI, a mini project or an iOS app.
_Avoid_: repo, app

**Workflow**:
A Project's own ordered steps that a Ticket passes through, defined inside that Project.
_Avoid_: pipeline, process

**Mission**:
A large outcome made of several Goals, such as "build a Slack clone".
_Avoid_: epic, initiative

**Goal**:
An outcome the human wants for a Project, from a one-Ticket feature to a whole app launch; done when all its Tickets are done. Goals do not nest.
_Avoid_: epic, milestone

**Run**:
One Harness session performing one Workflow step on one Ticket, such as implement, review or discuss; a Ticket usually takes several.
_Avoid_: session, job, attempt

**Ticket**:
One unit of work that belongs to a Goal; done when it reaches the end of its Project's Workflow.
_Avoid_: issue, task, story

**Gate**:
A Workflow step that pauses work until the human approves it.
_Avoid_: checkpoint, approval step

**Harness**:
The coding agent that does the work on a Ticket, such as Claude Code or Codex; Punt is agnostic to which.
_Avoid_: runtime, worker, droid
