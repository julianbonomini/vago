# How warren keeps tickets (Seeds)

Research for ticket `08-where-punt-keeps-goals-and-tickets`. Question: how does warren keep its own lightweight ticket system, Seeds, and how does warren use it end to end? Beads is covered briefly for contrast.

Sources are the projects' own READMEs, specs, design docs and source code, read 2026-10-01 at these commits:

- Seeds: [jayminwest/seeds@8623af5](https://github.com/jayminwest/seeds/tree/8623af5e5322aa1fb9f0514bb478273d9d9feaf2) (v0.6.0)
- warren: [jayminwest/warren@8a439fe](https://github.com/jayminwest/warren/tree/8a439fe8e10f733865d8be0c7985d2b384eb76fd)
- Beads: [gastownhall/beads@6cd1184](https://github.com/gastownhall/beads/tree/6cd11846873228c3d83e064d4f45c96ad16a9a2f)

Links below use `main` for readability.

**Facts only.** This file reports what Seeds, warren and Beads do. It does not say what Punt should do. That decision belongs to the human (ticket 08).

## TL;DR

- **Storage.** Seeds is a Bun/TypeScript CLI (`sd`). Its whole database is JSONL files in a committed `.seeds/` directory in the repo: `issues.jsonl`, `plans.jsonl`, `templates.jsonl`, plus `config.yaml`. Each line is one issue: `id`, `title`, `status` (`open | in_progress | closed`), `type` (`task | bug | feature | epic`), `priority` 0-4, optional `description`, `assignee`, `labels`, `blocks`/`blockedBy`, `plan_id`, `closeReason`, `extensions` (opaque JSON for tools like warren), and ISO timestamps.
- **IDs** are `<project>-<4 random hex>`, checked against existing IDs. After 100 collisions they grow to 8 hex. Branch merges rely on random IDs, a `merge=union` gitattribute, and dedup-by-id on read where the last line wins.
- **`sd ready`** returns issues with `status == open` whose `blockedBy` IDs are all closed. There are plan-related exceptions. `--respect-schedule` also hides `extensions.queued === true` and future `extensions.scheduledFor`. Results are sorted by priority.
- **Concurrency.** Writes take an advisory lock file (`O_CREAT|O_EXCL`, 30 s stale, 100 ms retry with jitter, 30 s timeout) and do temp file + rename. `sd update --claim` is an atomic `open → in_progress` plus assignee, done under the lock.
- **warren's own repo replaced `merge=union`.** warren uses a custom 3-way id-keyed merge driver (`merge=seeds-jsonl`). The reason: Seeds rewrites rows in place, so union merges produced two contradictory copies of a row. warren also needs a GitHub workflow to heal PRs, because GitHub's server-side merge ignores custom drivers. The upstream bug, `seeds-6e2d`, is still open.
- **warren on the host never calls `sd ready` or `--claim`.** It shells out to `sd show/list/close/update --extensions/plan list/plan show --json` behind an `IssueTracker` seam (`getIssue`, `listIssueStatuses`, `closeIssue`, plus optional `listPlans`/`getPlan`, `mergeIssueMetadata`, `listScheduledIssues`).
- **How warren picks work.** It picks which seed to run from an explicit plan's ordered `children`, an explicit ordered list of IDs, a manual dispatch with a `seedId`, or a cron pass over `extensions.scheduledFor`. The agent prompt carries only the ID (default `work on sd {seed_id}`). The agent reads the issue itself with `sd` inside the sandbox.
- **Closing.** The agent is told to `sd close`. warren also closes the seed on the host as a safety net after a successful reap that pushed commits. For plan-run children, warren closes the seed with a bot commit on the default branch when the child PR merges. There is no "failed" status in Seeds. A failed run leaves the seed as it was, and the failure lives in warren's own run and plan-run records.
- **Foreign mirrors.** Seeds features turn on only if `.seeds/` exists in the repo. On repos you don't own they stay off. Prompt fragments that mention `sd` are gated on `hasSeeds && isGitNative`.
- **Size.** Seeds has about 11.7k lines of non-test TypeScript in 55 files (plus about 15.7k lines of tests) and 3 runtime dependencies (`commander`, `chalk`, `ajv`). Beads is Go on Dolt, with about 384k lines of non-test Go. Seeds' SPEC says it exists to replace Beads in the os-eco ecosystem: "no Dolt, no daemon, no binary DB files."

## 1. Storage

### Files and location

`.seeds/` sits at the repo root. Per the [README "On-Disk Format"](https://github.com/jayminwest/seeds#on-disk-format) and [`src/types.ts`](https://github.com/jayminwest/seeds/blob/main/src/types.ts):

```
.seeds/
  config.yaml          # project: <name>, version: "1" (+ optional max_plan_depth, plan_templates)
  issues.jsonl         # all issues, one JSON object per line
  plans.jsonl          # sd plan submit output
  templates.jsonl      # sd tpl templates
  .gitignore           # "*.lock"
```

The README says "No daemon, no binary DB files. **The JSONL file IS the database.**"

**Worktrees.** `findSeedsDir` walks up from cwd to find `.seeds/config.yaml`. Inside a linked git worktree it redirects to the main repo's `.seeds/` when that exists (`resolveWorktreeRoot` in [`src/config.ts`](https://github.com/jayminwest/seeds/blob/main/src/config.ts)). `sd sync` skips committing inside a worktree: "Issues are stored in the main repo." ([`src/commands/sync.ts`](https://github.com/jayminwest/seeds/blob/main/src/commands/sync.ts))

### Issue schema

From [`src/types.ts`](https://github.com/jayminwest/seeds/blob/main/src/types.ts):

```ts
export interface Issue {
  id: string;
  title: string;
  status: "open" | "in_progress" | "closed";
  type: "task" | "bug" | "feature" | "epic";
  priority: number;            // 0 Critical, 1 High, 2 Medium (default), 3 Low, 4 Backlog
  assignee?: string;           // also the claim holder
  description?: string;        // the body
  closeReason?: string;
  blocks?: string[];           // forward edges
  blockedBy?: string[];        // reverse edges; drives readiness
  labels?: string[];
  convoy?: string;             // template-pour grouping
  plan_id?: string;            // parent plan
  plan_step_index?: number;
  requires_plan?: boolean;     // hidden from ready until its sub-plan exists
  discoveredFrom?: string;     // provenance (sd create --from), never blocks
  intent?: string | string[];  // link to a "roots" idea id
  extensions?: Record<string, unknown>;  // opaque, consumer-owned (warren_*)
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}
```

Field-by-field answers to the brief:

| Asked for | Seeds field |
|---|---|
| id | `id` |
| title / body | `title` / `description` |
| status values | `open`, `in_progress`, `closed` |
| priority | `priority` 0-4. The CLI accepts `2` or `P2` |
| type | `task`, `bug`, `feature`, `epic` |
| dependencies / blockers | `blockedBy` and `blocks`, written in pairs by `sd dep add` / `sd block` |
| parent / epic | `plan_id` + `plan_step_index`. The plan row has `seed` (the parent issue) and ordered `children`. `type: epic` exists but has no special semantics in `ready` |
| labels | `labels` (normalized: lowercased, trimmed, deduped) |
| timestamps | `createdAt`, `updatedAt`, `closedAt` (ISO 8601) |
| assignee / claim | `assignee`. `--claim` sets it together with `in_progress` |

The Plan row has `id`, `seed`, `template`, `name`, `status` (`draft | approved | active | done`), `revision`, `sections`, `children[]`, `adoptedChildren[]`, `outcome`, `outcomeNote`, `reviewedBy`, `createdAt` and `updatedAt`.

### Sample records

A line from Seeds' own [`.seeds/issues.jsonl`](https://github.com/jayminwest/seeds/blob/main/.seeds/issues.jsonl), with blockers, labels and a plan link (the blocker list is shortened here):

```json
{"id":"seeds-045e","title":"pi-seeds extension audit follow-ups","status":"closed","type":"feature","priority":1,"createdAt":"2026-05-15T22:43:39.806Z","updatedAt":"2026-05-27T02:58:39.337Z","description":"Audit of the newly-shipped @os-eco/pi-seeds extension surfaced 12 findings ...","labels":["pi-extension","audit"],"plan_id":"pl-23f6","blockedBy":["seeds-f029","seeds-1bdd","seeds-6f43", "..."],"closedAt":"2026-05-27T02:58:38.835Z","closeReason":"Rolled back pi extension; see seeds-2f21"}
```

A minimal open issue:

```json
{"id":"seeds-c2c0","title":"sd guard: also catch Bash writes to .seeds/*.jsonl ...","status":"open","type":"task","priority":3,"createdAt":"2026-09-28T23:53:59.235Z","updatedAt":"2026-09-28T23:53:59.235Z"}
```

As of these commits, Seeds' own file has 257 lines and warren's [`.seeds/issues.jsonl`](https://github.com/jayminwest/warren/blob/main/.seeds/issues.jsonl) has 1,816.

### `extensions`

`extensions` is "runtime metadata owned by downstream consumers — e.g. warren's scheduling state and dispatch pointers. Seeds itself treats the value as opaque JSON". `sd update --extensions '<json>'` shallow-merges one level deep, and `--clear-extensions` drops the field. The convention is to namespace keys per consumer ([README "Extensions"](https://github.com/jayminwest/seeds#extensions)). warren writes `role`, `trigger`, `lastRunId`, `lastRunAt`, `scheduledFor` and `lastScheduledRun` through a strict zod schema ([`src/seeds-cli/warren-extensions.ts`](https://github.com/jayminwest/warren/blob/main/src/seeds-cli/warren-extensions.ts)).

## 2. IDs

[`src/id.ts`](https://github.com/jayminwest/seeds/blob/main/src/id.ts):

- Issues are `${prefix}-${4 hex}`. The prefix is the `project` value from `config.yaml` (for example `seeds-a1b2`, `warren-eeff`). The hex comes from `crypto.randomBytes`.
- Each new ID is checked against the set of existing IDs in the file. After 100 collisions the generator switches to 8 hex characters.
- Templates use `tpl-xxxx` and plans use `pl-xxxx` ([SPEC.md "ID Generation"](https://github.com/jayminwest/seeds/blob/main/SPEC.md)).
- SPEC says this "Matches beads' format for familiarity, eases migration."
- **Across branches:** nothing coordinates IDs. The collision check only sees the local file. Two branches that mint the same ID would collapse to one record under dedup-on-read (last line wins). The sources don't mention this case beyond the random-ID design. Older records in the repo have 3-character IDs (for example `seeds-0tk`), imported from Beads.

## 3. Readiness: what `sd ready` computes

`readyIssues()` in [`src/commands/ready.ts`](https://github.com/jayminwest/seeds/blob/main/src/commands/ready.ts) keeps an issue when:

1. `status === "open"`. `in_progress` and `closed` are excluded.
2. If `requires_plan === true`, its own sub-plan must exist and not be `draft`. Otherwise the issue is hidden.
3. If the issue's plan is in `draft`, the issue is ready **even if blocked**. The comment says "Planning is the highest-priority work".
4. Otherwise every ID in `blockedBy` must belong to an issue with `status === "closed"`.

After that, the command applies:

- Optional filters: `--type`, `--assignee`, `--label` (AND), `--label-any` (OR), `--unlabeled`, `--priority`, `--priority-max`.
- Optional `--respect-schedule`, which drops `extensions.queued === true` and an `extensions.scheduledFor` that parses to a future time.
- Sort by `--sort` (`priority` by default, or `created`, `updated`, `id`), then `--limit` (default 50).

`sd ready` does **not** look at `assignee`, so an open issue with an assignee is still ready. Claim works by moving the issue to `in_progress`.

`sd close` also removes the closed ID from `blockedBy` on every issue listed in the closed issue's `blocks`, and moves affected plans' status forward ([`src/commands/close.ts`](https://github.com/jayminwest/seeds/blob/main/src/commands/close.ts)).

## 4. Status lifecycle, and who changes it

From [SPEC.md](https://github.com/jayminwest/seeds/blob/main/SPEC.md):

```
open ──> in_progress ──> closed
  ^          │
  └──────────┘  (reopen via update --status=open)
```

- **Claim.** `sd update <id> --claim [--as <agent>]`. Inside the issues lock it fails unless `status == open` and the issue is unassigned or assigned to the same claimant. It then sets `status: in_progress` and `assignee`. The identity is `--as`, or `$USER` when `--as` is missing ([`src/commands/update.ts`](https://github.com/jayminwest/seeds/blob/main/src/commands/update.ts)).
- **Done.** `sd close <id...> [--reason]` sets `closed`, `closedAt` and `closeReason`.
- **Failed.** Seeds has no failed status.

Who changes status under warren:

| Actor | What it does | Source |
|---|---|---|
| Agent in the sandbox | Taught to `sd create`, `sd close` and `sd sync`, and to claim with `sd update --claim` (via `sd prime`, AGENTS.md, and the builtin `TRACKER_FRAGMENT`). Its `.seeds/` is the committed copy in the workspace clone | [`src/registry/builtins/prompt-fragments.ts`](https://github.com/jayminwest/warren/blob/main/src/registry/builtins/prompt-fragments.ts) |
| warren host, at reap | `mirrorSeeds` reads the workspace's `issues.jsonl`. It appends issues the agent created and takes closes that are newer by `updatedAt`. It ignores every other field change. `mirrorPlans` appends new plan rows only. `stageSeedsForCommit` then authors a `chore(warren): seeds state` commit for `issues.jsonl`/`plans.jsonl` | [`src/runs/reap/seeds.ts`](https://github.com/jayminwest/warren/blob/main/src/runs/reap/seeds.ts), [`src/runs/reap/stage.ts`](https://github.com/jayminwest/warren/blob/main/src/runs/reap/stage.ts) |
| warren host, safety net | A `post_reap` subscriber calls `tracker.closeIssue(run.seedId)` when outcome is `succeeded`, the branch was pushed, and `commitsAhead > 0`. The source says: "warren dispatches a run against a seed and expects the agent to `sd close` it on success. The safety net closes it host-side even when the agent forgot" | [`src/runs/reap/seed-close-lifecycle.ts`](https://github.com/jayminwest/warren/blob/main/src/runs/reap/seed-close-lifecycle.ts) |
| warren host, plan-run merge | When a plan-run child PR merges, warren fetches origin, makes a throwaway worktree off `origin/<default>`, runs `sd close`, and pushes a bot-identity commit to the default branch. Closing a seed that is already closed is a no-op | [`src/plan-runs/close-child-seed.ts`](https://github.com/jayminwest/warren/blob/main/src/plan-runs/close-child-seed.ts) |
| warren host, metadata | `sd update --extensions` writes dispatch pointers after each dispatch, and clears `scheduledFor` after a scheduled fire | [`src/seeds-cli/extensions.ts`](https://github.com/jayminwest/warren/blob/main/src/seeds-cli/extensions.ts), [`src/triggers/scheduled-pass.ts`](https://github.com/jayminwest/warren/blob/main/src/triggers/scheduled-pass.ts) |

- **Claiming.** The warren host source has no `--claim` call. `grep -- --claim src/` finds nothing outside builtin prompt text. warren tracks "this seed is being worked" in its own run and plan-run rows, not in Seeds status.
- **Failure.** On failure (dispatch error, missing seed, run failed) warren marks the plan-run child or plan-run `failed` in its own database, with a `failureReason` such as `child_seed_not_found:<id>` or `dispatch_failed:...`. It does not write a status to the seed ([`src/plan-runs/coordinator.ts`](https://github.com/jayminwest/warren/blob/main/src/plan-runs/coordinator.ts)).
- **Status vocabulary.** Inside warren, statuses fold to `open | closed | other`. Seeds' `in_progress` becomes `other` ([`src/core/wire-tracker.ts`](https://github.com/jayminwest/warren/blob/main/src/core/wire-tracker.ts)).
- **Restrictions on read-only agents.** Builtin `bugwatch`, `nightwatch` and `planner` prompts say: "Do not run sd close or sd update --status on issues you didn't create."

## 5. CLI surface

Every command takes `--json`. List-like commands also take `--format markdown|compact|plain|ids|json`. JSON success looks like `{ "success": true, "command": "create", "id": "..." }`. Errors look like `{ "success": false, "command": "...", "error": "..." }`. Global flags are `-q`, `--verbose` and `--timing`. Source: the [README "Commands"](https://github.com/jayminwest/seeds#commands), checked against [`src/commands/`](https://github.com/jayminwest/seeds/tree/main/src/commands).

**Issues**

| Command | What it does |
|---|---|
| `sd init` | Create `.seeds/` (and add `merge=union` lines to `.gitattributes`) |
| `sd create --title …` | New issue (`--type`, `--priority`, `--description`, `--assignee`, `--from <id>`, `--intent`) |
| `sd show <id…>` | Show one or more issues |
| `sd list` | List with filters (`--status`, `--type`, `--assignee`, `--label`, `--priority`, `--limit`, `--all`, `--sort`) |
| `sd ready` | Open, unblocked issues (see §3) |
| `sd search <q>` | Case-insensitive substring search on title + description |
| `sd update <id>` | Change fields. `--claim [--as]` for an atomic claim. `--extensions` / `--clear-extensions` |
| `sd close <id…>` | Close (`--reason`) |
| `sd dep add/remove/list` | Manage dependencies |
| `sd block <id> --by <b>` / `sd unblock <id> --from <b>` (`--all`) | Add or remove a blocker |
| `sd blocked` | List blocked issues |
| `sd label add/remove/list/list-all` | Labels |
| `sd stats` | Project statistics |
| `sd sync` | `git add .seeds/` and commit (`--status`, `--dry-run`). Skipped inside a worktree |

**Plans:** `sd plan templates`, `sd plan prompt <seed>` (emits planning-prompt JSON), `sd plan submit <seed> --plan <file>` (validates the plan, spawns child seeds, wires `blockedBy` from `steps[].blocks`), `sd plan show`, `validate`, `list`, `create` (adopt-only plan), `adopt`, `reorder`, `release`, `edit`, `outcome --result success|partial|failure`, `review --by`.

**Templates:** `sd tpl create`, `tpl step add`, `tpl list`, `tpl show`, `tpl pour` (creates issues where step N+1 is blocked by step N), `tpl status` (progress of a "convoy").

**Health and config:** `sd doctor [--fix]`, `sd config schema|show|set|unset`.

**Agent integration:** `sd prime`, `sd onboard`, `sd setup claude`, `sd guard`.

**Utility:** `sd upgrade`, `sd completions <shell>`, `sd migrate-from-beads`.

### How agents are taught

- **`sd prime`** ([`src/commands/prime.ts`](https://github.com/jayminwest/seeds/blob/main/src/commands/prime.ts)) prints workflow context plus live state: in-progress issues and the top ready issues. `--compact` gives a short version and `--json` gives typed `sections` + `state`. A repo-local `.seeds/PRIME.md` replaces the built-in text. The built-in rules include "Track durable work in seeds … not markdown task files", "Claim before starting: `sd update <id> --claim`", and "Never hand-edit `.seeds/*.jsonl`". It also prints a close checklist: close the issues, file the remaining work with `--from`, run the gates, then `sd sync`.
- **`sd onboard`** ([`src/commands/onboard.ts`](https://github.com/jayminwest/seeds/blob/main/src/commands/onboard.ts)) writes a versioned `seeds:start`/`seeds:end` section into CLAUDE.md / AGENTS.md: "Run `sd prime` at session start … or run `sd setup claude` once to do it automatically."
- **`sd setup claude`** installs Claude Code hooks: SessionStart runs `sd prime --compact`, and PreToolUse runs `sd guard`. `sd guard` denies Write/Edit/MultiEdit/NotebookEdit on `.seeds/*.jsonl` and names the `sd` command to use instead ([`src/commands/guard.ts`](https://github.com/jayminwest/seeds/blob/main/src/commands/guard.ts)).
- **warren** installs `@os-eco/seeds-cli@0.5.13` in its agent image ([`deploy/docker/Dockerfile.agent`](https://github.com/jayminwest/warren/blob/main/deploy/docker/Dockerfile.agent)). It adds this gated prompt fragment: "/workspace/.seeds/issues.jsonl holds the project's issue queue. The `sd` CLI manages it (`sd ready`, `sd create`, `sd close`, `sd sync`); see AGENTS.md for the workflow." warren's repo also ships a `seeds-issue-audit` skill under `.agents/skills/` and `.claude/skills/`.

## 6. Grouping and how warren picks work

**Grouping in Seeds** works on three levels:

- `type: epic`, which is only a label.
- **Plans**: a `plans.jsonl` row anchored to a parent seed, with ordered `children`. Children get `plan_id`, and the parent seed's description gets a `seeds:plan-backref` block. Plans can nest via `plan_template` up to `max_plan_depth` (default 3).
- **Template convoys**, made by `sd tpl pour`.

There is no separate "goal" entity. Plan details are in [PLAN_SPEC.md](https://github.com/jayminwest/seeds/blob/main/PLAN_SPEC.md).

**Plan status is automatic.** `sd close` calls `applyPlanTransitions` on affected plans.

**How warren picks which seed to run.** warren does not poll `sd ready`. Work reaches an agent by four routes:

1. **Plan-run** (`POST /plan-runs` with `planId`). The plan must be `approved | active | done` and have at least one open child. warren runs the children **serially in `plan.children` order** (`seq = index + 1`), gated on each child's PR merging. Closed children are skipped. The Seeds README says: "warren's plan-run consumes `plan.children` order verbatim … so `reorder` is the surface for guaranteeing the release seed runs last." Sources: [`src/plan-runs/create.ts`](https://github.com/jayminwest/warren/blob/main/src/plan-runs/create.ts), [`coordinator.ts`](https://github.com/jayminwest/warren/blob/main/src/plan-runs/coordinator.ts).
2. **Ordered issue list** (`POST /plan-runs` with `issues: [id, …]`). The same serial walk without a plan, for trackers that can't group issues ([docs/design/issue-tracker.md §4](https://github.com/jayminwest/warren/blob/main/docs/design/issue-tracker.md)).
3. **Manual dispatch** (`POST /runs` with `seedId`). The ID is validated through `tracker.getIssue` first ([`src/server/handlers/runs/dispatch.ts`](https://github.com/jayminwest/warren/blob/main/src/server/handlers/runs/dispatch.ts)).
4. **Cron tick.** `listScheduledIssues` returns open seeds with a parseable `extensions.scheduledFor`. Past-due ones are dispatched to `defaultRole` from `.warren/config.yaml`. Afterwards warren writes `{scheduledFor: null, lastScheduledRun, …}` back ([`src/triggers/scheduled-pass.ts`](https://github.com/jayminwest/warren/blob/main/src/triggers/scheduled-pass.ts), [`src/triggers/dispatch.ts`](https://github.com/jayminwest/warren/blob/main/src/triggers/dispatch.ts)).

There is also an **auto-plan-run**, which re-dispatches a plan when a PR merges. It requires `isGitNative && supportsPlans` ([`src/runs/reap/auto-plan-run.ts`](https://github.com/jayminwest/warren/blob/main/src/runs/reap/auto-plan-run.ts)).

## 7. Git, merging and concurrency

**Committed.** `.seeds/*.jsonl` and `config.yaml` are committed. Only `*.lock` is gitignored. `sd sync` commits `.seeds/`. warren commits `issues.jsonl`/`plans.jsonl` on the agent's branch at reap (`chore(warren): seeds state`), and pushes plan-child closes straight to the default branch.

**Seeds' design: `merge=union` + dedup-on-read.** `sd init` adds `.seeds/issues.jsonl merge=union` (and the same for templates and plans) to `.gitattributes`. `readIssues` parses every line, skips malformed ones, and keeps the **last occurrence per `id`** (`deduplicateById` in [`src/store.ts`](https://github.com/jayminwest/seeds/blob/main/src/store.ts)). The README says: "two branches that update `extensions` on the same issue collapse via `merge=union` + dedup-on-read (last-occurrence wins). Consumers needing strict ordering should serialize through a single agent."

**Writes rewrite the file.** `create` appends a line (temp file + rename). `update`, `close` and `dep` rewrite the whole file through `writeIssues`. Closing an issue also rewrites the rows it blocked.

**warren's repo does not use `merge=union`.** Its [`.gitattributes`](https://github.com/jayminwest/warren/blob/main/.gitattributes) says:

> The seeds and mulch state files are id-keyed JSONL whose writers REWRITE rows in place (closing an issue rewrites its row and every sibling's blockedBy …). merge=union therefore emitted two contradictory copies of any concurrently rewritten row (warren-9c90). merge=seeds-jsonl runs scripts/merge-seeds-jsonl.ts, a real 3-way id-keyed merge

- **The driver.** [`scripts/merge-seeds-jsonl.ts`](https://github.com/jayminwest/warren/blob/main/scripts/merge-seeds-jsonl.ts) is 288 lines and is registered by the `prepare` script. It merges per field against the ancestor. For array fields it applies both sides' additions and removals. `updatedAt` resolves to the later timestamp. Real conflicts get git conflict markers, which a lint gate (`check:seeds-integrity`) refuses.
- **The GitHub workaround.** GitHub's server-side merge does not run custom drivers, so PRs touching `.seeds` show CONFLICTING. A workflow, [`seeds-merge-autoheal.yml`](https://github.com/jayminwest/warren/blob/main/.github/workflows/seeds-merge-autoheal.yml), redoes the merge with the driver and pushes the result to the PR branch.
- **The doctor trap.** `sd doctor --fix` / `sd init` re-append union lines, which silently override the driver, so warren added `check:merge-strategy`.
- **Upstream status.** The bug is filed as [`seeds-6e2d`](https://github.com/jayminwest/seeds/blob/main/.seeds/issues.jsonl): "init/doctor ship merge=union for issues.jsonl and plans.jsonl, which silently corrupts them on concurrent edits". It was "Reproduced six times in one session while running a 19-child plan through concurrent agents". It is still open at this commit.

**Locking for writers on the same machine** ([`src/store.ts`](https://github.com/jayminwest/seeds/blob/main/src/store.ts), README "Concurrency"):

- Each data file has a lock file `<file>.lock`, created with `openSync(lock, "wx")` (`O_CREAT|O_EXCL`).
- A lock is stale after 30 s. Stale locks are reclaimed by an atomic rename to a sidecar plus an inode/mtime check, so a fresh lock can never be deleted by mistake.
- Retry waits 100 ms + up to 100 ms jitter. Timeout is 30 s.
- Writes go to a temp file and then `rename`.
- Lock order is plans (outer), then issues (inner), for commands that touch both.
- Inside worktrees, `sd` resolves to the main repo's `.seeds/`, so agents in worktrees of the same clone share one file and one lock.
- warren's sandboxed agents work on their own clone. warren merges their changes on the host through `mirrorSeeds` (new issues + newer closes only) and git, not through the lock.

## 8. warren end to end

**The seam** ([`src/tracker/contract.ts`](https://github.com/jayminwest/warren/blob/main/src/tracker/contract.ts), [docs/design/issue-tracker.md](https://github.com/jayminwest/warren/blob/main/docs/design/issue-tracker.md)):

```ts
interface IssueTracker {
  readonly capabilities: TrackerCapabilities; // supportsPlans, supportsMetadata, supportsScheduledIssues, isGitNative
  getIssue(ctx, issueId): Promise<Issue>;               // throws IssueNotFoundError
  listIssueStatuses(ctx): Promise<Map<string, IssueStatus>>;
  closeIssue(ctx, issueId): Promise<void>;              // idempotent
}
// optional capability interfaces:
PlanCapableTracker.listPlans(ctx) / getPlan(ctx, planId)
MetadataCapableTracker.mergeIssueMetadata(ctx, issueId, metadata)  // shallow merge, null clears
ScheduledIssueCapableTracker.listScheduledIssues(ctx)
```

- **The neutral `Issue`** has `id`, `status` (`open|closed|other`), `title?`, `description?`, `blockedBy?` and `metadata?`.
- **The design rule:** "No domain module may name seeds, `sd`, `.seeds/`, or a seeds CLI envelope."
- **`SeedsTracker`** maps `getIssue` to `sd show <id> --json` and `listIssueStatuses` to `sd list --format json`. It maps `closeIssue` to `sd close`, `listPlans`/`getPlan` to `sd plan list/show --json`, and `mergeIssueMetadata` to `sd update --extensions`. `listScheduledIssues` is built from `sd list`. All capabilities are true, and the CLI runs with `cwd` set to the host clone (`ctx.localPath`).
- **`RemoteTracker`** speaks HTTP `warren-tracker/v1` to an extension container (Jira and ADO extensions exist). Agents never reach it directly, because the sandbox has no network ("The sandbox stays `network: none`").

**How a task reaches the agent:**

- **Plan runs.** The prompt is a template with `{seed_id}` substituted. The default is `"work on sd {seed_id}"` ([`src/core/plan-run-prompt.ts`](https://github.com/jayminwest/warren/blob/main/src/core/plan-run-prompt.ts)).
- **Scheduled seeds.** The prompt is `defaultPrompt` from config, or `Work on seed <id> (<title>).`
- **Seed content.** The title and description are not inlined by these paths. The agent reads them itself with `sd show` from the committed `.seeds/` in its workspace clone.
- **Other prompt parts.** The prompt is assembled as `<agent system section> --- <repoContext> --- <task>`. The tracker fragment is included only when gated on.
- **Run records.** warren stores `runs.seed_id`. The PR title/body step reads the seed title through `getIssue` ([`src/runs/reap/pr-context.ts`](https://github.com/jayminwest/warren/blob/main/src/runs/reap/pr-context.ts)).

**Repos you don't own** ([docs/onboarding-external-repos.md](https://github.com/jayminwest/warren/blob/main/docs/onboarding-external-repos.md)):

- The doc's limit: "No in-repo `.seeds/` / `.mulch/`. Those features activate on directories inside the project repo. On a foreign mirror they stay off unless you own a fork that carries them."
- The gating: the project row's `hasSeeds` is a probe for `.seeds/` in the host clone ([`src/projects/capabilities.ts`](https://github.com/jayminwest/warren/blob/main/src/projects/capabilities.ts)). Prompt fragments gate on `hasSeeds && tracker.capabilities.isGitNative` ([`src/runs/spawn/prompt-capabilities.ts`](https://github.com/jayminwest/warren/blob/main/src/runs/spawn/prompt-capabilities.ts)). "A mirror of an external repo runs tracker-clean without editing agent definitions."
- Plan-runs: on a git-native tracker without `.seeds/` they are refused with `ProjectLacksTrackerError`.
- The cron pass treats "Not in a seeds project" as a stable state and rate-limits the notice.
- What to use instead on a mirror: a `repoContext` in an untracked host-clone `.warren/config.yaml`, for example "There is no issue tracker here — take the task statement in the prompt as the whole spec".

## 9. Size

| | Seeds | Beads |
|---|---|---|
| Language / runtime | TypeScript on Bun (`engines.bun >= 1.0.0`). The `bin` points straight at `src/index.ts`, with no build step | Go, with Dolt embedded |
| Non-test source | ~11,660 lines in 55 files under `src/` (counted with `wc -l`) | ~384,000 lines of non-test `.go` |
| Tests | ~15,670 lines | — |
| Runtime deps | 3: `commander`, `chalk`, `ajv` ([`package.json`](https://github.com/jayminwest/seeds/blob/main/package.json)) | 272 `go.mod` lines |
| Storage engine | JSONL text files | Dolt SQL database |

The core store (lock + JSONL read/write + dedup) is [`src/store.ts`](https://github.com/jayminwest/seeds/blob/main/src/store.ts), about 250 lines. Much of the remaining size is the plan system (`plan*.ts`), output formatting and `doctor`. [SPEC.md](https://github.com/jayminwest/seeds/blob/main/SPEC.md) still says "Zero runtime dependencies. Bun built-ins only", which no longer matches `package.json`.

## 10. Beads, for contrast

Sources: [README](https://github.com/gastownhall/beads#readme), [docs/CLI_REFERENCE.md](https://github.com/gastownhall/beads/blob/main/docs/CLI_REFERENCE.md), [docs/core-concepts/](https://github.com/gastownhall/beads/tree/main/docs/core-concepts), [`internal/types/types.go`](https://github.com/gastownhall/beads/blob/main/internal/types/types.go).

- **Storage.** A Dolt database. In embedded mode (the default) it lives at `.beads/embeddeddolt/` with a single writer. Server mode (`bd init --server`) uses `.beads/dolt/` with concurrent writers. Sync between machines is `bd dolt push/pull` against `refs/dolt/data` on the git remote. The README says "`.beads/issues.jsonl` is an export for viewers and interchange, not the source of truth or a backup". `--stealth` keeps it out of the repo, and `--contributor` routes issues to a separate repo.
- **Statuses:** `open`, `in_progress`, `blocked`, `deferred`, `closed`, `pinned`, `hooked`, plus custom statuses.
- **Dependency types.** `blocks`, `parent-child`, `conditional-blocks` and `waits-for` affect readiness. `related` and `discovered-from` don't. Graph links include `relates-to`, `duplicates`, `supersedes` and `replies-to`.
- **IDs.** Hash IDs (`bd-a1b2`). Epics use hierarchical IDs (`bd-a3f8.1`, `bd-a3f8.1.1`).
- **`bd ready`:** "open issues with no active blockers. Excludes in_progress, blocked, deferred, and hooked issues." It filters by assignee, label, type, metadata and `defer_until`. `--claim` atomically claims the first ready issue and `--explain` shows the reasoning.
- **CLI.** About 109 top-level `bd` commands are documented. Agent onboarding uses `bd prime`, `bd onboard`, and `bd setup claude|codex|factory|cursor|…`, and `bd init` writes AGENTS.md by default. There are also molecules/wisps (workflow templates), messaging, compaction ("memory decay") and `bd remember`.
- **Why Seeds exists alongside it** ([Seeds SPEC.md "Why"](https://github.com/jayminwest/seeds/blob/main/SPEC.md)): Seeds "Replaces beads in the overstory/mulch ecosystem with something purpose-built: no Dolt, no daemon, no binary DB files." SPEC lists these problems with Beads:
  - a "2.8MB binary `beads.db` … that can't diff or merge in git"
  - "286 export-state tracking files"
  - pre-commit hook failures
  - "multiple agents fighting over `beads.db` lock"
  - a "Dual source of truth"

  It adds: "Overstory uses ~7 beads operations on a simple data model. Seeds covers exactly that surface." `sd migrate-from-beads` imports `.beads/issues.jsonl`.
