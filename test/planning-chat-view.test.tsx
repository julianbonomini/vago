import { expect, test } from "bun:test";
import type { TestRendererSetup } from "@opentui/core/testing";
import { makeFakeClaude, planningFixture } from "./fake-harness.ts";
import { makeProject } from "./project.ts";
import { frameWith, renderView } from "./view-render.tsx";

// The files of planning item `name` whose chat holds `turns`, each with its
// log, as `vago plan say` leaves them.
async function chatFiles(
	name: string,
	turns: {
		message: string;
		outcome?: string;
		reason?: string;
		log?: string;
	}[],
): Promise<Record<string, string>> {
	const files: Record<string, string> = {};
	const lines = ['harness = "claude-code"'];
	for (const [index, turn] of turns.entries()) {
		const log = `logs/turn-0${index + 1}.jsonl`;
		lines.push(
			"",
			"[[turns]]",
			`message = ${JSON.stringify(turn.message)}`,
			"started = 2026-10-06T10:00:00.000Z",
			`log = "${log}"`,
		);
		if (turn.outcome !== undefined) {
			lines.push(
				"ended = 2026-10-06T10:01:00.000Z",
				`outcome = "${turn.outcome}"`,
			);
		}
		if (turn.reason !== undefined) {
			lines.push(`reason = ${JSON.stringify(turn.reason)}`);
		}
		if (turn.log !== undefined) {
			files[`.vago-goals/${name}/planning/${log}`] = turn.log;
		}
	}
	files[`.vago-goals/${name}/planning/chat.toml`] = `${lines.join("\n")}\n`;
	return files;
}

// Opens the only planning item of the Project shown in `view`.
async function openOnlyItem(view: TestRendererSetup): Promise<void> {
	await frameWith(view, " 1/1 ");
	view.mockInput.pressEnter();
}

test("a reopened planning item shows its earlier turns and the message field", async () => {
	const root = await makeProject(
		await chatFiles("search", [
			{
				message: "What should search rank by?",
				outcome: "ok",
				log: await Bun.file(planningFixture).text(),
			},
		]),
	);
	const view = await renderView(root);

	await openOnlyItem(view);

	const frame = await frameWith(view, "sorted by recency");
	expect(frame).toContain("you");
	expect(frame).toContain("What should search rank by?");
	expect(frame).toContain("Enter Send");
});

test("a message sent in the view shows at once, then the agent's response", async () => {
	const root = await makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago-goals/search/planning/.keep": "",
	});
	const fake = await makeFakeClaude("exit 0", planningFixture);
	const view = await renderView(root, { width: 80, height: 24 }, fake.env);
	await openOnlyItem(view);
	await frameWith(view, "No messages yet.");

	await view.mockInput.typeText("What should search rank by?");
	view.mockInput.pressEnter();

	const sent = await frameWith(view, "you");
	expect(sent).toContain("What should search rank by?");
	await frameWith(view, "sorted by recency");
	const calls = await fake.calls();
	expect(calls[0]?.stdin).toEndWith("What should search rank by?");
});

test("typing the Goals view's keys in the field types them and triggers nothing", async () => {
	const root = await makeProject({ ".vago-goals/search/planning/.keep": "" });
	const view = await renderView(root);
	await openOnlyItem(view);
	await frameWith(view, "No messages yet.");

	await view.mockInput.typeText("sjkgdnr?");

	const typed = await frameWith(view, "sjkgdnr?");
	expect(typed).not.toContain("New Goal name:");
	expect(typed).not.toContain("Rename search to:");
	expect(typed).not.toContain("Discard search");
	expect(typed).not.toContain("only a ready Goal starts");
	expect(typed).not.toContain("show, hide these keys");
	expect(typed).toContain("No messages yet.");
	view.mockInput.pressEscape();
	const list = await frameWith(view, " 1/1 ");
	expect(list).toContain(" search ");
});

test("each planning item shows only its own conversation", async () => {
	const root = await makeProject({
		...(await chatFiles("a", [{ message: "Message to a", outcome: "ok" }])),
		...(await chatFiles("b", [{ message: "Message to b", outcome: "ok" }])),
	});
	const view = await renderView(root);
	await frameWith(view, " 1/2 ");

	view.mockInput.pressArrow("down");
	await frameWith(view, " 2/2 ");
	view.mockInput.pressEnter();

	const frame = await frameWith(view, "Message to b");
	expect(frame).not.toContain("Message to a");
});

test("a turn that failed shows why under its message", async () => {
	const root = await makeProject(
		await chatFiles("search", [
			{
				message: "What should search rank by?",
				outcome: "error",
				reason: "sandbox-exec isn't on PATH",
			},
		]),
	);
	const view = await renderView(root);

	await openOnlyItem(view);

	const frame = await frameWith(view, "sandbox-exec isn't on PATH");
	expect(frame.indexOf("What should search rank by?")).toBeLessThan(
		frame.indexOf("sandbox-exec isn't on PATH"),
	);
});
