# What Alpha is written in

Type: grilling
Status: resolved
Blocked by: 09

## Question

What language and runtime is the Alpha kernel written in? Go was the lean candidate (a single installable binary that runs anywhere, plus Bubble Tea for a later TUI). TypeScript on Node is the main alternative, and Rust was already rejected as hard to read. Weigh:

- How each one installs and ships.
- Access to Harness SDKs (see "What Agent SDKs add over Harness CLIs").
- Whether a Project's Workflow can be code or has to be declarative config (TOML/YAML plus prompt files plus shell steps), since a Go binary can't run user Go code.
- How well LLMs write each language, and how strong its feedback loop is for a project that improves itself.
- Rebuilding and reinstalling the binary after Alpha changes its own code.

The kernel is a CLI (or later a daemon) with a stable interface, so a TUI or macOS app doesn't constrain this choice. The human decides. Offer an ADR once it resolves.

## Answer

**TypeScript on Bun, driving the Harness CLIs; Workflows are declarative.** Recorded as [ADR 0001](../../../docs/adr/0001-typescript-on-bun-driving-harness-clis.md).

- **Language: TypeScript.** The deciding factor is that the human reads TypeScript most reliably; idiomatic Go (channels, goroutines) is where they lose the thread, and a Punt that improves itself must stay understandable. Go's single-binary advantage is matched by Bun's `bun build --compile`. Rust was already rejected; Python is ruled out.
- **Runtime: Bun**, not Deno or Node: more common and battle-tested, a built-in test runner, and a subprocess API (`Bun.spawn` with streamed stdout) suited to driving Harnesses. Installs as one compiled binary.
- **Harnesses through their headless CLIs** (`claude -p --output-format stream-json`, `codex exec --json`), no SDKs, like Sandcastle and warren. Nothing Alpha needs is SDK-only. The event stream gets logged so a later Punt TUI can show live Run status (the viewer itself stays out of scope).
- **Workflows are declarative**: TOML/YAML steps plus prompt files, skills and shell steps. A Project's author never needs to know TypeScript. The detailed shape is "How a Project defines its Workflow".
- **Pinned binary.** Alpha keeps running its installed version; its own merged changes take effect only after an explicit rebuild and reinstall, so a bad merge can't break the Alpha driving the Goal.
- **Punt's repo provides `bun run check`**: strict `tsc --noEmit` (Bun doesn't type-check), Biome, `bun test`. Whether and how it gates a change (branch, human review, automatic) is the Workflow's call, not this decision's.
- **House style for Punt's own code**: plain TypeScript (functions and modules, classes only for real state, no clever types, Zod only at edges, few dependencies, Bun built-ins first), plus design principles from *A Philosophy of Software Design* and *Designing Data-Intensive Applications*. It lives in Punt's own code-style file, the same mechanism every Project uses.
