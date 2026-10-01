# How a Run fails and what Alpha does next

Type: grilling
Status: open

## Question

What happens when a Step fails, a Run times out or stalls, or Alpha itself is stopped? Inputs: [How other orchestrators work](03-how-other-orchestrators-work.md), the warren pointers in [What Punt borrows from other orchestrators](07-what-punt-borrows-from-other-orchestrators.md), and the fog left by [Where Punt keeps Goals and Tickets](08-where-punt-keeps-goals-and-tickets.md).

To decide:

- Retries: none, or warren's one retry for provider errors only; how a provider error is told apart from a failing Step.
- What `stuck` means for the Ticket's dependants, and whether Alpha keeps going on other ready Tickets or stops the Goal.
- What a Ticket still `running` at startup means (warren: marked lost), and what happens to an in-flight Ticket when the human stops Alpha to edit the Workflow.
- What Run metadata Alpha records when a Ticket goes `running` (Harness session ID, start time) and where.
- How the human un-sticks a Ticket, given the CLI has no command to set status.

Explicit terminal reasons for a Run stay out of scope.
