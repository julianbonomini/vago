# Tickets are untracked files, and only Alpha writes their status

Punt keeps a Project's Goals and Tickets as Markdown files under `.punt/goals/`, with a TOML header that holds each Ticket's `status` and `blocked_by`. Those files are never tracked by git: `punt init` excludes them through `.git/info/exclude` and doesn't offer to commit them. Only Alpha writes status (`ready`, `running`, `done`, `stuck`). Agents never see the header, because `{{ticket}}` substitutes only the title and body.

A reader might expect Tickets to be versioned with the code, as warren's Seeds does. But Runs happen in the human's checkout, and the Workflow does git inside Steps. Tracked status writes would be swept into commits, lost on branch switches, and would conflict on merges; Seeds needed a custom merge driver for this. Punt is a tool for one developer, and several developers can use it on the same repo, so it leaves no trace there: no `.gitignore` line, no committed Tickets.

## Considered options

- A hosted tracker (GitHub Issues, Linear): rejected because it annoys shared and open-source repos, or needs a fork.
- Status in a separate untracked state file, so Tickets could be committed: rejected because it adds a second file to keep in sync, for a benefit only committed Tickets need.
- SQLite: deferred. Markdown reads well for LLMs and is simple to strip and substitute. A move to SQLite later would happen behind `punt goal new` and `punt ticket add`.

## Consequences

- Tickets don't travel with the code or between machines, and a team can't share them through git.
- Agents can't mark their own work done. A Ticket is done when its Workflow finishes.
