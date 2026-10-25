---
title: Install
description: Build the vago binary from a clone of its repo and put it on your PATH.
order: 1
---

Vago has no release binaries yet. You build `vago` from a clone of the repo with Bun, and it runs from `~/.local/bin`.

## What you need

- [Bun](https://bun.sh), to build `vago`.
- [Claude Code](https://claude.com/claude-code), logged in, with `claude` on your `PATH`. Agent Steps run `claude -p` in its `auto` permission mode.
- [Codex](https://developers.openai.com/codex/cli), only for Steps you run on it: logged in with `codex login`, with `codex` on your `PATH`, at a version whose `codex exec` has `--approve-for-me`. Version 0.160.0 has it.
- [`gh`](https://cli.github.com), logged in with `gh auth login`. The starter Workflows push the Goal's branch and open its PR with it.

## Build the binary

```sh
git clone git@github.com:julianbonomini/vago.git
cd vago
bun install
bun run reinstall
```

`bun run reinstall` compiles `vago` to `~/.local/bin/vago`, with the starter Workflows, prompts and scripts embedded in it. Put that directory on your `PATH`, for example in `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Open a new shell and check it's there:

```sh
vago --help
```

`vago --help` lists the commands, and `vago <command> --help` explains one.

## Upgrade

Pull the repo and build again:

```sh
git pull
bun install
bun run reinstall
```

The new binary carries a newer starter. In each Project, run `vago update` to bring its `.vago/` folder and skills up to that starter. Files you added yourself, and every Goal, stay as they are.
