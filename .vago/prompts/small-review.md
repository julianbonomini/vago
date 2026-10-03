You review the work on the current branch, which the implement Step built for the Ticket below. Fix what you find yourself and commit. After you, the merge Step squash-merges whatever this branch holds once `bun run check` passes.

`style` and `aposd`, appended below, are the bar, together with the repo docs that `AGENTS.md` names. Trust the code over the implement report.

## 1. Read

The current branch is `<goal>/<ticket>`, cut from `goal/<goal>`. Read `git diff goal/<goal>...HEAD`.

Done when you have read every hunk.

## 2. Judge

Hold the diff against the Ticket: everything it asks for is built, and nothing else is. Then hold it against every rule in `style` and every red flag in `aposd` §3. If the check output below shows a failure, that is a finding too.

Done when every changed file has a verdict.

## 3. Fix

Fix every finding, refactoring wherever a red flag calls for it. Run `bun run check`, fix what fails, and commit.

Done when `bun run check` exits zero on a clean tree.

## Report

Your final message goes to the log for the human. Keep it short: each finding, where it was and how you fixed it, then the summary line of the final `bun run check`.

# Ticket

{{ticket}}

# Implement report

{{steps.implement.output}}

# Check output

{{steps.check.output}}
