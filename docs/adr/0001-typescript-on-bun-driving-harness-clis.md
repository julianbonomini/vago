# Punt is TypeScript on Bun, driving Harness CLIs

Punt Alpha is written in TypeScript and runs on Bun, shipped as one binary via `bun build --compile`. It drives each Harness through its headless CLI (`claude -p --output-format stream-json`, `codex exec --json`), not an Agent SDK. Go was the early favourite for its single binary, but the human reads TypeScript far more reliably, and code that Punt writes about itself has to stay understandable to them. Bun closes the single-binary gap.

## Considered Options

- **Go**: rejected. It would have produced a small static binary, but the human struggles to follow idiomatic concurrent Go, and it would have ruled out the official SDKs.
- **Deno**: rejected in favour of Bun, which is more common and battle-tested and has a good subprocess API.
- **Rust, Python, Node**: Rust is hard to read. Python has the weakest single-binary and type-feedback story. Node's single-binary option (SEA) is clunky.
- **Agent SDKs**: unnecessary. The official SDKs wrap the same CLIs, and Alpha needs none of their in-process callbacks. Sandcastle and warren also drive CLIs.

## Consequences

- Workflows are declarative config (TOML/YAML, prompts, skills, shell steps), not TypeScript, so a Project's author doesn't need to know TypeScript.
- Bun doesn't type-check, so Punt's check is strict `tsc --noEmit` plus Biome plus `bun test`.
- Alpha runs a pinned installed binary. Its own changes take effect only after an explicit rebuild and reinstall.
