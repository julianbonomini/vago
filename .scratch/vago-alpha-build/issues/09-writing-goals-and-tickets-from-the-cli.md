# 09: Writing Goals and Tickets from the CLI

**What to build:** `vago goal new <goal>` creates the Goal's folder with `goal.md` and an empty `tickets/`. `vago ticket add <goal> <slug>` creates the next numbered Ticket file with a TOML header (`status = "ready"`, plus any blockers the human names) and a title for the human to fill in. Neither command can set any other status.

Spec: [Vago Alpha](../../vago-alpha/spec.md).

**Blocked by:** 04 (Goals of several Tickets).

**Status:** done

- [x] `vago goal new` creates a Goal that `vago run` accepts.
- [x] `vago ticket add` numbers Tickets 01, 02, … in order and writes a valid `ready` header.
- [x] Blockers given to `ticket add` land in `blocked_by`. An unknown blocker is refused.
- [x] Creating a Goal that already exists is refused.
