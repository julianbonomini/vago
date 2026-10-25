---
title: Install
description: Install vago with Homebrew or a release binary, or build it from source.
order: 1
---

Vago runs on macOS and Linux, on arm64 and x64. Install it with Homebrew, download a binary from the GitHub release, or build it from a clone of the repo.

## What you need

- [Claude Code](https://claude.com/claude-code), logged in, with `claude` on your `PATH`. Agent Steps run `claude -p` in its `auto` permission mode.
- [Codex](https://developers.openai.com/codex/cli), only for Steps you run on it: logged in with `codex login`, with `codex` on your `PATH`, at a version whose `codex exec` has `--approve-for-me`. Version 0.160.0 has it.
- [`gh`](https://cli.github.com), logged in with `gh auth login`. The starter Workflows push the Goal's branch and open its PR with it.

## Homebrew

```sh
brew install julianbonomini/tap/vago
```

Check it's there:

```sh
vago --help
```

`vago --help` lists the commands, and `vago <command> --help` explains one.

## Release binary

Each version is published as a [GitHub release](https://github.com/julianbonomini/vago/releases/latest) with one archive per machine: `vago-darwin-arm64`, `vago-darwin-x64`, `vago-linux-arm64` and `vago-linux-x64`, each with a `.sha256` file beside it. The archive holds the `vago` binary, with the starter Workflows, prompts and scripts embedded in it. For an Apple Silicon Mac:

```sh
curl -LO https://github.com/julianbonomini/vago/releases/latest/download/vago-darwin-arm64.tar.gz
tar -xzf vago-darwin-arm64.tar.gz
mv vago-darwin-arm64/vago ~/.local/bin/
```

Any directory on your `PATH` works in place of `~/.local/bin`.

## Build from source

You need [Bun](https://bun.sh).

```sh
git clone git@github.com:julianbonomini/vago.git
cd vago
bun install
bun run reinstall
```

`bun run reinstall` compiles `vago` to `~/.local/bin/vago`. Put that directory on your `PATH`, for example in `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

## Upgrade

With Homebrew:

```sh
brew upgrade vago
```

With a release binary, download the latest archive and replace the binary. From source, pull the repo and build again:

```sh
git pull
bun install
bun run reinstall
```

The new binary carries a newer starter. In each Project, run `vago update` to bring its `.vago/` folder and skills up to that starter. Files you added yourself, and every Goal, stay as they are.
