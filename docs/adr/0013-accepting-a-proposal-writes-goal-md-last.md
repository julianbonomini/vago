# Accepting a Proposal writes goal.md last

`vago plan accept <item>` turns a planning item whose Proposal is ready to accept into a ready Goal. It stages the Ticket files and `goal.md` in the item's `planning/accepting/`, moves the staged `tickets/` into the item's folder, then links `goal.md` into place last. A folder is a Goal once it has a `goal.md` (ADR 0010), so that link is the commit point: before it the folder is still a planning item, and after it the Goal and all its Tickets are there. The link fails when a `goal.md` already exists, so it never replaces one. A crash before the link leaves a planning item with a leftover `tickets/` and staging folder, and the next Accept removes both before it writes. Acceptance holds the folder's `running.lock`, the lock `vago run` takes, and checks again under it that the folder isn't a Goal yet, so two Accepts of one item can't interleave.

## Considered options

- **Write `goal.md` first.** A crash or a failed Ticket write would leave a ready Goal with some of its Tickets, which `vago run` and the TUI would treat as complete.
- **Build a whole new folder and rename it over the item.** The item's folder already holds `planning/`, which the Goal keeps, and a rename can't replace a folder that isn't empty.
- **No lock, only the exclusive link.** Each Accept stages in the same `planning/accepting/` and removes a leftover `tickets/`, so a second Accept could delete the staged files of the first, or the Tickets of a Goal the first had just committed.
- **Accept inside the TUI's process.** The TUI would write Goal and Ticket files, which ADR 0005 rules out, and would check the Workflow by name only, where `vago plan accept` loads it as `vago run` does.

## Consequences

- `running.lock` marks a planning item being accepted as well as a Goal being run, and also a planning item's response, rename or discard (ADR 0014). A Goal's refusal says "already being run or accepted", and a `vago run` of a Goal still being committed is refused for that moment. A planning item's refusal says a response is still being written, or another vago is changing the item.
- Accept is refused after an interrupted last response (ADR 0014).
- `vago plan accept` is the only way to accept. The TUI runs it in a process of its own and waits for it.
- An accepted Goal keeps its `planning/` folder. Its chat and Proposal stay readable, and `vago plan say`, `retry`, `workflow`, `rename` and `discard` refuse it.
- Accepting starts nothing; only `vago run` or the TUI's Start does.
