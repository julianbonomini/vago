// Runs one Step for a Ticket or for the Goal as one Run, a read-only Harness
// session such as a planning turn's, and a Harness's own interactive session:
// the only module that spawns a Step's or an agent's process. Hides how the
// Run is recorded and announced, how a command is spawned, how a Harness's
// stream is read, how an interactive session's messages are read from its
// transcript, and how output reaches the log.

import { closeSync, openSync, writeSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import {
	findHarness,
	type Harness,
	type HarnessSessionReport,
	type HarnessTranscriptFiles,
} from "./harness/registry.ts";
import { printStepEnded, printStepStarted } from "./progress.ts";
import { withoutWritesUnder } from "./sandbox.ts";
import {
	isLastTicket,
	type RunOwner,
	readGoalBody,
	readRunLog,
	readTicketBody,
	recordRunEnd,
	recordRunFellBack,
	recordRunSession,
	recordRunStart,
	runOwnerGoal,
	shellExitCode,
	type TicketRun,
	type TicketRunEntry,
} from "./tickets/tickets.ts";
import { type AgentStep, buildPrompt, type Step } from "./workflow.ts";

/**
 * How a Run ended. `permission-mode` is a Harness session that ran in `mode`
 * instead of the mode its command asked for, `permission-denied` one whose
 * Harness refused a tool call. Either wins over the exit code, since a
 * session that couldn't do its work often still exits 0.
 */
export type RunOutcome =
	| { kind: "ok" }
	| { kind: "exit"; code: number }
	| { kind: "permission-mode"; mode: string }
	| { kind: "permission-denied" }
	| { kind: "idle-timeout" }
	| { kind: "interrupted" };

/** How a Run ended, and what's left of it for later Steps and the human. */
export type FinishedRun = {
	outcome: RunOutcome;
	/**
	 * For later Steps' prompts: a shell Step's exit code and everything it
	 * wrote to stdout and stderr, an agent Step's final result text.
	 */
	output: string;
	/** Absolute path of the Run's log. */
	log: string;
	/**
	 * The id of the Run's Harness session, to resume it. Absent for a shell
	 * Step, and for a session that ended before reporting its id.
	 */
	sessionId?: string;
	/**
	 * The command that resumes the Run's Harness session. Absent for a shell
	 * Step, and for a session that ended before reporting its id.
	 */
	resumeHint?: string;
};

/**
 * Runs `step` for `owner`, a Ticket or the Goal, with `worktree`, the Goal's
 * worktree as an absolute path, as the working directory of its command or
 * Harness session, and waits for it to end. The Run gets an entry in
 * `owner`'s `[[runs]]` before it starts and its end filled in after, a line
 * on stdout at each, and a log of everything it wrote. An agent Step's
 * prompt reads `stepOutputs`, the outputs of the Steps already run in this
 * pass by Step id, the Goal's name and the Goal, and for a Ticket the
 * Ticket. A shell Step's command gets the Goal's name in `VAGO_GOAL`, like
 * `hello`, and `VAGO_PROJECT_ROOT`, the main checkout's path. For a Ticket it
 * also gets the Ticket's name in `VAGO_TICKET`, like `01-say-hello`, and
 * `VAGO_LAST_TICKET`, `true` when every other Ticket of the Goal is `done`
 * and `false` otherwise; for the Goal, neither is set, even when `vago`'s own
 * environment has them.
 * SIGINT or SIGTERM while the Step runs kills every process it started
 * and ends the Run `interrupted`, instead of ending `vago`.
 * Given `resume`, the id of an earlier Run's session of an agent Step on
 * the same Harness, the Run resumes that session with a fixed message
 * to continue, in place of the prompt, and is recorded as resuming it. When
 * the resume fails to start, the Run says so in its log and its entry, and
 * starts a fresh session with the prompt instead.
 */
export async function runStep(
	step: Step,
	owner: RunOwner,
	worktree: string,
	stepOutputs: ReadonlyMap<string, string>,
	resume?: string,
): Promise<FinishedRun> {
	const started = new Date();
	const resumes = step.type === "agent" ? resume : undefined;
	const entry = await recordRunStart(owner, step, started, resumes);
	printStepStarted(step.name, started);
	await mkdir(dirname(entry.log), { recursive: true });
	// One descriptor for both streams keeps stdout and stderr in the order the
	// Step wrote them, which two separate pipes can't promise.
	const fd = openSync(entry.log, "w");
	const interrupt = interruptOnSignal(["SIGINT", "SIGTERM"]);
	let outcome: RunOutcome;
	let output: string;
	let session: HarnessSessionReport | undefined;
	let resumeHint: string | undefined;
	try {
		if (step.type === "agent") {
			({ outcome, session, resumeHint } = await runAgent(
				step,
				entry,
				worktree,
				stepOutputs,
				resumes,
				fd,
				interrupt.signal,
			));
			output = session.resultText ?? "";
		} else {
			// Agents read the Goal and Ticket in their prompt; a command needs
			// the names, for example to name a branch per Goal and Ticket, and
			// whether the Goal ends with this Ticket, to announce it.
			const { root, goal } = runOwnerGoal(owner);
			const env: Record<string, string | undefined> = {
				...process.env,
				VAGO_GOAL: goal,
				// The main checkout, for example to reach `.vago-goals/`, which
				// the Goal's worktree doesn't hold.
				VAGO_PROJECT_ROOT: root,
			};
			if (owner.kind === "ticket") {
				env.VAGO_TICKET = owner.ticket.name;
				env.VAGO_LAST_TICKET = String(await isLastTicket(owner.ticket));
			} else {
				// A Goal Step runs on no Ticket, whatever `vago` itself was given.
				delete env.VAGO_TICKET;
				delete env.VAGO_LAST_TICKET;
			}
			const child = Bun.spawn(["sh", "-c", step.run], {
				cwd: worktree,
				env,
				stdin: "ignore",
				stdout: fd,
				stderr: fd,
				detached: true,
			});
			const code = await exitCodeOf(child, interrupt.signal, "group");
			outcome = outcomeOf(code);
			// Read back from the log, so a review prompt sees stdout and stderr
			// interleaved the way the Step wrote them.
			output = shellOutput(code, await Bun.file(entry.log).text());
		}
	} finally {
		interrupt.release();
		closeSync(fd);
	}
	if (interrupt.signal.aborted) outcome = { kind: "interrupted" };
	const ended = new Date();
	const spelled = spellOutcome(outcome);
	await recordRunEnd(entry, spelled, ended, session);
	printStepEnded(step.name, spelled, started, ended, session?.costUsd);
	return {
		outcome,
		output,
		log: entry.log,
		sessionId: session?.sessionId,
		resumeHint,
	};
}

/**
 * The output `run` gave later Steps, rebuilt from its log and its
 * `[[runs]]` entry: an agent Run's final result text, "" when its session
 * gave none, and for a shell Run `exit code N` and its log. Undefined when
 * the log is gone, or for a shell Run whose outcome isn't `ok` or `exit N`.
 */
export async function readRunOutput(
	run: TicketRun,
): Promise<string | undefined> {
	if (!(await Bun.file(run.log).exists())) return undefined;
	const { added } = await readRunLog(run.log);
	if (run.harness === undefined) {
		const code = shellExitCode(run.outcome);
		return code === undefined ? undefined : shellOutput(code, added);
	}
	const harness = findHarness(run.harness);
	let resultText: string | undefined;
	for (const line of added.split("\n")) {
		// The command only tells a permission mode fallback apart, which the
		// answer doesn't depend on.
		resultText = harness.readLine(line, []).resultText ?? resultText;
	}
	return resultText ?? "";
}

/** A read-only Harness session to run. */
export type ReadOnlySession = {
	harness: string;
	model: string;
	/** The session to resume; a fresh one when absent. */
	resume?: string;
	/** What the session reads on stdin. */
	input: string;
	/** The working directory, which nothing the session starts can write under. */
	folder: string;
	/** Absolute path of the log that gets the stream and stderr. */
	log: string;
};

/**
 * Runs `session` and waits for it to end. `onSessionId` gets the session's
 * id as soon as the Harness reports it. A tool call the Harness refuses
 * doesn't fail it. SIGINT or SIGTERM stops every process it started and
 * ends it `interrupted`. No idle timeout, and no fallback when a resume
 * fails to start: that ends it `exit N`. Throws, naming what to install,
 * when the Harness's program isn't on `PATH`, and as `withoutWritesUnder`
 * does.
 */
export async function runReadOnlySession(
	session: ReadOnlySession,
	onSessionId: (sessionId: string) => Promise<void>,
): Promise<{ outcome: RunOutcome; report: HarnessSessionReport }> {
	const harness = findHarness(session.harness);
	const command =
		session.resume === undefined
			? harness.readOnlyCommand(session.model)
			: harness.readOnlyResumeCommand(session.resume, session.model);
	const spawned = await spawnableReadOnly(harness, session.folder, command);
	await mkdir(dirname(session.log), { recursive: true });
	const fd = openSync(session.log, "w");
	const interrupt = interruptOnSignal(["SIGINT", "SIGTERM"]);
	let ran: HarnessSessionRun;
	try {
		ran = await runSession({
			harness,
			command,
			spawned,
			stdin: session.input,
			cwd: session.folder,
			fd,
			interrupt: interrupt.signal,
			idleTimeoutMs: undefined,
			onSessionId,
		});
	} finally {
		interrupt.release();
		closeSync(fd);
	}
	const { session: report, code } = ran;
	let outcome: RunOutcome;
	if (interrupt.signal.aborted) {
		outcome = { kind: "interrupted" };
	} else if (report.permissionModeFallback !== undefined) {
		outcome = { kind: "permission-mode", mode: report.permissionModeFallback };
	} else {
		outcome = outcomeOf(code);
	}
	return { outcome, report };
}

/** A Harness's own interactive session to run, read-only. */
export type InteractiveReadOnlySession = {
	harness: string;
	model: string;
	/** What is added to the agent's system prompt. */
	instructions: string;
	/** The session to resume; absent to start a fresh one. */
	resume?: string;
	/** The working directory, which nothing the session starts can write under. */
	folder: string;
};

/**
 * Runs `session` on this process's terminal and waits for it to end. Its
 * stdin, stdout and stderr are this process's, and it stays in the
 * terminal's foreground. Nothing it starts can write under its folder.
 * `onSessionId` gets the session's id once: before the session starts when
 * the Harness names it up front, as it does a resumed session's, or else
 * once its transcript tells, which may be only after the human's first
 * message. While it runs, and once more after it ends however it ended,
 * `onAnswers` gets every message the agent has written in the session so
 * far, a resumed session's earlier ones included, whenever there are more
 * than `onAnswers` last took without throwing. Calls never overlap. An error
 * from either callback after the session has started never ends it; the
 * same call comes again a second later. A Harness whose transcript Vago
 * can't find gives no call after the start.
 * SIGHUP, SIGTERM or SIGINT stops it within 5 seconds and ends it
 * `interrupted`; otherwise it ends `ok` or `exit N`. Throws, naming what to
 * install, when the Harness's program isn't on `PATH`, as
 * `withoutWritesUnder` does, and as `onSessionId` does before the start.
 */
export async function runInteractiveReadOnlySession(
	session: InteractiveReadOnlySession,
	onSessionId: (sessionId: string) => Promise<void>,
	onAnswers: (answers: string[]) => Promise<void>,
): Promise<RunOutcome> {
	const harness = findHarness(session.harness);
	const command = harness.interactiveReadOnlyCommand(session);
	const spawned = await spawnableReadOnly(
		harness,
		session.folder,
		command.argv,
	);
	if (command.sessionId !== undefined) await onSessionId(command.sessionId);
	const readTranscript = transcriptReader(
		harness,
		{
			sessionId: command.sessionId,
			// The Harness names its transcript, or records its folder, as the
			// kernel sees the working directory, with symlinks resolved.
			folder: await realpath(session.folder),
			startedAt: new Date(),
		},
		onSessionId,
		onAnswers,
	);
	let reading: Promise<void> | undefined;
	const timer = setInterval(() => {
		if (reading !== undefined) return;
		reading = readTranscript().finally(() => {
			reading = undefined;
		});
	}, 1000);
	// SIGHUP too: it is how this process hears that its terminal closed.
	const interrupt = interruptOnSignal(["SIGINT", "SIGTERM", "SIGHUP"]);
	let code: number;
	try {
		// Not detached, so the session stays in the terminal's foreground
		// group and can read it.
		const child = Bun.spawn(spawned, {
			cwd: session.folder,
			stdio: ["inherit", "inherit", "inherit"],
		});
		code = await exitCodeOf(child, interrupt.signal, "process");
	} finally {
		interrupt.release();
		// However it ended, so a message written just before, such as the
		// proposal the human then accepts, is still handed over.
		clearInterval(timer);
		await reading;
		await readTranscript();
	}
	return interrupt.signal.aborted ? { kind: "interrupted" } : outcomeOf(code);
}

// One read of the transcript of the interactive session started at
// `startedAt` in `folder`: until its id is known and taken by `onSessionId`,
// the search for it among every transcript started there since, and then the
// agent's messages handed to `onAnswers` when there are more than it last
// took. A callback that throws is called again on the next read.
function transcriptReader(
	harness: Harness,
	session: { sessionId?: string; folder: string; startedAt: Date },
	onSessionId: (sessionId: string) => Promise<void>,
	onAnswers: (answers: string[]) => Promise<void>,
): () => Promise<void> {
	const { folder, startedAt } = session;
	let sessionId = session.sessionId;
	let sessionIdTaken = sessionId !== undefined;
	let taken = 0;
	return async () => {
		if (sessionId === undefined) {
			const anyTranscript = harness.interactiveTranscript(
				{ folder },
				homedir(),
				process.env,
			);
			for (const file of await transcriptFiles(anyTranscript)) {
				// A file last written before the start can't be this session's.
				if (Bun.file(file).lastModified < startedAt.getTime()) continue;
				const text = await readTranscriptFile(file);
				const owner = harness.transcriptSession(text.split("\n", 1)[0] ?? "");
				if (owner?.folder === folder && owner.startedAt >= startedAt) {
					sessionId = owner.sessionId;
					break;
				}
			}
		}
		if (sessionId === undefined) return;
		if (!sessionIdTaken) {
			sessionIdTaken = await onSessionId(sessionId).then(
				() => true,
				() => false,
			);
			if (!sessionIdTaken) return;
		}
		const transcript = harness.interactiveTranscript(
			{ sessionId, folder },
			homedir(),
			process.env,
		);
		const lines: string[] = [];
		for (const file of await transcriptFiles(transcript)) {
			lines.push(...(await readTranscriptFile(file)).split("\n"));
		}
		const answers = harness.transcriptAnswers(lines);
		if (answers.length <= taken) return;
		// Left as it was when `onAnswers` fails, so the next read retries.
		await onAnswers(answers)
			.then(() => {
				taken = answers.length;
			})
			.catch(() => {});
	};
}

// The paths of `transcript`'s files, in name order; none while the Harness
// hasn't written one yet, which it may not until the human's first message.
async function transcriptFiles(
	transcript: HarnessTranscriptFiles | undefined,
): Promise<string[]> {
	if (transcript === undefined) return [];
	const glob = new Bun.Glob(transcript.pattern);
	const files = await Array.fromAsync(
		glob.scan({ cwd: transcript.folder, absolute: true, onlyFiles: true }),
	).catch((): string[] => []);
	return files.sort((a, b) => (basename(a) < basename(b) ? -1 : 1));
}

// Empty when the file is gone, as when the human deletes a session.
function readTranscriptFile(file: string): Promise<string> {
	return Bun.file(file)
		.text()
		.catch(() => "");
}

// `command`, a read-only session of `harness`, wrapped so nothing it starts
// can write under `folder`. Throws, naming what to install, when the
// Harness's program isn't on `PATH`, and as `withoutWritesUnder` does.
async function spawnableReadOnly(
	harness: Harness,
	folder: string,
	command: string[],
): Promise<string[]> {
	// Checked here: inside the sandbox a missing program reads only as the
	// sandbox's exit code.
	if (Bun.which(harness.program) === null) {
		throw new Error(
			`${harness.program} isn't on PATH, so no ${harness.title} session can start; install ${harness.title} or put ${harness.program} on PATH`,
		);
	}
	// The Harness's own read-only tools are one guard; the sandbox is the one
	// that holds even when the Harness lets a write through.
	return withoutWritesUnder(folder, command);
}

// What a resumed session is handed in place of the Step's prompt.
const continueMessage =
	"You were interrupted. Continue the task from where you stopped; check the working tree first.\n";

// Runs the agent Step's session, resuming session `resumes` when given. A
// resume that ended on its own without the Harness reporting a session
// never started, so the Step gets one fresh session in its place; one cut
// off by the human or the idle timeout ended as the Run does.
async function runAgent(
	step: AgentStep,
	entry: TicketRunEntry,
	worktree: string,
	stepOutputs: ReadonlyMap<string, string>,
	resumes: string | undefined,
	fd: number,
	interrupt: AbortSignal,
): Promise<{
	outcome: RunOutcome;
	session: HarnessSessionReport;
	resumeHint?: string;
}> {
	const harness = findHarness(step.harness);
	let ran: HarnessSessionRun | undefined;
	if (resumes !== undefined) {
		const command = harness.resumeCommand(resumes, step.model, step.args);
		ran = await runSession({
			harness,
			command,
			spawned: command,
			stdin: continueMessage,
			cwd: worktree,
			fd,
			interrupt,
			idleTimeoutMs: step.idleTimeoutMs,
			onSessionId: (sessionId) => recordRunSession(entry, sessionId),
		});
		if (
			ran.session.sessionId === undefined &&
			!ran.idleTimedOut &&
			!interrupt.aborted
		) {
			writeSync(
				fd,
				`vago: session ${resumes} couldn't be resumed; running the Step in a fresh session\n`,
			);
			await recordRunFellBack(entry);
			ran = undefined;
		}
	}
	if (ran === undefined) {
		const { owner } = entry;
		const { root, goal } = runOwnerGoal(owner);
		const prompt = buildPrompt(step, {
			// `loadWorkflow` refuses `{{ticket}}` in a Goal Step's prompt.
			ticket: owner.kind === "ticket" ? await readTicketBody(owner.ticket) : "",
			goal: await readGoalBody(root, goal),
			goalName: goal,
			stepOutputs,
		});
		const command = harness.command(step.model, step.args);
		ran = await runSession({
			harness,
			command,
			spawned: command,
			stdin: prompt,
			cwd: worktree,
			fd,
			interrupt,
			idleTimeoutMs: step.idleTimeoutMs,
			onSessionId: (sessionId) => recordRunSession(entry, sessionId),
		});
	}
	const { session, code, idleTimedOut } = ran;
	// A session out of the mode asked for is why its calls were denied, so
	// the fallback is the reason to name.
	let outcome: RunOutcome;
	if (idleTimedOut) {
		outcome = { kind: "idle-timeout" };
	} else if (session.permissionModeFallback !== undefined) {
		outcome = { kind: "permission-mode", mode: session.permissionModeFallback };
	} else if (session.permissionDenied) {
		outcome = { kind: "permission-denied" };
	} else {
		outcome = outcomeOf(code);
	}
	return {
		outcome,
		session,
		resumeHint:
			session.sessionId === undefined
				? undefined
				: harness.resumeHint(session.sessionId),
	};
}

// How one Harness session of a Run ended.
type HarnessSessionRun = {
	session: HarnessSessionReport;
	code: number;
	idleTimedOut: boolean;
};

// A Harness session for `runSession` to spawn.
type HarnessSessionSpawn = {
	harness: Harness;
	/** The Harness's argv, which its stream lines are read against. */
	command: string[];
	/** What is spawned: `command`, or `command` wrapped in a sandbox. */
	spawned: string[];
	stdin: string;
	cwd: string;
	/** The log's descriptor, which gets the raw stream and stderr. */
	fd: number;
	interrupt: AbortSignal;
	/** How long the session may stream nothing; no limit when undefined. */
	idleTimeoutMs: number | undefined;
	/** Gets the session's id as soon as the Harness reports it. */
	onSessionId: (sessionId: string) => Promise<void>;
};

// Spawns `session` and waits for it to end. The log gets the raw stream and
// stderr together, so a Harness that fails before streaming (bad login,
// unknown model) still leaves its reason there. The session id goes to
// `onSessionId` as soon as the Harness reports it, so a session still going,
// or one whose `vago` died, can be resumed.
async function runSession(
	session: HarnessSessionSpawn,
): Promise<HarnessSessionRun> {
	const { harness, command, fd, idleTimeoutMs } = session;
	const child = Bun.spawn(session.spawned, {
		cwd: session.cwd,
		stdin: new Blob([session.stdin]),
		stdout: "pipe",
		stderr: fd,
		detached: true,
	});
	const idle = new AbortController();
	const exit = exitCodeOf(
		child,
		AbortSignal.any([session.interrupt, idle.signal]),
		"group",
	);
	const idleTimer =
		idleTimeoutMs === undefined
			? undefined
			: setTimeout(() => idle.abort(), idleTimeoutMs);
	let report: HarnessSessionReport = {};
	const readLine = async (line: string) => {
		const read = harness.readLine(line, command);
		if (read.sessionId !== undefined && read.sessionId !== report.sessionId) {
			await session.onSessionId(read.sessionId);
		}
		report = { ...report, ...read };
	};
	const decoder = new TextDecoder();
	let partial = "";
	for await (const chunk of child.stdout) {
		idleTimer?.refresh();
		// Written as it arrives, so `tail -f` on the log follows the Run live.
		writeSync(fd, chunk);
		const lines = (partial + decoder.decode(chunk, { stream: true })).split(
			"\n",
		);
		partial = lines.pop() ?? "";
		for (const line of lines) await readLine(line);
	}
	clearTimeout(idleTimer);
	await readLine(partial + decoder.decode());
	const code = await exit;
	return { session: report, code, idleTimedOut: idle.signal.aborted };
}

// A signal that aborts on any of `signals` until `release` is called, so
// `vago` takes the signal and stops what it started itself: a detached
// session or command, in a process group of its own out of reach of the
// terminal's Ctrl-C, or an interactive session, which a closed terminal
// would leave running.
function interruptOnSignal(signals: NodeJS.Signals[]): {
	signal: AbortSignal;
	release: () => void;
} {
	const interrupt = new AbortController();
	const abort = () => interrupt.abort();
	for (const name of signals) process.on(name, abort);
	return {
		signal: interrupt.signal,
		release: () => {
			for (const name of signals) process.off(name, abort);
		},
	};
}

/**
 * `outcome` as the Ticket header, the Step lines and the `stuck` message all
 * spell it: `ok`, `exit 1`, `permission-mode default`.
 */
export function spellOutcome(outcome: RunOutcome): string {
	// Each kind is named as it's spelled, so only the ones with a value add it.
	if (outcome.kind === "exit") return `exit ${outcome.code}`;
	if (outcome.kind === "permission-mode") {
		return `permission-mode ${outcome.mode}`;
	}
	return outcome.kind;
}

// A shell Run's output for later Steps' prompts.
function shellOutput(code: number, log: string): string {
	return `exit code ${code}\n${log}`;
}

// Stops the child when `stop` aborts, at once if it already has, as when the
// signal came while the Step was still being set up: the group it leads when
// it was spawned detached, or the child alone, which leads no group. Resolves
// to the exit code once the child has exited and, if it was stopped, once
// what was signalled is gone too, since a leader can exit while the rest of
// its group still ignores SIGTERM.
async function exitCodeOf(
	child: Bun.Subprocess,
	stop: AbortSignal,
	scope: "group" | "process",
): Promise<number> {
	let stopping: Promise<void> | undefined;
	const startStopping = () => {
		stopping = stopProcesses(scope === "group" ? -child.pid : child.pid);
	};
	if (stop.aborted) startStopping();
	else stop.addEventListener("abort", startStopping, { once: true });
	const code = await child.exited;
	stop.removeEventListener("abort", startStopping);
	await stopping;
	return code;
}

// Long enough for a Harness to stop the tool commands it started.
const stopGraceMs = 5_000;

// `target` as `process.kill` takes it: a pid, or a group leader's pid negated
// for the whole group. The whole group of a detached child, since a process
// the Step started would otherwise live on and could hold the Harness's
// stdout open, so its stream would never end. SIGTERM first, because a
// Harness can run its tool commands in process groups of their own, which no
// signal to this group reaches, and only the Harness can stop them. SIGKILL
// after the grace period, because a Step that ignores SIGTERM must still end.
// Resolves once the target is gone or has been sent SIGKILL.
async function stopProcesses(target: number): Promise<void> {
	const deadline = Date.now() + stopGraceMs;
	signalTarget(target, "SIGTERM");
	while (signalTarget(target, 0)) {
		if (Date.now() >= deadline) {
			signalTarget(target, "SIGKILL");
			return;
		}
		await Bun.sleep(50);
	}
}

// False when the target is gone, as it is already when the signal comes just
// after the Step ended. Signal 0 only asks whether it is alive. macOS answers
// EPERM, not ESRCH, while every process left in a group is a zombie waiting
// to be reaped, and no signal can reach such a group either.
function signalTarget(target: number, signal: NodeJS.Signals | 0): boolean {
	try {
		process.kill(target, signal);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code !== "ESRCH" && code !== "EPERM") throw error;
		return false;
	}
}

function outcomeOf(code: number): RunOutcome {
	return code === 0 ? { kind: "ok" } : { kind: "exit", code };
}
