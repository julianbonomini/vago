# Tickets are untracked files, and only Alpha writes their status

Vago keeps a Project's Goals and Tickets as Markdown files under `.vago-goals/`, with a TOML header that holds each Ticket's `status`, `blocked_by` and, when it has one, `workflow`. Those files are never tracked by git: `vago init` excludes them through `.git/info/exclude` and doesn't offer to commit them. Only Alpha writes status (`ready`, `running`, `done`, `stuck`). Agents never see the header, because `{{ticket}}` substitutes only the title and body.

`.vago-goals/` sits at the repo root, apart from `.vago/`, which holds only the config: Workflows, prompts, rules and scripts. Deleting `.vago/` to run `vago init` again from a fresh starter leaves every Goal where it was.

A Goal's `goal.md` has a `+++` header too. It holds only `workflow`, the name of the Workflow the Goal's Tickets go through, in `.vago/workflows/<name>.toml`. `vago goal new` writes it, and the human may edit it by hand between runs to switch the Goal to another Workflow. A Ticket whose header has its own `workflow` goes through that one instead; `vago ticket add --workflow` writes it, and the human may edit it the same way. Vago never rewrites it, and agents never see it, because `{{goal}}` is the text after it.

A reader might expect Tickets to be versioned with the code, as warren's Seeds does. But Runs happen in the human's checkout, and the Workflow does git inside Steps. Tracked status writes would be swept into commits, lost on branch switches, and would conflict on merges; Seeds needed a custom merge driver for this. Vago is a tool for one developer, and several developers can use it on the same repo, so it leaves no trace there: no `.gitignore` line, no committed Tickets.

## Considered options

- A hosted tracker (GitHub Issues, Linear): rejected because it annoys shared and open-source repos, or needs a fork.
- Status in a separate untracked state file, so Tickets could be committed: rejected because it adds a second file to keep in sync, for a benefit only committed Tickets need.
- SQLite: deferred. Markdown reads well for LLMs and is simple to strip and substitute. A move to SQLite later would happen behind `vago goal new` and `vago ticket add`.

## Consequences

- Tickets don't travel with the code or between machines, and a team can't share them through git.
- Agents can't mark their own work done. A Ticket is done when its Workflow finishes.
- A Goal whose `goal.md` has no header, or a header that names no Workflow, is refused, and so is a Goal where the Goal or a Ticket that isn't done names a Workflow that doesn't exist.
