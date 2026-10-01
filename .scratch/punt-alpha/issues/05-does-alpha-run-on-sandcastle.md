# Does Alpha run on Sandcastle?

Type: grilling
Status: resolved
Blocked by: 02, 07

## Question

Does Alpha call Sandcastle as a library to execute its Runs, or does it own that engine itself, possibly copied from Sandcastle? Weigh how lean it is, the Harness-agnostic requirement, how dependent we become on a pre-1.0 project, and how easily Punt can improve itself later.

## Answer

**No. Alpha owns its engine and has no runtime dependency on Sandcastle, whatever language it is written in.**

- **Copy ideas, not code.** Alpha reimplements the mechanisms it takes from Sandcastle (headless Harness in a container, completion signal, idle timeout, env-file allowlist). It doesn't import, vendor or shell out to Sandcastle. Dependencies aren't banned on principle, but nothing here calls for one.
- **Sandcastle is just a developer tool.** The human may use it to build the kernel, the same way they might use manual Harness sessions. That choice has no effect on Alpha: nothing in Alpha's code or config refers to Sandcastle, and removing any `.sandcastle/` scaffolding leaves Alpha working.
- **Consequences:** pre-1.0 churn upstream can't break Alpha. Harness-agnosticism becomes Alpha's own job, via a per-Harness adapter like Sandcastle's agent providers. Alpha can improve its whole engine itself, because the engine lives in its own repo.
- **Language moved out.** This session leaned towards Go as a single installable binary (Rust rejected as hard for the human to read). Go's costs then came up: possibly no Agent SDKs (unverified), and Workflows would have to be declarative config instead of scripts. So the language became its own ticket, "What Alpha is written in". Also noted: if the kernel is a CLI or daemon with a stable interface, a later TUI or macOS app can be written in any language, so the UI doesn't constrain the kernel's language.
