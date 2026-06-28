---
custom-width: 100
---

# OST demo

A self-contained demo of the **Markdown Mindmap** plugin. It reads only the notes under
`ost-demo/`. Open this note in Obsidian (Reading or Live Preview) to render the map.

An **Opportunity Solution Tree** (Teresa Torres, _Continuous Discovery Habits_): one product **outcome** at the top, customer **opportunities** (needs/pains heard in interviews) below it, candidate **solutions** under each opportunity, and **experiments** (assumption tests) under each solution. The case is a streaming service growing weekly watch time.

```mindmap
title: Streaming · Outcome → Opportunities → Solutions → Experiments
height: 860
levels:
  - id: outcome
    label: OUTCOME
    from: ost-demo/outcome
    color: "#1abc9c"
    card:
      title: title
      sub: metric
  - id: opportunities
    label: OPPORTUNITIES
    from: ost-demo/opportunities
    color: "#9b59b6"
    card:
      title: title
      sub: insight
      meta:
        - type
        - reach
  - id: solutions
    label: SOLUTIONS
    from: ost-demo/solutions
    color: "#e67e22"
    card:
      title: title
      meta:
        - effort
        - confidence
      bars: breakdown
  - id: experiments
    label: EXPERIMENTS
    from: ost-demo/experiments
    color: "#3498db"
    where:
      archived:
    card:
      title: title
      meta:
        - method
        - status
      progress: progress
edges:
  - from: outcome
    to: opportunities
    via: opportunities
    reverse: true
  - from: opportunities
    to: solutions
    via: opportunity
  - from: solutions
    to: experiments
    via: solution
  - from: solutions
    to: experiments
    via: alsoServes
    secondary: true
filter:
  - type
  - confidence
  - status
views:
  - name: Active
    filters:
      type:
        - Continuity
        - Discovery
      confidence:
        - low
      status:
        - active
```

## What each layer shows off

- **OUTCOME** subtitle is the metric; reverse + list-valued edge (one note points down to all four opportunities).
- **OPPORTUNITIES** per-level colour, a verbatim interview quote as subtitle, and a meta line (`type`, `reach`), filterable by `type`.
- **SOLUTIONS** meta line (`effort`, `confidence`), stacked **discipline bars** (design/eng/research/data), filterable by `confidence`.
- **EXPERIMENTS** the assumption test: method + status meta, **progress bars**, a `where` filter that hides the killed `SMS blast`, and a **dashed secondary link** (the taste-picker test also feeds `Mood collections`).
- **Toolbar / interaction**: search box, `type`/`confidence`/`status` filter chips, hover-to-highlight ancestors+descendants, click a card for the detail modal, collapse/expand, pan, zoom, fullscreen, fit/reset.
