---
title: Your first Goal
description: Write a Goal, add two Tickets, run it with vago run, and review the pull request it opens.
order: 3
---

This page takes one [Goal](/docs/glossary/#goal) from a Markdown file to a pull request, in a Project already [set up](/docs/set-up-a-project/) with the starter Workflows. You write the Goal and its [Tickets](/docs/glossary/#ticket) here with the CLI. An agent can also plan them with you in the TUI, and accepting its [Proposal](/docs/glossary/#proposal) writes the same files.

The example adds search to a notes app, in two Tickets: an index, then ranking, which needs the index.

## Write the Goal

A Goal is an outcome you want. Every agent Step sees its text, so write it as you would brief a developer: what to build, what done means, what's out of scope. Save it to a file:

```markdown
# Search

Users can search their notes by title and body from the top bar.

Done when typing in the search box lists matching notes, best match first.
```

Create the Goal from it with [`vago goal new`](/docs/cli-reference/#vago-goal-new), naming the Workflow its Tickets go through:

```sh
vago goal new search --workflow small --body-file goal.md
```

It writes `.vago-goals/search/goal.md` and prints its path. `--workflow small` names `.vago/workflows/small.toml`; a name with no file there is refused, with the names that are.

## Add the Tickets

A Ticket is one unit of work in the Goal, and each one ends as one commit on the Goal's branch. Write each in its own file, a `# ` title and a body like the Goal's, then add them in the order they should run with [`vago ticket add`](/docs/cli-reference/#vago-ticket-add):

```sh
vago ticket add search index --body-file index.md
vago ticket add search ranking --blocked-by 1 --body-file ranking.md
```

Each Ticket gets the next number: these are `.vago-goals/search/tickets/01-index.md` and `02-ranking.md`. `--blocked-by 1` makes `02-ranking` wait until `01-index` is done. Both start `ready`. [Goals and Tickets](/docs/goals-and-tickets/) has the file formats and the rules for blockers.

## Run it

```sh
vago run search
```

[`vago run`](/docs/cli-reference/#vago-run) takes the Goal's Tickets one at a time, lowest number first, each through every Step of the Workflow, until every Ticket is done or one goes stuck. The Steps run in the Goal's own [worktree](/docs/glossary/#worktree), a checkout outside your repo on the branch `vago/search`, which Vago cuts from your repo's default branch as you last pulled it. Your own checkout stays as it is, and you can keep working in it.

With `small`, each Ticket goes through these Steps:

1. New branch cuts `search/01-index` from `vago/search`.
2. Build: an agent builds the Ticket and commits.
3. Checks runs `bun run check`. When it fails, the Ticket goes on, and Review reads the failure.
4. Review: a fresh agent reviews the work and fixes what it finds.
5. Goal review runs on the last Ticket only, reading the whole Goal's diff, and may add Tickets for problems too big to fix there.
6. Squash merge squashes the Ticket's branch into `vago/search` as one commit, pushes `vago/search`, and opens or updates its PR.

`vago run` prints the worktree's path, then a line when each Step starts and when it ends, with how long it took and what an agent Step cost, and a summary when it stops. Once the Goal is done and its branch pushed, it removes the worktree:

```text
Worktree /Users/you/.vago/worktrees/my-app-1a2b3c4d/search
01-index
  2026-10-02T21:00:48Z                  New branch started
  2026-10-02T21:00:48Z    0.1s          New branch ok
  2026-10-02T21:00:48Z                  Build started
  2026-10-02T21:14:01Z  13m13s   $2.41  Build ok
...

search: 2 of 2 Tickets done
Ticket      Status  Runs    Took   Cost
01-index    done       5  21m40s  $3.90
02-ranking  done       6  18m02s  $3.12
Total                 11  39m42s  $7.02
Removed worktree /Users/you/.vago/worktrees/my-app-1a2b3c4d/search; branch vago/search is kept
```

Each time an agent Step runs is a [Run](/docs/glossary/#run): one Harness session, logged in full under `.vago-goals/search/logs/`. To watch every Goal while it runs, open the TUI with `vago`, in another terminal.

When an agent Step fails, `vago run` resumes its session and tries again, up to three times. When those fail too, or a shell Step fails, the Ticket goes stuck and `vago run` stops, printing the log to read and the command that picks it up again.

## Review and merge

Once both Tickets are done, the starter's [`after_all`](/docs/glossary/#after_all) Steps write the PR's description with the `vago-pr` skill, label the PR `ready-for-review`, and mention you on it, so GitHub notifies you. The PR holds one commit per Ticket. Review it as you would a colleague's, and merge it yourself: the starter Workflows never merge into your default branch.

To see what the Goal took, print its report with [`vago goal report`](/docs/cli-reference/#vago-goal-report):

```sh
vago goal report search
```
