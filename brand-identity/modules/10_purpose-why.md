# Purpose / Why

Status: in progress. Vago is the final name. Participant: Julian (sole founder).

## Raw

> "I wanted to use a software factory or agentic orchestrator where I could define absolutely every aspect of the workflow myself."

> "I could bring my own skills or use reused skills."

> "Every project has its own workflow and what I've seen, at least, is that many of these orchestrators (and again I haven't investigated that much) have their workflow defined for you"

> "What matters most for me is that the opinions are not on my workflow but rather on how my workflow is executed"

Examples given: a solo Project could take a task, do the work, and commit to `main`; another Project could require PRs, checks, code style, and careful review; an open source contribution could require its own contribution steps.

> "It can decide things like:
> - where each step runs
> - failure modes
> - how what I want to implement gets split into smaller tasks
> - how those smaller tasks are implemented, like passing through my workflow
> - how the state for those is managed"

> "to just defining what you want, forgetting about it, and trusting that your workflow is good enough so you don't have to look at it"

> "I can go watch TV. I can just go sleep. Imagine I want to do something big, like add a feature that will take me days. For those days it will take, I won't even have to be on the computer, right? I know at some point I will have a PR ready for me with everything there"

> "Of course in the version I'm currently working on, it will get stuck and you have to manually help it but ideally in the future this will not happen, right? It should be resilient enough that it runs until the goal is achieved"

The founder wants personal setup, including any sidecars, to stay out of the way of other people working in the same Project. They cited inspiration from three or four projects and have not compared the broader field in depth.

## Synthesis

The founder wants to hand off the work of running a Project's process while retaining control over that process. The personal value is time away from the computer during multi-day work. A Project's own rules, including shared-project and open source contribution rules, should determine the Workflow. The tool can have opinions about execution, state, failure handling, and eventually planning.

Candidate formulations, for discussion:

1. Define how your Project gets built, then leave the work to run.
2. Your Project sets the Workflow. Vago carries its Tickets through it while you are away.
3. Spend your attention on the outcome and the rules; return when the work needs your judgment.

The [Vago Alpha spec](../../.scratch/vago-alpha/spec.md) narrows the current release: Alpha runs user-written Goals and Tickets through a frozen, linear Workflow, one Ticket at a time. On a failed Step it marks the Ticket `stuck` and stops the Goal for human inspection and reset. Alpha does not plan or split work, retry, or recover autonomously. It also leaves branding and the final name out of scope. Those are boundaries of Alpha, not changes to the founder's longer-term aim.

Open questions:

- What should count as a successful unattended result across Projects, especially when the Workflow ends in a PR rather than a merge?
- Which execution decisions should always remain visible or adjustable by the human?
- How should the shared-project promise be described without assuming all collaborators want the same Workflow?

Tensions to revisit:

- The desired long-term experience is to leave a Goal until it succeeds. Alpha deliberately stops on failure and requires human recovery.
- The founder wants the tool to split work into smaller tasks. Alpha requires the human to write Tickets.
- Other tools' limits are the founder's current impression, not a validated competitive claim.
