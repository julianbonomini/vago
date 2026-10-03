## Rules and knowledge

- The `vago-write-code`, `vago-check-red-flags` and `vago-design-module` skills in `.claude/skills/`: the code style, the red flags and module design, from *A Philosophy of Software Design*.
- `docs/architecture.md`: modules, owners, and the rules between them. Read before writing code.
- `CONTEXT.md`: the domain language. `docs/adr/`: the decisions behind it; read the ones your change touches.

`bun run check` passes before every commit.

## The installed `vago`

`bun run reinstall` compiles `src/cli.ts`, with the starter embedded, to `~/.local/bin/vago`, so that directory must be on `PATH`. The human runs it between Goals. Sessions and Workflow Steps leave it to the human, so a bad merge can't replace the `vago` that is driving a Goal.

## Commits and PRs

- A commit message is one plain phrase: imperative, lowercase, at most about 60 characters, like `parse workflow toml and reject unknown step types`. No prefix, no body, no trailing period, no colons, em dashes or emoji.
- Commits and PRs are written as the human's own: no Co-Authored-By trailers, no "Generated with" footers.
- Push only your own branch. `main` changes only through a squash merge, and history is never rewritten.

## Writing docs and code comments

Use the /no-ai-writing skill.
