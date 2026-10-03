# 14: Commands an agent started outlive its Run

**What's wrong:** when Vago kills an agent Step, the commands the agent started keep running. `killGroup` in `src/step-runner.ts` sends SIGKILL to `claude`'s process group, but Claude Code's Bash tool starts each command in a process group of its own. SIGKILL also gives `claude` no chance to stop those commands itself.

Found in a rehearsal on a throwaway clone of Vago (2026-10-02):

- The Ticket asked the agent to run `until test -f /nonexistent-file; do sleep 3; done` in the foreground, with `idle_timeout = "20s"`.
- Vago marked the Run `idle-timeout` after 27.8s and `claude` was gone, but the loop's `zsh` was still running with `PPID 1`, and its `PGID` was its own pid (1505). It had to be killed by hand.

SIGINT and SIGTERM go through the same `killGroup`, so story 57 ("leaves no orphan agents") most likely breaks the same way. In the rehearsal's Ctrl-C test, the agent's command had already ended before the signal.

**What to build:** stopping an agent Step also stops what the agent started.

One way: send SIGTERM to the group first, so `claude` can stop its own tool processes, then SIGKILL after a short grace period if anything is still alive. Check that Claude Code really stops its tool processes on SIGTERM before relying on it. If it doesn't, find another way to reach them.

Spec: [Vago Alpha](../../vago-alpha/spec.md), user stories 52 and 57.

**Blocked by:** none.

**Status:** done

- [x] After an idle timeout, no process the agent started is alive. The test uses a fake `claude` that starts a child in its own process group and stops it on SIGTERM.
- [x] The same holds after SIGINT and after SIGTERM to `vago run`.
- [x] A Step that ignores SIGTERM still ends, within the grace period.
- [x] The outcomes stay `idle-timeout` and `interrupted`.

## Comments

Checked by hand on Claude Code 2.1.287 (2026-10-02): `claude -p` was spawned in its own process group, and its Bash tool ran `sleep 417`, which ran under a `zsh` in a process group of its own. SIGTERM to `claude`'s group ended `claude` in 760 ms with exit code 143, and the `zsh` and `sleep` were gone. Vago now relies on this.

Shell Steps take the same path, so a shell Step whose processes ignore SIGTERM now gets up to 5s before SIGKILL, where before it was killed at once.
