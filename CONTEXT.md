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
One of a Project's named lists of ordered Steps, defined inside that Project. Each Goal names the Workflow its Tickets pass through, and a Ticket may name another for itself.
_Avoid_: pipeline, process

**Step**:
One entry in a Workflow, either an agent Step, which a Harness performs as one Run, or a shell Step, which runs a command.
_Avoid_: stage, phase, task

**Goal Step**:
A Step of a Workflow's `before_all` or `after_all` list, run for the whole Goal in its worktree rather than for a Ticket, and recorded in `goal.md`. Only the Goal's own Workflow's Goal Steps run.
_Avoid_: hook, setup step

**`before_all`**:
A Workflow's list of Goal Steps that runs once, before the Goal's first Ticket, and not again once it has gone through.
_Avoid_: on start, setup

**`after_all`**:
A Workflow's list of Goal Steps that runs once every Ticket is done, and again after any Tickets added since then are done. A Goal isn't done until it has gone through.
_Avoid_: on end, teardown

**Milestone**:
A large outcome made of several Goals, such as "build a Slack clone"; done when all its Goals are done. Not part of Alpha.
_Avoid_: mission, epic, initiative

**Goal**:
An outcome the human wants for a Project, from a one-Ticket feature to a whole app launch; done when all its Tickets are done. Goals do not nest.
_Avoid_: epic, mission

**Planning item**:
A Goal still being planned: a folder in `.vago-goals/` with a `planning/` folder and no `goal.md`. It shows in the Goals list as `planning`, has a name the human may change, and can be discarded. It is no Goal: `vago run` doesn't find it, and it has no Workflow, Tickets or Runs.
_Avoid_: draft, idea, proposal

**Run**:
One Harness session performing one agent Step on one Ticket, or for the Goal in a Goal Step, such as implement, review or discuss; a Ticket usually takes several.
_Avoid_: session, job, attempt

**Pass**:
A Ticket's, or a Goal Step list's, way through its Steps from the first; a reset Ticket starts a new one, and a picked-up pass continues its latest.
_Avoid_: attempt, round

**Lost**:
A Goal whose Ticket says `running` while no live `vago run` has the Goal. The next `vago run` ends that Ticket's open Run with outcome `lost` and picks the Ticket up at that Run's Step. A Goal Step Run left open is ended `lost` the same way, and its pass is picked up at that Step.
_Avoid_: crashed, orphaned

**Resume**:
A Run that continues an earlier Run's Harness session with a fixed message to continue, in place of the Step's prompt, when a Ticket is picked up at an agent Step or the Step is retried. A resume that fails to start falls back to a fresh session once.
_Avoid_: restart, rerun

**Retry**:
A Resume that `vago run` starts by itself after an agent Step fails, waiting 1, 1 and then 5 minutes before each of the three; the Ticket goes stuck when the last one fails. Shell Steps are never retried.
_Avoid_: attempt, rerun

**Ticket**:
One unit of work that belongs to a Goal; done when it reaches the end of its Workflow.
_Avoid_: issue, task, story

**Gate**:
A Workflow Step that pauses work until the human approves it. Not part of Alpha.
_Avoid_: checkpoint, approval step

**Harness**:
The coding agent that performs an agent Step: Claude Code or Codex. A Workflow names one for all its agent Steps, and a Step may name its own, so one Ticket can be built on one Harness and reviewed on the other.
_Avoid_: runtime, worker, droid

**Worktree**:
A Goal's own checkout of the Project, outside it, on branch `vago/<goal>`, where the Goal's Steps run. Vago removes it once the Goal is done and nothing in it would be lost; the branch stays.
_Avoid_: workspace, sandbox
