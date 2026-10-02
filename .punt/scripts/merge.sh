# Squash-merges this Ticket's branch into the Goal's branch as one commit,
# pushes the Goal's branch and makes sure it has a PR to main, described by
# `punt goal report`. Fails, and so leaves the Ticket stuck, when the tree is
# dirty or the Ticket changed nothing.
set -eu

goal="goal/$PUNT_GOAL"
ticket="$PUNT_GOAL/$PUNT_TICKET"

if [ -n "$(git status --porcelain)" ]; then
	echo "$ticket has uncommitted changes."
	exit 1
fi

git switch "$goal"
git merge --squash "$ticket"
# Fails on an empty squash: a Ticket that changed nothing isn't done.
git commit -m "$(echo "$PUNT_TICKET" | tr '-' ' ')"
git branch -D "$ticket"

git push -u origin "$goal"
# Rewritten after every Ticket, so the last merge leaves the whole Goal's
# Runs. A body edited by hand on GitHub is replaced too.
body="$(punt goal report "$PUNT_GOAL")"
if gh pr view "$goal" >/dev/null 2>&1; then
	gh pr edit "$goal" --body "$body"
else
	gh pr create --base main --head "$goal" --title "$PUNT_GOAL" --body "$body"
fi
