import { expect, test } from "bun:test";
import {
	makeFakeClaude,
	permissionModeFallbackFixture,
} from "./fake-claude.ts";
import {
	goalText,
	makeProject,
	runPunt,
	runPuntInTerminal,
} from "./project.ts";

const goalDir = ".punt-goals/hello";

const workflow = `
[[steps]]
id   = "greet"
type = "shell"
run  = "true"

[[steps]]
id   = "check-everything"
type = "shell"
run  = 'test "$PUNT_TICKET" != 03-fail'
`;

function ticket(blockedBy = ""): string {
	return `+++\nstatus = "ready"\n${blockedBy}+++\n# A Ticket\n`;
}

// Each time reads as the same instant, and each duration as the same one,
// so the expected text can spell out every column.
function steady(stdout: string): string {
	return stdout
		.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ/g, "2026-10-02T10:00:00Z")
		.replace(/\b\d\.\ds\b/g, "1.0s");
}

test("piped, each Ticket's name heads its indented Step lines, and the summary is a table after a blank line", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: ticket(),
		[`${goalDir}/tickets/02-wave-goodbye.md`]: ticket(),
		[`${goalDir}/tickets/03-fail.md`]: ticket(),
		[`${goalDir}/tickets/04-later.md`]: ticket("blocked_by = [3]\n"),
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(steady(result.stdout)).toBe(`\
01-greet
  2026-10-02T10:00:00Z                  greet started
  2026-10-02T10:00:00Z    1.0s          greet ok
  2026-10-02T10:00:00Z                  check-everything started
  2026-10-02T10:00:00Z    1.0s          check-everything ok
02-wave-goodbye
  2026-10-02T10:00:00Z                  greet started
  2026-10-02T10:00:00Z    1.0s          greet ok
  2026-10-02T10:00:00Z                  check-everything started
  2026-10-02T10:00:00Z    1.0s          check-everything ok
03-fail
  2026-10-02T10:00:00Z                  greet started
  2026-10-02T10:00:00Z    1.0s          greet ok
  2026-10-02T10:00:00Z                  check-everything started
  2026-10-02T10:00:00Z    1.0s          check-everything exit 1
03-fail is stuck after check-everything: exit 1
  log:    .punt-goals/hello/logs/03-check-everything-2.log
  reset:  punt ticket reset hello 03

hello: 2 of 4 Tickets done
Ticket           Status  Runs  Took  Cost
01-greet         done       2  1.0s
02-wave-goodbye  done       2  1.0s
03-fail          stuck      2  1.0s
04-later         ready      0  1.0s
Total                       6  1.0s
`);
});

test("the summary adds up each Ticket's cost into the total and leaves a cost-less Ticket's blank", async () => {
	const done = (step: string, started: string, ended: string, cost: string) =>
		`+++\nstatus = "done"\n\n[[runs]]\nstep = "${step}"\nstarted = ${started}\nended = ${ended}\noutcome = "ok"\nlog = "logs/${step}.jsonl"\ncost_usd = ${cost}\n+++\n# A Ticket\n`;
	const root = await makeProject({
		".punt/workflows/test.toml": `
[[steps]]
id   = "greet"
type = "shell"
run  = "true"
`,
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: done(
			"implement",
			"2026-10-02T10:00:00.000Z",
			"2026-10-02T10:05:30.000Z",
			"1.254",
		),
		[`${goalDir}/tickets/02-wave.md`]: done(
			"implement",
			"2026-10-02T11:00:00.000Z",
			"2026-10-02T11:02:00.000Z",
			"0.5",
		),
		[`${goalDir}/tickets/03-later.md`]: ticket(),
	});

	const result = await runPunt(root, ["run", "hello"]);

	expect(steady(result.stdout)).toEndWith(`
hello: 3 of 3 Tickets done
Ticket    Status  Runs   Took   Cost
01-greet  done       1  5m30s  $1.25
02-wave   done       1  2m00s  $0.50
03-later  done       1   1.0s
Total                3  7m30s  $1.75
`);
});

test("a long outcome pushes no column of the Step lines", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": `
harness = "claude-code"
model   = "opus"

[[steps]]
id   = "greet"
type = "shell"
run  = "true"

[[steps]]
id     = "implement"
type   = "agent"
prompt = "prompts/implement.md"
`,
		".punt/prompts/implement.md": "Implement it.\n",
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: ticket(),
	});
	const claude = await makeFakeClaude("exit 0", permissionModeFallbackFixture);

	const result = await runPunt(root, ["run", "hello"], claude.env);

	const lines = steady(result.stdout).split("\n");
	const greet = lines.find((line) => /greet +ok/.test(line)) ?? "";
	const implement =
		lines.find((line) => /implement +permission-mode default/.test(line)) ?? "";
	expect(implement.indexOf("1.0s")).toBe(greet.indexOf("1.0s"));
	const durationColumn = "  2026-10-02T10:00:00Z    1.0s  ";
	expect(greet).toStartWith(durationColumn);
	expect(implement).toStartWith(durationColumn);
	expect(implement).toEndWith("implement permission-mode default");
});

test("in a terminal, start lines are dimmed, ok is green, and a failed Step and the stuck message are red", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/03-fail.md`]: ticket(),
	});

	const printed = await runPuntInTerminal(root, ["run", "hello"], {
		NO_COLOR: "",
	});

	// Each line as the terminal shows it, with the escape codes spelled out.
	const lines = printed.replaceAll("\x1b", "ESC").split("\r\n");
	expect(lines[0]).toBe("03-fail");
	expect(lines[1]).toMatch(/^ESC\[2m {2}\S+ .*greet startedESC\[22m$/);
	expect(lines[2]).toEndWith("greet ESC[32mokESC[39m");
	expect(lines[4]).toEndWith("check-everything ESC[31mexit 1ESC[39m");
	expect(lines[5]).toBe(
		"ESC[31m03-fail is stuck after check-everything: exit 1ESC[39m",
	);
	expect(lines).toContainEqual(expect.stringContaining("ESC[31mstuck "));
});

test("in a terminal, the summary shows done green, stuck red and ready plain", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/01-greet.md`]: ticket(),
		[`${goalDir}/tickets/03-fail.md`]: ticket(),
		[`${goalDir}/tickets/04-later.md`]: ticket("blocked_by = [3]\n"),
	});

	const printed = await runPuntInTerminal(root, ["run", "hello"], {
		NO_COLOR: "",
	});

	const lines = printed.replaceAll("\x1b", "ESC").split("\r\n");
	const row = (name: string) =>
		lines.find((line) => line.startsWith(`${name} `)) ?? "";
	expect(row("01-greet")).toContain("ESC[32mdone");
	expect(row("03-fail")).toContain("ESC[31mstuck");
	expect(row("04-later")).toContain("ready");
	expect(row("04-later")).not.toContain("ESC");
});

test("in a terminal with NO_COLOR set, the output is plain text", async () => {
	const root = await makeProject({
		".punt/workflows/test.toml": workflow,
		[`${goalDir}/goal.md`]: goalText("test"),
		[`${goalDir}/tickets/03-fail.md`]: ticket(),
	});

	const printed = await runPuntInTerminal(root, ["run", "hello"], {
		NO_COLOR: "1",
	});

	expect(printed).toContain("03-fail is stuck after check-everything: exit 1");
	expect(printed).not.toContain("\x1b[");
});
