# Vago

Vago builds a Goal in your repo while you're away. You write the Goal and split it into Tickets, and `vago run` takes each Ticket through a Workflow: a list of Steps, some run by a coding agent (Claude Code or Codex) and some by shell commands. Each Ticket ends as one commit on the Goal's branch, and the Goal ends as one pull request for you to review and merge.

The words Vago uses (Goal, Ticket, Workflow, Step, Run, Harness) are defined in [`CONTEXT.md`](CONTEXT.md).

## Install

```sh
brew install julianbonomini/tap/vago
```

Or download the binary for your machine from the [latest release](https://github.com/julianbonomini/vago/releases/latest).

Vago drives tools you already have, so you also need:

- [Claude Code](https://claude.com/claude-code), logged in, with `claude` on your `PATH`.
- [`gh`](https://cli.github.com), logged in with `gh auth login`. The starter Workflows push the Goal's branch and open its PR with it.
- [Codex](https://developers.openai.com/codex/cli), only if you run Steps on it.

## Start

At the root of the repo you want Vago to work on:

```sh
vago init
```

This copies the starter Workflows, prompts and scripts into `.vago/`, and the skills they use into `.claude/skills/` and `.agents/skills/`. After installing a newer `vago`, `vago update` brings them up to date.

Then run `vago` to open the TUI. Press `n` to plan a new Goal with an agent, accept its Proposal, and press `s` to start it. From a shell, the same looks like this:

```sh
vago goal new search --workflow small --body-file goal.md
vago ticket add search index --body-file index.md
vago ticket add search ranking --blocked-by 1 --body-file ranking.md
vago run search
```

`vago --help` lists the commands, and `vago <command> --help` explains one.

## Build from source

You need [Bun](https://bun.sh).

```sh
git clone git@github.com:julianbonomini/vago.git
cd vago
bun install
bun run reinstall
```

`bun run reinstall` compiles `vago` to `~/.local/bin/vago`, so put that directory on your `PATH`. How Vago is built is in [`docs/architecture.md`](docs/architecture.md).

## Release

Bump `version` in `package.json` and merge to `main`. The release workflow checks the code, builds the binary for macOS and Linux on arm64 and x64, publishes a GitHub release tagged with the version, and updates the formula in [julianbonomini/homebrew-tap](https://github.com/julianbonomini/homebrew-tap).
