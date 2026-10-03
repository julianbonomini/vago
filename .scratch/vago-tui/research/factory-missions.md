# Factory Missions and Mission Control

Research into Factory's Missions feature and its terminal view, Mission Control, as input for a Vago TUI. Gathered 2026-10-03.

Statements marked **(inferred)** are my reading of the evidence and do not appear in a source. Everything else carries a link.

## Sources

Primary, from Factory:

- [S1] Product page: https://factory.com/product/missions
- [S2] Launch post "Introducing Missions": https://factory.com/news/missions. The page header reads "February 26, 2025", but the launch tweets [S9] and the changelog [S8] put the launch on 2026-02-26, so the year on the page looks like a typo.
- [S3] "How Missions Work" (Theo Luan, April 10, 2026): https://factory.com/news/missions-architecture
- [S4] Docs, overview: https://docs.factory.com/missions/overview (also at https://docs.factory.com/cli/features/missions)
- [S5] Docs, Planning & Validation: https://docs.factory.com/missions/planning
- [S6] Docs, Running in the CLI: https://docs.factory.com/missions/running-cli
- [S7] Docs, Running in the Factory App: https://docs.factory.com/missions/running-app
- [S7b] Docs, Configuration & Reference: https://docs.factory.com/missions/reference
- [S7c] Docs, Interaction Modes: https://docs.factory.com/autonomy-and-safety/specification-mode
- [S7d] Docs, CLI Quickstart (Essential controls table): https://docs.factory.com/cli/getting-started/quickstart
- [S7e] Docs, CLI Reference (keyboard shortcuts): https://docs.factory.com/droid-cli/cli-reference
- [S8] Changelog: https://docs.factory.com/changelog/release-notes
- [S9] Launch thread on X, 2026-02-26: https://x.com/FactoryAI/status/2027104794289263104, https://x.com/FactoryAI/status/2027104816405811694 (the Mission Control screenshot), https://x.com/FactoryAI/status/2027104899583066300, https://x.com/FactoryAI/status/2027104931086512440
- [S10] X post, 2026-06-10, Missions in CLI/Web/Desktop and on Droid Computers: https://x.com/FactoryAI/status/2064764847393534031
- [S11] Screenshot `mission-control.webp`, the CLI view, used by [S4], [S2] (as `/static/mission-control-7a5684.png`) and [S9]: https://docs.factory.com/docs-assets/images/mission-control.webp
- [S12] Screenshot `mission-web.webp`, the Factory App view: https://docs.factory.com/docs-assets/images/mission-web.webp

Secondary:

- [S13] Reverse-engineered orchestrator and worker prompts, taken with mitmweb from factory-cli 0.84.0 on 2026-03-25: https://gist.github.com/V1ki/356b121038722ebf32b5aac85482c113. Not from Factory and possibly stale, but it is the only source for the on-disk artifacts and the orchestrator's tool contracts. Treat it as evidence, not documentation.
- [S14] GitHub issue, `droid exec --mission` does no work: https://github.com/Factory-AI/factory/issues/2

I found no Hacker News thread about Missions, and no launch video that shows the TUI. The launch videos (`/videos/missions-hero.mp4` on [S2] and the clips in [S9]) are motion graphics: an orchestrator glyph, "Feature 1 / Worker" boxes with orange check badges, "Validator / Checking..." boxes, and words like "Execute." on a dark grid. They show no terminal frames. The only images of the actual UI are the two screenshots [S11] and [S12].

## 1. Concept model

### Factory's concepts

- **Mission.** A bounded, multi-feature project with a clear outcome. You start one with `/missions` (or `/mission`, or `/enter-mission` in the launch post) [S4][S2]. The heuristic sweet spot is about 1 to 500 features; above that, split it into several Missions [S4].
- **Mission Mode.** The session state Droid enters once you approve a plan, alongside Normal and Spec mode. It is not part of the Shift+Tab mode cycle [S7c].
- **Planning phase.** A back-and-forth conversation in which Droid asks clarifying questions and probes for constraints. Factory calls it "where most of the value comes from" [S2][S5]. It produces a proposal that the user approves [S4]. Per [S13], the orchestrator calls a `ProposeMission` tool with `title`, a markdown `proposal`, and `workingDirectory`, and a changelog entry mentions "Mission approvals ... proposal body now renders once during approval" [S8, July 23, 2026].
- **Validation contract.** "A finite checklist of testable behavioral assertions that define completion and correctness", written before any features exist ("mission-level TDD") [S3]. Example IDs look like `VAL-AUTH-001`, each with a Tool and an Evidence line [S3].
- **Milestone.** "A meaningful checkpoint" that groups features. Every milestone ends in a validation phase [S2][S4]. Milestones set how often validation runs [S5]. Once a milestone's validators pass it is "sealed" and takes no new features; follow-up work goes into a new milestone [S13].
- **Feature.** The unit of work. Each one gets a fresh worker with clean context [S2]. Per [S13], `features.json` is an ordered array whose entries have `id, description, skillName, milestone, preconditions[], expectedBehavior[], verificationSteps[], fulfills[] (contract assertion IDs), status`. Status is `pending`, `completed` or `cancelled`. Array order is execution order: "the topmost pending feature runs next". There are no explicit dependency edges; `preconditions` is prose. The product page does say plans have "dependencies, ordering" [S1].
- **Orchestrator.** An LLM agent that "plans and decomposes", "steers execution", and delegates every investigation and implementation step [S3]. You can talk to it, pause it, and redirect it [S4][S6].
- **Runner.** "A programmatic runner takes the feature list and spawns a worker for each feature in order" [S3]. Per [S13], the orchestrator's `StartMissionRun` tool blocks while the runner executes workers one after another. It returns when a handoff has actionable items, when the user pauses, or when all features are done.
- **Worker.** A fresh session for one feature. It writes tests first, implements, commits, and returns a structured handoff [S3][S13]. Workers cannot ask the user anything or spawn mission tools; they run in exec mode [S13].
- **Handoff.** The structured result of a worker: `successState`, `discoveredIssues`, `whatWasLeftUndone`, `returnToOrchestrator`, and a `handoffFile` path [S13]. The orchestrator has to act on each item or dismiss it with a justification (`DismissHandoffItems`) [S13]. "Handoff items dismissed" appears as an event in the Progress Log [S11].
- **Validators.** Fresh agents that the system injects when a milestone's features finish. A **scrutiny validator** runs tests, typecheck and lint, and reviews each feature. A **user-testing validator** exercises the app as a black box against the contract [S3][S13]. They report problems but fix nothing; the orchestrator writes "fix features" and the milestone re-validates until it passes [S3]. Either kind can be skipped (`skipScrutiny`, `skipUserTesting`) [S7b].
- **Skills.** Worker procedures, reused from your setup or written during planning [S4]. Each feature names one (`skillName`); per [S13] they live at `.factory/skills/{worker-type}/SKILL.md`. The orchestrator also turns codebase patterns into reusable skills [S2][S9].
- **Shared state.** "The validation contract, the feature list, research notes, operational guidelines, and an evolving knowledge base" [S3]. Per [S13]: `mission.md`, `validation-contract.md`, `validation-state.json`, `features.json` and `AGENTS.md` live in a `missionDir`, while `.factory/services.yaml`, `.factory/init.sh`, `.factory/library/` and the skills live in the repo. Changelog: "Files related to Missions now live together under `~/.factory`" [S8, April 22, 2026].
- **Models per role.** Orchestrator, worker, validator and research roles each get their own model, for example Opus 4.6, Sonnet/Opus 4.6, GPT-5.3-Codex and Kimi K2.5 at launch [S2]. These are configurable in settings and flags [S7b].
- **Droid / custom droids.** Droid is Factory's own agent harness. "Custom droids" are subagents that workers can use [S7b].
- **Droid Computer.** A persistent remote machine you can choose as a mission's target [S7].
- **Human role.** "Project manager": monitor, unblock, redirect [S2][S6]. The orchestrator halts and "hands control back to the user" when it is blocked [S3]. Per [S13], the triggers include needing human action, a judgment call, a dead external dependency, unclear requirements, scope beyond what was agreed, or a boundary change.

### Mapping to Vago

| Factory | Vago | Notes |
|---|---|---|
| Mission | **Goal** | One outcome, planned up front, run until done. Factory states no rule of one PR per mission; git is "source of truth" and every worker commits [S2][S13]. |
| (none) | **Mission** (several Goals) | Factory has nothing above a Mission. Over about 500 features it says to split the work into several Missions [S4]. |
| Milestone | (none) | A checkpoint inside the plan that gates validation and is sealed after it passes. The closest Vago analogue would be a group of Tickets inside a Goal with a validation gate. |
| Feature | **Ticket** | Factory orders features in an array; Vago uses `blocked_by` edges. Feature fields worth a look: `preconditions`, `expectedBehavior`, `verificationSteps`, `fulfills`. |
| Worker session | **Run** | One fresh agent session for one feature. Workers commit their own work [S13]. |
| Skill (`skillName` per feature) | **Workflow** (loosely) | A Factory skill is the procedure one worker follows. A Vago Workflow is a sequence of Steps, so a Workflow spans more than one session. |
| Validator (scrutiny, user-testing) | shell or agent **Steps** (partly) | Factory validates per milestone in separate sessions that the system injects. Vago validates per Ticket, inside its Workflow. |
| Runner (programmatic, sequential) | `vago run <goal>` | Both walk the work list without an LLM in the loop [S3]. |
| Orchestrator (LLM) | (none) | Vago has no agent that re-plans, writes fix work, or triages handoffs mid-Goal. |
| Handoff (structured worker report) | Run outcome and log | Factory's handoff is typed (issues, unfinished work, return-to-orchestrator). |
| Validation contract and `validation-state.json` | (none) | Assertions defined before features; each feature claims assertions. |
| Planning conversation, then `ProposeMission`, then approve | Goal planning session | Factory runs planning and execution in the same session and the same TUI. |
| Droid (Factory's harness), model per role | **Harness** (Claude Code / Codex) | Factory sets a model for each role. |
| Progress Log events | Run stream-json logs | Factory shows a summarized event feed, not raw streams (see §2). |
| Droid Computer, cloud containers | (none) | Remote execution target. |
| `features.json`, `mission.md`, etc. | Ticket Markdown with TOML headers | Both keep state in files. Factory's files are JSON and Markdown under `~/.factory` and `.factory/`. |

Factory has these and Vago does not: milestones with sealed validation gates, an LLM orchestrator that writes fix features, a validation contract, typed handoffs with forced dismissal, models per role, research subagents, remote targets, and a cost and duration estimate (`total runs ≈ #features + 2 * #milestones`, "a floor rather than a ceiling") [S5].

Vago has these and Factory does not: a Mission that groups Goals, an explicit `blocked_by` DAG, user-defined Workflows with shell Steps, one PR per Goal, and a choice of external Harness.

On parallelism: Factory says "Serial execution with targeted parallelization has worked better than broad parallelism", and it parallelizes "within features and during validation" [S2]. The runner spawns workers one after another [S3][S13], and parallelism is still listed as an open question [S4].

## 2. The TUI: Mission Control in the CLI

### How you get there

- `/missions` opens "the Missions menu" [S7d]. Since April 2, 2026 it has been a "Unified /missions menu ... with model tabs and improved navigation" [S8]. A mission picker filters as you type [S8, July 28, 2026]. Entering prompts a warning if another mission is already running [S8, Feb 26, 2026].
- Planning happens in the ordinary Droid chat. The orchestrator asks questions (it has an `AskUser` tool) and then presents a proposal for approval [S4][S13]. Since Feb 19, 2026 you can pause during planning and resume "in-context ... in Mission Control view" [S8].
- After approval, "Droid enters Mission Control, the orchestration view" [S6].
- **Ctrl+T** toggles "the Mission Control overlay (orchestrator sessions only)" [S7d][S7e][S8, Mar 16, 2026]. **(inferred)** Mission Control is a full-screen overlay on top of the orchestrator chat, not a separate program. Ctrl+T switches between the chat, where you type to the orchestrator, and the dashboard.

### Layout of the screenshot [S11]

The screenshot shows a macOS Terminal window titled `ultramarine — -zsh — 80x24`. The title says 80x24, but the content is far wider, so the screenshot was probably staged. Monospace font, near-black background, light grey text, one orange-amber accent color, thin grey box borders between panes. From top to bottom:

1. **Header line.** An orange three-dot glyph and orange `Mission Control`, then the project path `~/local/ultramarine/apps` in dim grey. On the right, dot-separated stats: `Time 32h 12m · Input 3.0K · Cached 221.1M · Output 1.3M`. Labels are dim and values bright. The stats are token counts, not dollars. Later changelog entries add a per-worker token breakdown, subagent tokens, and an optional "Factory token usage" toggle [S8, Apr 2, May 11, 2026].
2. **Status and progress bar.** An orange dot and orange `RUNNING`, then a full-width bar drawn in a dotted or dithered texture: dense orange for the done part, grey dots for the rest. On the right, `16/22` with the done count bright and the total dim.
3. **Main area, split into two columns** (about 60/40):
   - **Left: "Active Feature"**, followed by the feature id `user-testing-validator-window-os-actions`. Below it, key/value lines with dim keys: `skill user-testing-flow-validator` and `milestone window-os-actions`. Then a **Preconditions** list and an **Expected Behavior** list with `·` bullets, the latter truncated with `+4 more`. Then the feature description as an indented block with a grey vertical bar on its left, like a blockquote. These are the fields of a `features.json` entry.
   - **Right top: "Features"** with `16/22` on the right. A flat list of feature ids with no milestone headers. Done items have a green-grey `✓` and dim text. The current item has a filled `●` and is highlighted with an inverted light-grey bar (dark text). Pending items have a hollow `○`. Validator features appear in the list in execution order, e.g. `scrutiny-validator-window-os-actions` followed by `user-testing-validator-window-os-actions`.
   - **Right bottom: "Progress Log"** with a pager count `1-12 of 124`. Two columns: a relative time (`8h ago`, `7h ago`) and an event line, cut off at the pane edge. The event vocabulary seen: `Run started: <summary>`, `Worker #91808914 started [github-actions-…]`, `Worker #… completed [...]`, `Milestone validation: ci-e2e`, `Handoff items dismissed`, `Run started: CI scrutiny passed. Continui…`. Worker ids are short hex hashes. **(inferred)** "Run started" lines mark each `StartMissionRun` call by the orchestrator, carrying the orchestrator's one-line reason.
4. **Bottom pane: "Active Worker"**, followed by `#18` and the feature id, with `Time 8m 36s` on the right. It shows a live, condensed tool-call stream from the worker. Each line has a bold verb and an argument: `Execute cd … && bash .factory/init.sh …`, then an indented dim `✓ All dependencies installed. Playwright browsers verified. Environment ready.` (a one-line result summary), then `Read src/main/window-manager.ts (142 lines)`, with the line count in dim parentheses. Assistant prose lines start with the orange three-dot glyph: `Running the window state persistence tests first:`.
5. **Footer key hints**, with the key bright and the label dim: `F Features   W Workers   M Models   R Resume   Tab Next View   Ctrl+G Back To Orchestrator`.

### Keys and views

- `F` Features, `W` Workers, `M` Models, `R` Resume, `Tab` Next View, `Ctrl+G` Back To Orchestrator [S11].
- `g` / `G` "jump between workers and the features list" [S8, Apr 29, 2026].
- Ctrl+T toggles the overlay; Escape closes overlays; `?` opens the shortcuts pane [S7e].
- A **Workers view** for "monitoring individual Missions worker progress and output" [S8, Mar 27, 2026]. **(inferred)** `W` opens it, and you can pick a past or current worker and read its output, the way the app's left sidebar works [S7].
- A **Models** view: the CLI has a "Mission Control model selector" [S8, Apr 2026 fix], and the app lets you change the orchestrator, worker and validator models "on the fly" [S7].
- **Mission Control settings**: you can disable QA-style validation there [S4][S5].
- `R` Resume. **(inferred)** It resumes a paused mission. Pausing is done by interrupting the orchestrator ("Missions now pause correctly when the orchestrator is interrupted", [S8, July 21, 2026]); Ctrl+C interrupts the agent [S7e].

### What the human can do

- Approve or reject the proposal at the end of planning [S4][S8].
- Pause the orchestrator, describe the problem in plain language, and ask it to re-assess, re-plan, reorder, mark a stuck feature complete, or change scope. Then resume [S4][S6]. The docs give example prompts such as *"The worker on the auth integration has been stuck for 20 minutes. Mark it as complete and move to the next feature."* [S4]. There is no per-worker chat: you steer through the orchestrator. Workers cannot ask the user anything, and worker permission requests are auto-denied [S13][S8, Apr 20, 2026].
- Change models mid-mission [S7].
- Turn off validation types [S4][S7b].
- Read any worker's output (Workers view) [S8][S7].
- The orchestrator stops on its own and asks for input when it is blocked [S3]. The app flags this with "an amber status and a sidebar indicator when they need your response" [S8, Sep 2, 2026], and with audio and badge notifications [S8].
- There is no approve-each-diff step during execution. Diffs and commits show up in the app as per-feature "validation criteria and commits" [S7]. I found no diff pane in the CLI view.

### How live progress is shown

Overall: a progress bar with a done/total feature count, and the mission state (`RUNNING`, `COMPLETED`). Per feature: a check, dot or circle. Per event: the timestamped Progress Log. Per worker: the live tool stream with an elapsed timer [S11][S12]. "Real-time streaming updates from subagents in mission control" was added on March 10, 2026 [S8].

### The Factory App version [S12], for comparison

A three-column desktop dashboard in the same dark theme with orange accents, and a proportional font. **Top bar:** `MISSION /home/factory-user`, the title "Neon Pulse: Cyberpunk TUI Easter Egg", and three big stats: `TIME 02:57:04`, `PROGRESS 12/12`, `FACTORY STANDARD CREDITS 35.5M`. Below that, `● COMPLETED` and a solid olive-yellow full bar. **Left sidebar, "Sessions":** `Orchestrator` first, then sessions grouped under milestone headers ("Milestone 1: Neon Pulse"), listed as `Worker #1: Neon core render snapshot` … `Validator #8: Scrutiny validator neon pulse`, each with an age (`8d`). **Center:** the orchestrator chat transcript (the user prompt, "Thought for 1s", a "Mission Complete" summary with Validation bullets such as `validation-state.json: 25/25 assertions passed` and a Commits list of short SHAs) and a message box with chips for model, `Auto High`, `Mission Mode`, MCP and `Skills (19)`. **Right sidebar:** Model rows for Orchestrator, Worker and Validator, each with a model name and a 5-segment reasoning-effort meter. Below them, Features `12/12` grouped by milestone with orange checks, then a Progress Log of the form `Validator #15 started/completed/selected <feature>`. The docs say the same thing: "top bar tracks overall time and credits ... right sidebar maintains a live progress log", the left sidebar lists workers, and you "drill down into any feature to review its specific validation criteria and commits" [S7].

## 3. Does the TUI drive or observe, and where do missions run?

- The orchestrator is an ordinary Droid session in Mission Mode, and Mission Control is an overlay of that session [S7c][S7e]. The CLI session that planned the mission is the one that runs it. In that sense the TUI starts and owns the run.
- The process model, though, is daemon and client. Droid has a `droid daemon` server, and the SDK can "connect to an existing daemon" [S7e, CLI reference; docs full text]. The changelog mentions a "TUI daemon session" [S8, Apr 20, 2026] and says "every connected client shows the models the run is actually using" [S8, Aug 17, 2026]. Missions "keep running through network reconnects" [S8, May 22, 2026]. In the app you can reopen past missions and "resume execution exactly where you left off" [S7]. **(inferred)** The Mission Control TUI is one client of a mission that the daemon hosts. Several clients (CLI, Desktop, Web) can watch and steer the same run, and the run survives the view going away.
- Missions can also run headless with no TUI: `droid exec --mission -f mission.md`, which needs `--auto high` [S7b][S7e].
- Location: "Missions runs locally or in isolated cloud containers", with cloud-managed, hybrid or airgapped deployment [S2]. Local runs keep the machine awake by default (`keepSystemAwakeDuringMissions`) [S7b], and a 2026-08-17 fix handles workers stuck after the machine sleeps [S8]. Since June 2026 Missions run "anywhere you use Factory, including the CLI, Web, and Desktop App", and you can hand execution to a Droid Computer, a persistent remote machine, to work asynchronously [S10][S7].

## 4. What stands out compared to other agent TUIs

- **It is a project-manager dashboard, not a chat with a sidebar.** One screen answers which feature is being built, which worker has it, what tools it is running, and how far along the mission is: "One view for everything ... all in your terminal" [S9]. Most agent TUIs (Claude Code, Codex) show one transcript.
- **It shows the spec next to the activity.** The Active Feature pane shows preconditions, expected behavior and the description of the work the worker is doing at that moment, so you can check what the agent was asked to do while it does it [S11].
- **It condenses the stream.** The worker pane shows verb-led tool lines with one-line result summaries and line counts. Raw output is left out [S11].
- **It treats the run as an event log.** The Progress Log is a paged, relative-timestamped list of orchestration events (run started, worker started/completed, milestone validation, handoffs dismissed). It tells the story of the run at the level of the work list, not at the level of tokens [S11].
- **Validation is first-class in the plan.** Validator features show up in the feature list as items of their own, and the done/total count includes them [S11].
- **You steer through one agent.** You talk to the orchestrator, never to workers; Ctrl+G returns to it from any view [S11][S4].
- **Cost is shown as tokens** (input / cached / output) in the header, not dollars. The app shows credits [S11][S12].
- **The look is restrained.** Near-black background, one orange accent for brand, state and the current item, green-grey checks, an inverted bar for selection, a dithered progress bar, and dim labels with bright values throughout [S11].
- **It is built for long runs.** Median mission about 2 hours, 14% over 24 hours, the longest 16 days [S2]. Relative times ("8h ago") and a session clock of `32h 12m` fit that [S11].

## Gaps

- There is no published walkthrough or video of the CLI Mission Control beyond the one screenshot. What the Workers, Models and Next View screens look like is not documented.
- How the planning chat renders the proposal and the approve/reject choice in the CLI is not shown anywhere I found.
- [S13] is a third-party capture from CLI 0.84.0 (March 2026). The file names and tool contracts may have changed since.
