# 07: A Step fails and the Ticket goes stuck

**What to build:**

- **What fails a Step:** an agent Step fails on a non-zero exit, or when the Harness has streamed nothing for `idle_timeout` (default 30 min, overridable for the Workflow and per Step). A shell Step fails on a non-zero exit and has no timeout. `on_fail = "continue"` lets the Ticket go on; the default is `"stop"`.
- **When a Ticket goes `stuck`:** the Goal stops, `punt run` exits non-zero, and it prints the log path, the resume command (`claude --resume <id>`) and the `punt ticket reset` command.
- **Reset:** `punt run` refuses to start while any Ticket in the Goal is `stuck`, and names them. `punt ticket reset <goal> <NN>` sets a stuck Ticket back to `ready` and keeps its `[[runs]]`. Its next Runs get new log files.
- **No retries.**

Spec: [Punt Alpha](../../punt-alpha/spec.md).

**Blocked by:** 03 (Agent Steps on Claude Code), 04 (Goals of several Tickets).

**Status:** ready-for-agent

- [ ] A fake `claude` exiting non-zero leaves the Ticket `stuck` with outcome `exit <n>`, and later Tickets stay `ready`.
- [ ] A fake that goes silent past a tiny `idle_timeout` is killed, with outcome `idle-timeout`.
- [ ] A failing shell Step with `on_fail = "continue"` records `exit <n>`, the Ticket goes on, and a later prompt's `{{steps.<id>.output}}` shows the failure (left over from 06). With the default, the Ticket goes `stuck`.
- [ ] The stuck message shows the log path, the resume command and the reset command.
- [ ] `punt run` with a stuck Ticket refuses, naming it, and runs nothing.
- [ ] After `punt ticket reset`, the Ticket is `ready`, its earlier `[[runs]]` and logs are kept, and its new Runs get new log files.
