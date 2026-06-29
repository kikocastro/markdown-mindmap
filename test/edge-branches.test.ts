import { describe, it, expect } from "vitest";
import {
  wrap,
  cardContentHeight,
  countByCat,
  collectNodes,
  buildEdges,
  computeVisible,
  focusVisible,
  siblings,
  orderAndLayout,
  filterOptions,
  type MNode,
  type MapCfg,
} from "../src/graph";
import { mk, resolverFor } from "./fixtures";

// Edge branches the happy-path suites don't reach: empty/whitespace values,
// level dedup, secondary edges, resolver hits/misses, stale ids, and primary
// cycles (mutual frontmatter links are valid vault input, so these aren't dead).

// minimal MNode for the pure visibility/layout/siblings ops (no collection step)
const node = (id: string, over: Partial<MNode> = {}): MNode => ({
  id,
  levelIdx: 0,
  path: id,
  basename: id,
  fm: {},
  title: id,
  sub: "",
  meta: "",
  labels: [],
  labelColors: [],
  color: "#000",
  levelLabel: "",
  progress: null,
  bars: [],
  collIdx: 0,
  parents: new Set(),
  children: new Set(),
  primaryParent: null,
  ...over,
});

describe("wrap", () => {
  it("returns [] for an empty string (nothing to push)", () => {
    expect(wrap("", 100, 12, 2)).toEqual([]);
  });
});

describe("cardContentHeight", () => {
  it("floors title to 1 line when empty and adds the toggle pad for parents", () => {
    const childless = cardContentHeight(node("a", { title: "" }), 270, 2, 1);
    const parent = cardContentHeight(
      node("b", { title: "", children: new Set(["c"]) }),
      270,
      2,
      1
    );
    expect(childless).toBe(parent); // empty title -> 1 line either way; padR only shifts wrap width
    expect(childless).toBeGreaterThan(0);
  });

  it("floors a whitespace-only sub to 1 line", () => {
    const blank = cardContentHeight(node("a"), 270, 2, 1);
    const spaced = cardContentHeight(node("b", { sub: "   " }), 270, 2, 1);
    expect(spaced).toBe(blank + 15); // one sub line at 15px
  });
});

describe("countByCat", () => {
  it("skips empty entries in the list", () => {
    const fm = { tags: ["a (x)", "", "b (x)"] };
    expect(countByCat(fm, "tags")).toEqual([["x", 2]]);
  });
});

describe("collectNodes", () => {
  it("keeps a note in its first matching level only", () => {
    const cfg: MapCfg = {
      levels: [
        { id: "l1", from: "" },
        { id: "l2", from: "" },
      ],
    };
    const { byLevel } = collectNodes(cfg, [mk("n.md", { title: "N" })]);
    expect(byLevel[0]).toHaveLength(1);
    expect(byLevel[1]).toHaveLength(0);
  });

  it("defaults missing frontmatter to {}", () => {
    const cfg: MapCfg = { levels: [{ id: "l", from: "" }] };
    const note = {
      path: "n.md",
      basename: "n",
      frontmatter: undefined as never,
    };
    const { nodes } = collectNodes(cfg, [note]);
    expect(nodes["n.md"].title).toBe("n"); // falls back to basename, no throw
  });
});

describe("buildEdges", () => {
  it("ignores self-links and edges referencing unknown levels", () => {
    const cfg: MapCfg = {
      levels: [{ id: "a", from: "a", card: { title: "title" } }],
      edges: [
        { from: "a", to: "a", via: "self" }, // resolves to itself -> skipped
        { from: "ghost", to: "a", via: "x" }, // unknown level id -> skipped
      ],
    };
    const notes = [mk("a/n.md", { title: "n", self: "[[n]]" })];
    const { nodes, byLevel } = collectNodes(cfg, notes);
    buildEdges(cfg, nodes, byLevel);
    expect(nodes["a/n.md"].parents.size).toBe(0);
  });

  it("keeps the first edge kind when a pair is linked twice", () => {
    // same from/to declared primary then secondary -> stays primary (no downgrade)
    const cfg: MapCfg = {
      levels: [
        { id: "g", from: "g", card: { title: "title" } },
        { id: "p", from: "p", card: { title: "title" } },
      ],
      edges: [
        { from: "g", to: "p", via: "goal" },
        { from: "g", to: "p", via: "goal", secondary: true },
      ],
    };
    const notes = [
      mk("g/G.md", { title: "G" }),
      mk("p/P.md", { title: "P", goal: "[[G]]" }),
    ];
    const { nodes, byLevel } = collectNodes(cfg, notes);
    buildEdges(cfg, nodes, byLevel);
    expect(nodes["p/P.md"].primaryParent).toBe("g/G.md");
  });

  it("resolves by `title` frontmatter when basename misses, and via reverse edges", () => {
    const cfg: MapCfg = {
      levels: [
        { id: "g", from: "g", card: { title: "title" } },
        { id: "p", from: "p", card: { title: "title" } },
      ],
      // reverse: the `via` lives on the `from` note pointing down to `to`
      edges: [{ from: "g", to: "p", via: "children", reverse: true }],
    };
    const notes = [
      // points to "Child One" (a title, not a basename) and to a dangling name
      mk("g/G.md", { title: "G", children: ["[[Child One]]", "[[Nope]]"] }),
      mk("p/c1.md", { title: "Child One" }),
    ];
    const { nodes, byLevel } = collectNodes(cfg, notes);
    buildEdges(cfg, nodes, byLevel);
    expect(nodes["p/c1.md"].primaryParent).toBe("g/G.md");
  });

  it("records secondary (dashed) edges without setting a primary parent", () => {
    const cfg: MapCfg = {
      levels: [
        { id: "g", from: "g", card: { title: "title" } },
        { id: "p", from: "p", card: { title: "title" } },
      ],
      edges: [{ from: "g", to: "p", via: "goal", secondary: true }],
    };
    const notes = [
      mk("g/G.md", { title: "G" }),
      mk("p/P.md", { title: "P", goal: "[[G]]" }),
      mk("p/orphan.md", { title: "orphan", goal: "[[Ghost]]" }), // dangling -> no edge
    ];
    const { nodes, byLevel } = collectNodes(cfg, notes);
    buildEdges(cfg, nodes, byLevel);
    expect(nodes["p/P.md"].parents.has("g/G.md")).toBe(true);
    expect(nodes["p/P.md"].primaryParent).toBeNull();
    expect(nodes["p/orphan.md"].parents.size).toBe(0);
  });

  it("resolves via the injected resolver, falling back to basename", () => {
    const cfg: MapCfg = {
      levels: [
        { id: "g", from: "g", card: { title: "title" } },
        { id: "p", from: "p", card: { title: "title" } },
      ],
      edges: [{ from: "g", to: "p", via: "goal" }],
    };
    const notes = [
      mk("g/G.md", { title: "G" }),
      mk("p/hit.md", { title: "hit", goal: "[[G]]" }), // resolver returns g/G.md
      mk("p/miss.md", { title: "miss", goal: "[[G]]" }), // resolver null -> basename path
    ];
    const { nodes, byLevel } = collectNodes(cfg, notes);
    // resolver knows only the hit note's target; miss falls through to basename index
    const resolver = resolverFor([notes[0]]);
    buildEdges(cfg, nodes, byLevel, resolver);
    expect(nodes["p/hit.md"].primaryParent).toBe("g/G.md");
    expect(nodes["p/miss.md"].primaryParent).toBe("g/G.md");
  });
});

describe("computeVisible", () => {
  it("ignores stale collapsed ids", () => {
    const nodes = { a: node("a") };
    const vis = computeVisible(nodes, new Set(["ghost"]), {}, { levels: [] });
    expect([...vis]).toEqual(["a"]);
  });
});

describe("focusVisible", () => {
  it("terminates on a primary-parent cycle", () => {
    // A <-> B mutual primary parents (valid if two notes link each other)
    const a = node("a", { primaryParent: "b", children: new Set(["b"]) });
    const b = node("b", { primaryParent: "a", children: new Set(["a"]) });
    const vis = focusVisible({ a, b }, "a");
    expect(new Set(vis)).toEqual(new Set(["a", "b"]));
  });
});

describe("siblings", () => {
  it("orders by level, then collection index, then path", () => {
    const parent = node("p", {
      children: new Set(["hi", "lo", "tieB", "tieA", "self"]),
    });
    const self = node("self", { parents: new Set(["p"]) });
    const hi = node("hi", { levelIdx: 2, collIdx: 0, parents: new Set(["p"]) });
    const lo = node("lo", { levelIdx: 1, collIdx: 9, parents: new Set(["p"]) });
    // same level + same collIdx -> path breaks the tie
    const tieB = node("tieB", {
      levelIdx: 1,
      collIdx: 9,
      parents: new Set(["p"]),
    });
    const tieA = node("tieA", {
      levelIdx: 1,
      collIdx: 9,
      parents: new Set(["p"]),
    });
    const nodes = { p: parent, self, hi, lo, tieB, tieA };
    expect(siblings(nodes, "self")).toEqual(["lo", "tieA", "tieB", "hi"]);
  });
});

describe("orderAndLayout", () => {
  it("does not loop on a primary-parent cycle", () => {
    const cfg: MapCfg = { levels: [{ id: "l", from: "" }] };
    const a = node("a", { primaryParent: "b", children: new Set(["b"]) });
    const b = node("b", { primaryParent: "a", children: new Set(["a"]) });
    const nodes = { a, b };
    const byLevel = [[a, b]];
    const vis = new Set(["a", "b"]);
    const { order } = orderAndLayout(cfg, nodes, byLevel, vis);
    expect(order[0].sort()).toEqual(["a", "b"]);
  });
});

describe("filterOptions", () => {
  it("returns {} when no filter is configured", () => {
    expect(filterOptions({ a: node("a") }, { levels: [] })).toEqual({});
  });
});
