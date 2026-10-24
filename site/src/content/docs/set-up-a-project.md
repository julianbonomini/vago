---
title: Set up a Project
description: Run vago init in a repo to get the starter Workflows and skills, keep them current with vago update, and pick a Workflow.
order: 2
---

A [Project](/docs/glossary/#project) is the repo Vago works on. Setting one up copies Vago's starter [Workflows](/docs/glossary/#workflow), their prompts and scripts, and a set of skills into it. Every `vago` command reads the directory it runs in as the Project, so run them from the repo's root.

## Run vago init

```sh
cd ~/code/my-app
vago init
```

[`vago init`](/docs/cli-reference/#vago-init) first asks `Commit the Workflow? [y/N]`, then writes:

- `.vago/workflows/small.toml` and `.vago/workflows/try-hard.toml`, the two starter Workflows.
- `.vago/prompts/`, the prompt of each agent [Step](/docs/glossary/#step), and `planning.md`, the instructions of the agent that plans a Goal with you in the TUI.
- `.vago/scripts/`, the shell scripts the starter Steps run: `branch.sh` cuts a Ticket's branch, `merge.sh` squash-merges it and opens the Goal's PR, `ready.sh` labels that PR `ready-for-review` and mentions you on it.
- Seven skills in `.claude/skills/`, where Claude Code finds them, and the same seven in `.agents/skills/`, where Codex finds them, so the starter prompts work on either [Harness](/docs/glossary/#harness).

The skills are the ones the starter prompts name, and you can use them in your own sessions too:

- `vago-write-code`, `vago-check-red-flags` and `vago-design-module` hold the code and design rules, from John Ousterhout's *A Philosophy of Software Design*.
- `vago-pr` writes a PR body as a summary, evidence and merge danger. The starter's `describe` Step runs it on the Goal's PR.
- `vago-grilling`, `vago-to-goal` and `vago-to-tickets` plan a Goal. In a session of your own, `/vago-grilling` questions you about an idea, `/vago-to-goal` writes the conversation up as a Goal, and `/vago-to-tickets` splits that Goal into Tickets with the `vago` CLI.

Answer `y` to the question to leave `.vago/` and the skills for git, so everyone who clones the repo gets your Workflows. Any other answer adds `.vago/` and each skill's folder to `.git/info/exclude`, so they stay in your checkout and never show up in `git status`. Either way it adds `.vago-goals/`, where your Goals and Tickets live, to `.git/info/exclude`: Goals and Tickets are never tracked by git.

`vago init` refuses, and changes nothing, outside the root of a git repo, or when a file it would write already exists in `.vago/`, `.claude/skills/` or `.agents/skills/`.

## Keep it current with vago update

After you [upgrade `vago`](/docs/install/#upgrade), run [`vago update`](/docs/cli-reference/#vago-update) in each Project to bring `.vago/` and both copies of the skills to the starter the new binary ships:

```sh
vago update
```

It overwrites each starter file that differs, writes the ones that are missing, and prints the path of every file it changed, so you can see when it replaced a prompt you had tuned. Files you added, such as your own Workflow, prompt or skill, stay as they are, and so does every Goal in `.vago-goals/`. It keeps the answer you gave `vago init`: when `.git/info/exclude` lists `.vago/`, a skill new in this starter is excluded too. Run it twice and the second run prints nothing.

## Pick a Workflow

Each Goal names the Workflow its Tickets go through, so you pick one when you create the Goal. Both starters run every Ticket through these Steps in order, on Claude Code with Claude Opus:

| Workflow | Steps | Pick it when |
|---|---|---|
| `small` | New branch, Build, Checks, Review, Goal review, Squash merge | The Tickets are small and already clear. One agent builds each Ticket and a fresh one reviews it. |
| `try-hard` | New branch, Design, Product, Architecture, Design choices, Build, Checks, Review, Goal review, Squash merge | A Ticket leaves design questions open. Agents propose designs, check them against the Ticket, pick one, and write down the choices before one builds it. It takes four more agent Runs per Ticket than `small`. |

Goal review runs only on the Goal's last Ticket, and reads the whole Goal's diff. Once every Ticket is done, both starters write the PR's description and mark it ready for review.

The starter files are yours to change. Read them before your first Goal, since they assume a few things about the Project:

- The Checks Step runs `bun run check`, and the prompts tell every agent to make it pass. In a Project with another check command, change it in `.vago/workflows/*.toml` and in the prompts that name it.
- `merge.sh` pushes the Goal's branch to `origin` and opens its PR with `gh`, against the repo's default branch.
- The prompts send agents to the docs that the Project's `AGENTS.md` names.

Each Workflow is one TOML file in `.vago/workflows/`, and the file's name, without `.toml`, is the name you pass to `--workflow`. Copy one to make your own.

Next: [Your first Goal](/docs/your-first-goal/).
