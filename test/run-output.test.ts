import { expect, test } from "bun:test";
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

test("piped, the Step lines line up in columns, a blank line between Tickets, and the summary is a table", async () => {
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
2026-10-02T10:00:00Z  01-greet         greet             started
2026-10-02T10:00:00Z  01-greet         greet             ok              1.0s
2026-10-02T10:00:00Z  01-greet         check-everything  started
2026-10-02T10:00:00Z  01-greet         check-everything  ok              1.0s

2026-10-02T10:00:00Z  02-wave-goodbye  greet             started
2026-10-02T10:00:00Z  02-wave-goodbye  greet             ok              1.0s
2026-10-02T10:00:00Z  02-wave-goodbye  check-everything  started
2026-10-02T10:00:00Z  02-wave-goodbye  check-everything  ok              1.0s

2026-10-02T10:00:00Z  03-fail          greet             started
2026-10-02T10:00:00Z  03-fail          greet             ok              1.0s
2026-10-02T10:00:00Z  03-fail          check-everything  started
2026-10-02T10:00:00Z  03-fail          check-everything  exit 1          1.0s
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
	expect(lines[0]).toMatch(
		/^ESC\[2m\S+ {2}03-fail {2}greet .*startedESC\[22m$/,
	);
	expect(lines[1]).toContain("ESC[32mok ");
	expect(lines[3]).toContain("ESC[31mexit 1 ");
	expect(lines[4]).toBe(
		"ESC[31m03-fail is stuck after check-everything: exit 1ESC[39m",
	);
	expect(lines).toContainEqual(expect.stringContaining("ESC[31mstuck "));
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
