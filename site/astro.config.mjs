import { defineConfig } from "astro/config";
import { siteUrl } from "./src/site.ts";

export default defineConfig({
	site: siteUrl,
	// Code blocks take their colours from CSS variables, which the docs layout maps onto the site's tokens.
	markdown: { shikiConfig: { theme: "css-variables" } },
});
