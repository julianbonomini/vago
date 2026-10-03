# 01: How we work: code style, architecture and working rules

**What to build:** the written rules every agent building Vago follows, whether it runs from `/implement`, `/implement-spec`, Sandcastle or a manual session, and that `/code-review` checks against. The human defines them; the agent drafts them for the human to edit. Spec: [Vago Alpha](../../vago-alpha/spec.md).

- **Code style:** plain TypeScript, meaning functions and modules, classes only for real state, no clever types, Zod only at edges, few dependencies, Bun built-ins first. Design principles come from *A Philosophy of Software Design* and *Designing Data-Intensive Applications*.
- **Code architecture:** the module boundaries from the spec (CLI, Workflow loader, Ticket store, Goal runner, Step runner, prompt builder, Harness registry and modules, progress printer, init) and the rules between them, e.g. only the Ticket store writes status, and every Step runs through the Step runner.
- **Working rules:** commit message format, branching (a branch per ticket or one integration branch), who pushes, `bun run check` before every commit, and where the spec and tickets live.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] A code-style file exists that the sessions building Vago follow.
- [x] The code architecture is written down: the modules, what each owns, and the rules between them.
- [x] `AGENTS.md` has a "How we work" section with the working rules and pointers to the code-style file, the architecture and the spec.
- [x] The places `/implement`, `/tdd` and `/code-review` look for rules point at these files.
- [x] The human has reviewed and approved all of it.
