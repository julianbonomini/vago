# What Alpha is written in

Type: grilling
Status: open
Blocked by: 09

## Question

What language and runtime is the Alpha kernel written in? Go was the lean candidate (a single installable binary that runs anywhere, plus Bubble Tea for a later TUI). TypeScript on Node is the main alternative, and Rust was already rejected as hard to read. Weigh:

- How each one installs and ships.
- Access to Harness SDKs (see "What Agent SDKs add over Harness CLIs").
- Whether a Project's Workflow can be code or has to be declarative config (TOML/YAML plus prompt files plus shell steps), since a Go binary can't run user Go code.
- How well LLMs write each language, and how strong its feedback loop is for a project that improves itself.
- Rebuilding and reinstalling the binary after Alpha changes its own code.

The kernel is a CLI (or later a daemon) with a stable interface, so a TUI or macOS app doesn't constrain this choice. The human decides. Offer an ADR once it resolves.
