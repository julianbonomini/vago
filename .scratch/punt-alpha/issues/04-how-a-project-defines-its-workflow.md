# How a Project defines its Workflow

Type: grilling
Status: open
Blocked by: 02, 07, 10

## Question

What is the shape of a Project's Workflow definition in Alpha? This covers where it lives in the Project, its format (code, config, prompt files, skills), which steps exist and how they chain, how merge policy and Ticket "done" are expressed, and how the Project's conventions and code style reach every Run.

It also covers whether steps share a sandbox or worktree (each step is always its own Run), and whether a Goal gets its own branch that Tickets merge into or each Ticket lands on main. If the Workflow decides the branch question, Project setup has to ask for it. One candidate from warren: read merge policy from the base branch, so an agent can't edit its own merge rules. See "What Punt borrows from other orchestrators".

Constraint from "Does Alpha run on Sandcastle?": the Workflow definition can't depend on Sandcastle. Whether it can be code or has to be declarative config depends on "What Alpha is written in".
