# Squash-merges this Ticket's branch into the Goal's branch as one commit,
# pushes the Goal's branch and makes sure it has a PR to main, described by
# `vago goal report`. After the Goal's last Ticket, the PR also gets the
# ready-for-review label and a comment mentioning the human `gh` is logged in
# as. Fails, and so leaves the Ticket stuck, when the tree is dirty or the
# Ticket changed nothing.
set -eu

goal="goal/$VAGO_GOAL"
ticket="$VAGO_GOAL/$VAGO_TICKET"

if [ -n "$(git status --porcelain)" ]; then
	echo "$ticket has uncommitted changes."
	exit 1
fi

git switch "$goal"
git merge --squash "$ticket"
# Fails on an empty squash: a Ticket that changed nothing isn't done.
git commit -m "$(echo "$VAGO_TICKET" | tr '-' ' ')"
git branch -D "$ticket"

git push -u origin "$goal"
# Rewritten after every Ticket, so the last merge leaves the whole Goal's
# Runs. A body edited by hand on GitHub is replaced too.
body="$(vago goal report "$VAGO_GOAL")"
if gh pr view "$goal" >/dev/null 2>&1; then
	gh pr edit "$goal" --body "$body"
else
	gh pr create --base main --head "$goal" --title "$VAGO_GOAL" --body "$body"
fi

if [ "$VAGO_LAST_TICKET" = true ]; then
	gh label create ready-for-review --force --color 0e8a16 \
		--description "Every Ticket of the Goal is done"
	gh pr edit "$goal" --add-label ready-for-review
	# A comment, not the body: the body is rewritten after every Ticket, and
	# GitHub notifies a mention only when it's first posted. Posted once, so
	# a later last merge doesn't ping the human again.
	ping="@$(gh api user --jq .login) every Ticket of this Goal is done, it's ready for your review."
	if ! gh pr view "$goal" --json comments --jq '.comments[].body' | grep -qxF "$ping"; then
		gh pr comment "$goal" --body "$ping"
	fi
fi
