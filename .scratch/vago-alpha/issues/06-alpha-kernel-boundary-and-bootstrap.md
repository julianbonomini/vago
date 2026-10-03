# Alpha kernel boundary and bootstrap path

Type: grilling
Status: resolved
Blocked by: 04, 05, 08, 11, 12

## Question

Pull the prior decisions together. What exactly is inside the Alpha kernel and what is outside? What are the manual bootstrap steps, from building the kernel with ordinary developer tools (Sandcastle or manual Harness sessions; "Does Alpha run on Sandcastle?" settled that this choice has no effect on Alpha) to Alpha finishing its own first Goal? This is the decision handed to `/to-spec`.

Also settle how the human sees progress without a TUI (Ticket status, Run logs, what `vago run` prints). Runtime and failure handling are decided in [What Alpha's runtime is](11-what-alphas-runtime-is.md) and [How a Run fails and what Alpha does next](12-how-a-run-fails-and-what-alpha-does-next.md); this ticket assembles them.

## Answer

**The human builds all of Alpha by hand with Sandcastle, shipping the Claude Code Harness only behind a compiled-in Harness seam. The bar is `vago run <goal>` taking a 2-Ticket Goal on Vago's own repo to `done`, one Ticket after the other.** No ADR: the Harness seam is cheap to change, and the rest assembles earlier decisions.

- **Inside the kernel (all of Alpha, no seed split).** The CLI: `vago init`, `goal new`, `ticket add`, `run`, `ticket reset`. Workflow loading, freezing and validation (Steps, includes, `args`, `idle_timeout`), per [How a Project defines its Workflow](04-how-a-project-defines-its-workflow.md). The Ticket store and format checks, per [Where Vago keeps Goals and Tickets](08-where-vago-keeps-goals-and-tickets.md). Agent and shell Steps, plain substitution, the idle timeout, signal teardown, `[[runs]]` and logs, per [What Alpha's runtime is](11-what-alphas-runtime-is.md) and [How a Run fails and what Alpha does next](12-how-a-run-fails-and-what-alpha-does-next.md).
- **Harnesses.** Alpha is Harness-agnostic by design but ships **Claude Code only**. Codex comes once the whole thing works. Vago supports only explicit Harnesses, with no user plugins. Each Harness is a module compiled into the binary, and a registry maps the Workflow's `harness` name to it. An unknown name fails validation. A Harness module provides three things:
  - **Command:** the command to run, built from the prompt, `model` and `args`, in its guarded mode;
  - **Stream reading:** it parses one JSONL line at a time into the session ID, tokens and cost;
  - **Resume hint:** the command that resumes a session.

  The kernel owns everything else: spawning the process, the idle timer, logs, `[[runs]]` and outcomes. Adding a Harness means one module plus one registry entry. The Workflow format keeps the per-Step `harness` override.
- **Outside the kernel.** The starter Workflow (`workflow.toml`, prompts, starter code-style) lives in Vago's repo and ships inside the binary, and `vago init` copies it. Vago builds itself with that Workflow. Git, Harness logins, tmux and keeping the machine awake belong to the Workflow or the human.
- **Seeing progress.**
  - **Logs:** each Run's raw stream goes to `.vago/goals/<goal>/logs/<NN>-<step>-<k>.jsonl`, where `k` is the Run's index in `[[runs]]`, so a reset Ticket keeps its earlier logs. Shell Steps write a `.log` file. Each `[[runs]]` entry records its `log` path. Logs are untracked with the rest of `goals/` and never cleaned up.
  - **`vago run` output:** one line when a Step starts and one when it ends, showing timestamp, Ticket, Step, outcome, duration and cost:
    ```
    09:12:03  01 ticket-validation  implement  …
    09:31:40  01 ticket-validation  implement  ok  19m37s  $1.84
    ```
    On `stuck` it also prints the log path, the resume command and the `vago ticket reset` command. Live following is `tail -f` on the log.
  - No `status` command and no viewer. Small extras like these are scope creep for Alpha.
- **Bootstrap.**
  1. The human builds Alpha by hand with Sandcastle whenever the time comes. The spec plans no Tickets for this phase.
  2. Install with `bun run install` (`bun build --compile`, then copy onto `PATH`), run by hand between Goals, never inside a Workflow. Alpha runs a pinned binary.
  3. Write a 2-Ticket Goal for Vago's own repo with a `blocked_by` edge between the Tickets.
- **The bar.** On Vago's own repo, `vago run <goal>` picks up the ready Ticket, runs it through every Step of the Workflow, then does the same for the second. Runs are serial, and both Tickets end `done` with no human touching anything. Throwaway repos are fine for smoke tests and don't count.
