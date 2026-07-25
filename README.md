# Markdown Mindmap

[![coverage](https://raw.githubusercontent.com/kikocastro/markdown-mindmap/gh-pages/badges/coverage.svg)](https://github.com/kikocastro/markdown-mindmap/actions/workflows/test.yml)

An [Obsidian](https://obsidian.md) plugin that renders configurable mind maps (leveled, left-to-right trees) **live from your notes' frontmatter links**. Each map is a single fenced ` ```mindmap ` code block, so you can drop as many maps as you like anywhere in your vault. There is no separate data file to keep in sync: the tree is rebuilt from your notes every time you open it.

Point it at some folders, tell it which frontmatter field links each note to its parent, and it draws the graph: a column per level, curved edges, hover to highlight a node's lineage, click to open the note, collapse/expand subtrees, filter, and search.

It ships as **two adapters over one shared core** (`src/graph.ts`): the **Obsidian plugin** (the full experience described below, rendered inline in a note) and a **VS Code extension** (a command opens the map in a panel — see [VS Code](#vs-code)). The feature list below describes the Obsidian plugin; the VS Code adapter is intentionally minimal for now (render + pan/zoom + click-to-open).

## Screenshots

![Overview — map with sidebar filters](assets/screenshot-overview.png)

| Card dialog                                                                                             | Hover lineage                                                                    |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ![Card dialog showing parents, siblings, children and rendered note](assets/screenshot-card-dialog.png) | ![Hover highlighting a node's full lineage](assets/screenshot-hover-lineage.png) |

| Saved views                                                                | Search highlight                                                    | Titles only                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| ![Save current filters as a named view](assets/screenshot-saved-views.png) | ![Search spotlighting matching cards](assets/screenshot-search.png) | ![Titles-only mode](assets/screenshot-titles-only.png) |

| Causal map overview                                                                       | Causal loop spotlight                                                            |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ![Causal map overview with loop and type rails](assets/screenshot-causalmap-overview.png) | ![Causal map spotlighting the morale loop](assets/screenshot-causalmap-loop.png) |

## Features

- **Live from frontmatter.** Folders become columns; frontmatter links become edges. Add or remove a note and the map updates.
- **Three views over one dataset.** The same block renders as a mind **map**, a **gantt** (bars by start/due, progress fill, status colours, a _today_ marker, milestone diamonds), or a **kanban** board (columns by any field) — switch from the toolbar, filters and search apply everywhere.
- **Per-level card design.** Pick which fields show as title / subtitle / meta per level; cards auto-size to their content.
- **Edges from links.** A `[[wikilink]]`, plain title, basename, list, or nested field (`customFields.serves`) on either end of an edge.
- **Secondary (dashed) links.** Mark cross-links that should draw dashed and stay out of the layout spine (e.g. "also relates to").
- **Bar charts & progress bars.** Render a 0–100 field as a progress bar, or a list field as a stacked count-by-category bar.
- **Multi-select filters and saved views.** Toggle-chip filters per property (OR within a property, AND across), then save named filter combinations back into the map block. Each saved view also remembers which subtrees are collapsed and which view type it opened in, and the one you pick is remembered across Obsidian restarts.
- **Strict or hierarchy-aware filtering.** By default a filtered-out note takes its subtree with it; set `filterKeepsHierarchy: true` to keep matches in context — their subtasks ride along and their ancestors stay visible.
- **Export.** Save the current view next to the note as a standalone HTML file or an editable Excalidraw drawing.
- **Search highlight.** A search box that spotlights matching cards and dims the rest.
- **Collapse / expand** any subtree, focus a node's lineage/subtree, **pan / zoom / fit / fullscreen**; click a card for a dialog with its linked parents/siblings/children, optional properties, and the rendered note.
- **Theme-aware.** Uses Obsidian CSS variables, so it follows your light/dark theme.

## How it works

A map is a list of **levels**. Each level reads notes from a `from:` folder and becomes a **column** (left to right, in the order you list them). **Edges** connect levels: an edge says _"notes in the child level point up to a note in the parent level via frontmatter field X"_.

```
 LEVEL 0          LEVEL 1              LEVEL 2
 ┌──────────┐     ┌──────────────┐     ┌────────────┐
 │  Goal A  │────▶│  Project 1   │────▶│   Task …    │
 │          │──┐  └──────────────┘     └────────────┘
 └──────────┘  │  ┌──────────────┐     ┌────────────┐
               └─▶│  Project 2   │────▶│   Task …    │
                  └──────────────┘     └────────────┘
        edge: project.goal=[[Goal A]]    edge: task.project=[[Project 1]]
```

## Install

### Community plugins (recommended)

[Markdown Mindmap](https://community.obsidian.md/plugins/markdown-mindmap) is in the Obsidian community plugin store:

1. **Settings → Community plugins → Browse**.
2. Search **"Markdown Mindmap"**, **Install**, then **Enable**.

Updates arrive through Obsidian's normal plugin-update flow.

### Manual (local testing / latest build)

1. Get the three build files (`main.js`, `manifest.json`, `styles.css`) — either from a [Release](../../releases) or by building from source (`npm install && npm run build`).
2. Copy them into `<your-vault>/.obsidian/plugins/markdown-mindmap/`.
3. Reload Obsidian, then **Settings → Community plugins → enable "Markdown Mindmap"**.

### BRAT

Once a release is published, install with [BRAT](https://github.com/TfTHacker/obsidian42-brat): _Add beta plugin_ → `kikocastro/markdown-mindmap`. BRAT-managed plugins also survive Obsidian Sync, unlike a hand-copied folder.

## Quick start

Put this in any note (Reading view or Live Preview):

````markdown
```mindmap
title: Goals → Projects → Tasks
levels:
  - id: goals
    label: GOALS
    from: planning/goals
    card: { title: title, sub: kpi }
  - id: projects
    label: PROJECTS
    from: planning/projects
    card: { title: title, meta: [status] }
  - id: tasks
    label: TASKS
    from: planning/tasks
    card: { title: title, meta: [status], progress: progress }
edges:
  - { from: goals,    to: projects, via: goal }     # each project note: goal: "[[Goal A]]"
  - { from: projects, to: tasks,    via: project }  # each task note: project: "[[Project 1]]"
filter: [status]
```
````

> A runnable copy of this map, with sample notes, lives in [`examples/mindmap-demo/`](examples/mindmap-demo). Copy that folder into your vault root and open `Mindmap demo.md`. A second, richer tree — an Opportunity Solution Tree with interview-quote subtitles and a saved view — lives in [`examples/ost-demo/`](examples/ost-demo). See [`examples/README.md`](examples/README.md) for what each demo exercises.

## Configuration reference

**Top level**

| Key                    | Type            | Meaning                                                                                                                                                    |
| ---------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`                | string          | Heading in the toolbar.                                                                                                                                    |
| `height`               | number          | Component height in px (default `900`).                                                                                                                    |
| `view`                 | string          | Initial view: `map` (default), `gantt`, or `kanban`.                                                                                                       |
| `levels`               | list            | Columns, left to right. **Required.**                                                                                                                      |
| `edges`                | list            | Parent → child links between levels.                                                                                                                       |
| `gantt`                | map             | Gantt view config (see [Gantt & kanban views](#gantt--kanban-views)). Configuring it adds the view to the switcher.                                        |
| `kanban`               | map             | Kanban view config (same section). Configuring it adds the view to the switcher.                                                                           |
| `filter`               | list of strings | Frontmatter properties exposed as multi-select chip filters.                                                                                               |
| `filterLabels`         | map             | Rename a filter group's heading, e.g. `{ customFields.quarters: Quarter }`. Unlisted properties keep their raw name.                                       |
| `filterKeepsHierarchy` | boolean         | Default `false` (strict): a filtered-out note hides itself **and** its subtree. `true` keeps context (below).                                              |
| `layout`               | map             | Override card/column sizing (below). All keys optional.                                                                                                    |
| `properties`           | boolean         | When `true`, the note dialog shows all frontmatter as a table above the rendered note.                                                                     |
| `views`                | list            | Saved views (filters + collapse + view mode), managed by the toolbar's saved-view controls.                                                                |
| `activeView`           | string          | Name of the saved view to re-select on render. Written by the toolbar when you pick one, so the choice survives an Obsidian restart; cleared by **Reset**. |

**`layout`** (all optional, defaults shown)

| Key          | Default | Meaning                                                                                                                          |
| ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `cardWidth`  | `270`   | Card width in px.                                                                                                                |
| `cardHeight` | `44`    | **Minimum** card height in px. Cards auto-size to their content (title lines, sub, meta, bar, labels); this only sets the floor. |
| `columnGap`  | `150`   | Horizontal gap between columns.                                                                                                  |
| `rowGap`     | `12`    | Vertical gap between stacked cards.                                                                                              |
| `top`        | `64`    | Top margin before the first card.                                                                                                |
| `titleLines` | `2`     | Title lines shown before truncating. Set `3` to allow longer titles; cards grow to fit automatically.                            |
| `subLines`   | `1`     | Subtitle (`sub`) lines shown before truncating. Set `2`+ to wrap a long subtitle onto multiple lines; cards grow to fit.         |

**Each level**

| Key     | Type       | Meaning                                                                                                                                                                                                                                              |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`    | string     | Unique id, referenced by edges. **Required.**                                                                                                                                                                                                        |
| `from`  | string     | Folder to read notes from (recursive). **Required.**                                                                                                                                                                                                 |
| `label` | string     | Column header.                                                                                                                                                                                                                                       |
| `color` | hex string | Column / card-border colour. Defaults cycle the [flatuicolors _defo_](https://flatuicolors.com/palette/defo) palette.                                                                                                                                |
| `where` | map        | Keep only notes whose frontmatter matches a value, e.g. `{ horizon: now }` to use only drivers with `horizon: now`, or `{ parentId: null }` to keep top-level notes (a `null` target matches null, empty, **or** missing). Multiple keys are AND-ed. |
| `card`  | map        | Which fields render on the card (below).                                                                                                                                                                                                             |

**Each card**

All card field values are frontmatter property names. Dotted paths work everywhere (`customFields.serves`, `nested.key`).

| Key        | Type             | Renders                                                                                                                                                                             |
| ---------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`    | field            | Bold title (falls back to the file name).                                                                                                                                           |
| `sub`      | field            | Subtitle line.                                                                                                                                                                      |
| `meta`     | list of fields   | A muted `·`-joined line.                                                                                                                                                            |
| `progress` | field (0–100)    | A progress bar.                                                                                                                                                                     |
| `bars`     | field **or** map | A stacked count-by-category bar (below).                                                                                                                                            |
| `labels`   | list of fields   | Small colored value pills along the card's bottom strip, one per field (e.g. `[kind, horizon, stage]`). Empty/missing fields drop out; pills that don't fit on one row are skipped. |

**`bars`** — either a field name (string) or a map:

| Key        | Type                | Meaning                                                                                                                                            |
| ---------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `field`    | field               | The list field to count. **Required.**                                                                                                             |
| `category` | `parens` \| `value` | How to derive each category. `parens` (default): text in trailing parens, else the value (`"Acme (client)"` → `client`). `value`: the whole value. |
| `colors`   | map                 | `category → hex`. Categories not listed cycle the auto palette. Omit to use the built-in `client`/`prospect`/`trial`/`customer` defaults.          |

`bars: demand` is shorthand for `bars: { field: demand, category: parens }`.

**Each edge**

| Key         | Type     | Meaning                                                                                                                                                          |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `from`      | level id | Parent level.                                                                                                                                                    |
| `to`        | level id | Child level.                                                                                                                                                     |
| `via`       | field    | The frontmatter field holding the link. By default it lives on the **`to`** notes and points up to a **`from`** note. Dotted paths work (`customFields.serves`). |
| `reverse`   | bool     | Set `true` when the field lives on the **`from`** notes and points down (e.g. a `serves:` list).                                                                 |
| `secondary` | bool     | Draw the edge **dashed** and keep it out of the layout spine (for "also relates to" cross-links).                                                                |

### How links resolve

A `via` value is matched, in order, against: Obsidian's own link resolution (`[[wikilink]]`), then the target's **basename**, then its `title` frontmatter, then its `id` frontmatter (so pm-style `parentId: p-broker-operator` hierarchies link up). A value may be a single link or a list. A note's **first non-secondary** parent is its layout parent (single-parent tree); any extra parents still draw edges.

### How filters treat the hierarchy

A filter only constrains notes that **have** the property — a note missing it is never filtered out by that chip. What differs is what happens to the notes around a match:

- **Strict (default).** A note that fails the filter hides itself and its whole primary subtree. Good for "show me only the devops tasks", where a parent that isn't devops shouldn't drag its children in.
- **`filterKeepsHierarchy: true`.** A match keeps its context: its primary **subtree rides along** (a matching epic still shows its subtasks, whatever their own status) and its **ancestors stay visible** as scaffolding. Good for a roadmap where you want the tree shape intact around the hits.

Collapse always applies last, so a contracted subtree stays hidden under either mode.

## Gantt & kanban views

The same collected + filtered tree can render as a **gantt** or a **kanban** board. Add the config block(s) and a view switcher appears in the toolbar; set `view:` to make one the default. Filters, search, collapse, and saved views apply in every view — a saved view pins **filters + view mode**, so you can keep e.g. a "devops · gantt" view one click away.

````markdown
```mindmap
title: 2026 Roadmap
view: gantt
levels:
  - id: tasks
    from: strategy/2026 Roadmap_tasks
    where: { parentId: null }
    card: { title: title, labels: [status], meta: [start, due], progress: progress }
  - id: subtasks
    from: strategy/2026 Roadmap_tasks
    card: { title: title, progress: progress }
edges:
  - { from: tasks, to: subtasks, via: parentId }
gantt: { start: start, end: due }
kanban: { groupBy: status }
filter: [status, tags]
```
````

**`gantt`** — field names are frontmatter properties, like everything else:

| Key           | Type                                     | Meaning                                                                                                                                                  |
| ------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`       | field                                    | Start date (ISO, e.g. `2026-06-09`). **Required.**                                                                                                       |
| `end`         | field                                    | End/due date. **Required.**                                                                                                                              |
| `progress`    | field (0–100)                            | Bar fill. Defaults to the card's `progress` field.                                                                                                       |
| `status`      | field                                    | Field driving the bar/milestone colour (default `status`). See the status colours below.                                                                 |
| `scale`       | `week` \| `month` \| `quarter` \| `year` | Axis tick unit (default `month`). Also switchable from the toolbar's Scale chips.                                                                        |
| `density`     | `compact` \| `comfortable`               | Default `compact`. `comfortable` scales up rows and fonts for reading from a distance (presentations). Also switchable from the toolbar's Density chips. |
| `sortByStart` | bool                                     | Default `true`: rows sort by crescent start date (dateless last). `false` restores the raw tree/path order.                                              |
| `groupRows`   | bool                                     | Default `true`: rows follow the tree order with subtasks indented under parents. `false`: flat path order.                                               |
| `showLabels`  | bool                                     | Default `true`: the card's `labels`, `·`-joined, on a discreet second line under the row title. `false` drops them for a barer chart.                    |

Rows render as bars from `start` to `end` with a progress fill. A task whose `start` equals its `end` (or that has only one of the two) renders as a **milestone diamond**. Tasks with neither date get a plain row. Click a row to open the note; hover one for a native tooltip with the full title, date range, status, progress, and tags. A vertical **today** marker is drawn when the current date falls inside the charted range.

`sortByStart` sorts _within_ the hierarchy: siblings (and roots) are ordered by start date, but children stay grouped under their parent — the tree is never flattened. Nested items can be contracted/expanded with a per-row toggle, sharing the map view's collapse state, so saved views' collapsed lists apply here too. The toolbar's **show subtasks** chip (under **Rows**) expands/contracts every parent row at once; it's on by default, so the gantt opens with nested rows showing.

**Status colours.** Bars and milestones colour themselves from the `status` field, matched case- and space-insensitively: green for `done` / `complete` / `completed` / `closed` / `shipped`, blue for `in progress` / `in-progress` / `doing` / `active` / `wip` / `started` / `ongoing`, grey for `todo` / `to do` / `planned` / `backlog` / `open` / `not started` / `new` / `pending`. Any other (or missing) value falls back to the level's colour.

**`kanban`**

| Key       | Type            | Meaning                                                                                                  |
| --------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `groupBy` | field           | Column key (e.g. `status`). **Required.**                                                                |
| `columns` | list of strings | Explicit column order. Unlisted values found in the data are appended; valueless notes land in `(none)`. |
| `colors`  | map             | `value → hex` for column headers. Unlisted columns cycle the auto palette.                               |

Cards are the same cards as the map (title/sub/meta/progress/labels config all apply), stacked into columns by `groupBy` value.

### Migrating from the Project Manager plugin

Task notes written by Project Manager (`pm-task: true` frontmatter with `status`, `start`, `due`, `progress`, `priority`, `assignees`, `tags`, `parentId`/`subtaskIds`, `customFields.*`) render as-is: point a level's `from:` at your `*_tasks` folder, add the `gantt:`/`kanban:` blocks above, done. The plugin never writes task files — edit the note and the view re-renders. Editing, drag-rescheduling, notifications, recurring tasks, and the table view are deliberate non-goals.

## Advanced example

A product strategy tree, showing secondary dashed links, demand bars, and progress bars:

````markdown
```mindmap
title: North Star → Drivers → Opportunities → Roadmap
height: 860
properties: true
levels:
  - { id: northstar, label: NORTH STAR,   from: strategy/north-star,   color: "#1abc9c", card: { title: title, sub: metric } }
  - { id: drivers,   label: DRIVERS,       from: strategy/drivers,      color: "#9b59b6", card: { title: title, sub: metric } }
  - { id: opps,      label: OPPORTUNITIES, from: strategy/opportunities, color: "#e67e22", card: { title: title, labels: [kind, horizon], bars: demand } }
  - { id: roadmap,   label: ROADMAP,       from: strategy/roadmap,      color: "#e74c3c", where: { parentId: null }, card: { title: title, meta: [status], progress: progress } }
edges:
  - { from: drivers, to: opps,    via: ladders-to }
  - { from: opps,    to: roadmap, via: serves }
  - { from: opps,    to: roadmap, via: alsoServes, secondary: true }   # dashed
filter: [horizon, kind, status]
```
````

## Interactions

The toolbar is a sidebar rail down the left of the map: title and search at the top, then the chip groups (**View**, **Scale**, **Density**, **Rows**, one per filter property, **Saved views**), then a footer with **Display**, **Export**, and the **Reset** / **Help** row.

- **Search** box — spotlight cards matching title / sub / meta, dim the rest.
- **View** chips — flip the same data between map / gantt / kanban (shown when `gantt:` or `kanban:` is configured).
- **Scale** / **Density** / **Rows** chips — gantt only: axis unit (week / month / quarter / year), compact vs comfortable row size, and **show subtasks** to expand or contract every parent row at once.
- **Filter chips** — multi-select per property (OR within, AND across), with options sorted alphabetically.
- **Saved views** — save the current filter combination + view mode, apply it from the dropdown, edit it, or delete it. Each view also stores which subtrees are collapsed, so applying it restores that shape. Saved views are written to the block's `views:` key, and the selected one to `activeView:`.
- **Export** — save the current view next to the note as a standalone `.html` file or an editable `.excalidraw` drawing. Both capture what's on screen now, including the active filters, collapse state, and view type.
- **Hover** a card — highlight its full up/down lineage (in gantt and kanban too, walking the same parent tree).
- **Click** a card — open a dialog: title + file name, level badge, progress/demand breakdown, its **linked parents, siblings, and children** (click one to jump the dialog there), optional frontmatter properties, the rendered note, "Open note", and "Focus".
- **Focus** from a card dialog — show that node, its ancestors, and its primary descendants. Focus persists while you pan and click; a **Focus: …** chip appears at the top of the rail, and its **✕** (or **Reset**) clears it.
- **Titles only** — hide each card's subtitle, meta, bars, and labels, leaving just the title. Hidden in the gantt view, which draws rows rather than cards.
- **+ / −** on a card, or the per-row toggle in the gantt — collapse / expand its subtree.
- **«** / **☰** — collapse the toolbar rail to a single button (and expand it back) when it gets in the way.
- **Help** — open the quick-reference help dialog. **Fullscreen** — toggle fullscreen. **Reset** — clear filters/search/collapse/focus/titles-only, return to the block's default view, and refit.
- **Drag** to pan, **scroll** to zoom. Clicking empty map space clears the sticky hover highlight.

## Development

```bash
npm install
npm run dev     # esbuild watch → main.js (Obsidian) + dist/ (VS Code)
npm run build   # type-check + production build
```

Obsidian only loads `main.js`, `manifest.json`, and `styles.css`. For live iteration, symlink this folder into your vault:

```bash
ln -s "$(pwd)" "<your-vault>/.obsidian/plugins/markdown-mindmap"
```

(If you use Obsidian Sync, prefer a Release + BRAT, or commit the built files — Sync can remove a hand-linked plugin folder it doesn't recognize.)

### VS Code

The same core also drives a VS Code extension (`src/vscode/`). Unlike Obsidian, it does **not** render inline in the editor — you run a command and the map opens in a panel.

**Run it from source:**

1. Open this repo's folder in VS Code (the adapter lives in `src/vscode/`).
2. Press `F5` (Run and Debug → **Run Extension**). It builds, then opens an **Extension Development Host** window already pointed at `examples/`.
3. In that window, open a markdown note that contains a ` ```mindmap ` block (e.g. `mindmap-demo/Mindmap demo.md`).
4. Command Palette (`Cmd/Ctrl+Shift+P`) → **Markdown Mindmap: Open Map**. The graph opens in a panel beside the note: drag to pan, scroll to zoom, click a card to open that note.

**Notes:**

- **Config source:** the active note's first ` ```mindmap ` block (same YAML as Obsidian).
- **`from:` paths are relative to the workspace root**, and links resolve by note basename or `title` frontmatter (there's no vault link index outside Obsidian).
- **Visuals follow your VS Code theme** (via `--vscode-*` variables), so the map looks different from the Obsidian version by design.
- **Current scope:** render (map, gantt, or kanban per the block's `view:` key) + pan/zoom + click-to-open. The toolbar (search, filter chips, the view switcher, fullscreen, reset), collapse toggles, and the note dialog are Obsidian-only for now.

## Limits

- `from:` is folder-only (no tag / Dataview queries yet).
- Link resolution matches a wikilink, basename, `title`, or `id` — not an arbitrary shared field value (so a keyword like `stage: claims` won't auto-link unless a note of that basename/title/id exists).
- Layout centring assumes primary edges connect adjacent levels.
- Gantt: no dependency arrows and no date-range filtering yet (filters are discrete values). Dates are read, never written — there's no drag-to-reschedule.
- Excalidraw export is lossy by design: rounded boxes, centred labels, and straight arrows — no curves, progress bars, label pills, or column headers.
- Causal maps: cycle detection is bounded (at most 64 loops, 12 nodes long), so a very dense graph reports the first loops found rather than every one.

## Causal maps (systems thinking)

Besides trees, the plugin renders **causal-loop diagrams** — multi-connected graphs for systems
thinking, built for diagnosing retrospectives, post-mortems, and spotting leverage points. One
fenced ` ```causalmap ` block per diagram (Obsidian only for now).

Each causal variable is a note carrying its **outgoing signed edges** in frontmatter. Topology is
stored once, on the source note — no separate edge file:

```yaml
---
id: untested-code-live # optional, defaults to the file name
label: Untested code live
type: vice # driver | vice | capability | virtue — colours the border
status: active
affects:
  - to: incident # id, note name, or [[wikilink]]
    sign: "+" # "+" moves the same direction (default), "-" opposite
    loops: [R1] # optional: name the loop(s) this edge belongs to
---
```

The block:

````yaml
```causalmap
title: Engineering system
folders: [systems/nodes]
loopFolders: [systems/loops]   # optional loop cards (id + label) naming detected loops
where: { status: active }
height: 700
```
````

What you get:

- **Cycles are detected automatically** (bounded simple-cycle search) and classified by sign
  parity: an even number of `-` edges makes a **reinforcing** loop, odd makes a **balancing**
  one. No hand-maintained loop lists to drift out of date.
- **Loop rail**: every detected loop as a chip (● amber = reinforcing, ● teal = balancing);
  click one to spotlight exactly its edges and nodes — the retro projector view, click again to
  release. Hovering a chip shows the whole cycle as a `A → B → C → A` tooltip. Loops whose
  edges share a `loops:` tag take that name and lead the rail alphabetically; a matching card in
  `loopFolders` (frontmatter `id` + `label`) supplies the display label. Untagged cycles get auto
  names (`L1`, `L2`, …) and follow in discovery order.
- **Type legend**: a **Types** rail listing the node types actually present with their colours.
- **Signed edges**: curved arrows with a `+`/`−` badge; negative links draw dashed.
- **Deterministic force-directed layout** — the same notes always produce the same picture.
- Hover a node to light up everything it affects and is affected by; click it for the note
  dialog (linked rows carry their edge sign); search, fullscreen, HTML export, pan/zoom as in
  mindmaps.

Other keys: `edgesField` / `labelField` / `typeField` rename the frontmatter fields,
`typeColors` overrides the per-type palette, `layout: { nodeWidth, spacing, iterations }`
tunes the drawing, `properties: true` shows all frontmatter in the dialog.

> A runnable copy, with sample cards and loop notes, lives in
> [`examples/causalmap-demo/`](examples/causalmap-demo). Copy that folder into your vault root
> and open `Causal map demo.md`.

## License

MIT © Kiko Castro
