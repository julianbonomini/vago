# Vago

Vago builds a Goal in your repo while you're away. You write the Goal and split it into Tickets, and `vago run` takes each Ticket through a Workflow: a list of Steps, some run by a coding agent (Claude Code) and some by shell commands. Each Ticket ends as one commit on the Goal's branch, and the Goal ends as one pull request for you to review and merge.

The words Vago uses (Goal, Ticket, Workflow, Step, Run, Harness) are defined in [`CONTEXT.md`](CONTEXT.md). How Vago is built is in [`docs/architecture.md`](docs/architecture.md).

## Install

You need:

- [Bun](https://bun.sh), to build `vago`.
- [Claude Code](https://claude.com/claude-code), logged in, with `claude` on your `PATH`. Agent Steps run `claude -p` in its `auto` permission mode.
- [`gh`](https://cli.github.com), logged in with `gh auth login`. The starter Workflows push the Goal's branch and open its PR with it.

Build the binary from a clone of this repo:

```sh
git clone git@github.com:julianbonomini/vago.git
cd vago
bun install
bun run reinstall
```

`bun run reinstall` compiles `src/cli.ts` to `~/.local/bin/vago`, with the starter Workflows embedded in it. Put that directory on your `PATH`, for example in `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

`vago --help` lists the commands, and `vago <command> --help` explains one.

## Set up a Project

Run `vago init` at the root of the repo you want Vago to work on, your Project. Every `vago` command reads the directory it runs in as the Project, so run them all from the root.

```sh
cd ~/code/my-app
vago init
```

`vago init` copies the starter into `.vago/`:

- `workflows/small.toml` and `workflows/try-hard.toml`, the two starter Workflows.
- `prompts/`, the prompt of each agent Step.
- `scripts/branch.sh` and `scripts/merge.sh`, the git work of the `branch` and `merge` Steps.

It also puts five skills into `.claude/skills/`, where Claude Code finds them:

- `vago-write-code`, `vago-check-red-flags` and `vago-design-module` hold the design and code rules, from John Ousterhout's *A Philosophy of Software Design*. Each starter prompt names the ones its Step runs, and you can use them in your own sessions too.
- `vago-to-goal` and `vago-to-tickets` are for you, after a planning conversation: `/vago-to-goal` writes the conversation up as a Goal, and `/vago-to-tickets` slices that Goal into Tickets. They run only when you type their name.

Before it writes anything, it asks `Commit the Workflow? [y/N]`. Answer `y` to leave `.vago/` and the skills for git, so everyone who clones the repo gets your Workflows. Any other answer adds `.vago/` and each skill's folder to `.git/info/exclude`, so they stay in your checkout. Anything else in `.claude/` stays as git saw it. Either way it adds `.vago-goals/`, where Goals and Tickets live, to `.git/info/exclude`.

`vago init` refuses, and changes nothing, when the directory has no `.git` or a file it would write already exists in `.vago/` or `.claude/skills/`.

### Update a Project

After installing a newer `vago`, run `vago update` to bring `.vago/` and the skills to the starter it ships:

```sh
vago update
```

It overwrites each starter file that differs, writes any that are missing, and prints the path of every file it changed, so you see which tuned prompt it replaced. Files you added, like your own Workflow or prompt, stay as they are, and so does every Goal in `.vago-goals/`. It keeps your commit answer: if `.git/info/exclude` lists `.vago/`, the Workflow stays private and any new skill is excluded too. It asks again only when the exclude lists neither `.vago/` nor `.vago-goals/`. Run it twice and the second run prints nothing.

### Pick a Workflow

Both starter Workflows run each Ticket through these Steps, in order, with Claude Opus as the model:

| Workflow | Steps | Pick it when |
|---|---|---|
| `small` | branch, implement, check, review, merge | The Tickets are small and already clear. One agent builds each Ticket and a fresh one reviews it. |
| `try-hard` | branch, design, product, architecture, implement, check, review, merge | A Ticket leaves design questions open. One agent proposes two or three designs, a second checks them against the Ticket, a third picks one and fixes it until it passes the skills, then implement builds it and review checks it. It takes three more agent Runs per Ticket than `small`. |

The starter files are yours to change, and a few of them assume things about the Project that you may need to change first:

- The `check` and `merge` Steps run `bun run check`, and the prompts tell agents to make it pass. In a Project without that script, change the command in `.vago/workflows/*.toml` and the prompts that name it.
- `branch.sh` cuts the Goal's branch from `main`, and `merge.sh` pushes to `origin` and opens the PR against `main`.
- The prompts send agents to the docs that the Project's `AGENTS.md` names.

## Write a Goal and its Tickets

A Goal is an outcome you want, written in Markdown. Its Tickets are the units of work that get it done. Every agent Step sees the Goal's text and its Ticket's text in its prompt, so write them as you'd brief a developer: what to build, what done means, what's out of scope.

Say you want search in your app, built in two parts where the second needs the first. Write the Goal to a file:

```markdown
# Search

Users can search their notes by title and body from the top bar.

Done when typing in the search box lists matching notes, best match first.
```

Then create the Goal, naming the Workflow its Tickets go through:

```sh
vago goal new search --workflow small --body-file goal.md
```

This creates `.vago-goals/search/goal.md` and prints its path. `--workflow` names a file in `.vago/workflows/`, and `vago goal new` refuses one that isn't there and lists the ones that are. Without `--body-file`, the body is a `# search` title for you to fill in. `--body-file -` reads the body from stdin.

Add the Tickets in the order they should run:

```sh
vago ticket add search index --body-file index.md
vago ticket add search ranking --blocked-by 1 --body-file ranking.md
```

Each Ticket gets the next number, so these are `.vago-goals/search/tickets/01-index.md` and `02-ranking.md`. `--blocked-by 1` means `02-ranking` waits until `01-index` is done; repeat the flag for each blocker. Goal names and Ticket slugs may hold only letters, digits, `-` and `_`.

Vago writes a `+++` header at the top of each file. The Ticket's header holds its status (`ready`, `running`, `done` or `stuck`), its blockers and its Runs, and only Vago writes it. You may edit the text below the header at any time. In `goal.md` the header holds only `workflow`, which you may change by hand between runs to switch the Goal to another Workflow.

## Run a Goal

```sh
vago run search
```

`vago run` takes the lowest-numbered Ticket that is `ready` and has every blocker `done`, runs it through each Step of the Goal's Workflow, and moves on to the next one, until no Ticket is ready or one goes stuck. With the starter Workflows, each Ticket goes like this:

1. `branch` cuts `goal/search` from `main` if it doesn't exist yet, then switches to a fresh `search/01-index` branch cut from it. It fails if the checkout has uncommitted changes.
2. The agent Steps build and review the Ticket on that branch and commit there. `check` runs between them; when it fails, the Ticket goes on, and review reads the failure and fixes it.
3. `merge` runs `bun run check`, squash-merges the Ticket's branch into `goal/search` as one commit, deletes the Ticket's branch, pushes `goal/search`, and creates or updates its PR to `main`. The PR description is the output of `vago goal report search`, rewritten after every Ticket. After the Goal's last Ticket, `merge` also labels the PR `ready-for-review` and comments on it mentioning you, the account `gh` is logged in as, so GitHub notifies you. A Goal that ends with a stuck Ticket gets neither.

A shell Step gets the Goal's and Ticket's names in `$VAGO_GOAL` and `$VAGO_TICKET`, and `$VAGO_LAST_TICKET` is `true` when every other Ticket of the Goal is `done`, `false` otherwise.

The Steps run in your checkout and switch its branches, so leave it alone until the run ends. When it ends, you review the Goal's PR and merge it yourself.

`vago run` prints a line when each Step starts and when it ends, with the time in UTC, the Ticket, the Step, how it ended, how long it took and, for an agent Step, what it cost. At the end it prints a summary table:

```text
2026-10-02T21:00:48Z  01-index    branch     started
2026-10-02T21:00:48Z  01-index    branch     ok              0.1s
2026-10-02T21:00:48Z  01-index    implement  started
2026-10-02T21:14:01Z  01-index    implement  ok            13m13s  $2.41
...

search: 2 of 2 Tickets done
Ticket      Status  Runs    Took   Cost
01-index    done       5  21m40s  $3.90
02-ranking  done       5  18m02s  $3.12
Total                 10  39m42s  $7.02
```

On a terminal the outcomes and statuses are coloured; set `NO_COLOR` to turn that off. `vago run` exits 0 only when every Ticket of the Goal is done.

A Step ends `ok`, `exit <code>` for a shell Step or Claude Code exiting non-zero, `idle-timeout` when Claude printed nothing for the Workflow's `idle_timeout` (10 minutes in the starters), `interrupted` when you pressed Ctrl-C, `permission-denied` when Claude Code refused a tool call, or `permission-mode <mode>` when the session ran in another mode than the one its command asked for.

`vago goal report search` prints the Goal's text followed by a Markdown table of each Ticket's Runs, time and cost, with every Run in a collapsed table below. It is the same text the PR description holds.

## Recover a stuck Ticket

A Ticket goes stuck when one of its Steps fails. `vago run` stops there and tells you where to look:

```text
02-ranking is stuck after review: exit 1
  log:    .vago-goals/search/logs/02-review-4.jsonl
  resume: claude --resume 3f2a9c1e-...
  reset:  vago ticket reset search 02
```

To recover:

1. Read the log. Each Run has one under `.vago-goals/<goal>/logs/`, named for the Ticket number, the Step and the Run's position: a `.log` with a shell Step's output, or a `.jsonl` with Claude Code's raw stream for an agent Step. `resume` opens the agent's session in Claude Code, if you want to ask it what happened.
2. Fix the checkout. The Step stopped wherever it was, so the checkout may be on the Ticket's branch with uncommitted changes, or partway through the merge. `branch` refuses to start on a dirty checkout, so commit, stash or discard what's there. If the Ticket itself was the problem, edit its text below the header.
3. Reset the Ticket with `vago ticket reset search 02`. Its status goes back to `ready`; its Runs stay in the header.
4. Run `vago run search` again.

A reset Ticket starts over: `branch` cuts its branch again from `goal/search`, so commits left on the old `search/02-ranking` branch are dropped. Tickets already merged into `goal/search` keep their work.

While any Ticket of the Goal is stuck, `vago run` runs nothing and lists the reset command for each stuck one. A Ticket left `running` by a `vago run` that crashed or was killed goes stuck on the next run, with its open Run ended `lost`, because the checkout may hold that Run's partial work.
