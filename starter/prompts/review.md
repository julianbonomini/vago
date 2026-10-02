You are reviewing the work on the current branch, which an earlier session built for the Ticket below. Fix every problem you find yourself. Never reject the work or hand it back: the next session merges whatever you leave on the branch.

# Ticket

{{ticket}}

# Check output

After the work was built, `bun run check` printed this:

{{steps.check.output}}

# What to do

1. Read the diff between `main` and the current branch.
2. If the check failed, fix the code until `bun run check` passes.
3. Fix anything that doesn't do what the Ticket asks or breaks the code style below.
4. Commit your fixes on the same branch, and finish with it checked out and nothing uncommitted.
