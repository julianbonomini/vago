# Vago

Vago builds a Goal in your repo while you're away. You write the Goal and split it into Tickets, and `vago run` takes each Ticket through a Workflow: a list of Steps, some run by a coding agent (Claude Code or Codex) and some by shell commands. Each Ticket ends as one commit on the Goal's branch, and the Goal ends as one pull request for you to review and merge.

The docs are at [vago.buenomini.com](https://vago.buenomini.com).

## Install

```sh
brew install julianbonomini/tap/vago
```

Or download the binary for your machine from the [latest release](https://github.com/julianbonomini/vago/releases/latest).

Vago drives tools you already have, so you also need:


## Docs

- [Set up a Project](https://vago.buenomini.com/docs/set-up-a-project/) with `vago init` and keep it current with `vago update`.
- [Your first Goal](https://vago.buenomini.com/docs/your-first-goal/) writes a Goal, adds its Tickets and runs it.
- [Goals and Tickets](https://vago.buenomini.com/docs/goals-and-tickets/) and [Workflows](https://vago.buenomini.com/docs/workflows/) cover the file formats.
- [Running and watching](https://vago.buenomini.com/docs/running-and-watching/), [Planning a Goal in the TUI](https://vago.buenomini.com/docs/planning-a-goal/) and [When things go wrong](https://vago.buenomini.com/docs/when-things-go-wrong/) cover `vago run`, the TUI and recovering a stuck Ticket.
- The [CLI reference](https://vago.buenomini.com/docs/cli-reference/) and the [glossary](https://vago.buenomini.com/docs/glossary/).
- The [cookbook](https://vago.buenomini.com/cookbook/) has example Workflows: chaining Goals, merging straight to `main`, review on Codex and more.
- The [agents section](https://vago.buenomini.com/agents/) is written for a coding agent working in a repo that uses Vago, with a snippet for your repo's `AGENTS.md` and an [`llms.txt`](https://vago.buenomini.com/llms.txt).

## Working on Vago

The words Vago uses are defined in [`CONTEXT.md`](CONTEXT.md), and how it is built is in [`docs/architecture.md`](docs/architecture.md). The site's source is in [`site/`](site/).

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
