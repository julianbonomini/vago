---
name: vago-check-red-flags
description: Red-flag review from A Philosophy of Software Design. Use on a diff before a commit, a report or a review verdict, or on the whole codebase when asked; reports each finding with its file, line, red flag and fix.
---

# Check red flags

Review code against the red flags of John Ousterhout's *A Philosophy of Software Design* and say what to fix. Every red flag is complexity added, and any finding blocks the change until it's fixed.

## Steps

1. **Pick the scope.** Review the diff you were given. With none named, review the current branch against the branch it came from, plus uncommitted changes. When asked for the whole codebase, review every source file.
2. **Read beyond the hunk.** For each file in scope, read the whole module and the callers and callees the code in scope touches. Information Leakage, Repetition, Pass-Through Method and Conjoined Methods only show when you see the other side, so search the codebase for the same knowledge, the same code and the same signature.
3. **Check every red flag below against every module, export, function, name and comment in scope.** Also check every exported type: does its module own the concept the type names? A type kept somewhere else, for example to avoid an import cycle, is Information Leakage.
4. **Report.** One finding per line: `path:line`, the red flag, what is wrong, and the fix. The fix names the change (merge these modules, inline this wrapper, rename to `x`), not "consider improving". Finish with the files you checked. With no findings, say so.

Done when every file in scope has been checked against every red flag. If you wrote the code, fix each finding and run the check again.

When a finding's fix isn't clear, read the matching chapter in [aposd.md](../vago-design-module/aposd.md) §4.

## Red flags

| Red flag | Meaning | What it looks like in TypeScript |
|---|---|---|
| **Shallow Module** | The interface isn't much simpler than the implementation. | `class FileWrapper { read(p) { return fs.readFileSync(p) } }`, or a 3-line exported function with 4 options. |
| **Information Leakage** | One design decision shows up in several modules. | Two files each parse the Ticket `+++` header, or both know the `.vago-goals/<goal>/` layout. |
| **Temporal Decomposition** | Code is split by the order things run, not by what knowledge they hide. | `read-workflow.ts`, `validate-workflow.ts`, `freeze-workflow.ts`, all of which know the Workflow schema. |
| **Overexposure** | To use the common feature you have to learn about rare ones. | `run(cmd, { retries, shell, env, cwd, encoding, signal })` with no defaults, so every call site fills them in. |
| **Pass-Through Method** | A method does little except forward to another with a similar signature. | `getStatus(id) { return store.getStatus(id) }` repeated across layers. |
| **Repetition** | The same nontrivial code appears in several places. | The same `try { parse(...) } catch { ... }` plus a shape check copied into each command. |
| **Special-General Mixture** | A general mechanism contains code for one particular use. | A general `runStep()` with `if (step.id === "review")` inside it. |
| **Conjoined Methods** | You can't understand one method without reading another. | `prepare()` sets module state and `finish()` silently depends on it, so callers must pair them correctly. |
| **Comment Repeats Code** | All of the comment's information is obvious from the adjacent code. | `// increment i` above `i++`, or `/** Gets the name */ getName()`. |
| **Implementation Documentation Contaminates Interface** | The interface comment describes internals callers don't need. | A TSDoc on an exported function explaining which `Map` it caches into and the loop order. |
| **Vague Name** | A name broad enough to mean different things. | `data`, `info`, `result`, `handle()`, `manager`, `utils.ts`. |
| **Hard to Pick Name** | You can't find a precise, intuitive name for an entity. | You're stuck choosing between `processAndSaveOrSkip` and `doStuff`. The entity is doing two jobs. |
| **Hard to Describe** | A complete interface comment has to be long. | The TSDoc needs "if X then ... unless Y, in which case ..." to be accurate. |
| **Nonobvious Code** | You can't understand the behaviour or meaning from a quick read. | A magic `exitCode === 3`, a boolean positional argument `run(t, true, false)`, an untyped `any` flowing through. |
| **Adjacent Layers, Similar Abstractions** | Two layers next to each other offer nearly the same abstraction, so one isn't earning its place. | A `TicketService` whose methods mirror `ticket-store.ts` one for one. |
| **Pass-Through Variable** | A value is threaded through several functions that don't use it, only to reach one that does. | `cwd` passed through `runGoal`, `runTicket` and `runStep` so `spawn` can read it. |
