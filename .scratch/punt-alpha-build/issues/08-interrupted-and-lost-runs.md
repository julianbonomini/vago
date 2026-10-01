# 08: Interrupted and lost Runs

**What to build:**

- **Interrupted:** on SIGINT or SIGTERM, `punt run` kills the running Run's whole process group, marks the Ticket `stuck` with outcome `interrupted`, and exits non-zero.
- **Lost:** a Ticket found `running` at startup (after a crash or `kill -9`) is marked `stuck` with outcome `lost`, and `punt run` stops without running anything.

Spec: [Punt Alpha](../../punt-alpha/spec.md).

**Blocked by:** 07 (A Step fails and the Ticket goes stuck).

**Status:** ready-for-agent

- [ ] SIGINT during an agent Step leaves no process from the fake's process group alive.
- [ ] After SIGINT, the Ticket is `stuck`, its last `[[runs]]` entry has outcome `interrupted` and an end time, and the exit code is non-zero.
- [ ] SIGTERM behaves the same way.
- [ ] A Ticket that's already `running` before `punt run` ends `stuck` with outcome `lost`, and no Step runs.
