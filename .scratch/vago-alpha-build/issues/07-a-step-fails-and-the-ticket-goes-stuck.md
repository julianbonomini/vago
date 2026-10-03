# 07: A Step fails and the Ticket goes stuck

**What to build:**

- **What fails a Step:** an agent Step fails on a non-zero exit, or when the Harness has streamed nothing for `idle_timeout` (default 30 min, overridable for the Workflow and per Step). A shell Step fails on a non-zero exit and has no timeout. `on_fail = "continue"` lets the Ticket go on; the default is `"stop"`.
- **When a Ticket goes `stuck`:** the Goal stops, `vago run` exits non-zero, and it prints the log path, the resume command (`claude --resume <id>`) and the `vago ticket reset` command.
- **Reset:** `vago run` refuses to start while any Ticket in the Goal is `stuck`, and names them. `vago ticket reset <goal> <NN>` sets a stuck Ticket back to `ready` and keeps its `[[runs]]`. Its next Runs get new log files.
- **No retries.**

Spec: [Vago Alpha](../../vago-alpha/spec.md).

**Blocked by:** 03 (Agent Steps on Claude Code), 04 (Goals of several Tickets).

**Status:** done

- [x] A fake `claude` exiting non-zero leaves the Ticket `stuck` with outcome `exit <n>`, and later Tickets stay `ready`.
- [x] A fake that goes silent past a tiny `idle_timeout` is killed, with outcome `idle-timeout`.
- [x] A failing shell Step with `on_fail = "continue"` records `exit <n>`, the Ticket goes on, and a later prompt's `{{steps.<id>.output}}` shows the failure (left over from 06). With the default, the Ticket goes `stuck`.
- [x] The stuck message shows the log path, the resume command and the reset command.
- [x] `vago run` with a stuck Ticket refuses, naming it, and runs nothing.
- [x] After `vago ticket reset`, the Ticket is `ready`, its earlier `[[runs]]` and logs are kept, and its new Runs get new log files.
