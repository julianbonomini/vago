# Punt v2 backlog

What to build after Alpha, in no fixed order. Take one item at a time: grill it with `/grill-with-docs` if it has open questions, write it up as Punt Tickets, and `punt run` the Goal. Tick an item off when its Goal is merged.

Items marked _(grill)_ have design questions to settle before writing Tickets.

## From using Alpha

- [x] A Workflow for developing Punt itself, in Punt's own `.punt/`. _(grill)_
- [x] Goals and Tickets written from the CLI can't carry a body, a description or other detail yet. Add a way to give them that. _(grill)_
- [ ] Better `punt --help` and per-command help.
- [ ] Punt goals currently get erased when you delete punt to re-run punt init. punt goals should be tracked in a different folder like .punt-goals and .punt for the config. git ignore should exlude .punt-goals always, while punt init asks if you want to include .punt
- [ ] A README for developers who want to use Punt: install, `punt init`, writing a Goal and its Tickets, `punt run`, recovering a stuck Ticket. Architecture and philosophy can wait.
- [ ] Improve the logs from cli (colours, spacing, maybe a table, idk)
- [ ] Goal PR description sucks. title could be improved as well. should contain usefull info as well as cost, time, etc. some metrics...
- [ ] Prompt/skill / way to make grilling and to-tickets clone go directly into punt goals with correct format.

## From the Alpha map's out-of-scope list

- [ ] A TUI or viewer, including watching a Run live. _(grill)_
- [ ] TUI should be able to drill down on what is happening per session if you are curious (grill)
- [ ] Creating Goals and Tickets inside Punt, and decomposing Goals automatically. _(grill)_
- [ ] Missions and nested Goals. _(grill)_
- [ ] A view across Projects, and running several Goals of one Project at once. _(grill)_
- [ ] A planner that sequences Tickets, and explicit terminal reasons for a Run. _(grill)_
- [ ] Goal-level validation, and Factory Missions' validation approach. _(grill)_
- [ ] Notifications (ntfy, Slack, push).
- [ ] iOS and macOS sandboxes, and a macOS app. _(grill)_
- [ ] A library of default Workflows. Alpha ships one starter Workflow.
- [ ] User docs for writing Workflows and bringing your own skills.
- [ ] A container sandbox for Steps (Docker or Podman, image, mounts, credential passing). _(grill)_
- [ ] Detaching `punt run` (daemon, `--detach`, keeping the machine awake).
- [ ] Retrying provider errors. Needs per-Harness error classification. _(grill)_
- [ ] Gate and merge Step primitives, and a worktree per Goal. _(grill)_
- [ ] Branding and the final name.
- [ ] Harnesses other than Claude Code (a Codex adapter, user-supplied Harness plugins). _(grill)_
- [ ] `punt status` and similar small CLI extras.
