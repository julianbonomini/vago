# What Agent SDKs add over Harness CLIs

Type: research
Status: resolved

## Question

Alpha has to drive both Claude Code and Codex, and today it plans to do that through their headless CLIs (`claude --print --output-format stream-json`, `codex exec --json`). Before choosing Alpha's language, find out what the official agent SDKs would add:

- Which languages the Claude Agent SDK and the Codex SDK ship for, officially, as of now.
- Whether each SDK works by launching the CLI binary underneath, or calls the model API directly with its own agent loop.
- What each SDK can do that the headless CLI can't: session resume/fork, hooks, permission callbacks, custom tools or in-process MCP, structured output, cancellation, streaming events, cost and usage reporting. And the reverse: what the CLI does that the SDK doesn't.
- Whether Go has official or well-maintained community equivalents, and how complete they are.
- What languages the reference orchestrators (Sandcastle, warren, Factory Missions) and the other surveyed tools are written in, and how each drives its Harness (CLI or SDK).

Facts only, with primary sources. The language choice belongs to "What Alpha is written in".

## Answer

Officially, the Claude Agent SDK and the Codex SDK ship only for Python and TypeScript, and pi's SDK only for TypeScript (Node or Bun). There is no official Go SDK for any of them. Both Claude SDKs and both Codex SDKs run the bundled CLI binary as a subprocess; none has its own agent loop. Claude runs over a bidirectional stream-json control protocol, Codex TS over `codex exec --json`, and Codex Python over `codex app-server` JSON-RPC. pi is the exception: its SDK runs the agent in-process. Over `claude -p`, the Claude SDK adds in-process permission callbacks, hook callbacks, in-process MCP tools, mid-session control and session-file helpers. Resume, fork, JSON-schema output, budget caps, streaming and `total_cost_usd` are already CLI features. The Codex TS SDK adds little over `exec`. The Python SDK, through app-server, adds fork, list, steer and interrupt, but it auto-accepts approvals, and Codex reports tokens only, never cost. Community Go ports exist: Claude ports speak the same control protocol, with severity1 (173★) saying it is "partial" against Python; Codex clients target app-server; pi has one small RPC client. As for the orchestrators, Sandcastle, warren and vibe-kanban (Rust) drive CLIs directly. Cyrus uses the Claude Agent SDK. AO (Go) uses ACP and app-server. Most tools drive Codex through `app-server`, not either SDK.

Findings: [research/what-agent-sdks-add-over-harness-clis.md](../research/what-agent-sdks-add-over-harness-clis.md) (on branch research/what-agent-sdks-add-over-harness-clis)
