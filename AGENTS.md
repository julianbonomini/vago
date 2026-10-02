## How we work

Punt Alpha is built one build ticket at a time, by hand-run sessions. The spec is `.scratch/punt-alpha/spec.md`; the build tickets are `.scratch/punt-alpha-build/issues/`, taken in blocking order.

These are the coding standards `/implement`, `/tdd` and `/code-review` work against:

- `docs/code-style.md`: read before writing code.
- `docs/architecture.md`: read before writing code. Modules, owners, and the rules between them.
- `docs/aposd.md`: read before writing code or designing a new module or changing an exported interface. The design reference the style rules come from.

### A ticket, start to finish

1. **Branch** off an up-to-date `main`, named after the ticket file: `02-one-ticket-through-shell-steps`. Work sequentially in the main checkout; `/implement-spec` and worktrees aren't used for alpha.
2. **Build** with `/implement <ticket path>`, which runs `/tdd`. Commit on the branch as you go.
3. **Check:** `bun run check` passes before every commit. Docs-only commits before ticket 02 creates the script are exempt.
4. **Review** with `/code-review` and fix every finding, red flags included.
5. **Close the ticket** in the branch's last commit: tick its acceptance boxes and set `Status: done`.
6. **Open the PR.** Push the branch (`git push -u origin <branch>`) and run `gh pr create`.
   - Title: the ticket's number and title, `02 one Ticket through shell Steps`.
   - Body, a few lines: a link to the ticket file, two or three bullets on what changed, what the human should test by hand (or "nothing beyond `bun run check`"), and design-it-twice notes when `docs/code-style.md` asks for them.
7. **Hand over.** Ask the human to review or test, and fix requested changes on the same branch.
8. **Merge** only when the human says "merge" in the session: `gh pr merge --squash --delete-branch`, then switch to `main` and pull.

When the ticket, the spec or an ADR looks wrong, stop and ask the human. If they're away, write the question under `## Comments` on the ticket and set `Status: needs-info`. The ticket's scope is the scope.

### Commits and PRs

- A commit message is one plain phrase: imperative, lowercase, at most about 60 characters, like `parse workflow toml and reject unknown step types`. No prefix, no body, no trailing period, no colons, em dashes or emoji.
- Commits and PRs are written as the human's own: no Co-Authored-By trailers, no "Generated with" footers.
- Push only your ticket's branch. `main` changes only through a squash merge, and history is never rewritten.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

### Writing Docs and code comments

Use /no-ai-writing skill
