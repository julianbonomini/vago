# Code style

The rules for every line of Punt's code. They come from `docs/aposd.md`, and each rule names its source there. When a case isn't covered here, decide from `docs/aposd.md`.

The goal is **zero complexity added**. Complexity is anything that makes the system harder to understand or change (aposd §1). A change that adds complexity is wrong even when it works.

## The test

Before adding anything (a file, an export, a parameter, an option, a type, a branch, a dependency), ask: *does this make the system harder to understand or change?* If the answer is yes or unsure, find the simpler design, or stop and ask the human. Removing code that isn't earning its place is always in scope for the ticket you're on.

## Design

- **Deep modules.** Each module hides a lot behind a small exported surface. Export the few functions callers need; keep every helper unexported. (§2.4, §4 deep vs. shallow)
- **One owner per decision.** Each file format, path layout and protocol is known by exactly one module. `docs/architecture.md` names the owners. (§4 information hiding)
- **A type lives with the module that owns its concept.** `RunOutcome` belongs to the module that performs Runs, not to one that stores them. Review checks every exported type: does its module own the concept the type names? (§4 information hiding; red flag: Information Leakage)
- **An import cycle is a design error, not a placement puzzle.** Biome's `noImportCycles` fails `bun run check` on one. Fix the direction: make the lower module a leaf that takes plain values, or move the behaviour to the module that owns the concept. Never move a type or function out of its concept's owner to break a cycle. If there's no clean fix, stop and ask the human.
- **Modules by knowledge, not by order.** Code that shares knowledge lives together, even when it runs at different times. (red flag: Temporal Decomposition)
- **The common case is the call with no options.** Defaults live inside the module. Add a parameter only when the caller really knows better. (§2.5, §4 pull complexity downwards)
- **Errors defined out of existence.** Choose semantics where the error can't happen: an idempotent write, an empty list instead of a missing one. (§2.11)
- **Long, obvious functions.** A function reads top to bottom and does one thing completely. Split only when the piece is a real abstraction that someone can understand without reading its caller. No line limits. (§4 better together or apart)
- **General core, special edges.** Kernel modules carry no special case for one Step, Harness or command; those live in `cli.ts` and the Harness modules. (red flag: Special-General Mixture)
- **Design it twice** when you add a module or change a module's exported interface. Write both options in two or three lines each in the PR body, with the choice and why. (§2.12)

## Red flags

Any red flag in `docs/aposd.md` §3 blocks the PR. The session finds and fixes them before asking the human to review: Shallow Module, Information Leakage, Temporal Decomposition, Overexposure, Pass-Through Method, Repetition, Special-General Mixture, Conjoined Methods, Comment Repeats Code, Implementation Documentation Contaminates Interface, Vague Name, Hard to Pick Name, Hard to Describe, Nonobvious Code.

## TypeScript

Plain TypeScript: functions and modules.

- **Types.** `strict` and `noUncheckedIndexedAccess`. Data shapes are `type` aliases and string-literal unions (`"ok" | "idle-timeout"`), spelled out field by field. Every value has a real type. Generics only with one obvious type parameter. A type reads at a glance like documentation of the data. If it needs a second read, write the plain, longer version instead. (red flag: Nonobvious Code)
  Guardrails, since type gymnastics are complexity: no `any`, no `!` non-null assertions, no `enum`, no `namespace`, no conditional, mapped or template-literal types, no `infer`, no function overloads, no types derived from other types (`Pick`, `Omit`, `ReturnType`, `typeof x[keyof ...]`), except `z.infer` at the edges.
- **Classes** only for real state with a lifetime, such as a running child process. Everything else is a function. (§4 classitis)
- **Zod at edges only:** where data enters from outside (`workflow.toml`, Ticket headers, Harness stream lines). Past the edge, plain types.
- **Errors.** Domain outcomes the caller branches on are return values, a discriminated union such as `{ outcome: "stuck", reason }`. Bad input the human must fix throws a plain `Error` whose message names the problem and the file. Only `cli.ts` catches, prints and picks the exit code. No custom error classes, no Result library. (§4 define errors out of existence: aggregate)
- **Names.** Domain words exactly as in `CONTEXT.md`: `Ticket`, `Run`, `Step`, `Goal`, `Workflow`, `Harness`. The Harness's own ID is `sessionId`. A name says what the thing is; a name that's hard to pick means the design is wrong. A type is named for the thing it describes, not the module it sits in, and carries its owner's name when it's read far from that module (`TicketStatus`, `HarnessSessionReport`). (§4 naming; red flags: Vague Name, Hard to Pick Name)
  Guardrail: no `utils.ts`, `helpers.ts`, `manager`, `data`, `info`, `handle`.
- **Files.** Kebab-case filenames. Named exports only, imported from the file that defines them. No default exports, no barrel `index.ts`.
- **Bun first.** `Bun.spawn`, `Bun.file`, `Bun.write`, `Bun.TOML.parse`, `bun:test`. Use `node:` modules only where Bun has no equivalent.
- **Formatting** is Biome's defaults. Biome decides; `bun run check` fails on violations.

## Dependencies

Allowed: `zod`, `smol-toml` (Bun can parse TOML but not write it), and dev-only `typescript`, `@biomejs/biome`, `@types/bun`. Any other dependency needs the human's OK before it's added: every dependency is an unknown unknown (§1). Commands are parsed by hand.

## Comments and docs

- **Comments inside code explain why:** the reason, the constraint, the trap avoided. The code says what is happening. If a line needs a comment to say what it does, rewrite the line. (red flag: Comment Repeats Code)
- **A field or type comment says only what its name can't.** When a better name would say it, rename instead. (red flag: Comment Repeats Code)
- **Interface comment on every export:** the contract a caller relies on (what it gives back, what the caller must know, what it throws). Nothing about how it works. Write it before the body; if it's hard to write, fix the design. (§4 comments; red flags: Hard to Describe, Implementation Documentation Contaminates Interface)
- **Module comment:** each file opens with two or three lines saying what the module owns and hides.
- Comments change in the same commit as their code. A TODO carries a ticket number.
- **Run `/no-ai-writing`** whenever you write or revise prose: comments, docs, ticket text, PR titles and bodies.

## Tests

1. **Design first.** Write the module's exported signatures and interface comments.
2. **Then `/tdd`**, one vertical slice at a time, always through the `punt` CLI seam the spec defines (`.scratch/punt-alpha/spec.md`, Testing Decisions). A test describes behaviour the human could see: exit code, stdout, Ticket files, logs. It survives any refactor that keeps the CLI's behaviour.

Tests don't drive the shape of the code; the design does (§4 where he disagrees with *Clean Code*: TDD).
