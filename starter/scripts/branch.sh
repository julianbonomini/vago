# Puts the Goal's worktree on a fresh branch for this Ticket, cut from
# vago/<goal>, the Goal's branch, which Vago creates and owns. A reset Ticket
# starts over: its old branch is replaced.
set -eu

goal="vago/$VAGO_GOAL"
ticket="$VAGO_GOAL/$VAGO_TICKET"

if [ -n "$(git status --porcelain)" ]; then
	echo "The checkout has uncommitted changes. Commit or stash them first."
	exit 1
fi

git switch -C "$ticket" "$goal"
