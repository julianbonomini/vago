// The agent snippet: the block a developer pastes into their Project's AGENTS.md so their agent knows the
// Project uses Vago and where to read before it writes a Goal, Ticket or Workflow. The agents index shows it,
// and the test of the built site fails when a page it links isn't served.
import { siteUrl } from "../site.ts";

// When to read each agents page, in the snippet's own words, and the absolute path of its Markdown copy.
const pages = [
	{ when: "First", path: "/agents/what-vago-is.md" },
	{ when: "Before you write a Goal", path: "/agents/writing-a-goal.md" },
	{ when: "Before you add Tickets", path: "/agents/splitting-into-tickets.md" },
	{
		when: "Before you write a Workflow or a prompt",
		path: "/agents/writing-a-workflow.md",
	},
	{ when: "Before you run a `vago` command", path: "/agents/commands.md" },
	{
		when: "Before you count on Vago doing something",
		path: "/agents/limits.md",
	},
];

/** The snippet as Markdown, ready to paste: a `## Vago` heading, what the Project's Vago files are, the rules
 *  an agent most often breaks, and the agents pages to read. No leading or trailing whitespace. */
export const agentSnippet = [
	"## Vago",
	"",
	"This Project uses Vago: `vago run` takes a Goal's Tickets one at a time through a Workflow of agent and shell Steps, with no human present. Workflows, prompts and scripts are in `.vago/`. Goals and Tickets are Markdown files in `.vago-goals/`, which git doesn't track.",
	"",
	"- Read the pages below before you write or change a Goal, a Ticket, a Workflow or a prompt in `.vago/`.",
	"- Use Vago's words exactly: Goal, Ticket, Workflow, Step, Run, Harness.",
	"- Create Goals and Tickets with `vago goal new` and `vago ticket add`. Never write or edit the `+++` header of a Goal or Ticket file.",
	"- Leave `vago run`, `vago init`, `vago update` and `vago ticket reset` to the human.",
	"",
	...pages.map(({ when, path }) => `- ${when}: ${siteUrl}${path}`),
	`- Every page of the docs: ${siteUrl}/llms.txt`,
].join("\n");
