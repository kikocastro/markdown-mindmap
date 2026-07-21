# Examples

Three self-contained maps. Each reads only the notes under its own folder.

## `mindmap-demo`

Vision -> areas -> features -> tasks, wired by `area:` and `feature:` frontmatter links. Exercises per-level colours, a reverse list-valued edge, category bars, a status/track/priority filter, a `where` filter, progress bars, and a dashed secondary link.

## `ost-demo`

An Opportunity Solution Tree (outcome -> opportunities -> solutions -> experiments) for a streaming service. Same features as above plus interview-quote subtitles, discipline bars, and a saved view.

## `causalmap-demo`

A ` ```causalmap ` causal-loop diagram of a delivery team stuck in firefighting. Exercises node types/colours, signed edges (dashed `−`), three declared loops with loop cards (reinforcing + balancing), one auto-detected unnamed loop, a `where` filter hiding a dormant card, and id/wikilink edge resolution. Obsidian only.

## Running them

**Obsidian:** copy the demo folder (`mindmap-demo` or `ost-demo`) into the **root** of your vault (the `from:` paths are vault-root-relative, e.g. `mindmap-demo/areas`), then open the demo note in Reading view or Live Preview. If you put the folder elsewhere, repoint the `from:` paths to match.

**VS Code:** pressing `F5` in the repo opens the Extension Development Host with this `examples/` folder as the workspace root, so the demos' `from:` paths already resolve. Open a demo note and run **Markdown Mindmap: Open Map**. See the [VS Code section](../README.md#vs-code) of the main README.
