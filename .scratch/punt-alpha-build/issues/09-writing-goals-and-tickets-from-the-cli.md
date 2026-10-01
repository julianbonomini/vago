# 09: Writing Goals and Tickets from the CLI

**What to build:** `punt goal new <goal>` creates the Goal's folder with `goal.md` and an empty `tickets/`. `punt ticket add <goal> <slug>` creates the next numbered Ticket file with a TOML header (`status = "ready"`, plus any blockers the human names) and a title for the human to fill in. Neither command can set any other status.

Spec: [Punt Alpha](../../punt-alpha/spec.md).

**Blocked by:** 04 (Goals of several Tickets).

**Status:** ready-for-agent

- [ ] `punt goal new` creates a Goal that `punt run` accepts.
- [ ] `punt ticket add` numbers Tickets 01, 02, … in order and writes a valid `ready` header.
- [ ] Blockers given to `ticket add` land in `blocked_by`. An unknown blocker is refused.
- [ ] Creating a Goal that already exists is refused.
