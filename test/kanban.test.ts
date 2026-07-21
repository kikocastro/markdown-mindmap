import { describe, it, expect } from "vitest";
import {
  AUTO_COLORS,
  buildRenderModel,
  collectNodes,
  buildEdges,
  computeVisible,
  layoutKanban,
  resolveLayout,
} from "../src/graph";
import type { MapCfg } from "../src/graph";
import { mk, resolverFor, taskCfg, taskNotes } from "./fixtures";

// kanban view: visible nodes grouped into columns by a configurable field,
// cards reuse the existing card content/height rules, columns keep data order
// unless an explicit order is configured.

const kanban = (cfg: MapCfg = taskCfg, notes = taskNotes) => {
  const { nodes, byLevel } = collectNodes(cfg, notes);
  buildEdges(cfg, nodes, byLevel, resolverFor(notes));
  const vis = computeVisible(nodes, new Set(), {}, cfg);
  return { nodes, out: layoutKanban(cfg, nodes, byLevel, vis) };
};

describe("layoutKanban — columns", () => {
  it("derives columns from distinct groupBy values in data order", () => {
    const { out } = kanban();
    // collection order: broker-operator (in-progress), client-dns (done),
    // kickoff (todo) ... -> first-seen order
    expect(out.headers.map((h) => h.label)).toEqual([
      "in-progress",
      "done",
      "todo",
    ]);
    const xs = out.headers.map((h) => h.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("honours a configured column order and appends unlisted values", () => {
    const cfg: MapCfg = {
      ...taskCfg,
      kanban: { groupBy: "status", columns: ["todo", "in-progress"] },
    };
    const { out } = kanban(cfg);
    // configured first, then the unlisted "done" appended in data order
    expect(out.headers.map((h) => h.label)).toEqual([
      "todo",
      "in-progress",
      "done",
    ]);
  });

  it("counts each column's cards in its header", () => {
    const { out } = kanban();
    const byLabel = Object.fromEntries(
      out.headers.map((h) => [h.label, h.count])
    );
    expect(byLabel["in-progress"]).toBe(2);
    expect(byLabel["done"]).toBe(1);
    expect(byLabel["todo"]).toBe(2);
  });

  it("colors columns from the configured map, else the auto palette", () => {
    const cfg: MapCfg = {
      ...taskCfg,
      kanban: { groupBy: "status", colors: { done: "#2ecc71" } },
    };
    const { out } = kanban(cfg);
    const done = out.headers.find((h) => h.label === "done")!;
    const first = out.headers[0];
    expect(done.color).toBe("#2ecc71");
    expect(first.color).toBe(AUTO_COLORS[0]);
  });

  it("gathers nodes without a groupBy value under a trailing (none) column", () => {
    const notes = [
      ...taskNotes,
      mk("tasks/lost.md", { id: "t-lost", title: "Lost", parentId: "" }),
    ];
    const { out } = kanban(taskCfg, notes);
    expect(out.headers[out.headers.length - 1].label).toBe("(none)");
    expect(out.headers[out.headers.length - 1].count).toBe(1);
  });
});

describe("layoutKanban — cards", () => {
  it("positions every visible node in its column with no vertical overlap", () => {
    const { nodes, out } = kanban();
    const { vGap } = resolveLayout(taskCfg.layout);
    out.columns.forEach((col, ci) => {
      const x = out.headers[ci].x;
      let prevBottom = -Infinity;
      col.forEach((id) => {
        const n = nodes[id];
        expect(n.x).toBe(x);
        expect(n.y!).toBeGreaterThanOrEqual(prevBottom);
        prevBottom = n.y! + n.h! + vGap;
      });
    });
    const placed = out.columns.flat();
    expect(placed.sort()).toEqual(
      [
        "tasks/broker-operator.md",
        "tasks/broker-phase-1.md",
        "tasks/client-dns.md",
        "tasks/kickoff.md",
        "tasks/someday.md",
      ].sort()
    );
  });

  it("returns bounds that contain every card", () => {
    const { nodes, out } = kanban();
    out.columns.flat().forEach((id) => {
      const n = nodes[id];
      expect(n.x! + n.w!).toBeLessThanOrEqual(out.contentRight);
      expect(n.y! + n.h!).toBeLessThanOrEqual(out.contentBottom);
    });
  });

  it("throws the documented error when kanban config is missing groupBy", () => {
    expect(() => kanban({ ...taskCfg, kanban: undefined })).toThrow(
      /kanban.*groupBy/i
    );
  });
});

describe("buildRenderModel — kanban view", () => {
  it("produces positioned cards + colored column headers, no edges", () => {
    const m = buildRenderModel(
      { ...taskCfg, view: "kanban" },
      taskNotes,
      resolverFor(taskNotes)
    );
    expect(m.view).toBe("kanban");
    expect(m.edges).toEqual([]);
    expect(m.gantt).toBeUndefined();
    expect(m.nodes.length).toBe(5);
    expect(m.headers.length).toBe(3);
    m.headers.forEach((h) => {
      expect(h.color).toMatch(/^#/);
      expect(h.count).toBeGreaterThan(0);
    });
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it("applies filters before layout (chips work in kanban for free)", () => {
    const m = buildRenderModel(
      { ...taskCfg, view: "kanban" },
      taskNotes,
      resolverFor(taskNotes),
      { filters: { status: ["done"] } }
    );
    expect(m.nodes.map((n) => n.id)).toEqual(["tasks/client-dns.md"]);
    expect(m.headers.map((h) => h.label)).toEqual(["done"]);
  });
});
