# 13: An agent Step that couldn't do its work ends `ok`

**What's wrong:** an agent Step's outcome comes only from `claude`'s exit code. When Claude Code refuses the session's tool calls, the agent explains that it needs permission, `claude` exits 0, and Punt records `ok`. The next Step then runs on work that was never done.

Found in a rehearsal on a throwaway clone of Punt (2026-10-02), with the Workflow's `model = "haiku"`:

- Punt spawned `claude -p ... --permission-mode auto --model haiku`, but the `system/init` event reported `"permissionMode": "default"`. Claude Code doesn't offer auto mode on Haiku, and it falls back without an error. Sonnet and Opus report `"auto"`.
- In `default` mode with no one to approve, the agent's `Write` was denied. The stream carried a `system/permission_denied` event, and the result text was "Permission is required to write the NOTES.md file."
- `write` ended `ok`, and the Ticket only went `stuck` two Steps later, when a shell Step found no file.

The same thing will happen on Sonnet or Opus whenever auto mode's classifier denies a call, for example a `git push` or `gh pr create` in the starter's implement Step.

**What to build:** the Claude Code module reports what the stream says about permissions, and the kernel fails the Run on it.

- A session whose `system/init` event reports a `permissionMode` other than the one Punt asked for fails the Run.
- A session that streamed a `system/permission_denied` event fails the Run, even when `claude` exits 0.
- The outcome names the reason, so the `stuck` line and the `[[runs]]` entry say why. Pick the spelling, for example `permission-denied`, and add it to the spec's outcome list.

Spec: [Punt Alpha](../../punt-alpha/spec.md), user stories 37 and 51.

**Blocked by:** none.

**Status:** ready-for-agent

- [ ] A fake `claude` whose fixture reports `"permissionMode": "default"` in `system/init` and exits 0 leaves the Ticket `stuck`, the Goal stops, and `punt run` exits non-zero.
- [ ] A fake `claude` whose fixture carries a `system/permission_denied` event and exits 0 leaves the Ticket `stuck` the same way.
- [ ] The `[[runs]]` entry and the `stuck` message name the reason.
- [ ] A session in `auto` with no denials still ends `ok`.
- [ ] Fixtures for the new cases are recorded from real `claude -p --output-format stream-json --verbose` sessions: `--model haiku` for the fallback, and a denied call for `permission_denied`.
