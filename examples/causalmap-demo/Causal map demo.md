# Causal map demo

A self-contained demo of the ` ```causalmap ` block — a **causal-loop diagram** of a delivery
team stuck in firefighting. It reads only the notes under `causalmap-demo/`. Open this note in
Obsidian (Reading or Live Preview) to render the diagram.

```causalmap
title: Delivery system · why we keep firefighting
folders: [causalmap-demo/nodes]
loopFolders: [causalmap-demo/loops]
where: { status: active }
height: 720
```

## What it shows off

- **Types → colours**: `deadline-pressure` is a purple **driver** (external forcing function),
  the red **vices** are what we want low, blue **capabilities** high, and the green **virtues**
  form the learning loop.
- **Signed edges**: `+` moves the target the same direction, `−` the opposite (drawn dashed).
- **Declared loops**: edges tagged `loops: [R1]` etc. name the detected cycles; the cards in
  `causalmap-demo/loops/` supply the display labels (Firefighting trap, Morale spiral,
  Learning loop). Polarity is **computed** from the signs, never taken on faith: R1 has two
  `−` edges (even) so it reinforces, B1 has one (odd) so it balances.
- **Auto-detection**: the quick-patch cycle (`shortcuts → defects → firefighting → shortcuts`)
  carries no tags, so it appears in the rail with an auto name (`L1`) — exactly how an
  unnoticed loop surfaces in a retro.
- **`where` filter**: `legacy-rewrite-pressure` is `status: dormant` and stays out of the render.
- **Link resolution**: most `to:` values are logical ids (= file names); `firefighting` reaches
  [[Team morale]] through a wikilink, and that note maps itself to the id `team-morale` via
  frontmatter `id:`.
- **Interaction**: click a loop chip (● amber = reinforcing, ● teal = balancing) to spotlight
  its cycle; hover a node for its direct influences; click a node for the note dialog (linked
  rows carry their edge signs); search, fullscreen, HTML export, pan/zoom.

## Reading it in a retro

Start from the incident (`defects`), walk the loops: R1 explains why "just test more" fails
(firefighting eats the capacity that would raise coverage), R2 why it slowly gets worse, B1 is
the only structure pushing back — the leverage point is making postmortem fixes actually ship.
