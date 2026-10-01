# 10: `punt init` and the starter Workflow

**What to build:** the starter Workflow, embedded in the binary:

- `workflow.toml` with implement, check (`bun run check`, `on_fail = "continue"`), review (fixes, never rejects) and merge Steps, all on `claude-code`;
- its prompts, which carry the git opinion;
- a starter code-style file, the one from "How we work".

`punt init` copies it into `.punt/` verbatim and refuses if a Workflow already exists. It adds `.punt/goals/` to `.git/info/exclude`, never `.gitignore`, then asks whether the Workflow should be committed and explains what that means. If the answer is no, all of `.punt/` is excluded.

Spec: [Punt Alpha](../../punt-alpha/spec.md).

**Blocked by:** 06 (Prompt composition).

**Status:** ready-for-agent

- [ ] `punt init` in a temp repo produces a `.punt/` that passes `punt run`'s Workflow check.
- [ ] `.git/info/exclude` gets `.punt/goals/`, and `.gitignore` is untouched.
- [ ] Answering "don't commit" excludes all of `.punt/`. Answering "commit" excludes only `goals/`.
- [ ] Running `punt init` again with a Workflow in place refuses and changes nothing.
- [ ] A Goal run through the starter Workflow with a fake `claude` reaches `done`.
