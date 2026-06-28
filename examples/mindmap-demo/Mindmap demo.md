---
custom-width: 100
---

# Mindmap demo

A self-contained demo of the **Markdown Mindmap** plugin. It reads only the notes under
`mindmap-demo/`. Open this note in Obsidian (Reading or Live Preview) to render the map.

```mindmap
title: Build the app · Vision → Areas → Features → Tasks
height: 860
levels:
  - { id: vision,   label: VISION,   from: mindmap-demo/vision,   color: "#1abc9c", card: { title: title, sub: metric } }
  - { id: areas,    label: AREAS,    from: mindmap-demo/areas,    color: "#9b59b6", card: { title: title, sub: aspiration } }
  - { id: features, label: FEATURES, from: mindmap-demo/features, color: "#e67e22", card: { title: title, meta: [track, priority], bars: breakdown } }
  - { id: tasks,    label: TASKS,    from: mindmap-demo/tasks,    color: "#3498db", where: { archived: null }, card: { title: title, meta: [track, due], progress: progress } }
edges:
  - { from: vision,   to: areas,    via: areas, reverse: true }
  - { from: areas,    to: features, via: area }
  - { from: features, to: tasks,    via: feature }
  - { from: features, to: tasks,    via: alsoServes, secondary: true }
filter: [track, status, priority]
```

## What each layer shows off

- **VISION** subtitle line; reverse + list-valued edge (one note points down to all four areas).
- **AREAS** per-level colour, subtitle.
- **FEATURES** meta line (the `track` label: frontend/backend/ai/devops), stacked **category bars** coloured by track, filterable.
- **TASKS** the `track` label again, **progress bars**, a `where` filter that hides the archived `Legacy password login`, and a **dashed secondary link** (`Auth endpoint` also serves `Usage-based billing`).
- **Toolbar / interaction**: search box, `track`/`status`/`priority` filter chips, hover-to-highlight ancestors+descendants, click a card for the detail modal, collapse/expand, pan, zoom, fullscreen, fit/reset.
