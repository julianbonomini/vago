# What Agent SDKs add over Harness CLIs

Type: research
Status: claimed

## Question

Alpha has to drive both Claude Code and Codex, and today it plans to do that through their headless CLIs (`claude --print --output-format stream-json`, `codex exec --json`). Before choosing Alpha's language, find out what the official agent SDKs would add:

- Which languages the Claude Agent SDK and the Codex SDK ship for, officially, as of now.
- Whether each SDK works by launching the CLI binary underneath, or calls the model API directly with its own agent loop.
- What each SDK can do that the headless CLI can't: session resume/fork, hooks, permission callbacks, custom tools or in-process MCP, structured output, cancellation, streaming events, cost and usage reporting. And the reverse: what the CLI does that the SDK doesn't.
- Whether Go has official or well-maintained community equivalents, and how complete they are.
- What languages the reference orchestrators (Sandcastle, warren, Factory Missions) and the other surveyed tools are written in, and how each drives its Harness (CLI or SDK).

Facts only, with primary sources. The language choice belongs to "What Alpha is written in".
