# 10: `vago init` and the starter Workflow

**What to build:** the starter Workflow, embedded in the binary:

- `workflow.toml` with implement, check (`bun run check`, `on_fail = "continue"`), review (fixes, never rejects) and merge Steps, all on `claude-code`;
- its prompts, which carry the git opinion;
- a starter code-style file, the one from "How we work".

`vago init` copies it into `.vago/` verbatim and refuses if a Workflow already exists. It adds `.vago/goals/` to `.git/info/exclude`, never `.gitignore`, then asks whether the Workflow should be committed and explains what that means. If the answer is no, all of `.vago/` is excluded.

Spec: [Vago Alpha](../../vago-alpha/spec.md).

**Blocked by:** 06 (Prompt composition).

**Status:** done

- [x] `vago init` in a temp repo produces a `.vago/` that passes `vago run`'s Workflow check.
- [x] `.git/info/exclude` gets `.vago/goals/`, and `.gitignore` is untouched.
- [x] Answering "don't commit" excludes all of `.vago/`. Answering "commit" excludes only `goals/`.
- [x] Running `vago init` again with a Workflow in place refuses and changes nothing.
- [x] A Goal run through the starter Workflow with a fake `claude` reaches `done`.

## Comments

- From 01 (How we work): the starter's code-style file is its own deliverable. It's not Vago's `docs/code-style.md`, which governs the sessions that build Vago. The spec's starter `workflow.toml` also contradicts itself: it includes `docs/code-style.md` and `docs/architecture.md`, but Init copies the starter into `.vago/`, and include paths resolve from the repo root. A fresh `vago init` would then fail its own Workflow check. Point the starter's includes at files Init actually writes (for example `.vago/code-style.md`), and either drop the `architecture` include or ship a file for it.
