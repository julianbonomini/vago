# Alpha kernel boundary and bootstrap path

Type: grilling
Status: open
Blocked by: 04, 05, 08, 11, 12

## Question

Pull the prior decisions together. What exactly is inside the Alpha kernel and what is outside? What are the manual bootstrap steps, from building the kernel with ordinary developer tools (Sandcastle or manual Harness sessions; "Does Alpha run on Sandcastle?" settled that this choice has no effect on Alpha) to Alpha finishing its own first Goal? This is the decision handed to `/to-spec`.

Also settle how the human sees progress without a TUI (Ticket status, Run logs, what `punt run` prints). Runtime and failure handling are decided in [What Alpha's runtime is](11-what-alphas-runtime-is.md) and [How a Run fails and what Alpha does next](12-how-a-run-fails-and-what-alpha-does-next.md); this ticket assembles them.
