# Vago v2 backlog

What to build after Alpha, in no fixed order. Take one item at a time: grill it with `/grill-with-docs` if it has open questions, write it up as Vago Tickets, and `vago run` the Goal. Tick an item off when its Goal is merged.

Items marked _(grill)_ have design questions to settle before writing Tickets.

## From using Alpha

- [x] A Workflow for developing Vago itself, in Vago's own `.vago/`. _(grill)_
- [x] Goals and Tickets written from the CLI can't carry a body, a description or other detail yet. Add a way to give them that. _(grill)_
- [x] Better `vago --help` and per-command help.
- [x] Vago goals currently get erased when you delete vago to re-run vago init. vago goals should be tracked in a different folder like .vago-goals and .vago for the config. git ignore should exlude .vago-goals always, while vago init asks if you want to include .vago
- [x] A README for developers who want to use Vago: install, `vago init`, writing a Goal and its Tickets, `vago run`, recovering a stuck Ticket. Architecture and philosophy can wait.
- [x] Improve the logs from cli (colours, spacing, maybe a table, idk)
- [x] Goal PR description sucks. title could be improved as well. should contain usefull info as well as cost, time, etc. some metrics...
- [x] Prompt/skill / way to make grilling and to-tickets clone go directly into vago goals with correct format.
- [x] rename the project to vago, everything! like docs, strings, project stuff, the config folder to .vago, everything!
- [x] fix all red flags
- [x] workflows to use skills instead of docs. for example implementer and design to use custom made skills for red flags and code style. maybe even hooks
- [x] @ me in PRs when they are ready for review + a label that they are ready for me to review them
- [x] figure a way to run goals in paralel, probably worktrees
- [x] vago to re init without destroying config (vago re-init or vago update)
- [x] TUI - needs grilling + prototyping
- [x] Configurable worktree creation: a Project says what Vago copies, what it runs and which ports each worktree's services get, so Goals that run services don't fight over ports. Like a work-project worktree command that copies, sets up and assigns new ports. _(grill)_
- [x] Refuse to run a Goal that's already running in another terminal, if the worktree Goal didn't ship it.
- [x] Split tickets.ts into a folder; it's past 400 lines.

UX IMPROVEMENTS
- [x] SIMPLE -> elapsed time in TUI should be more like run time (actively running time)
- [x] SIMPLE -> start goal run from TUI
- [x] make UI match more missions -> no space between boxes, constant header across all pages
- [x] attach a bit more metadata to goals, like created at, size, and some stuff like that, we later might want to show it on TUI
- [x] workflow steps to have user specified names, then show those in the UI
- [ ] pick up from failure... properly (resume session instead of starting from scratch) (needs grilling)
- [ ] fix merge step, it fails all the time should be quite bullet proof...
- [ ] The PR body carries the Goal's design choices ("Design it twice": the options, the pick and why) from the design and architecture Steps. Agent Steps can't reach `goal.md` or the PR body today.
  - [ ] pr descrition does not use full width. it has weird enters. it comes from goals
- [ ] TUI Run stream extras, from the prototype's round 6: Bash edits shown as edits with the diff a key away, a live clock on long commands, background tasks as one line, Skill loads, live tokens and cost for an open Run.
- [ ] session ID gets added to goal only when session ends...

NEW FEATURES (grilling needed)
- [ ] Milestones and nested Goals. _(grill)_
  - [ ] Show Milestones in the TUI, once Vago has them.
- [ ] goal on start and on end configuration steps, so workflows don't have to manually do those thigns
  - [ ] Creating Goals and Tickets inside Vago, and decomposing Goals automatically. _(grill)_
- [ ] create github app so commits come from vago (maybe)
- [ ] Notifications (ntfy, Slack, push). something to let you know if something is stuck, or what. or current progress.
- [ ] Harnesses other than Claude Code (a Codex adapter, user-supplied Harness plugins). _(grill)_
- [ ] Interact with agent session if you want to, like steer or correct while it runs without messing up the goal run


TECHINICAL IMRPOVEMENTS
- [ ] A cheaper way to copy big untracked folders (`node_modules`) into a Goal's worktree, if copying everything gets slow.

TO DECIDE IF I WANT IT
- [ ] Vago owns pushing the Goal's branch and opening its PR, instead of the Workflow's `merge.sh`. _(grill)_
  - [ ] Goal-level validation, and Factory Missions' validation approach. _(grill)_

DOCUMENTATION
- [ ] Ship with agent instructions on how to setup, use or know what capabilities does vago  have
- [ ] User docs for writing Workflows and bringing your own skills.


## From the Alpha map's out-of-scope list

- [ ] A view across Projects, and running several Goals of one Project at once. _(grill)_
- [ ] A planner that sequences Tickets, and explicit terminal reasons for a Run. _(grill)_
- [ ] iOS and macOS sandboxes, and a macOS app. _(grill)_
- [ ] A container sandbox for Steps (Docker or Podman, image, mounts, credential passing). _(grill)_
- [ ] Detaching `vago run` (daemon, `--detach`, keeping the machine awake).
- [ ] Retrying provider errors. Needs per-Harness error classification. _(grill)_
- [ ] Gate and merge Step primitives, and a worktree per Goal. _(grill)_
- [ ] Branding.
- [ ] `vago status` and similar small CLI extras.
