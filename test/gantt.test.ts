import { describe, it, expect } from "vitest";
import {
  GANTT,
  buildRenderModel,
  collectNodes,
  buildEdges,
  computeVisible,
  layoutGantt,
  parseDay,
} from "../src/graph";
import type { GanttModel, MapCfg } from "../src/graph";
import { mk, resolverFor, taskCfg, taskNotes } from "./fixtures";

// gantt view: one row per visible node in tree (DFS) order, a time axis from
// min(start) to max(end), bars with progress fill, milestone diamonds when
// start == due (or one of the two is missing).

const build = (cfg: MapCfg = taskCfg, notes = taskNotes) => {
  const { nodes, byLevel } = collectNodes(cfg, notes);
  buildEdges(cfg, nodes, byLevel, resolverFor(notes));
  const vis = computeVisible(nodes, new Set(), {}, cfg);
  return { nodes, byLevel, vis };
};

const gantt = (cfg: MapCfg = taskCfg, notes = taskNotes): GanttModel => {
  const { nodes, byLevel, vis } = build(cfg, notes);
  return layoutGantt(cfg, nodes, byLevel, vis);
};

describe("parseDay", () => {
  it("parses ISO dates to a UTC day number and rejects junk", () => {
    expect(parseDay("1970-01-01")).toBe(0);
    expect(parseDay("1970-01-02")).toBe(1);
    expect(parseDay("2026-06-15")).toBeGreaterThan(0);
    expect(parseDay("")).toBeNull();
    expect(parseDay(undefined)).toBeNull();
    expect(parseDay("not a date")).toBeNull();
  });

  it("accepts Date values (YAML parsers may emit them)", () => {
    expect(parseDay(new Date(86400000))).toBe(1);
  });
});

describe("layoutGantt — rows", () => {
  it("orders rows in DFS-by-primary-parent order (subtask under its parent)", () => {
    const g = gantt();
    const ids = g.rows.map((r) => r.id);
    const parent = ids.indexOf("tasks/broker-operator.md");
    expect(parent).toBeGreaterThanOrEqual(0);
    // the subtask (linked via parentId -> frontmatter id) follows its parent
    expect(ids[parent + 1]).toBe("tasks/broker-phase-1.md");
  });

  it("indents child rows one step deeper than their parent", () => {
    const g = gantt();
    const parent = g.rows.find((r) => r.id === "tasks/broker-operator.md")!;
    const child = g.rows.find((r) => r.id === "tasks/broker-phase-1.md")!;
    expect(parent.indent).toBe(0);
    expect(child.indent).toBe(1);
    expect(child.label).toBe("Broker operator · Phase 1");
  });

  it("stacks rows without overlap and reports content bounds", () => {
    const g = gantt();
    for (let i = 1; i < g.rows.length; i++) {
      expect(g.rows[i].y).toBeGreaterThanOrEqual(
        g.rows[i - 1].y + g.rows[i - 1].h
      );
    }
    const last = g.rows[g.rows.length - 1];
    expect(g.contentBottom).toBeGreaterThanOrEqual(last.y + last.h);
    expect(g.contentRight).toBeGreaterThan(GANTT.labelWidth);
  });

  it("survives a primary-parent cycle with finite indents", () => {
    // two levels pointing at each other -> primaryParent chain cycles
    const cfg: MapCfg = {
      levels: [
        { id: "a", from: "a", card: { title: "title" } },
        { id: "b", from: "b", card: { title: "title" } },
      ],
      edges: [
        { from: "a", to: "b", via: "up" },
        { from: "b", to: "a", via: "down" },
      ],
      gantt: { start: "start", end: "due" },
    };
    const notes = [
      mk("a/A.md", { title: "A", down: "B" }),
      mk("b/B.md", { title: "B", up: "A" }),
    ];
    const g = gantt(cfg, notes);
    expect(g.rows).toHaveLength(2);
    g.rows.forEach((r) => expect(r.indent).toBeLessThanOrEqual(2));
  });

  it("keeps folder order and no indent when groupRows is false", () => {
    const cfg: MapCfg = {
      ...taskCfg,
      gantt: { ...taskCfg.gantt!, groupRows: false },
    };
    const g = gantt(cfg);
    // folder (path) order: broker-operator, broker-phase-1, client-dns, kickoff, someday
    expect(g.rows.map((r) => r.id)).toEqual([
      "tasks/broker-operator.md",
      "tasks/broker-phase-1.md",
      "tasks/client-dns.md",
      "tasks/kickoff.md",
      "tasks/someday.md",
    ]);
    g.rows.forEach((r) => expect(r.indent).toBe(0));
  });
});

describe("layoutGantt — bars and milestones", () => {
  it("gives a spanning task a bar from start to end with progress fill", () => {
    const g = gantt();
    const row = g.rows.find((r) => r.id === "tasks/broker-operator.md")!;
    expect(row.milestone).toBeNull();
    const bar = row.bar!;
    expect(bar.x).toBeGreaterThanOrEqual(GANTT.labelWidth);
    expect(bar.w).toBeGreaterThan(0);
    // 30% progress -> fill is 30% of the bar width
    expect(bar.progressW).toBeCloseTo(bar.w * 0.3, 6);
  });

  it("maps bar geometry linearly to days at the scale's day width", () => {
    const g = gantt();
    const a = g.rows.find((r) => r.id === "tasks/broker-operator.md")!.bar!;
    const b = g.rows.find((r) => r.id === "tasks/broker-phase-1.md")!.bar!;
    // same start day -> same x
    expect(b.x).toBe(a.x);
    // 2026-06-09..08-16 is 68 days; ..07-18 is 39 days (default month scale)
    expect(a.w).toBeCloseTo(68 * GANTT.dayPx.month, 6);
    expect(b.w).toBeCloseTo(39 * GANTT.dayPx.month, 6);
  });

  it("renders start == due as a milestone diamond, not a bar", () => {
    const g = gantt();
    const row = g.rows.find((r) => r.id === "tasks/kickoff.md")!;
    expect(row.bar).toBeNull();
    expect(row.milestone).not.toBeNull();
    expect(row.milestone!.x).toBeGreaterThanOrEqual(GANTT.labelWidth);
  });

  it("renders a date-missing-one-side task as a milestone at the present date", () => {
    const notes = [
      mk("tasks/only-due.md", {
        id: "t1",
        title: "Only due",
        parentId: "",
        status: "todo",
        due: "2026-03-02",
      }),
      mk("tasks/only-start.md", {
        id: "t2",
        title: "Only start",
        parentId: "",
        status: "todo",
        start: "2026-03-09",
      }),
    ];
    const g = gantt(taskCfg, notes);
    const due = g.rows.find((r) => r.id === "tasks/only-due.md")!;
    const start = g.rows.find((r) => r.id === "tasks/only-start.md")!;
    expect(due.bar).toBeNull();
    expect(start.bar).toBeNull();
    // a week apart at the month scale
    expect(start.milestone!.x - due.milestone!.x).toBeCloseTo(
      7 * GANTT.dayPx.month,
      6
    );
  });

  it("leaves a dateless task as a plain row (no bar, no milestone)", () => {
    const g = gantt();
    const row = g.rows.find((r) => r.id === "tasks/someday.md")!;
    expect(row.bar).toBeNull();
    expect(row.milestone).toBeNull();
  });

  it("clamps progress into 0..100 and defaults missing progress to no fill", () => {
    const notes = [
      mk("tasks/over.md", {
        id: "t1",
        title: "Over",
        parentId: "",
        status: "todo",
        start: "2026-01-01",
        due: "2026-02-01",
        progress: 250,
      }),
      mk("tasks/none.md", {
        id: "t2",
        title: "None",
        parentId: "",
        status: "todo",
        start: "2026-01-01",
        due: "2026-02-01",
      }),
    ];
    const g = gantt(taskCfg, notes);
    const over = g.rows.find((r) => r.id === "tasks/over.md")!.bar!;
    const none = g.rows.find((r) => r.id === "tasks/none.md")!.bar!;
    expect(over.progressW).toBe(over.w);
    expect(none.progressW).toBeNull();
  });

  it("reads dates and progress from the configured field names", () => {
    const cfg: MapCfg = {
      levels: [{ id: "t", from: "tasks", card: { title: "title" } }],
      gantt: { start: "kickoffAt", end: "deadline", progress: "pct" },
    };
    const notes = [
      mk("tasks/custom.md", {
        title: "Custom",
        kickoffAt: "2026-01-05",
        deadline: "2026-01-25",
        pct: 50,
      }),
    ];
    const g = gantt(cfg, notes);
    const bar = g.rows[0].bar!;
    expect(bar.w).toBeCloseTo(20 * GANTT.dayPx.month, 6);
    expect(bar.progressW).toBeCloseTo(bar.w / 2, 6);
  });
});

describe("layoutGantt — axis", () => {
  it("emits month ticks spanning min(start)..max(end), padded to month bounds", () => {
    const g = gantt();
    // data range 2025-12-01 .. 2026-08-16 -> ticks Dec 2025 .. Sep 2026
    expect(g.ticks[0].label).toBe("Dec 2025");
    expect(g.ticks[g.ticks.length - 1].label).toBe("Sep 2026");
    expect(g.ticks).toHaveLength(10);
    const xs = g.ticks.map((t) => t.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[0]).toBe(GANTT.labelWidth);
  });

  it("labels quarter and week scales appropriately", () => {
    const q = gantt({
      ...taskCfg,
      gantt: { ...taskCfg.gantt!, scale: "quarter" },
    });
    expect(q.ticks[0].label).toBe("Q4 2025");
    expect(q.ticks[q.ticks.length - 1].label).toBe("Q4 2026");

    const notes = [
      mk("tasks/short.md", {
        id: "t",
        title: "Short",
        parentId: "",
        status: "todo",
        start: "2026-01-06",
        due: "2026-01-16",
      }),
    ];
    const w = gantt(
      { ...taskCfg, gantt: { ...taskCfg.gantt!, scale: "week" } },
      notes
    );
    // weeks floor to Monday: 2026-01-05 is a Monday
    expect(w.ticks[0].label).toBe("5 Jan");
  });

  it("handles an empty map (no rows, no ticks, top-only bounds)", () => {
    const g = gantt(taskCfg, []);
    expect(g.rows).toEqual([]);
    expect(g.ticks).toEqual([]);
    expect(g.contentBottom).toBe(GANTT.top);
  });

  it("emits no ticks when nothing has a date", () => {
    const notes = [
      mk("tasks/a.md", { id: "a", title: "A", parentId: "", status: "todo" }),
    ];
    const g = gantt(taskCfg, notes);
    expect(g.ticks).toEqual([]);
    expect(g.rows).toHaveLength(1);
  });

  it("throws the documented error when gantt config is missing fields", () => {
    expect(() => gantt({ ...taskCfg, gantt: undefined })).toThrow(
      /gantt.*start.*end/i
    );
    expect(() =>
      gantt({ ...taskCfg, gantt: { start: "start" } as never })
    ).toThrow(/gantt.*start.*end/i);
  });
});

describe("buildRenderModel — gantt view", () => {
  it("produces a gantt model with empty map collections", () => {
    const m = buildRenderModel(
      { ...taskCfg, view: "gantt" },
      taskNotes,
      resolverFor(taskNotes)
    );
    expect(m.view).toBe("gantt");
    expect(m.gantt).toBeDefined();
    expect(m.gantt!.rows.length).toBeGreaterThan(0);
    expect(m.nodes).toEqual([]);
    expect(m.edges).toEqual([]);
    expect(m.headers).toEqual([]);
    expect(m.contentRight).toBe(m.gantt!.contentRight);
    expect(m.contentBottom).toBe(m.gantt!.contentBottom);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it("applies filters before layout (chips work in gantt for free)", () => {
    const m = buildRenderModel(
      { ...taskCfg, view: "gantt" },
      taskNotes,
      resolverFor(taskNotes),
      { filters: { tags: ["devops"] } }
    );
    expect(m.gantt!.rows.map((r) => r.id)).toEqual(["tasks/client-dns.md"]);
  });

  it("honours a ui view override over cfg.view", () => {
    const m = buildRenderModel(taskCfg, taskNotes, resolverFor(taskNotes), {
      view: "gantt",
    });
    expect(m.view).toBe("gantt");
    const back = buildRenderModel(
      { ...taskCfg, view: "gantt" },
      taskNotes,
      resolverFor(taskNotes),
      { view: "map" }
    );
    expect(back.view).toBe("map");
    expect(back.gantt).toBeUndefined();
    expect(back.nodes.length).toBeGreaterThan(0);
  });
});
