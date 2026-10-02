// Types for the starter files `init.ts` imports `with { type: "text" }`.
// Bun hands over each file's text, and `bun build --compile` embeds it in the
// binary. Bun's own types read any `.toml` import as parsed TOML of type `any`;
// the Workflow pattern below wins over theirs because its prefix is longer, so
// a new starter Workflow needs no line here.

declare module "*.md" {
	const text: string;
	export default text;
}

declare module "../starter/workflows/*" {
	const text: string;
	export default text;
}

declare module "*.sh" {
	const text: string;
	export default text;
}
