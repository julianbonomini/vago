# Where Goals and Tickets live

Type: research
Status: resolved

## Question

Where should a Project's Goals and Tickets live so that Vago can pick up ready Tickets? Survey how Sandcastle, cyrus, vibe-kanban, symphony, agent-orchestrator, warren and Factory Missions store and discover work: GitHub Issues, Linear, local files in the repo, their own store. The constraint: it has to work for solo indie repos, company repos and open-source repos the human doesn't own, without forking or polluting someone else's tracker. Report the options, who uses which, and the trade-offs for that constraint. Facts only: the choice belongs to "Where Vago keeps Goals and Tickets".

## Answer

- All four kinds of store show up: a hosted tracker (Symphony and cyrus use Linear, AO and Sandcastle use GitHub Issues), files in the repo (Beads, Seeds), files outside the repo (Beads `--stealth`/`--contributor`, warren's untracked host-clone config, Factory missionDir), and the tool's own DB (vibe-kanban, AO). The tools that last put a tracker seam in front of storage. Sandcastle's is just list, view and close commands.
- Hosted trackers fail for OSS repos the human doesn't own: they need write or triage access, an App or webhook, or they pollute upstream. Only local files work for all three repo kinds.
- Findings: [research/where-goals-and-tickets-live.md](../research/where-goals-and-tickets-live.md)
