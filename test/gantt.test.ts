import { describe, it, expect } from "vitest";
import {
  GANTT,
  buildRenderModel,
  collectNodes,
  buildEdges,
  computeVisible,
  layoutGantt,
  parseDay,
  statusColor,
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

describe("layoutGantt — density", () => {
  it("defaults to compact metrics", () => {
    const g = gantt();
    expect(g.metrics.rowH).toBe(GANTT.rowH);
    expect(g.rows[0]?.h).toBe(GANTT.rowH);
  });

  it("comfortable scales up rows, fonts and taller rows push content down", () => {
    const { nodes, byLevel, vis } = build();
    const comfy = layoutGantt(taskCfg, nodes, byLevel, vis, {
      density: "comfortable",
    });
    const compact = layoutGantt(taskCfg, nodes, byLevel, vis, {});
    expect(comfy.metrics.rowH).toBeGreaterThan(compact.metrics.rowH);
    expect(comfy.metrics.titleSize).toBeGreaterThan(compact.metrics.titleSize);
    expect(comfy.metrics.barH).toBeGreaterThan(compact.metrics.barH);
    expect(comfy.rows[0].h).toBe(comfy.metrics.rowH);
    expect(comfy.contentBottom).toBeGreaterThan(compact.contentBottom);
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

  it("keeps folder order and no indent when groupRows is false and sorting is off", () => {
    const cfg: MapCfg = {
      ...taskCfg,
      gantt: { ...taskCfg.gantt!, groupRows: false, sortByStart: false },
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

  it("flat, start-sorted, no indent when groupRows is off but sorting stays on", () => {
    const cfg: MapCfg = {
      ...taskCfg,
      gantt: { ...taskCfg.gantt!, groupRows: false },
    };
    const g = gantt(cfg);
    // no hierarchy grouping: pure global start-date order, dateless last
    expect(g.rows.map((r) => r.id)).toEqual([
      "tasks/client-dns.md",
      "tasks/broker-operator.md",
      "tasks/broker-phase-1.md",
      "tasks/kickoff.md",
      "tasks/someday.md",
    ]);
    g.rows.forEach((r) => expect(r.indent).toBe(0));
  });
});

describe("layoutGantt — start-date ordering (default)", () => {
  it("sorts rows by crescent start date, dateless rows last", () => {
    const g = gantt();
    // client-dns 2025-12-01, broker-operator + phase-1 2026-06-09 (stable:
    // parent first), kickoff 2026-06-15, someday dateless
    expect(g.rows.map((r) => r.id)).toEqual([
      "tasks/client-dns.md",
      "tasks/broker-operator.md",
      "tasks/broker-phase-1.md",
      "tasks/kickoff.md",
      "tasks/someday.md",
    ]);
  });

  it("uses the end date when only the end is present", () => {
    const notes = [
      mk("tasks/late.md", {
        id: "t1",
        title: "Late",
        parentId: "",
        status: "todo",
        start: "2026-03-09",
        due: "2026-03-20",
      }),
      mk("tasks/only-due.md", {
        id: "t2",
        title: "Only due",
        parentId: "",
        status: "todo",
        due: "2026-03-02",
      }),
    ];
    const g = gantt(taskCfg, notes);
    expect(g.rows.map((r) => r.id)).toEqual([
      "tasks/only-due.md",
      "tasks/late.md",
    ]);
  });

  it("keeps tree order between two dateless rows", () => {
    const notes = [
      mk("tasks/undated-a.md", {
        id: "t2",
        title: "Undated A",
        parentId: "",
        status: "todo",
      }),
      mk("tasks/undated-b.md", {
        id: "t3",
        title: "Undated B",
        parentId: "",
        status: "todo",
      }),
      mk("tasks/dated.md", {
        id: "t1",
        title: "Dated",
        parentId: "",
        status: "todo",
        start: "2026-03-09",
        due: "2026-03-20",
      }),
    ];
    const g = gantt(taskCfg, notes);
    expect(g.rows.map((r) => r.id)).toEqual([
      "tasks/dated.md",
      "tasks/undated-a.md",
      "tasks/undated-b.md",
    ]);
  });

  it("sortByStart: false restores the DFS tree order", () => {
    const cfg: MapCfg = {
      ...taskCfg,
      gantt: { ...taskCfg.gantt!, sortByStart: false },
    };
    const g = gantt(cfg);
    expect(g.rows.map((r) => r.id)).toEqual([
      "tasks/broker-operator.md",
      "tasks/broker-phase-1.md",
      "tasks/client-dns.md",
      "tasks/kickoff.md",
      "tasks/someday.md",
    ]);
  });

  it("keeps a child grouped under its parent even when the child starts earlier", () => {
    const notes = [
      mk("tasks/parent.md", {
        id: "p",
        title: "Parent",
        parentId: "",
        status: "todo",
        start: "2026-06-01",
        due: "2026-06-30",
      }),
      mk("tasks/early-child.md", {
        id: "c",
        title: "Early child",
        parentId: "p",
        status: "todo",
        start: "2026-01-05",
        due: "2026-01-20",
      }),
    ];
    const g = gantt(taskCfg, notes);
    // the child's earlier start does NOT float it above the parent: siblings
    // and roots are sorted, but children stay nested under their parent.
    expect(g.rows.map((r) => r.id)).toEqual([
      "tasks/parent.md",
      "tasks/early-child.md",
    ]);
    expect(g.rows[0].indent).toBe(0);
    expect(g.rows[1].indent).toBe(1);
  });

  it("sorts sibling children by start date under their shared parent", () => {
    const notes = [
      mk("tasks/parent.md", {
        id: "p",
        title: "Parent",
        parentId: "",
        status: "todo",
        start: "2026-01-01",
        due: "2026-12-31",
      }),
      mk("tasks/child-late.md", {
        id: "cl",
        title: "Child late",
        parentId: "p",
        status: "todo",
        start: "2026-08-01",
        due: "2026-08-10",
      }),
      mk("tasks/child-early.md", {
        id: "ce",
        title: "Child early",
        parentId: "p",
        status: "todo",
        start: "2026-02-01",
        due: "2026-02-10",
      }),
    ];
    const g = gantt(taskCfg, notes);
    expect(g.rows.map((r) => r.id)).toEqual([
      "tasks/parent.md",
      "tasks/child-early.md",
      "tasks/child-late.md",
    ]);
  });
});

describe("layoutGantt — collapse state on rows", () => {
  it("flags rows with visible primary children as collapsible", () => {
    const g = gantt();
    const parent = g.rows.find((r) => r.id === "tasks/broker-operator.md")!;
    const leaf = g.rows.find((r) => r.id === "tasks/client-dns.md")!;
    expect(parent.hasKids).toBe(true);
    expect(parent.collapsed).toBe(false);
    expect(leaf.hasKids).toBe(false);
  });

  it("marks a collapsed row and hides its subtree when ui collapses it", () => {
    const m = buildRenderModel(taskCfg, taskNotes, resolverFor(taskNotes), {
      view: "gantt",
      collapsed: ["tasks/broker-operator.md"],
    });
    const ids = m.gantt!.rows.map((r) => r.id);
    expect(ids).not.toContain("tasks/broker-phase-1.md");
    const parent = m.gantt!.rows.find(
      (r) => r.id === "tasks/broker-operator.md"
    )!;
    expect(parent.collapsed).toBe(true);
    expect(parent.hasKids).toBe(true); // stays expandable while contracted
  });
});

describe("layoutGantt — labels", () => {
  const labelCfg: MapCfg = {
    levels: [
      { id: "t", from: "tasks", card: { title: "title", labels: ["status"] } },
    ],
    gantt: { start: "start", end: "due" },
  };

  const multiCfg: MapCfg = {
    levels: [
      {
        id: "t",
        from: "tasks",
        card: { title: "title", labels: ["status", "area"] },
      },
    ],
    gantt: { start: "start", end: "due" },
  };

  it("joins the card labels into one discreet run for the row title", () => {
    const notes = [
      mk("tasks/tagged.md", {
        id: "t1",
        title: "Tagged",
        parentId: "",
        status: "wip",
        start: "2026-03-02",
        due: "2026-03-20",
      }),
    ];
    const g = gantt(labelCfg, notes);
    expect(g.rows[0].labelText).toBe("wip");
  });

  it("joins multiple label fields with a middot separator", () => {
    const notes = [
      mk("tasks/multi.md", {
        id: "t1",
        title: "Multi",
        parentId: "",
        status: "wip",
        area: "devops",
        start: "2026-03-02",
        due: "2026-03-20",
      }),
    ];
    const g = gantt(multiCfg, notes);
    expect(g.rows[0].labelText).toBe("wip · devops");
  });

  it("gives a dateless row its label text too", () => {
    const notes = [
      mk("tasks/dateless.md", {
        id: "t1",
        title: "Dateless",
        parentId: "",
        status: "someday",
      }),
    ];
    const g = gantt(labelCfg, notes);
    expect(g.rows[0].labelText).toBe("someday");
  });

  it("emits no label text when showLabels is false", () => {
    const cfg: MapCfg = {
      ...labelCfg,
      gantt: { ...labelCfg.gantt!, showLabels: false },
    };
    const notes = [
      mk("tasks/tagged.md", {
        id: "t1",
        title: "Tagged",
        parentId: "",
        status: "wip",
        start: "2026-03-02",
        due: "2026-03-20",
      }),
    ];
    const g = gantt(cfg, notes);
    expect(g.rows[0].labelText).toBe("");
  });

  it("leaves label text empty when no labels are configured", () => {
    const g = gantt();
    g.rows.forEach((r) => expect(r.labelText).toBe(""));
  });
});

describe("statusColor", () => {
  it("maps done-like statuses to green (case/space/hyphen insensitive)", () => {
    for (const s of ["done", "Complete", " COMPLETED ", "closed", "shipped"])
      expect(statusColor(s)).toBe("#2ecc71");
  });

  it("maps in-progress-like statuses to blue", () => {
    for (const s of [
      "in progress",
      "in-progress",
      "In   Progress",
      "doing",
      "active",
      "wip",
      "started",
      "ongoing",
    ])
      expect(statusColor(s)).toBe("#3498db");
  });

  it("maps todo-like statuses to grey", () => {
    for (const s of [
      "todo",
      "to do",
      "to-do",
      "planned",
      "backlog",
      "open",
      "not started",
      "new",
      "pending",
    ])
      expect(statusColor(s)).toBe("#95a5a6");
  });

  it("returns null for unknown or missing statuses", () => {
    expect(statusColor("whatever")).toBeNull();
    expect(statusColor("")).toBeNull();
    expect(statusColor(undefined)).toBeNull();
    expect(statusColor(null)).toBeNull();
  });
});

describe("layoutGantt — status colour on rows", () => {
  it("colours bars/milestones by the row status", () => {
    const g = gantt();
    const dns = g.rows.find((r) => r.id === "tasks/client-dns.md")!; // done
    const broker = g.rows.find((r) => r.id === "tasks/broker-operator.md")!; // in-progress
    const kickoff = g.rows.find((r) => r.id === "tasks/kickoff.md")!; // todo (milestone)
    expect(dns.color).toBe("#2ecc71");
    expect(broker.color).toBe("#3498db");
    expect(kickoff.color).toBe("#95a5a6");
  });

  it("falls back to the node colour when the status is unknown/missing", () => {
    const cfg: MapCfg = {
      levels: [
        { id: "t", from: "tasks", color: "#123456", card: { title: "title" } },
      ],
      gantt: { start: "start", end: "due" },
    };
    const notes = [
      mk("tasks/nostatus.md", {
        title: "No status",
        start: "2026-01-05",
        due: "2026-01-25",
      }),
    ];
    const g = gantt(cfg, notes);
    expect(g.rows[0].color).toBe("#123456");
  });

  it("reads the status from a configured field name", () => {
    const cfg: MapCfg = {
      levels: [{ id: "t", from: "tasks", card: { title: "title" } }],
      gantt: { start: "start", end: "due", status: "state" },
    };
    const notes = [
      mk("tasks/s.md", {
        title: "S",
        state: "done",
        start: "2026-01-05",
        due: "2026-01-25",
      }),
    ];
    const g = gantt(cfg, notes);
    expect(g.rows[0].color).toBe("#2ecc71");
  });
});

describe("layoutGantt — today marker", () => {
  const build2 = (today?: number) => {
    const { nodes, byLevel, vis } = build();
    return layoutGantt(taskCfg, nodes, byLevel, vis, { today });
  };

  it("sets todayX when today falls within the axis range", () => {
    const g = build2(parseDay("2026-06-15")!);
    expect(g.todayX).not.toBeNull();
    expect(g.todayX!).toBeGreaterThan(GANTT.labelWidth);
  });

  it("leaves todayX null when today is outside the axis range", () => {
    expect(build2(parseDay("2030-01-01")!).todayX).toBeNull();
    expect(build2(parseDay("2000-01-01")!).todayX).toBeNull();
  });

  it("leaves todayX null when no today is supplied", () => {
    expect(build2(undefined).todayX).toBeNull();
    expect(gantt().todayX).toBeNull();
  });

  it("leaves todayX null when the chart has no dated rows (no ticks)", () => {
    const { nodes, byLevel, vis } = build(taskCfg, [
      mk("tasks/a.md", { id: "a", title: "A", parentId: "", status: "todo" }),
    ]);
    const g = layoutGantt(taskCfg, nodes, byLevel, vis, {
      today: parseDay("2026-06-15")!,
    });
    expect(g.ticks).toEqual([]);
    expect(g.todayX).toBeNull();
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

  it("labels the year scale with plain years from Jan 1", () => {
    const y = gantt({
      ...taskCfg,
      gantt: { ...taskCfg.gantt!, scale: "year" },
    });
    // data range 2025-12-01 .. 2026-08-16 -> 2025, 2026 (+ one past the end)
    expect(y.ticks[0].label).toBe("2025");
    expect(y.ticks.map((t) => t.label)).toContain("2026");
    const bar = y.rows.find((r) => r.id === "tasks/broker-operator.md")!.bar!;
    expect(bar.w).toBeCloseTo(68 * GANTT.dayPx.year, 6);
  });

  it("honours a ui ganttScale override over cfg.gantt.scale", () => {
    const m = buildRenderModel(taskCfg, taskNotes, resolverFor(taskNotes), {
      view: "gantt",
      ganttScale: "year",
    });
    expect(m.gantt!.ticks[0].label).toBe("2025");
    const back = buildRenderModel(taskCfg, taskNotes, resolverFor(taskNotes), {
      view: "gantt",
    });
    expect(back.gantt!.ticks[0].label).toBe("Dec 2025");
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

describe("layoutGantt — major period boundaries", () => {
  const tick = (g: GanttModel, label: string) =>
    g.ticks.find((t) => t.label === label)!;

  it("month view: firmer line at each quarter start, not mid-quarter", () => {
    const g = gantt(); // Dec 2025 .. Sep 2026
    expect(tick(g, "Jan 2026").major).toBe(true); // Q1 start
    expect(tick(g, "Apr 2026").major).toBe(true); // Q2 start
    expect(tick(g, "Dec 2025").major).toBe(false);
    expect(tick(g, "Feb 2026").major).toBe(false);
  });

  it("quarter view: firmer line at the year start (Q1) only", () => {
    const q = gantt({
      ...taskCfg,
      gantt: { ...taskCfg.gantt!, scale: "quarter" },
    });
    expect(tick(q, "Q1 2026").major).toBe(true);
    expect(tick(q, "Q4 2025").major).toBe(false);
    expect(tick(q, "Q2 2026").major).toBe(false);
  });

  it("week view: firmer line on the first week of a new month", () => {
    const notes = [
      mk("tasks/span.md", {
        id: "t",
        title: "Span",
        parentId: "",
        status: "todo",
        start: "2026-01-20",
        due: "2026-02-18",
      }),
    ];
    const w = gantt(
      { ...taskCfg, gantt: { ...taskCfg.gantt!, scale: "week" } },
      notes
    );
    expect(w.ticks[0].major).toBe(true); // first tick always opens a "new" month
    const feb = w.ticks.find((t) => t.label.endsWith("Feb"))!;
    expect(feb.major).toBe(true);
    const midJan = w.ticks.filter((t) => t.label.endsWith("Jan"));
    expect(midJan.slice(1).every((t) => t.major === false)).toBe(true);
  });

  it("year view: firmer line at the decade boundary", () => {
    const notes = [
      mk("tasks/dec.md", {
        id: "t",
        title: "Decade span",
        parentId: "",
        status: "todo",
        start: "2019-06-01",
        due: "2021-06-01",
      }),
    ];
    const y = gantt(
      { ...taskCfg, gantt: { ...taskCfg.gantt!, scale: "year" } },
      notes
    );
    expect(tick(y, "2020").major).toBe(true);
    expect(tick(y, "2019").major).toBe(false);
    expect(tick(y, "2021").major).toBe(false);
  });
});

describe("layoutGantt — bar tooltip", () => {
  it("a bar row's tooltip carries title, date range, and status", () => {
    const notes = [
      mk("tasks/x.md", {
        id: "t",
        title: "Ship it",
        parentId: "",
        status: "in-progress",
        start: "2026-03-02",
        due: "2026-03-20",
      }),
    ];
    const g = gantt(taskCfg, notes);
    expect(g.rows[0].tooltip).toBe(
      "Ship it\n2026-03-02 → 2026-03-20\nStatus: in-progress"
    );
  });

  it("a milestone row's tooltip shows the single date", () => {
    const notes = [
      mk("tasks/m.md", {
        id: "t",
        title: "Launch",
        parentId: "",
        status: "todo",
        due: "2026-04-01",
      }),
    ];
    const g = gantt(taskCfg, notes);
    expect(g.rows[0].tooltip).toBe("Launch\n2026-04-01\nStatus: todo");
  });

  it("a dateless, statusless row's tooltip is just the title", () => {
    const notes = [
      mk("tasks/bare.md", { id: "t", title: "Bare", parentId: "" }),
    ];
    const g = gantt(
      {
        levels: [{ id: "t", from: "tasks", card: { title: "title" } }],
        gantt: { start: "start", end: "due" },
      },
      notes
    );
    expect(g.rows[0].tooltip).toBe("Bare");
  });

  it("carries progress and tags when present", () => {
    const cfg: MapCfg = {
      levels: [
        {
          id: "t",
          from: "tasks",
          card: { title: "title", progress: "progress", labels: ["area"] },
        },
      ],
      gantt: { start: "start", end: "due" },
    };
    const notes = [
      mk("tasks/x.md", {
        id: "t",
        title: "Ship it",
        parentId: "",
        status: "in-progress",
        start: "2026-03-02",
        due: "2026-03-20",
        progress: 30,
        area: "devops",
      }),
    ];
    const g = gantt(cfg, notes);
    expect(g.rows[0].tooltip).toBe(
      "Ship it\n2026-03-02 → 2026-03-20\nStatus: in-progress\nProgress: 30%\nTags: devops"
    );
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
