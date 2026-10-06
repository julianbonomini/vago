# Squash-merges this Ticket's branch as one commit into vago/<goal>, the
# Goal's branch, which Vago creates and owns, pushes it and makes sure it has
# a PR to the repo's default branch, described by `vago goal report`, and
# writes the report's Runs to the end of the Goal's goal.md too. After the
# Goal's last Ticket, the PR also gets the ready-for-review label and a
# comment mentioning the human `gh` is logged in as.
#
# Changes a Step left uncommitted go in with the Ticket's work. Calls to
# GitHub that fail on the network or the service are tried again. Safe to run
# again after failing or stopping partway: it carries on from the squash, the
# push or the PR, and never squashes, opens or mentions anything twice. Fails,
# and so leaves the Ticket stuck, when the Ticket conflicts with vago/<goal>
# or changed nothing, or when a call fails for good, and its last line says
# why.
set -eu

goal="vago/$VAGO_GOAL"
ticket="$VAGO_GOAL/$VAGO_TICKET"
message="$(echo "$VAGO_TICKET" | tr '-' ' ')"

# What the script is doing, for the last line when a command fails.
doing="squashing $ticket into $goal"
trap 'status=$?; [ "$status" = 0 ] || echo "The merge failed $doing."' EXIT

fail() {
	trap - EXIT
	echo "$1"
	exit 1
}

# GitHub's 5xx answers and dropped connections, as gh and git print them.
transient='HTTP 5[0-9][0-9]|status code:? 5[0-9][0-9]|returned error: 5[0-9][0-9]|service unavailable|bad gateway|gateway time-?out|timed out|connection reset|connection refused|could not resolve host|hung up unexpectedly|tls handshake'

# Runs a command that talks to GitHub, and again after 1, 2 and 4 seconds
# while it fails on the network or the service. Any other failure, and the
# last, comes back at once with the command's stderr.
retrying() {
	errors="$(mktemp)"
	for wait in 1 2 4 0; do
		status=0
		"$@" 2>"$errors" || status=$?
		if [ "$status" = 0 ] || [ "$wait" = 0 ] ||
			! grep -Eqi "$transient" "$errors"; then
			cat "$errors" >&2
			rm -f "$errors"
			return "$status"
		fi
		echo "$(tail -n 1 "$errors"), trying again in ${wait}s." >&2
		sleep "$wait"
	done
}

# Whether the Ticket's squashed commit is already on vago/<goal>.
squashed() {
	git log --format=%s "$goal" | grep -qxF "$message"
}

# A Ticket whose branch is gone was squashed and its branch deleted by an
# earlier attempt that stopped after that, and this one picks up at the push.
if ! git rev-parse -q --verify "refs/heads/$ticket" >/dev/null; then
	squashed || fail "$ticket has no branch, so there is nothing to merge."
else
	if [ -n "$(git status --porcelain)" ]; then
		git add -A
		git commit -qm "changes left uncommitted"
	fi

	git switch -q "$goal"
	if ! git merge --squash "$ticket"; then
		conflicts="$(git diff --name-only --diff-filter=U | paste -sd ' ' -)"
		# Back to where the Ticket's Steps left the worktree, clean for a rerun.
		git reset -q --hard
		git switch -q "$ticket"
		fail "$ticket conflicts with $goal in $conflicts."
	fi
	# With nothing to squash, a Ticket whose commit is already on vago/<goal>
	# is a rerun of an attempt that stopped before deleting the branch.
	if ! git diff --cached --quiet; then
		git commit -qm "$message"
	elif ! squashed; then
		git switch -q "$ticket"
		fail "$ticket changed nothing, so it isn't done."
	fi
	git branch -D "$ticket"
fi

doing="pushing $goal to origin"
retrying git push -u origin "$goal"

doing="building the PR's body with vago goal report"
# Rewritten after every Ticket, so the last merge leaves the whole Goal's
# Runs. A body edited by hand on GitHub is replaced too.
# The Runs written last time come off goal.md first, so the report doesn't
# carry them twice.
goal_file="$VAGO_PROJECT_ROOT/.vago-goals/$VAGO_GOAL/goal.md"
kept="$(sed '/^## Runs$/,$d' "$goal_file")"
printf '%s\n' "$kept" >"$goal_file"
# Run from the main checkout: in the worktree, the Ticket's files could
# change how `vago` starts, as a `bunfig.toml` did.
body="$(cd "$VAGO_PROJECT_ROOT" && vago goal report "$VAGO_GOAL")"
printf '%s\n\n%s\n' "$kept" "$(printf '%s\n' "$body" | sed -n '/^## Runs$/,$p')" >"$goal_file"

doing="looking up the PR of $goal"
# Only "no pull requests found" means there is none to edit; any other
# failure would open a second one.
if lookup="$(retrying gh pr view "$goal" 2>&1 >/dev/null)"; then
	doing="updating the PR of $goal"
	retrying gh pr edit "$goal" --body "$body"
elif printf '%s\n' "$lookup" | grep -q "no pull requests found"; then
	doing="opening a PR for $goal"
	retrying gh pr create --head "$goal" --title "$VAGO_GOAL" --body "$body"
else
	printf '%s\n' "$lookup"
	exit 1
fi

if [ "$VAGO_LAST_TICKET" = true ]; then
	doing="marking the PR of $goal ready for review"
	retrying gh label create ready-for-review --force --color 0e8a16 \
		--description "Every Ticket of the Goal is done"
	retrying gh pr edit "$goal" --add-label ready-for-review
	# A comment, not the body: the body is rewritten after every Ticket, and
	# GitHub notifies a mention only when it's first posted. Posted once, so
	# a later last merge doesn't ping the human again.
	ping="@$(retrying gh api user --jq .login) every Ticket of this Goal is done, it's ready for your review."
	comments="$(retrying gh pr view "$goal" --json comments --jq '.comments[].body')"
	if ! printf '%s\n' "$comments" | grep -qxF "$ping"; then
		retrying gh pr comment "$goal" --body "$ping"
	fi
fi
