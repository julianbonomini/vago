# Puts the checkout on a fresh branch for this Ticket, cut from the Goal's
# branch. The Goal's first Ticket also cuts the Goal's branch from main.
# A reset Ticket starts over: its old branch is replaced.
set -eu

goal="goal/$VAGO_GOAL"
ticket="$VAGO_GOAL/$VAGO_TICKET"

if [ -n "$(git status --porcelain)" ]; then
	echo "The checkout has uncommitted changes. Commit or stash them first."
	exit 1
fi

git rev-parse --verify --quiet "refs/heads/$goal" >/dev/null || git branch "$goal" main
git switch -C "$ticket" "$goal"
