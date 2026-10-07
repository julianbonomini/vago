# A planning item is a Goal folder without goal.md

A planning item lives in `.vago-goals/<name>/`, the folder its Goal will have, as a `planning/` folder with no `goal.md` beside it. `tickets/` owns it like the Goals: `listGoals` passes over it, `listPlanningItems` lists it, and `vago plan new`, `vago plan rename` and `vago plan discard` make, rename and remove it. Its name is a Goal name, checked the same way, and no Goal or planning item may share it. Renaming moves the folder; discarding removes it with everything in it, and is refused for a folder that has a `goal.md`.

Everything planning saves goes under `planning/`. Accepting its Proposal writes `goal.md` and `tickets/` beside it, so the folder turns into a Goal whose planning stays with it, and nothing has to move or point across folders.

## Considered options

- **A folder of its own, like `.vago-goals/.planning/<id>/`, named by a stable id with the name in a file.** Renaming would change one field, but acceptance would have to move the planning history into the Goal's folder or leave a link to it, and a Goal named after a planning item could collide with it.
- **A file marking the item, like `planning/item.toml`.** It has nothing to hold yet: the name is the folder's, and the folder is enough to tell a planning item from a Goal.

## Consequences

- A planning item's name is the Goal's folder name, so it takes only letters, digits, `-` and `_`.
- Renaming moves the folder. Anything that later keeps a planning item's path while it works, such as an agent's response in progress, has to refuse a rename or follow the move. A response holds the item, so a rename is refused during it, and a discard stops it first (ADR 0014). Neither leaves a folder behind.
- Accepting writes `tickets/` and then `goal.md`, last (ADR 0013). From then on the planning chat is read-only: `vago plan say`, `retry`, `workflow`, `rename` and `discard` refuse the Goal.
- `vago goal new` on a planning item's name writes `goal.md` into its folder, which turns it into a Goal with its planning kept.
