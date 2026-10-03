# Purpose / Why

Status: complete. Vago is the final name. Participant: Julian (sole founder).

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

> "vago because means lazy in spanish as well as a later found acronim various agents go"

> "Lazy means that after defining what you want and after you put some time in there in the workflow, you can just throw stuff you want at it and any software factory will do it unsupervised. I'm the lazy one"

> "I don't know man. I just like the name Vago. It makes sort of sense because I'm being lazy by using it, because I don't want to do the work myself"

> "Defining the goal in a detailed way:
> - Defining what I want, maybe roughly how I want it
> - What is out of scope?
> - What is in scope?
> - What are the user stories?
> Kind of like how a product person would do it"

> "I think now why these and many software factories exist is because the bottleneck now is human attention. If we can put human attention on what we want to build rather than how to build it, that's the way to go, right? I will work a little bit on creating a workflow that I feel does the right job with the code and then I can 100% focus on the product that I want to create"

> "I think those will 100% disappear because I'm sure there will be something better. There is something better already probably but it would mean, I don't know, really"

The founder wants personal setup, including any sidecars, to stay out of the way of other people working in the same Project. They cited inspiration from three or four projects and have not compared the broader field in depth.

## Synthesis

The founder wants to hand off the work of running a Project's process while retaining control over that process. The personal value is time away from the computer during multi-day work. A Project's own rules, including shared-project and open source contribution rules, should determine the Workflow. The tool can have opinions about execution, state, failure handling, and eventually planning.

The human keeps product decisions: defining the Goal, rough direction, scope, exclusions, and user stories. Vago takes over the execution that follows.

The founder sees human attention as the constraint. Their desired shift is from supervising implementation to deciding what to build, after investing in a Workflow they trust. This is the founder's belief and intended experience, not a measured claim about all software development.

Vago is the final name. The founder chose the Spanish word for "lazy" and later found the expansion "various agents go." The human is the "lazy" one: they invest effort in the Goal and Workflow, then delegate execution without supervising each Run.

Candidate formulations, for discussion:

1. Set the Goal and Workflow. Vago runs the work while you are away.
2. Keep your attention on what to build. Let your Project's Workflow direct the agents.
3. Define the rules for each Project, then hand off execution without supervising every Run.

The [Vago Alpha spec](../../.scratch/vago-alpha/spec.md) narrows the current release: Alpha runs user-written Goals and Tickets through a frozen, linear Workflow, one Ticket at a time. On a failed Step it marks the Ticket `stuck` and stops the Goal for human inspection and reset. Alpha does not plan or split work, retry, or recover autonomously. It also leaves branding and the final name out of scope. Those are boundaries of Alpha, not changes to the founder's longer-term aim.

Open questions:

- What should count as a successful unattended result across Projects, especially when the Workflow ends in a PR rather than a merge?
- Which execution decisions should always remain visible or adjustable by the human?
- How should the shared-project promise be described without assuming all collaborators want the same Workflow?

Tensions to revisit:

- The desired long-term experience is to leave a Goal until it succeeds. Alpha deliberately stops on failure and requires human recovery.
- The founder wants the tool to split work into smaller tasks. Alpha requires the human to write Tickets.
- Other tools' limits are the founder's current impression, not a validated competitive claim.

The founder expects better tools to appear and gave no specific answer to what would be missed if Vago disappeared. The purpose does not depend on Vago being permanent or unique.
