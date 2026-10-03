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
- [ ] worfklow still produces red flags when checked as a whole
- [n] fix all red flags
- [ ] pr descrition does not use full width. it has weird enters 

## From the Alpha map's out-of-scope list

- [ ] A TUI or viewer, including watching a Run live. _(grill)_
- [ ] TUI should be able to drill down on what is happening per session if you are curious (grill)
- [ ] Creating Goals and Tickets inside Vago, and decomposing Goals automatically. _(grill)_
- [ ] Missions and nested Goals. _(grill)_
- [ ] A view across Projects, and running several Goals of one Project at once. _(grill)_
- [ ] A planner that sequences Tickets, and explicit terminal reasons for a Run. _(grill)_
- [ ] Goal-level validation, and Factory Missions' validation approach. _(grill)_
- [ ] Notifications (ntfy, Slack, push).
- [ ] iOS and macOS sandboxes, and a macOS app. _(grill)_
- [ ] A library of default Workflows. Alpha ships one starter Workflow.
- [ ] User docs for writing Workflows and bringing your own skills.
- [ ] A container sandbox for Steps (Docker or Podman, image, mounts, credential passing). _(grill)_
- [ ] Detaching `vago run` (daemon, `--detach`, keeping the machine awake).
- [ ] Retrying provider errors. Needs per-Harness error classification. _(grill)_
- [ ] Gate and merge Step primitives, and a worktree per Goal. _(grill)_
- [ ] Branding.
- [ ] Harnesses other than Claude Code (a Codex adapter, user-supplied Harness plugins). _(grill)_
- [ ] `vago status` and similar small CLI extras.
