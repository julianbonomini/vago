# 02: Tracer bullet: one Ticket through shell Steps

**What to build:** the Bun/TypeScript project with `bun run check` (strict `tsc --noEmit`, Biome, `bun test`), and a test helper that makes a throwaway git repo and runs `punt` as a child process. `punt run <goal>` on a Goal of one Ticket, with a Workflow of shell Steps only:

- marks the Ticket `running`, then `done`;
- appends a `[[runs]]` entry per Step (`step`, `started`, `ended`, `outcome`, `log`);
- writes one `.log` file per Step under `.punt/goals/<goal>/logs/`;
- prints a line when each Step starts and when it ends, then exits 0.

Spec: [Punt Alpha](../../punt-alpha/spec.md).

**Blocked by:** 01 (How we work).

**Status:** done

- [x] `bun run check` runs `tsc --noEmit`, Biome and `bun test`, and passes.
- [x] A test builds a temp repo with `.punt/workflow.toml` and one Ticket, runs `punt run <goal>`, and sees exit 0 and the Ticket `done`.
- [x] The Ticket header has one `[[runs]]` entry per Step with outcome `ok` and a log path, and the body is unchanged.
- [x] Each Step's stdout and stderr are in its `.log` file.
- [x] stdout shows start and end lines with timestamp, Ticket, Step, outcome and duration.
