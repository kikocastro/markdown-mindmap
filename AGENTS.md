# Agent guide

Canonical instructions for coding agents in this repo. `CLAUDE.md` and `GEMINI.md` are symlinks to this file, so every tool reads one source.

## What this is

Leveled left-to-right mind maps from note frontmatter links, with **two adapters over one shared core**: an Obsidian plugin and a VS Code extension. One ` ```mindmap ` YAML block per map (see `README.md`). A block renders as one of three **view types** (`view: map | gantt | kanban`): the same collected + filtered tree laid out as a tree of cards, a gantt (bars by `gantt.start`/`gantt.end`, milestone diamonds), or a kanban board (columns by `kanban.groupBy`). Filters/search/collapse apply before layout, so they work in every view. A second block type, ` ```causalmap `, renders causal-loop diagrams (systems-thinking graphs with automatic cycle detection) — Obsidian only for now.

## Architecture

- `src/core/` — **pure core.** No host coupling. Modules: `config` (types + defaults), `helpers`, `collect`, `edges`, `visibility`, `layout-tree`, `layout-gantt`, `layout-kanban`, `views`, `render-model` (`buildRenderModel` -> the serializable `RenderModel` both adapters draw; dispatches on the view type), `export` (HTML/Excalidraw export builders). All unit-tested. **Shared by both adapters.**
- `src/graph.ts` — re-exporting barrel over `src/core/`; every import path goes through it.
- `src/causal.ts` — **pure causal-map core.** Imports only from `graph.ts`. Signed-edge collection, cycle detection, loop polarity, force-directed layout. Same rules as the core: host-free, 100% covered.
- `src/render/` — **shared SVG renderer** (`renderer.ts` draws a `RenderModel` into an injected document/SVG root for all three views; `panzoom.ts` owns pan/zoom/fit). The only DOM code outside the adapters; coverage-excluded like them, but lint-covered and bundled into both builds.
- `src/obsidian/main.ts` — **Obsidian adapter** (with `src/obsidian/causal.ts` for ` ```causalmap ` blocks); only these files import `obsidian`. Owns host I/O (vault read, resolver, code-block processor, YAML write-back), toolbar/state wiring, exports, and the note `Modal`. Builds `main.js`.
- `src/vscode/` — **VS Code adapter.** `extension.ts` (host: reads workspace markdown, runs `buildRenderModel`, posts the `RenderModel`), `webview.ts` (bootstrap: shared renderer + pan/zoom + click-to-open). Builds `dist/extension.js` + `dist/webview.js`.
- `styles.css` — Obsidian theming via CSS variables. (VS Code styling is inline in the webview HTML shell, using `--vscode-*` vars.)
- `test/` — vitest, exercising the core through plain `NoteLike` data (host-agnostic).

**Invariant: keep `src/graph.ts` (and everything under `src/core/`) host-free.** No `from "obsidian"`, no `from "vscode"`, no DOM. New pure logic and its tests go there; only host glue goes in the adapters.

## Commands

```bash
npm run build      # typecheck + esbuild production -> main.js (Obsidian) + dist/ (VS Code)
npm run dev        # esbuild watch (all targets)
npm test           # vitest run --coverage
npm run typecheck  # tsc --noEmit, strict + noUnused* + noImplicit*
```

Obsidian loads `main.js` + `manifest.json` + `styles.css`. VS Code loads `dist/extension.js` (command **Markdown Mindmap: Open Map**) which reads the `mindmap` block from the active note. `main.js` and `dist/` are generated (gitignored).

## Releasing (Obsidian)

Never hand-edit version numbers or hand-attach release assets. Both broke before.

```bash
npm version patch   # bumps package.json + manifest.json + versions.json, commits, tags (bare, no "v")
git push --follow-tags
```

`npm version` runs `version-bump.mjs` (keeps manifest/versions in sync) and tags bare per `.npmrc`. Pushing the tag triggers `.github/workflows/release.yml`, which builds and creates the GitHub release with `main.js` + `manifest.json` + `styles.css` attached. Obsidian needs all three on the release or users never get the update; the workflow also fails if the tag and `manifest.json` version disagree.

## Conventions

- **TDD on the core.** Test-first for anything under `src/core/` (via the `src/graph.ts` barrel): red, watch it fail, green. Pre-commit and pre-push hooks run typecheck + tests.
- DOM code in `main.ts` and `src/render/` is validated by build + manual Obsidian check (not unit-tested; the established split is "pure logic is tested, rendering is not").
- Mark deliberate simplifications with a `// ponytail:` comment naming the ceiling.
