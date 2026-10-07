# Vago

Vago builds a Goal in your repo while you're away. You write the Goal and split it into Tickets, and `vago run` takes each Ticket through a Workflow: a list of Steps, some run by a coding agent (Claude Code or Codex) and some by shell commands. Each Ticket ends as one commit on the Goal's branch, and the Goal ends as one pull request for you to review and merge.

The words Vago uses (Goal, Ticket, Workflow, Step, Run, Harness) are defined in [`CONTEXT.md`](CONTEXT.md). How Vago is built is in [`docs/architecture.md`](docs/architecture.md).

## Install

You need:

- [Bun](https://bun.sh), to build `vago`.
- [Claude Code](https://claude.com/claude-code), logged in, with `claude` on your `PATH`. Agent Steps run `claude -p` in its `auto` permission mode.
- [Codex](https://developers.openai.com/codex/cli), only for Steps you run on it: logged in with `codex login`, with `codex` on your `PATH`, at a version whose `codex exec` has `--approve-for-me` (0.160.0 has it). See [Run Steps on Codex](#run-steps-on-codex).
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
- `prompts/`, the prompt of each agent Step, and `planning.md`, the planning agent's instructions (see [Plan a Goal in the TUI](#plan-a-goal-in-the-tui)).
- `scripts/branch.sh` and `scripts/merge.sh`, the git work of the `branch` and `merge` Steps.

It also puts seven skills into `.claude/skills/`, where Claude Code finds them, and the same seven into `.agents/skills/`, where Codex finds them, so the starter prompts work on either Harness:

- `vago-write-code`, `vago-check-red-flags` and `vago-design-module` hold the design and code rules, from John Ousterhout's *A Philosophy of Software Design*. Each starter prompt names the ones its Step runs, and you can use them in your own sessions too.
- `vago-pr` writes a PR body as a summary, evidence and merge danger. The `describe` Step runs it on the Goal's PR.
- `vago-grilling`, `vago-to-goal` and `vago-to-tickets` plan a Goal. The planning agent loads them as its work needs them. In a session of your own, `/vago-grilling` questions you about an idea, `/vago-to-goal` writes the conversation up as a Goal, and `/vago-to-tickets` slices that Goal into Tickets with the `vago` CLI.

Before it writes anything, it asks `Commit the Workflow? [y/N]`. Answer `y` to leave `.vago/` and the skills for git, so everyone who clones the repo gets your Workflows. Any other answer adds `.vago/` and each skill's folder, in both places, to `.git/info/exclude`, so they stay in your checkout. Anything else in `.claude/` and `.agents/` stays as git saw it. Either way it adds `.vago-goals/`, where Goals and Tickets live, to `.git/info/exclude`.

`vago init` refuses, and changes nothing, when the directory has no `.git` or a file it would write already exists in `.vago/`, `.claude/skills/` or `.agents/skills/`.

### Update a Project

After installing a newer `vago`, run `vago update` to bring `.vago/` and both copies of the skills to the starter it ships:

```sh
vago update
```

It overwrites each starter file that differs, writes any that are missing, and prints the path of every file it changed, so you see which tuned prompt it replaced. Files you added, like your own Workflow, prompt or skill, stay as they are, and so does every Goal in `.vago-goals/`. It keeps your commit answer: if `.git/info/exclude` lists `.vago/`, the Workflow stays private and any new skill is excluded too. It asks again only when the exclude lists neither `.vago/` nor `.vago-goals/`. Run it twice and the second run prints nothing.

### Pick a Workflow

Both starter Workflows run each Ticket through these Steps, in order, with Claude Opus as the model, and run two more Steps, `describe` and `ready`, once every Ticket is done (see [Run Steps once per Goal](#run-steps-once-per-goal)):

| Workflow | Steps | Pick it when |
|---|---|---|
| `small` | branch, implement, check, review, merge | The Tickets are small and already clear. One agent builds each Ticket and a fresh one reviews it. |
| `try-hard` | branch, design, product, architecture, design-choices, implement, check, review, merge | A Ticket leaves design questions open. One agent proposes two or three designs, a second checks them against the Ticket, a third picks one and fixes it until it passes the skills, a fourth writes down the choices for the PR description, then implement builds it and review checks it. It takes four more agent Runs per Ticket than `small`. |

The starter files are yours to change, and a few of them assume things about the Project that you may need to change first:

- The `check` Step runs `bun run check`, and the prompts tell every agent Step to make it pass before it finishes. In a Project without that script, change the command in `.vago/workflows/*.toml` and the prompts that name it.
- `merge.sh` pushes the Goal's branch to `origin` and opens its PR with `gh`, against the repo's default branch, with the Goal report as its body. `describe` rewrites the body with the `vago-pr` skill once every Ticket is done, and `ready.sh` labels and comments on that PR.
- The prompts send agents to the docs that the Project's `AGENTS.md` names.

### Run Steps once per Goal

Besides `[[steps]]`, which every Ticket goes through, a Workflow can list Goal Steps, which run for the whole Goal: `[[before_all]]` runs once before the Goal's first Ticket, and `[[after_all]]` once every Ticket is done. They take the same types and options as `[[steps]]`. This is the starter's `after_all`:

```toml
[[after_all]]
id     = "describe"
name   = "PR description"
type   = "agent"
prompt = "prompts/describe.md"

[[after_all]]
id   = "ready"
name = "Ready for review"
type = "shell"
run  = "sh .vago/scripts/ready.sh"
```

`before_all` runs on the first `vago run` that has a Ticket to take, and not again once it has gone through. `after_all` runs again after Tickets added since its last pass are done, such as Tickets one of its own agent Steps adds, so a Step that mustn't repeat checks for itself, as `ready.sh` checks for its comment. A Goal whose Tickets are all done isn't done until `after_all` has gone through.

Goal Steps run in the Goal's worktree on `vago/<goal>`. A shell Goal Step gets `$VAGO_GOAL` and `$VAGO_PROJECT_ROOT`, but no `$VAGO_TICKET` or `$VAGO_LAST_TICKET`. An agent Goal Step's prompt gets `{{goal}}` and `{{goal_name}}`, and the Workflow is refused if it reads `{{ticket}}`. `{{steps.<id>.output}}` reads only earlier Steps of the same list, and Step ids are unique across all three lists. Their Runs go in `goal.md`'s header, their logs are named for their list, like `logs/after_all-ready-1.log`, and `vago goal report` and the TUI show them before and after the Tickets.

Only the Goal's Workflow's Goal Steps run, so `vago ticket add --workflow` refuses any other Workflow that has them.

### Run Steps on Codex

Each agent Step runs on a Harness, the coding agent that performs it. There are two: `claude-code`, which the starter Workflows use, and `codex`. The Workflow's top-level `harness` and `model` apply to every agent Step, and a Step may set its own. To run a whole Workflow on Codex, change the top of its file:

```toml
harness = "codex"
model   = "gpt-6-sol"
```

To mix Harnesses, set them on one Step. This keeps Claude Code building and has Codex review:

```toml
[[steps]]
id      = "review"
name    = "Review"
type    = "agent"
prompt  = "prompts/small-review.md"
harness = "codex"
model   = "gpt-6-sol"
```

A Step that changes `harness` sets `model` too, since the Workflow's model belongs to the other Harness. `args` are appended to the Harness's command, so a Step that changes Harness also needs its own `args` when the Workflow sets any.

Vago runs Codex as `codex exec --json --approve-for-me --model <model>`. Commands run in Codex's `workspace-write` sandbox, and each request to leave it, such as `git commit` writing to the worktree's git folder, goes to Codex's automatic review instead of to you, so a Run never stops to ask. Vago never passes `--dangerously-bypass-approvals-and-sandbox`, as it never passes Claude Code's `--dangerously-skip-permissions`. A command the review declines ends the Step `permission-denied`.

Codex reports no cost, so Vago prices a Codex Run from its tokens and the model's list price, and shows no cost for a model it has no price for. A Codex Run's log is its `codex exec --json` stream, and its resume hint is `codex resume <session id>`.

## Write a Goal and its Tickets

You can plan a Goal and its Tickets with an agent in the TUI (see [Plan a Goal in the TUI](#plan-a-goal-in-the-tui)), or write them yourself with the CLI, as this section does.

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

Vago writes a `+++` header at the top of each file. The Ticket's header holds its status (`ready`, `running`, `done` or `stuck`), when it was created, its blockers and its Runs, and only Vago writes it. You may edit the text below the header at any time. In `goal.md` the header holds `workflow`, which you may change by hand between runs to switch the Goal to another Workflow, and when the Goal was created.

## Run a Goal

```sh
vago run search
```

`vago run` takes the lowest-numbered Ticket that is `ready` or `stuck` and has every blocker `done`, runs it through each Step of the Goal's Workflow, and moves on to the next one, until no such Ticket is left or one goes stuck. A stuck Ticket is picked up at the Step it stopped on (see [Recover a stuck Ticket](#recover-a-stuck-ticket)). With the starter Workflows, each Ticket goes like this:

1. `branch` switches the Goal's worktree to a fresh `search/01-index` branch cut from `vago/search`, the Goal's branch, which Vago cut from the repo's default branch. It fails if the worktree has uncommitted changes, unless the worktree is already on the Ticket's branch, where it leaves the work as it is.
2. The agent Steps build and review the Ticket on that branch and commit there. `check` runs between them; when it fails, the Ticket goes on, and review reads the failure and fixes it.
3. On the Goal's last Ticket, `goal-review` reads the whole Goal's diff for problems no single Ticket shows: names that disagree with the glossary, one decision owned in two places, docs that no longer match the code. It fixes the small ones on the branch. For bigger ones it adds Tickets to the Goal, so this Ticket is no longer the last and `vago run` takes them next. Only the first Goal review may add Tickets; the ones after it fix or report. Its `when = "last-ticket"` skips it on every other Ticket; a Step without `when` runs on every Ticket.
4. `merge` commits any changes the Steps left uncommitted, squash-merges the Ticket's branch into `vago/search` as one commit, deletes the Ticket's branch, pushes `vago/search`, and creates or updates its PR to the repo's default branch. The PR description is the output of `vago goal report search`, rewritten after every Ticket. A push or `gh` call that fails on the network or with a 5xx from GitHub is tried again a few times. When `merge` fails anyway, its log's last line says why, and running the Ticket again finishes the job: a Ticket already squashed into `vago/search` isn't squashed twice.

Once every Ticket is done, the starter Workflows' `after_all` Step `ready` labels the PR `ready-for-review` and comments on it mentioning you, the account `gh` is logged in as, so GitHub notifies you. A Goal that ends with a stuck Ticket gets neither, and a later `after_all` doesn't mention you again.

A shell Step gets the Goal's and Ticket's names in `$VAGO_GOAL` and `$VAGO_TICKET`, and `$VAGO_LAST_TICKET` is `true` when every other Ticket of the Goal is `done`, `false` otherwise. An agent Step's prompt gets the Ticket in `{{ticket}}`, `goal.md` without its header in `{{goal}}`, the Goal's name in `{{goal_name}}`, and an earlier Step's output in `{{steps.<id>.output}}`.

The Steps run in your checkout and switch its branches, so leave it alone until the run ends. When it ends, you review the Goal's PR and merge it yourself.

`vago run` prints each Ticket's name as it starts, and under it a line when each Step starts and when it ends, with the time in UTC, how long it took and, for an agent Step, what it cost, then the Step and how it ended. A Step shows by its `name` in the Workflow, or by its `id` when it has none. At the end it prints a summary table:

```text
01-index
  2026-10-02T21:00:48Z                  New branch started
  2026-10-02T21:00:48Z    0.1s          New branch ok
  2026-10-02T21:00:48Z                  Build started
  2026-10-02T21:14:01Z  13m13s   $2.41  Build ok
...

search: 2 of 2 Tickets done
Ticket      Status  Runs    Took   Cost
01-index    done       5  21m40s  $3.90
02-ranking  done       5  18m02s  $3.12
Total                 10  39m42s  $7.02
```

On a terminal the outcomes and statuses are coloured; set `NO_COLOR` to turn that off. `vago run` exits 0 only when every Ticket of the Goal is done and its `after_all` has gone through.

A Step ends `ok`, `exit <code>` for a shell Step or a Harness exiting non-zero, `idle-timeout` when the Harness printed nothing for the Workflow's `idle_timeout` (10 minutes in the starters), `interrupted` when you pressed Ctrl-C, `permission-denied` when Claude Code refused a tool call or Codex's automatic review declined a command, or `permission-mode <mode>` when a Claude Code session ran in another mode than the one its command asked for.

`vago goal report search` prints the Goal's text, each paragraph on one line, then the output of each Step with `goal_report = true`, such as `try-hard`'s design choices, collapsed under its Ticket, then a Markdown table of each Ticket's Runs, time and cost, with every Run in a collapsed table below. It is the same text the PR description holds.

## Watch every Goal

`vago` with no command, on a terminal, opens a full-screen view of every Goal of the Project: its state (running, lost, stuck, planning, ready or done), a progress bar with its Tickets done of total, its run time (how long its Runs ran, pauses left out) and cost, and what it is doing or waiting for. The selected Goal's latest Runs and description show below the list. It reads `.vago-goals/` again every second, so you can leave it open while Goals run in other terminals. `s` starts the selected Goal when it is ready, in a `vago run` of its own that keeps running after you quit the TUI. The TUI never stops a Goal or changes its Tickets; its other actions plan new Goals.

A Goal shows as lost when one of its Tickets says `running` but no live `vago run` has the Goal; the next `vago run` picks that Ticket up at the Step it was on. Move with `↑↓` or `j k`, jump with `g` and `G`, open a Goal with Enter, start it with `s`, press `?` for the keys and `q` to quit. Set `NO_COLOR` to drop the colours and `VAGO_ASCII=1` for a terminal without the box and symbol glyphs. Run from inside a Goal's worktree, it shows the main checkout's Project. Without a terminal, `vago` prints the usage and exits 1.

## Plan a Goal in the TUI

Press `n` in the Goals list for a New Goal. Type a preliminary name and press Enter; when both `claude` and `codex` are on your `PATH`, Tab picks the Harness the planning agent runs on, Claude Code unless you pick Codex. Vago makes a planning item, a folder in `.vago-goals/` with no `goal.md`, and opens it in the planning view.

The planning view runs the Harness's own interactive session, `claude` or `codex`, in a pane beside the Preview. It is the Harness's own UI, so you type, edit and use its commands as in a terminal. The agent reads the Project, starting from the instructions in `.vago/prompts/planning.md`, which you can edit like any prompt. It asks about the decisions still open first, and writes a Proposal once they are settled; each revision replaces it. The session runs in a sandbox (`sandbox-exec` on macOS, `bwrap` on Linux) that refuses every write under the Project.

The Preview shows the latest Proposal: the Goal, its Tickets in order with their blockers, and the Workflow the agent recommends and why. While the session has the focus it gets every key, `q` and Ctrl-C included; Ctrl-] moves the focus to the Preview, and Ctrl-] or Tab moves it back. Below 100 columns the focused one fills the screen. With the Preview focused:

- `w` picks another Workflow from `.vago/workflows/`.
- `a` asks to accept the Proposal, and `y` confirms. Accepting needs at least one Ticket and a Workflow. It ends the session, writes the Goal and its Tickets, all `ready`, and starts nothing: select the Goal and press `s` when you want it to run.
- `?` shows the planning keys.

Esc goes back to the Goals list, and ends the session; so does quitting the TUI. Vago keeps the session's id, so reopening the item resumes the same conversation. A planning item shows in the Goals list as `planning`, with how its planning stands: `no session yet`, `session open`, `waiting for your reply` or `proposal ready`. Its run time and cost columns stay blank. Press Enter to reopen it, `r` to rename it, and `d` then `y` to discard it with its chat, which also stops its open session.

The session pane's title row shows how long the item's sessions were open and what they cost. They stay out of the Goal's Runs, the TUI's spend and `vago goal report`. After acceptance, `p` in the Goal view opens the planning session again to read; nothing said there changes the Goal.

The `vago plan` commands do the same from a shell: `new`, `rename`, `session`, `workflow`, `accept` and `discard`. `vago plan <command> --help` gives each one's arguments.

## Recover a stuck Ticket

When an agent Step fails, whatever its outcome, `vago run` resumes its Harness session in a new Run after 1 minute, again after 1 more minute and again after 5 more, with a fixed message telling the agent it was interrupted and to continue where it stopped. Each wait prints a `retries in` line under the Step, and the TUI shows the time left. A Ticket goes stuck when those three retries fail too, when a shell Step fails, or when you press Ctrl-C, which also ends the retries. Shell Steps are never retried. `vago run` stops at a stuck Ticket and tells you where to look:

```text
02-ranking is stuck after review: exit 1
  log:    .vago-goals/search/logs/02-review-7.jsonl
  resume: claude --resume 3f2a9c1e-...
  again:  vago run search
  reset:  vago ticket reset search 02
```

To recover:

1. Read the log. Each Run has one under `.vago-goals/<goal>/logs/`, named for the Ticket number, the Step and the Run's position: a `.log` with a shell Step's output, or a `.jsonl` with the Harness's raw stream for an agent Step. `resume` opens the agent's session in its Harness, `claude --resume` or `codex resume`, if you want to ask it what happened.
2. Fix what made it fail, if anything needs fixing. If the Ticket itself was the problem, edit its text below the header.
3. Run `vago run search` again.

`vago run` picks a stuck Ticket up at the Step it stopped on, and doesn't run the Steps before it again. A shell Step runs again from the start; the starter's `branch` and `merge` are safe to run twice. An agent Step resumes the session of its last Run with the same continue message, or runs its prompt in a fresh session when that Run has no session or the resume fails to start, and the Run's log says so. The later Steps still get the earlier Steps' outputs in `{{steps.<id>.output}}`, rebuilt from the Ticket's `[[runs]]` and their logs. When one can't be rebuilt, say because its log was deleted, `vago run` names the Step, leaves the Ticket as it was and stops:

```text
02-ranking can't be picked up: implement has no log left to rebuild its output from
  reset:  vago ticket reset search 02
```

Each resume and retry is a Run of its own in the Ticket's header, marked `resume = "resumed"`, or `"fell-back"` when the resume failed to start and it ran in a fresh session. Its time and cost count like any Run's, and `vago goal report` and the TUI mark it.

To start a Ticket over instead, reset it with `vago ticket reset search 02` and run `vago run search`. Its status goes back to `ready`; its Runs stay in the header. A reset Ticket starts at its first Step: `branch` cuts its branch again from `vago/search`, so commits left on the old `search/02-ranking` branch are dropped, and it fails if the worktree has uncommitted changes, so commit, stash or discard them first. Tickets already merged into `vago/search` keep their work.

A Goal Step that fails leaves the Goal stuck the same way, and `vago run` prints the Goal's name in place of a Ticket's, with no `reset` line:

```text
search is stuck after Ready for review: exit 1
  log:    .vago-goals/search/logs/after_all-ready-2.log
  again:  vago run search
```

The next `vago run search` picks it up at that Step, under the same rules as a Ticket's Steps. A Goal Step has no reset: to run a `before_all` again from its first Step, delete its `[[runs]]` tables from `goal.md`'s header.

A Ticket left `running` by a `vago run` that crashed or was killed has its open Run ended `lost` by the next `vago run`, which then picks it up at that Run's Step like any stuck Ticket. An agent Run's `session_id` reaches its `[[runs]]` entry as soon as its Harness reports it, so a lost Run's session can still be resumed.
