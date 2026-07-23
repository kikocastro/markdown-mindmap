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

// ---- two-level same-folder setup (mirrors the user's real roadmap vault) ----
// Level 0: top-level tasks (where parentId == null), each has a status.
// Level 1: subtasks (same folder, no where), mostly have NO status field.
// Kanban groupBy: "status" must produce one column per distinct status value
// PLUS a trailing "(none)" for statusless subtasks — all at distinct x positions.
describe("buildRenderModel — kanban two-level same-folder", () => {
  // Build a minimal but realistic replica: 3 parents (todo/in-progress/done) + 3 subtasks (no status).
  const folder = "roadmap";
  const sameFolder: import("../src/graph").NoteLike[] = [
    // top-level tasks — have a status field (some "quoted" in the source YAML,
    // but Obsidian's YAML parser strips quotes before we see the value)
    mk(`${folder}/task-todo-1.md`, {
      id: "t1",
      title: "Todo task 1",
      parentId: "",
      status: "todo",
    }),
    mk(`${folder}/task-todo-2.md`, {
      id: "t2",
      title: "Todo task 2",
      parentId: "",
      status: "todo",
    }),
    mk(`${folder}/task-wip.md`, {
      id: "t3",
      title: "WIP task",
      parentId: "",
      status: "in-progress",
    }),
    mk(`${folder}/task-done.md`, {
      id: "t4",
      title: "Done task",
      parentId: "",
      status: "done",
    }),
    // subtasks — linked via parentId, NO status field → go to "(none)"
    mk(`${folder}/sub-a.md`, { id: "s1", title: "Sub A", parentId: "t1" }),
    mk(`${folder}/sub-b.md`, { id: "s2", title: "Sub B", parentId: "t3" }),
    mk(`${folder}/sub-c.md`, { id: "s3", title: "Sub C", parentId: "t3" }),
  ];

  const sameFolderCfg: import("../src/graph").MapCfg = {
    levels: [
      {
        id: "tasks",
        from: folder,
        where: { parentId: null }, // top-level tasks only
        card: { title: "title", meta: ["status"] },
      },
      {
        id: "subtasks",
        from: folder, // SAME folder, no where → picks up the subtasks
        card: { title: "title" },
      },
    ],
    edges: [{ from: "tasks", to: "subtasks", via: "parentId" }],
    kanban: { groupBy: "status" },
    filter: ["status"],
  };

  it("produces 4 columns (todo/in-progress/done/none) — not stacked into one", () => {
    const m = buildRenderModel(
      { ...sameFolderCfg, view: "kanban" },
      sameFolder,
      resolverFor(sameFolder)
    );
    expect(m.view).toBe("kanban");
    // 3 status columns + 1 (none) column for subtasks without status
    expect(m.headers.map((h) => h.label)).toContain("todo");
    expect(m.headers.map((h) => h.label)).toContain("in-progress");
    expect(m.headers.map((h) => h.label)).toContain("done");
    expect(m.headers.map((h) => h.label)).toContain("(none)");
    expect(m.headers.length).toBe(4);
  });

  it("all 7 nodes are placed and none is lost in the (none) bucket", () => {
    const m = buildRenderModel(
      { ...sameFolderCfg, view: "kanban" },
      sameFolder,
      resolverFor(sameFolder)
    );
    expect(m.nodes.length).toBe(7);
    const noneHeader = m.headers.find((h) => h.label === "(none)")!;
    expect(noneHeader.count).toBe(3); // three statusless subtasks
  });

  it("each column header sits at a distinct x — columns are side-by-side not stacked", () => {
    const m = buildRenderModel(
      { ...sameFolderCfg, view: "kanban" },
      sameFolder,
      resolverFor(sameFolder)
    );
    const xs = m.headers.map((h) => h.x);
    // all x values must be unique (no two columns share the same horizontal position)
    expect(new Set(xs).size).toBe(xs.length);
    // and they must be strictly increasing (left-to-right order)
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("nodes in different columns have different x coordinates", () => {
    const m = buildRenderModel(
      { ...sameFolderCfg, view: "kanban" },
      sameFolder,
      resolverFor(sameFolder)
    );
    // build a map: nodeId -> column label (via the header x)
    const xToLabel = Object.fromEntries(m.headers.map((h) => [h.x, h.label]));
    const byColumn: Record<string, string[]> = {};
    m.nodes.forEach((n) => {
      const col = xToLabel[n.x] ?? `x=${n.x}`;
      (byColumn[col] = byColumn[col] || []).push(n.id);
    });
    // todo nodes must NOT share x with in-progress or done nodes
    const todoXs = m.nodes
      .filter((n) => xToLabel[n.x] === "todo")
      .map((n) => n.x);
    const wipXs = m.nodes
      .filter((n) => xToLabel[n.x] === "in-progress")
      .map((n) => n.x);
    const doneXs = m.nodes
      .filter((n) => xToLabel[n.x] === "done")
      .map((n) => n.x);
    const noneXs = m.nodes
      .filter((n) => xToLabel[n.x] === "(none)")
      .map((n) => n.x);
    // each status group must have at least one node, all at the same x, distinct from others
    expect(todoXs.length).toBeGreaterThan(0);
    expect(wipXs.length).toBeGreaterThan(0);
    expect(doneXs.length).toBeGreaterThan(0);
    expect(noneXs.length).toBeGreaterThan(0);
    const uniqueX = (arr: number[]) => (new Set(arr).size === 1 ? arr[0] : NaN);
    const tx = uniqueX(todoXs),
      wx = uniqueX(wipXs),
      dx = uniqueX(doneXs),
      nx = uniqueX(noneXs);
    expect([tx, wx, dx, nx].every((v) => !isNaN(v))).toBe(true); // each column has one x
    expect(new Set([tx, wx, dx, nx]).size).toBe(4); // all four x values are distinct
  });

  it("subtasks with no status field land in (none), not in a status column", () => {
    const m = buildRenderModel(
      { ...sameFolderCfg, view: "kanban" },
      sameFolder,
      resolverFor(sameFolder)
    );
    const noneX = m.headers.find((h) => h.label === "(none)")!.x;
    const subtaskIds = [
      `${folder}/sub-a.md`,
      `${folder}/sub-b.md`,
      `${folder}/sub-c.md`,
    ];
    subtaskIds.forEach((id) => {
      const node = m.nodes.find((n) => n.id === id)!;
      expect(node).toBeDefined();
      expect(node.x).toBe(noneX);
    });
  });
});
