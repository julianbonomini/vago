import { expect, test } from "bun:test";
import { join } from "node:path";
import type { TestRendererSetup } from "@opentui/core/testing";
import {
	type FakeHarness,
	makeFakeClaude,
	planningFixture,
	planningFixtureAnswering,
} from "./fake-harness.ts";
import {
	heldLock,
	makeProject,
	type RunningVago,
	runVago,
	startVago,
} from "./project.ts";
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
		sessionId?: string;
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
		if (turn.sessionId !== undefined) {
			lines.push(`session_id = "${turn.sessionId}"`);
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

// Waits until turn `number` of planning item `item`'s chat, in the Project
// at `root`, has `field`: `ended` once it ends, `session_id` once its session
// reports.
async function turnHas(
	root: string,
	item: string,
	number: number,
	field: "ended" | "session_id",
): Promise<void> {
	const chat = join(root, ".vago-goals", item, "planning/chat.toml");
	for (let tries = 0; ; tries++) {
		const text = await Bun.file(chat)
			.text()
			.catch(() => "");
		const turns = Bun.TOML.parse(text) as {
			turns?: Record<string, unknown>[];
		};
		if (turns.turns?.[number - 1]?.[field] !== undefined) return;
		if (tries === 300) {
			throw new Error(`Turn ${number} never had ${field}:\n${text}`);
		}
		await Bun.sleep(20);
	}
}

test("a response sent from the view outlives it, and coming back shows it working, then its answer", async () => {
	const root = await makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago-goals/search/planning/.keep": "",
	});
	const fake = await makeFakeClaude("sleep 2; exit 0", planningFixture);
	const first = await renderView(root, { width: 80, height: 24 }, fake.env);
	await openOnlyItem(first);
	await frameWith(first, "No messages yet.");
	await first.mockInput.typeText("What should search rank by?");
	first.mockInput.pressEnter();
	await frameWith(first, "you");
	first.renderer.destroy();

	const second = await renderView(root, { width: 80, height: 24 }, fake.env);
	await openOnlyItem(second);
	const working = await frameWith(second, "still answering");
	expect(working).toContain("What should search rank by?");
	expect(working).not.toContain("interrupted");
	expect(working).not.toContain("Ctrl-R");
	second.renderer.destroy();
	await turnHas(root, "search", 1, "ended");

	const third = await renderView(root, { width: 80, height: 24 }, fake.env);
	await openOnlyItem(third);
	const answered = await frameWith(third, "sorted by recency");
	expect(answered).not.toContain("still answering");
	expect(await fake.calls()).toHaveLength(1);
});

test("while another vago answers, the footer says so and Enter sends nothing", async () => {
	const root = await makeProject(
		await chatFiles("search", [{ message: "What should search rank by?" }]),
	);
	await heldLock(root, "search");
	const view = await renderView(root);
	await openOnlyItem(view);
	await frameWith(view, "still answering");

	await view.mockInput.typeText("And ties?");
	view.mockInput.pressEnter();

	await frameWith(view, "> And ties?");
	await Bun.sleep(1200);
	const chat = await Bun.file(
		join(root, ".vago-goals/search/planning/chat.toml"),
	).text();
	expect(chat).not.toContain("And ties?");
});

// Sends `message` to planning item `item` through `vago plan say`, with
// `fake` as the agent, without waiting for it.
function startSay(
	root: string,
	item: string,
	message: string,
	fake: FakeHarness,
): RunningVago {
	return startVago(
		root,
		["plan", "say", item, "--body-file", "-"],
		fake.env,
		message,
	);
}

test("a killed worker leaves its response interrupted, offering Retry response", async () => {
	const root = await makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		".vago-goals/a/planning/.keep": "",
	});
	const answers = await makeFakeClaude("exit 0", planningFixture);
	await startSay(root, "a", "What should search rank by?", answers).exited;
	const sleeps = await makeFakeClaude("sleep 30", planningFixture);
	const worker = startSay(root, "a", "And ties?", sleeps);
	await turnHas(root, "a", 2, "session_id");

	worker.kill("SIGKILL");
	await worker.exited;

	const view = await renderView(root, { width: 80, height: 50 });
	await openOnlyItem(view);
	const frame = await frameWith(view, "Ctrl-R Retry response");
	expect(frame).toContain("What should search rank by?");
	expect(frame).toContain("And ties?");
	expect(frame).toContain("The response was interrupted; Ctrl-R retries it.");
	expect(frame).not.toContain("still answering");
	const renamed = await runVago(root, ["plan", "rename", "a", "b"]);
	expect(renamed.stderr).toBe("");
	expect(renamed.exitCode).toBe(0);
});

test("Ctrl-R retries an interrupted response once, under the same message", async () => {
	const root = await makeProject({
		".vago/prompts/planning.md": "You help plan a Goal.\n",
		...(await chatFiles("search", [
			{
				message: "What should search rank by?",
				outcome: "ok",
				log: await Bun.file(planningFixture).text(),
			},
			{
				message: "And ties?",
				outcome: "interrupted",
				sessionId: "77544455-7842-4de0-80a3-d8fc7dbb33f6",
				// Cut off after the agent's first tool call.
				log: (
					await Bun.file(planningFixture).text()
				)
					.split("\n")
					.slice(0, 8)
					.join("\n"),
			},
		])),
	});
	const fake = await makeFakeClaude(
		"sleep 3; exit 0",
		await planningFixtureAnswering("Ties go to the newest result."),
	);
	const view = await renderView(root, { width: 80, height: 50 }, fake.env);
	await openOnlyItem(view);
	await frameWith(view, "Ctrl-R Retry response");

	view.mockInput.pressKey("r", { ctrl: true });
	view.mockInput.pressKey("r", { ctrl: true });

	await frameWith(view, "Retrying…");
	// Once the retried response is being written, it reads as any other.
	await frameWith(view, "still answering");
	const frame = await frameWith(view, "Ties go to the newest result.");
	expect(frame).toContain("sorted by recency");
	expect(frame).not.toContain("Ctrl-R");
	const you = frame.lastIndexOf("And ties?");
	const retried = frame.indexOf("Response interrupted; retried");
	expect(you).toBeLessThan(retried);
	expect(retried).toBeLessThan(frame.indexOf("Ties go to the newest result."));
	expect(frame.match(/And ties\?/g)).toHaveLength(1);
	await turnHas(root, "search", 2, "ended");
	expect(await fake.calls()).toHaveLength(1);
});
