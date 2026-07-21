import { describe, it, expect } from "vitest";
import { buildRenderModel, resolveLayout } from "../src/graph";
import type { RenderModel } from "../src/graph";
import { mk, resolverFor, simpleCfg, simpleNotes } from "./fixtures";

// The RenderModel is the core-owned, host-free view model both adapters draw
// from: everything drawable, pre-positioned, JSON-serializable. These tests pin
// that it mirrors what the adapters used to compute ad hoc from MNode fields.

const model = (ui: Parameters<typeof buildRenderModel>[3] = {}): RenderModel =>
  buildRenderModel(simpleCfg, simpleNotes, resolverFor(simpleNotes), ui);

describe("buildRenderModel — nodes", () => {
  it("emits one positioned node per visible note with card strings and colors", () => {
    const m = model();
    expect(m.view).toBe("map");
    expect(m.nodes.map((n) => n.id).sort()).toEqual([
      "g/Goal A.md",
      "p/Proj 1.md",
      "t/T1.md",
    ]);
    const goal = m.nodes.find((n) => n.id === "g/Goal A.md")!;
    expect(goal.title).toBe("Goal A");
    expect(goal.sub).toBe("north star");
    expect(goal.x).toBeGreaterThanOrEqual(0);
    expect(goal.y).toBeGreaterThanOrEqual(0);
    expect(goal.w).toBeGreaterThan(0);
    expect(goal.h).toBeGreaterThan(0);
    expect(goal.color).toMatch(/^#/);
    expect(goal.hasKids).toBe(true);
    expect(goal.collapsed).toBe(false);
    const task = m.nodes.find((n) => n.id === "t/T1.md")!;
    expect(task.progress).toBe(100);
    expect(task.meta).toBe("done");
    expect(task.hasKids).toBe(false);
  });

  it("lists nodes in tree draw order (level by level, DFS order)", () => {
    const m = model();
    expect(m.nodes.map((n) => n.id)).toEqual([
      "g/Goal A.md",
      "p/Proj 1.md",
      "t/T1.md",
    ]);
  });

  it("is JSON-serializable (no Sets, functions, or cycles)", () => {
    const m = model();
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});

describe("buildRenderModel — edges", () => {
  it("emits edges with endpoints on the parent's right and child's left mid", () => {
    const m = model();
    expect(m.edges).toHaveLength(2);
    const goal = m.nodes.find((n) => n.id === "g/Goal A.md")!;
    const proj = m.nodes.find((n) => n.id === "p/Proj 1.md")!;
    const e = m.edges.find(
      (x) => x.a === "g/Goal A.md" && x.b === "p/Proj 1.md"
    )!;
    expect(e.x1).toBe(goal.x + goal.w);
    expect(e.y1).toBe(goal.y + goal.h / 2);
    expect(e.x2).toBe(proj.x);
    expect(e.y2).toBe(proj.y + proj.h / 2);
    expect(e.color).toBe(goal.color);
    expect(e.secondary).toBe(false);
  });

  it("marks secondary edges", () => {
    const notes = [
      mk("g/G.md", { title: "G" }),
      mk("p/P.md", { title: "P", seeAlso: "[[G]]" }),
    ];
    const m = buildRenderModel(
      {
        levels: [
          { id: "goals", from: "g", card: { title: "title" } },
          { id: "projects", from: "p", card: { title: "title" } },
        ],
        edges: [
          { from: "goals", to: "projects", via: "seeAlso", secondary: true },
        ],
      },
      notes,
      resolverFor(notes)
    );
    expect(m.edges).toHaveLength(1);
    expect(m.edges[0].secondary).toBe(true);
  });
});

describe("buildRenderModel — headers and bounds", () => {
  it("emits a header per labeled level at its column x", () => {
    const m = model();
    expect(m.headers.map((h) => h.label)).toEqual([
      "GOALS",
      "PROJECTS",
      "TASKS",
    ]);
    const xs = m.headers.map((h) => h.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("skips headers for unlabeled levels", () => {
    const notes = [mk("g/G.md", { title: "G" })];
    const m = buildRenderModel(
      { levels: [{ id: "goals", from: "g", card: { title: "title" } }] },
      notes
    );
    expect(m.headers).toEqual([]);
  });

  it("returns content bounds that contain every node", () => {
    const m = model();
    m.nodes.forEach((n) => {
      expect(n.x + n.w).toBeLessThanOrEqual(m.contentRight);
      expect(n.y + n.h).toBeLessThanOrEqual(m.contentBottom);
    });
  });

  it("carries the map title and resolved line counts", () => {
    const m = buildRenderModel(
      { ...simpleCfg, title: "My map", layout: { subLines: 3 } },
      simpleNotes,
      resolverFor(simpleNotes)
    );
    expect(m.title).toBe("My map");
    expect(m.titleLines).toBe(resolveLayout({ subLines: 3 }).titleLines);
    expect(m.subLines).toBe(3);
    expect(model().title).toBe("");
  });
});

describe("buildRenderModel — ui state", () => {
  it("applies filters (hiding a filtered node and its primary subtree)", () => {
    const m = model({ filters: { status: ["done"] } });
    // Proj 1 (wip) is filtered out and takes its subtree (T1) with it
    expect(m.nodes.map((n) => n.id)).toEqual(["g/Goal A.md"]);
    expect(m.edges).toEqual([]);
  });

  it("hides a collapsed node's subtree but keeps the node, flagged collapsed", () => {
    const m = model({ collapsed: ["p/Proj 1.md"] });
    expect(m.nodes.map((n) => n.id)).toEqual(["g/Goal A.md", "p/Proj 1.md"]);
    expect(m.nodes.find((n) => n.id === "p/Proj 1.md")!.collapsed).toBe(true);
    // hasKids still true so the renderer can draw the expand toggle
    expect(m.nodes.find((n) => n.id === "p/Proj 1.md")!.hasKids).toBe(true);
  });

  it("intersects focus with filters", () => {
    const notes = [
      mk("g/G1.md", { title: "G1" }),
      mk("g/G2.md", { title: "G2" }),
      mk("p/P1.md", { title: "P1", goal: "[[G1]]" }),
      mk("p/P2.md", { title: "P2", goal: "[[G2]]" }),
    ];
    const cfg = {
      levels: [
        { id: "goals", from: "g", card: { title: "title" } },
        { id: "projects", from: "p", card: { title: "title" } },
      ],
      edges: [{ from: "goals", to: "projects", via: "goal" }],
    };
    const m = buildRenderModel(cfg, notes, resolverFor(notes), {
      focused: "g/G1.md",
    });
    // focus keeps G1 and its subtree only
    expect(m.nodes.map((n) => n.id).sort()).toEqual(["g/G1.md", "p/P1.md"]);
  });

  it("passes titleOnly through to the model", () => {
    expect(model().titleOnly).toBe(false);
    expect(model({ titleOnly: true }).titleOnly).toBe(true);
  });

  it("throws the documented error on an empty config", () => {
    expect(() =>
      buildRenderModel({ levels: [] } as never, simpleNotes)
    ).toThrow(/levels/);
  });
});
