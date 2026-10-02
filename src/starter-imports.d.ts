// Types for the starter files `init.ts` imports `with { type: "text" }`.
// Bun hands over each file's text, and `bun build --compile` embeds it in the
// binary. Bun's own types read any `.toml` import as parsed TOML of type `any`.

declare module "*.md" {
	const text: string;
	export default text;
}

declare module "*/workflow.toml" {
	const text: string;
	export default text;
}

declare module "*.sh" {
	const text: string;
	export default text;
}
