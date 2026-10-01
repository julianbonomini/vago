# What Alpha's runtime is

Type: grilling
Status: open

## Question

Where do a Workflow's Steps actually execute, and what does the kernel own to make that happen? The Destination says Runs happen "on a Harness in a sandbox", while ADR 0002 says they use the human's checkout as-is; settle what the sandbox is. Expect to copy Sandcastle heavily (see [research/how-sandcastle-runs-work.md](../research/how-sandcastle-runs-work.md) §1 and §5: `sleep infinity` container, `docker exec` per Run, bind-mounted checkout, env-file allowlist as `-e` flags, `claude setup-token`, `docker rm -f` on exit).

To decide:

- Container per Goal, per Ticket or per Step; agent and shell Steps sharing it.
- Docker only, or Podman too.
- Who owns the image: a Dockerfile copied by `punt init` into `.punt/`, and how `workflow.toml` names it; Harness CLIs installed in it.
- How the checkout and `.git` are mounted; UID alignment.
- Credentials: how each Harness's auth and `gh` reach the container (env-file allowlist, `claude setup-token`); git identity inside.
- Teardown on exit, signal or crash.
- How `punt run` stays alive while the human is away (foreground process, tmux, a daemon).
