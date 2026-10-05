// Test helper: a fake `gh` that keeps one repo's pull requests and labels in
// a JSON file, for the starter's scripts to drive without a real GitHub.

import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A pull request as the fake keeps it. */
export type FakePullRequest = {
	base: string;
	title: string;
	body: string;
	labels: string[];
	/** The body of each comment, oldest first. */
	comments: string[];
};

/** What the fake's repo holds. */
export type FakeGitHub = {
	/** The pull requests by head branch. */
	pullRequests: Record<string, FakePullRequest>;
	/** The labels defined in the repo. */
	labels: string[];
	/** Calls still to fail, each once, before doing anything. */
	failures: FakeGhFailure[];
};

/** A `gh` call to fail, and the error it prints. */
export type FakeGhFailure = {
	/** The call's subcommands, as `pr create`. */
	call: string;
	message: string;
};

/** A fake `gh`, ready to put on the `PATH` of a `vago` child. */
export type FakeGh = {
	/** Environment for `runVago` that puts the fake first on `PATH`. */
	env: Record<string, string>;
	/** The repo as the calls so far left it. */
	state(): Promise<FakeGitHub>;
	/**
	 * Makes the next `call` fail, printing `message` to stderr and changing
	 * nothing, as GitHub's errors do. The calls after it work again.
	 */
	failNext(call: string, message: string): Promise<void>;
};

/**
 * Writes a fake `gh`, logged in as `login`, into a fresh temp directory. It
 * knows the subcommands the starter's scripts call, ignores `--jq` and
 * prints what the scripts ask it for, and fails, as `gh` does, on a `pr`
 * call for a branch with no PR and on adding a label the repo doesn't have.
 * A `pr create` with no `--base` targets the repo's default branch, as on
 * GitHub: the branch that the `origin` remote's HEAD points to.
 */
export async function makeFakeGh(login: string): Promise<FakeGh> {
	const dir = await mkdtemp(join(tmpdir(), "vago-fake-gh-"));
	const stateFile = join(dir, "state.json");
	const empty: FakeGitHub = { pullRequests: {}, labels: [], failures: [] };
	await Bun.write(stateFile, JSON.stringify(empty));
	const program = join(dir, "gh");
	await Bun.write(
		program,
		`#!${process.execPath}\nimport { runFakeGh } from ${JSON.stringify(import.meta.path)};\nawait runFakeGh(${JSON.stringify(stateFile)}, ${JSON.stringify(login)});\n`,
	);
	await chmod(program, 0o755);
	const state = async (): Promise<FakeGitHub> =>
		JSON.parse(await Bun.file(stateFile).text());
	return {
		env: { PATH: `${dir}:${process.env.PATH}` },
		state,
		failNext: async (call, message) => {
			const repo = await state();
			repo.failures.push({ call, message });
			await Bun.write(stateFile, JSON.stringify(repo));
		},
	};
}

/** The fake's program: runs one `gh` call against the repo in `stateFile`. */
export async function runFakeGh(
	stateFile: string,
	login: string,
): Promise<void> {
	const state: FakeGitHub = JSON.parse(await Bun.file(stateFile).text());
	const argv = process.argv.slice(2);
	const flag = (name: string) => {
		const at = argv.indexOf(name);
		return at === -1 ? undefined : argv[at + 1];
	};
	const fail = (message: string): never => {
		console.error(message);
		process.exit(1);
	};
	const [group, command, target = ""] = argv;
	const call = `${group} ${command}`;
	const failure = state.failures.find((failing) => failing.call === call);
	if (failure !== undefined) {
		state.failures.splice(state.failures.indexOf(failure), 1);
		await Bun.write(stateFile, JSON.stringify(state));
		fail(failure.message);
	} else if (call === "api user") {
		console.log(login);
	} else if (call === "label create") {
		if (!state.labels.includes(target)) state.labels.push(target);
	} else if (call === "pr create") {
		state.pullRequests[flag("--head") ?? ""] = {
			base: flag("--base") ?? originHead(),
			title: flag("--title") ?? "",
			body: flag("--body") ?? "",
			labels: [],
			comments: [],
		};
	} else if (group === "pr") {
		const pullRequest =
			state.pullRequests[target] ??
			fail(`no pull requests found for branch "${target}"`);
		const body = flag("--body");
		const label = flag("--add-label");
		if (call === "pr view" && flag("--json") === "comments") {
			for (const comment of pullRequest.comments) console.log(comment);
		} else if (call === "pr comment" && body !== undefined) {
			pullRequest.comments.push(body);
		} else if (call === "pr edit" && body !== undefined) {
			pullRequest.body = body;
		} else if (call === "pr edit" && label !== undefined) {
			if (!state.labels.includes(label)) fail(`'${label}' not found`);
			if (!pullRequest.labels.includes(label)) pullRequest.labels.push(label);
		} else if (call !== "pr view") {
			fail(`the fake gh doesn't know: gh ${argv.join(" ")}`);
		}
	} else {
		fail(`the fake gh doesn't know: gh ${argv.join(" ")}`);
	}
	await Bun.write(stateFile, JSON.stringify(state));
}

// The branch the bare repo behind the `origin` remote of the current
// directory has its HEAD on.
function originHead(): string {
	const git = (...args: string[]) =>
		Bun.spawnSync(["git", ...args])
			.stdout.toString()
			.trim();
	return git(
		"-C",
		git("remote", "get-url", "origin"),
		"symbolic-ref",
		"--short",
		"HEAD",
	);
}
