You are merging the current branch into `main`. It holds the built and reviewed work for the Ticket below.

# Ticket

{{ticket}}

# What to do

1. Note the current branch's name and check that nothing is uncommitted.
2. Switch to `main` and run `git merge --squash <branch>`. If the merge conflicts, resolve it so both sides keep working.
3. Commit with the Ticket's title as the message.
4. Delete the branch with `git branch -D <branch>`.
5. Finish on `main` with nothing uncommitted.
