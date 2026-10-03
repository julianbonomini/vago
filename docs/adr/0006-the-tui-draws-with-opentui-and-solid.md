# The TUI draws with OpenTUI and Solid

The TUI uses OpenTUI (`@opentui/core`, with `@opentui/solid` and `solid-js`) to draw the screen, and its views are Solid components. OpenTUI's renderer is a Zig library loaded through `bun:ffi`, so `vago` stops being pure TypeScript inside its single binary. A test on 2026-10-03 (Bun 1.4.2, macOS arm64) found `@opentui/core` 0.5.14 renders from a `bun build --compile` binary and adds about 11 MB to it. Solid updates only the text whose data changed, so views with live data need no hand-written code to keep the screen in sync with the Ticket files.

## Considered options

- Hand-rolled ANSI with `Bun.stringWidth`: no dependencies and nothing native, but an estimated 300 to 500 lines of cursor, key and repaint code before the first view, and every view keeps its screen in sync by hand.
- OpenTUI's core without a framework: no JSX, closer to the plain-TypeScript rule, but the same hand-written syncing once several views show live data.
- OpenTUI with React: more packages than Solid, and hooks rules on top.
- Ink: needs React and JSX, and compiled only after installing `react-devtools-core` as a workaround.
- blessed forks and terminal-kit: unmaintained, or heavy dependencies, and none target Bun.

## Consequences

- OpenTUI is 0.x and releases nightly, so its version is pinned and upgraded on purpose.
- Bun has broken loading OpenTUI's library from compiled binaries before (oven-sh/bun#30717, #44238), so a test runs the compiled `vago` and opens the TUI.
- OpenTUI's Markdown and tree-sitter worker isn't embedded in compiled binaries (anomalyco/opentui#807) and falls back to plain text, so the TUI doesn't use it.
- Solid's JSX needs its transform at build time, in `bun test`, `bun run` and the compiled binary. The prototype (branch `prototype/tui`, `build.ts`) found two conditions for the binary. It is built by a `Bun.build` script with `@opentui/solid/bun-plugin`: a plain `bun build --compile` draws the first frame and never updates, with no error, so the test that opens the compiled `vago` checks a second frame. And the build sets `compile: { autoloadBunfig: false }`, or the binary loads the repo's `bunfig.toml` preload when run inside it and dies with `preload not found`.
- TUI tests render views from fixture `.vago-goals/` folders through OpenTUI's test renderer and check the frame's text.
