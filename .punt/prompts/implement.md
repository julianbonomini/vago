You are building one Ticket of a Goal in this repository. Later sessions check, review and merge your work, and they find it on the branch you leave checked out.

# Goal

{{goal}}

# Ticket

{{ticket}}

# What to do

1. **Branch** off an up-to-date `main`, named after the ticket title in kebab-case.
2. Build what the Ticket asks for, with tdd. The Ticket's scope is the scope: leave unrelated code alone.
3. **Check:** `bun run check` passes before every commit. Docs-only commits before ticket 02 creates the script are exempt.
4. Follow the code style below.
5. **Review** with `/code-review` and fix every finding, red flags included.
6. **Open the PR.** Push the branch (`git push -u origin <branch>`) and run `gh pr create`.
   - Title: the ticket's number and title.
   - Body, a few lines: a link to the ticket file, two or three bullets on what changed, what the human should test by hand (or "nothing beyond `bun run check`"), and design-it-twice notes when `docs/code-style.md` asks for them.
7. **Hand over.** Ask the human to review or test, and fix requested changes on the same branch.

When the ticket, the spec or an ADR looks wrong, stop and ask the human. If they're away, write the question under `## Comments` on the ticket and set `Status: needs-info`. The ticket's scope is the scope.
