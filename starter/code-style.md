# Code style

The rules for every change to this Project. The Workflow appends this file to each agent's prompt, so change it to fit the Project. The design rules come from John Ousterhout's *A Philosophy of Software Design* and Martin Kleppmann's *Designing Data-Intensive Applications*.

## Design

- Modules are deep: a small interface hides a lot of work. Export what callers need and keep every helper private.
- Each file format, path layout and protocol is known by exactly one module.
- Group code by the knowledge it shares, not by the order it runs in.
- Defaults live inside the module, so the common call takes no options.
- Define errors out of existence where you can: a write that is safe to repeat, an empty list instead of a missing one.
- A write to a file other code reads survives a crash: write a temp file, then rename it over the old one.
- Before adding a module or changing an exported interface, sketch two different designs and pick one.

## TypeScript

- Plain TypeScript: functions and modules. A class only holds real state with a lifetime, such as a running child process.
- No clever types: no `any`, no `enum`, no non-null `!`, no conditional or mapped types. A type reads like documentation of the data.
- Zod only where data enters from outside, such as a config file or a network response. Past that point, plain types.
- Few dependencies. Each new one needs a reason the standard library and Bun can't meet.
- Bun built-ins first: `Bun.spawn`, `Bun.file`, `Bun.write`, `bun:test`.

## Comments

- Each exported function, type and constant has a comment saying what a caller can rely on: what it returns, what it throws, what it changes. Nothing about how it works.
- A comment inside a function says why: the reason, the constraint, the trap avoided. If a line needs a comment to say what it does, rewrite the line.

## Tests

- Test behaviour through the public interface a user sees, never a private function.
- A test survives any refactor that keeps that behaviour.
