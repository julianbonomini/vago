## Rules and knowledge

- The `vago-write-code`, `vago-check-red-flags` and `vago-design-module` skills in `.claude/skills/`: the code style, the red flags and module design, from *A Philosophy of Software Design*.
- `docs/architecture.md`: modules, owners, and the rules between them. Read before writing code.
- `CONTEXT.md`: the domain language. `docs/adr/`: the decisions behind it; read the ones your change touches.

`bun run check` passes before every commit.

## Product and workshop

Vago builds itself, so this repo holds two things:

- **The product** is what `vago` ships to every project: `src/` and `starter/`.
- **The workshop** is how the human builds Vago on this machine: this file, `.claude/skills/`, the human's user-level skills (`~/.claude/skills/`), and this repo's own `.vago/`, which is the installed product running on itself.

Everything belongs to the workshop unless the human says it ships. A skill, prompt or tool named in a conversation, Goal or Ticket is something to build with. When a change belongs in the product, the human says so, and it lands in `src/` or `starter/`. When unsure, ask which side it's on.

## TypeScript

The skills hold the rules for any language. These are Vago's own, on top of them.

- **Plain TypeScript:** functions and modules. Classes only for real state with a lifetime, such as a running child process.
- **Types.** `strict` and `noUncheckedIndexedAccess`. Data shapes are `type` aliases and string-literal unions (`"ok" | "idle-timeout"`), spelled out field by field. Generics only with one obvious type parameter. Guardrails, since type gymnastics are complexity: no `any`, no `!` non-null assertions, no `enum`, no `namespace`, no conditional, mapped or template-literal types, no `infer`, no function overloads, no types derived from other types (`Pick`, `Omit`, `ReturnType`, `typeof x[keyof ...]`), except `z.infer` at the edges.
- **Zod at edges only:** where data enters from outside (Workflow TOML, Ticket headers, Harness stream lines). Past the edge, plain types.
- **Errors.** Domain outcomes the caller branches on are a discriminated union such as `{ outcome: "stuck", reason }`. Bad input throws a plain `Error` naming the problem and the file. Only `cli.ts` catches, prints and picks the exit code. No custom error classes, no Result library.
- **Names.** Domain words exactly as in `CONTEXT.md`: `Ticket`, `Run`, `Step`, `Goal`, `Workflow`, `Harness`. The Harness's own ID is `sessionId`. A type read far from its module carries its owner's name (`TicketStatus`, `HarnessSessionReport`). No `utils.ts`, `helpers.ts`, `manager`, `data`, `info`, `handle`.
- **Files.** Kebab-case filenames. Named exports only, imported from the file that defines them. No default exports, no barrel `index.ts`.
- **Bun first.** `Bun.spawn`, `Bun.file`, `Bun.write`, `Bun.TOML.parse`, `bun:test`. `node:` modules only where Bun has no equivalent.
- **Import cycles.** Biome's `noImportCycles` fails `bun run check` on one.
- **Formatting** is Biome's defaults; `bun run check` fails on violations.
- **Dependencies.** Allowed: `zod`, `smol-toml` (Bun can parse TOML but not write it), and dev-only `typescript`, `@biomejs/biome`, `@types/bun`. Anything else needs the human's OK. Commands are parsed by hand.
- **Tests** go through the `vago` CLI seam the spec defines (`.scratch/vago-alpha/spec.md`, Testing Decisions), test-first with `/tdd`: exit code, stdout, Ticket files, logs.
- **A TODO** carries a Ticket number.

## The installed `vago`

`bun run reinstall` compiles `src/cli.ts`, with the starter embedded, to `~/.local/bin/vago`, so that directory must be on `PATH`. The human runs it between Goals. Sessions and Workflow Steps leave it to the human, so a bad merge can't replace the `vago` that is driving a Goal.

## Commits and PRs

- A commit message is one plain phrase: imperative, lowercase, at most about 60 characters, like `parse workflow toml and reject unknown step types`. No prefix, no body, no trailing period, no colons, em dashes or emoji.
- Commits and PRs are written as the human's own: no Co-Authored-By trailers, no "Generated with" footers.
- Push only your own branch. `main` changes only through a squash merge, and history is never rewritten.

## Writing docs and code comments

Use the /no-ai-writing skill.
