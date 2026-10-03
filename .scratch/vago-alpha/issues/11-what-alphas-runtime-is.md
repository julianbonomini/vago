# What Alpha's runtime is

Type: grilling
Status: resolved

## Question

Where do a Workflow's Steps actually execute, and what does the kernel own to make that happen? The Destination says Runs happen "on a Harness in a sandbox", while ADR 0002 says they use the human's checkout as-is; settle what the sandbox is. Expect to copy Sandcastle heavily (see [research/how-sandcastle-runs-work.md](../research/how-sandcastle-runs-work.md) §1 and §5: `sleep infinity` container, `docker exec` per Run, bind-mounted checkout, env-file allowlist as `-e` flags, `claude setup-token`, `docker rm -f` on exit).

To decide:

- Container per Goal, per Ticket or per Step; agent and shell Steps sharing it.
- Docker only, or Podman too.
- Who owns the image: a Dockerfile copied by `vago init` into `.vago/`, and how `workflow.toml` names it; Harness CLIs installed in it.
- How the checkout and `.git` are mounted; UID alignment.
- Credentials: how each Harness's auth and `gh` reach the container (env-file allowlist, `claude setup-token`); git identity inside.
- Teardown on exit, signal or crash.
- How `vago run` stays alive while the human is away (foreground process, tmux, a daemon).

## Answer

**Alpha has no sandbox of its own. Steps run on the human's machine in their checkout, and agent Steps run in their Harness's own guarded mode.** No ADR, because adding a container later is cheap.

- **Agent Steps.** Each is a child process on the host. By default the kernel launches each Harness in its own guarded unattended mode: Claude Code with `--permission-mode auto`, and Codex with `--sandbox workspace-write`, automatic approval review and network on, so agent `git push` and `gh` work. Alpha never adds `--dangerously-skip-permissions` or Codex's bypass flag by default.
- **`args`.** An optional `args = [...]` in `workflow.toml`, set for the whole Workflow and overridable per Step, is appended to the Harness command. A Project can tighten or loosen the defaults without a kernel change. It is frozen with the rest of the Workflow.
- **Shell Steps.** They run on the host as-is. The human writes them, so they carry no more risk than running them by hand.
- **Credentials.** Alpha uses the host's own Harness logins, `gh` auth and git identity, and never touches them. There's no env file, `setup-token`, image, mounts or UID handling.
- **Teardown.** On SIGINT, SIGTERM or exit, Alpha kills the running Run's process group. What that means for the Ticket belongs to [How a Run fails and what Alpha does next](12-how-a-run-fails-and-what-alpha-does-next.md).
- **Staying alive.** `vago run` is a foreground process only, with no `--detach`, daemon or `caffeinate`. The human wraps it in tmux and keeps the machine awake themselves.
- **Why no container.** The human writes the Tickets, a Harness guard stays on, and the checkout is exposed anyway (ADR 0002). The remaining risk is prompt injection reaching the host's credentials, and that was accepted for Alpha. Every Step runs through one place in the code, so a container can be added later by wrapping that single point, possibly as a Goal Alpha does itself.
- **Map changes.** The Destination now reads "in its own guarded mode on the human's machine" instead of "in a sandbox". A container sandbox and detaching `vago run` move to Out of scope. `vago init` copies no Dockerfile.
