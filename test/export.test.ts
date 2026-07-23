import { describe, it, expect } from "vitest";
import {
  mindmapExportPath,
  mindmapExcalidrawPath,
  mapToExcalidraw,
  modelToExcalidraw,
  buildRenderModel,
} from "../src/graph";
import {
  simpleCfg,
  simpleNotes,
  taskCfg,
  taskNotes,
  resolverFor,
} from "./fixtures";

describe("mindmapExportPath", () => {
  it("puts the .html next to the note, dropping the .md", () => {
    expect(mindmapExportPath("folder/Note.md")).toBe(
      "folder/Note mindmap.html"
    );
  });
  it("handles a note in the vault root", () => {
    expect(mindmapExportPath("Note.md")).toBe("Note mindmap.html");
  });
  it("strips only the trailing .md, keeping dots in the name", () => {
    expect(mindmapExportPath("d/My.Notes.md")).toBe("d/My.Notes mindmap.html");
  });
  it("keeps nested folders", () => {
    expect(mindmapExportPath("a/b/c/N.md")).toBe("a/b/c/N mindmap.html");
  });
});

describe("mindmapExcalidrawPath", () => {
  it("puts the .excalidraw next to the note, dropping the .md", () => {
    expect(mindmapExcalidrawPath("folder/Note.md")).toBe(
      "folder/Note mindmap.excalidraw"
    );
  });
});

describe("mapToExcalidraw", () => {
  const nodes = [
    { x: 0, y: 0, w: 100, h: 40, color: "#f00", text: "Root" },
    { x: 200, y: 0, w: 100, h: 40, color: "#0f0", text: "Child\nsub" },
  ];
  const edges = [{ x1: 100, y1: 20, x2: 200, y2: 20, color: "#f00" }];

  it("wraps a valid Excalidraw v2 file", () => {
    const f = mapToExcalidraw(nodes, edges);
    expect(f.type).toBe("excalidraw");
    expect(f.version).toBe(2);
    expect(Array.isArray(f.elements)).toBe(true);
  });

  it("emits a rectangle + bound text per node, plus an arrow per edge", () => {
    const f = mapToExcalidraw(nodes, edges);
    const byType = (t: string) => f.elements.filter((e) => e.type === t);
    expect(byType("rectangle")).toHaveLength(2);
    expect(byType("text")).toHaveLength(2);
    expect(byType("arrow")).toHaveLength(1);
  });

  it("places the rectangle at the node geometry with its color", () => {
    const r = mapToExcalidraw(nodes, edges).elements.find(
      (e) => e.type === "rectangle"
    )!;
    expect([r.x, r.y, r.width, r.height]).toEqual([0, 0, 100, 40]);
    expect(r.strokeColor).toBe("#f00");
  });

  it("binds each text to its rectangle both ways", () => {
    const els = mapToExcalidraw(nodes, edges).elements;
    const rect = els.find((e) => e.type === "rectangle")!;
    const text = els.find((e) => e.type === "text")!;
    expect(text.containerId).toBe(rect.id);
    expect(rect.boundElements).toContainEqual({ type: "text", id: text.id });
    expect(text.text).toBe("Root");
  });

  it("draws the arrow from edge start to end as relative points", () => {
    const a = mapToExcalidraw(nodes, edges).elements.find(
      (e) => e.type === "arrow"
    )!;
    expect([a.x, a.y]).toEqual([100, 20]);
    expect(a.points).toEqual([
      [0, 0],
      [100, 0],
    ]);
  });

  it("gives every element a unique id", () => {
    const ids = mapToExcalidraw(nodes, edges).elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("binds an arrow to its source/target rectangles both ways", () => {
    const bound = [
      { x1: 100, y1: 20, x2: 200, y2: 20, color: "#f00", source: 0, target: 1 },
    ];
    const els = mapToExcalidraw(nodes, bound).elements;
    const rects = els.filter((e) => e.type === "rectangle");
    const arrow = els.find((e) => e.type === "arrow")!;
    expect((arrow.startBinding as { elementId: string }).elementId).toBe(
      rects[0].id
    );
    expect((arrow.endBinding as { elementId: string }).elementId).toBe(
      rects[1].id
    );
    expect(rects[0].boundElements).toContainEqual({
      type: "arrow",
      id: arrow.id,
    });
    expect(rects[1].boundElements).toContainEqual({
      type: "arrow",
      id: arrow.id,
    });
  });
});

describe("modelToExcalidraw", () => {
  describe("map view", () => {
    const model = buildRenderModel(
      simpleCfg,
      simpleNotes,
      resolverFor(simpleNotes),
      { view: "map" }
    );

    it("emits one node per map node and one edge per map edge", () => {
      const { nodes, edges } = modelToExcalidraw(model);
      expect(nodes).toHaveLength(model.nodes.length);
      expect(edges).toHaveLength(model.edges.length);
      expect(edges.length).toBeGreaterThan(0);
    });

    it("carries node geometry and colour through unchanged", () => {
      const { nodes } = modelToExcalidraw(model);
      const first = model.nodes[0];
      expect(nodes[0]).toMatchObject({
        x: first.x,
        y: first.y,
        w: first.w,
        h: first.h,
        color: first.color,
      });
    });

    it("appends the sub line to the title when present", () => {
      const { nodes } = modelToExcalidraw(model);
      const goal = nodes.find((n) => n.text.startsWith("Goal A"))!;
      expect(goal.text).toBe("Goal A\nnorth star");
      // a node without a sub stays a single line
      const proj = nodes.find((n) => n.text === "Proj 1");
      expect(proj).toBeTruthy();
    });

    it("drops the sub line when titles are collapsed", () => {
      const collapsedTitles = buildRenderModel(
        simpleCfg,
        simpleNotes,
        resolverFor(simpleNotes),
        { view: "map", titleOnly: true }
      );
      const { nodes } = modelToExcalidraw(collapsedTitles);
      expect(nodes.find((n) => n.text === "Goal A")).toBeTruthy();
      expect(nodes.some((n) => n.text.includes("\n"))).toBe(false);
    });

    it("binds each edge to its source/target node indices", () => {
      const { nodes, edges } = modelToExcalidraw(model);
      const e = edges[0];
      expect(e.source).toBeTypeOf("number");
      expect(e.target).toBeTypeOf("number");
      expect(nodes[e.source!]).toBeTruthy();
      expect(nodes[e.target!]).toBeTruthy();
    });
  });

  describe("gantt view", () => {
    const model = buildRenderModel(taskCfg, taskNotes, resolverFor(taskNotes), {
      view: "gantt",
    });

    it("emits one node per gantt row and no edges", () => {
      const { nodes, edges } = modelToExcalidraw(model);
      expect(nodes).toHaveLength(model.gantt!.rows.length);
      expect(edges).toEqual([]);
    });

    it("positions a bar row at its bar geometry", () => {
      const { nodes } = modelToExcalidraw(model);
      const row = model.gantt!.rows.find((r) => r.bar)!;
      const node = nodes.find((n) => n.text === row.label)!;
      expect(node.x).toBe(row.bar!.x);
      expect(node.y).toBe(row.y);
      expect(node.w).toBe(Math.max(row.bar!.w, 8));
      expect(node.color).toBe(row.color);
    });

    it("emits a small centred square for a milestone row", () => {
      const { nodes } = modelToExcalidraw(model);
      const kickoff = nodes.find((n) => n.text === "Kickoff")!;
      const row = model.gantt!.rows.find((r) => r.label === "Kickoff")!;
      expect(row.milestone).toBeTruthy();
      expect(kickoff.w).toBe(14);
      expect(kickoff.h).toBe(14);
      expect(kickoff.x).toBe(row.milestone!.x - 7);
    });

    it("parks a dateless row in the left label column", () => {
      const { nodes } = modelToExcalidraw(model);
      const someday = nodes.find((n) => n.text === "Someday")!;
      expect(someday.x).toBe(0);
      expect(someday.w).toBe(model.gantt!.labelWidth);
    });
  });

  describe("kanban view", () => {
    const model = buildRenderModel(taskCfg, taskNotes, resolverFor(taskNotes), {
      view: "kanban",
    });

    it("emits one node per card and no edges", () => {
      const { nodes, edges } = modelToExcalidraw(model);
      expect(nodes).toHaveLength(model.nodes.length);
      expect(nodes.length).toBeGreaterThan(0);
      expect(edges).toEqual([]);
    });

    it("carries each card's geometry, colour and title", () => {
      const { nodes } = modelToExcalidraw(model);
      const card = model.nodes[0];
      expect(nodes[0]).toMatchObject({
        x: card.x,
        y: card.y,
        w: card.w,
        h: card.h,
        color: card.color,
      });
      expect(nodes[0].text).toContain(card.title);
    });
  });
});
