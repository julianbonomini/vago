# 03: Agent Steps on Claude Code

**What to build:** agent Steps that run on Claude Code, behind the Harness registry and module interface (command, stream reading, resume hint). The kernel owns spawning, logs and `[[runs]]`. An agent Step runs `claude -p --output-format stream-json --verbose --permission-mode auto --model <model>` with the prompt file, after substituting `{{ticket}}` (title and body, no header) and `{{goal}}` (the body of `goal.md`).

- **Recording:** the session ID, tokens and `cost_usd` go into `[[runs]]` along with `harness` and `model`. The end line shows cost. The raw stream goes to a `.jsonl` log.
- **Tests:** a fake `claude` on `PATH` replays a fixture recorded from a real `stream-json` session and records the argv and stdin it received.

Spec: [Punt Alpha](../../punt-alpha/spec.md).

**Blocked by:** 02 (Tracer bullet).

**Status:** done

- [x] A Workflow with one agent Step takes a Ticket to `done` through the fake `claude`.
- [x] The fake received guarded mode, the stream-json flags and the Workflow's `model`. It never received `--dangerously-skip-permissions`.
- [x] The prompt received has `{{ticket}}` and `{{goal}}` substituted, and the Ticket header never appears in it.
- [x] `[[runs]]` records `harness`, `model`, `session_id`, `tokens` and `cost_usd` from the fixture.
- [x] The `.jsonl` log holds the full stream.
- [x] Adding a Harness means one new module plus one registry entry, with no change to the kernel.
