import { describe, it, expect } from "vitest";
import {
  CausalCfg,
  CausalEdge,
  CausalNode,
  buildCausalEdges,
  buildLoops,
  causalExportPath,
  causalSearchMatch,
  collectCausalNodes,
  collectLoopCards,
  edgeKey,
  findCycles,
  layoutCausal,
  relaxOverlaps,
  resolveCausalLayout,
  validateCausalConfig,
  CAUSAL_TYPE_COLORS,
  CAUSAL_FALLBACK_COLOR,
} from "../src/causal";
import { mk } from "./fixtures";

const baseCfg: CausalCfg = { folders: ["sys/nodes"] };

// hand-build a node record (id-keyed) for the pure-graph functions
const nid = (id: string, extra: Partial<CausalNode> = {}): CausalNode => ({
  id,
  path: `sys/nodes/${id}.md`,
  basename: id,
  label: id,
  type: "",
  color: CAUSAL_FALLBACK_COLOR,
  fm: {},
  ...extra,
});
const rec = (...ns: CausalNode[]): Record<string, CausalNode> =>
  Object.fromEntries(ns.map((n) => [n.id, n]));
const e = (
  from: string,
  to: string,
  sign: "+" | "-" = "+",
  tags: string[] = []
): CausalEdge => ({
  from,
  to,
  sign,
  tags,
});

// ---- validateCausalConfig --------------------------------------------------

describe("validateCausalConfig", () => {
  it("throws on null cfg", () => {
    expect(() => validateCausalConfig(null)).toThrow(
      /non-empty `folders:` list/
    );
  });
  it("throws when folders is missing", () => {
    expect(() => validateCausalConfig({} as CausalCfg)).toThrow(
      /non-empty `folders:` list/
    );
  });
  it("throws on an empty folders array", () => {
    expect(() => validateCausalConfig({ folders: [] })).toThrow(
      /non-empty `folders:` list/
    );
  });
  it("accepts a valid cfg", () => {
    expect(() => validateCausalConfig({ folders: ["sys"] })).not.toThrow();
  });
});

// ---- collectCausalNodes ----------------------------------------------------

describe("collectCausalNodes", () => {
  it("collects notes under the configured folders only", () => {
    const notes = [
      mk("sys/nodes/a.md", { label: "A" }),
      mk("elsewhere/b.md", { label: "B" }),
    ];
    const nodes = collectCausalNodes(baseCfg, notes);
    expect(Object.keys(nodes)).toEqual(["a"]);
  });

  it("applies the where filter", () => {
    const cfg: CausalCfg = { ...baseCfg, where: { status: "active" } };
    const notes = [
      mk("sys/nodes/a.md", { status: "active" }),
      mk("sys/nodes/b.md", { status: "dormant" }),
      mk("sys/nodes/c.md", {}),
    ];
    expect(Object.keys(collectCausalNodes(cfg, notes))).toEqual(["a"]);
  });

  it("uses frontmatter id when present, basename otherwise", () => {
    const notes = [
      mk("sys/nodes/File Name.md", { id: "logical-id" }),
      mk("sys/nodes/bare.md", {}),
    ];
    const nodes = collectCausalNodes(baseCfg, notes);
    expect(Object.keys(nodes).sort()).toEqual(["bare", "logical-id"]);
  });

  it("first note wins a duplicated id", () => {
    const notes = [
      mk("sys/nodes/one.md", { id: "dup", label: "First" }),
      mk("sys/nodes/two.md", { id: "dup", label: "Second" }),
    ];
    const nodes = collectCausalNodes(baseCfg, notes);
    expect(nodes["dup"].label).toBe("First");
  });

  it("reads label from the default field with basename fallback", () => {
    const notes = [
      mk("sys/nodes/a.md", { label: "Nice label" }),
      mk("sys/nodes/b.md", {}),
    ];
    const nodes = collectCausalNodes(baseCfg, notes);
    expect(nodes["a"].label).toBe("Nice label");
    expect(nodes["b"].label).toBe("b");
  });

  it("honours custom labelField and typeField", () => {
    const cfg: CausalCfg = {
      ...baseCfg,
      labelField: "name",
      typeField: "kind",
    };
    const notes = [mk("sys/nodes/a.md", { name: "Custom", kind: "vice" })];
    const nodes = collectCausalNodes(cfg, notes);
    expect(nodes["a"].label).toBe("Custom");
    expect(nodes["a"].type).toBe("vice");
    expect(nodes["a"].color).toBe(CAUSAL_TYPE_COLORS["vice"]);
  });

  it("colours by type with custom overrides and a grey fallback", () => {
    const cfg: CausalCfg = { ...baseCfg, typeColors: { vice: "#000000" } };
    const notes = [
      mk("sys/nodes/a.md", { type: "vice" }),
      mk("sys/nodes/b.md", { type: "capability" }),
      mk("sys/nodes/c.md", { type: "unknown-type" }),
    ];
    const nodes = collectCausalNodes(cfg, notes);
    expect(nodes["a"].color).toBe("#000000");
    expect(nodes["b"].color).toBe(CAUSAL_TYPE_COLORS["capability"]);
    expect(nodes["c"].color).toBe(CAUSAL_FALLBACK_COLOR);
  });
});

// ---- buildCausalEdges --------------------------------------------------------

describe("buildCausalEdges", () => {
  it("builds signed edges from the default affects field", () => {
    const notes = [
      mk("sys/nodes/a.md", {
        affects: [{ to: "b", sign: "-", loops: ["R1"] }],
      }),
      mk("sys/nodes/b.md", {}),
    ];
    const nodes = collectCausalNodes(baseCfg, notes);
    const edges = buildCausalEdges(baseCfg, nodes);
    expect(edges).toEqual([{ from: "a", to: "b", sign: "-", tags: ["R1"] }]);
  });

  it("defaults sign to + and tags to [] (scalar loops value accepted)", () => {
    const notes = [
      mk("sys/nodes/a.md", { affects: [{ to: "b" }] }),
      mk("sys/nodes/b.md", { affects: [{ to: "a", loops: "B1" }] }),
    ];
    const nodes = collectCausalNodes(baseCfg, notes);
    const edges = buildCausalEdges(baseCfg, nodes);
    expect(edges[0]).toEqual({ from: "a", to: "b", sign: "+", tags: [] });
    expect(edges[1]).toEqual({ from: "b", to: "a", sign: "+", tags: ["B1"] });
  });

  it("honours a custom edgesField", () => {
    const cfg: CausalCfg = { ...baseCfg, edgesField: "causes" };
    const notes = [
      mk("sys/nodes/a.md", { causes: [{ to: "b" }] }),
      mk("sys/nodes/b.md", {}),
    ];
    const nodes = collectCausalNodes(cfg, notes);
    expect(buildCausalEdges(cfg, nodes)).toHaveLength(1);
  });

  it("resolves `to` by logical id, then basename, then the injected resolver", () => {
    const notes = [
      mk("sys/nodes/source.md", {
        affects: [{ to: "x1" }, { to: "By Name" }, { to: "[[Some Alias]]" }],
      }),
      mk("sys/nodes/By Name.md", { id: "named" }),
      mk("sys/nodes/x.md", { id: "x1" }),
      mk("sys/nodes/aliased.md", { id: "al" }),
    ];
    const nodes = collectCausalNodes(baseCfg, notes);
    const resolver = (key: string) =>
      key === "Some Alias" ? "sys/nodes/aliased.md" : null;
    const edges = buildCausalEdges(baseCfg, nodes, resolver);
    expect(edges.map((ed) => ed.to)).toEqual(["x1", "named", "al"]);
  });

  it("skips unresolved targets (no resolver, and resolver misses)", () => {
    const notes = [
      mk("sys/nodes/a.md", { affects: [{ to: "ghost" }, { to: "b" }] }),
      mk("sys/nodes/b.md", {}),
    ];
    const nodes = collectCausalNodes(baseCfg, notes);
    expect(buildCausalEdges(baseCfg, nodes)).toHaveLength(1);
    expect(buildCausalEdges(baseCfg, nodes, () => null)).toHaveLength(1);
  });

  it("skips malformed entries: scalars, nulls, and missing `to`", () => {
    const notes = [
      mk("sys/nodes/a.md", {
        affects: ["b", null, { sign: "-" }, { to: "b" }],
      }),
      mk("sys/nodes/b.md", {}),
    ];
    const nodes = collectCausalNodes(baseCfg, notes);
    expect(buildCausalEdges(baseCfg, nodes)).toHaveLength(1);
  });

  it("skips self-edges and duplicate from|to pairs", () => {
    const notes = [
      mk("sys/nodes/a.md", {
        affects: [{ to: "a" }, { to: "b" }, { to: "b", sign: "-" }],
      }),
      mk("sys/nodes/b.md", {}),
    ];
    const nodes = collectCausalNodes(baseCfg, notes);
    const edges = buildCausalEdges(baseCfg, nodes);
    expect(edges).toHaveLength(1);
    expect(edges[0].sign).toBe("+"); // first declaration wins
  });
});

// ---- findCycles ------------------------------------------------------------

describe("findCycles", () => {
  it("finds a triangle once, rotated to start at the lowest-sorted node", () => {
    const nodes = rec(nid("c"), nid("a"), nid("b"));
    const cycles = findCycles(nodes, [e("c", "a"), e("a", "b"), e("b", "c")]);
    expect(cycles).toEqual([["a", "b", "c"]]);
  });

  it("finds a two-node mutual link", () => {
    const nodes = rec(nid("a"), nid("b"));
    expect(findCycles(nodes, [e("a", "b"), e("b", "a")])).toEqual([["a", "b"]]);
  });

  it("returns [] for an acyclic graph", () => {
    const nodes = rec(nid("a"), nid("b"), nid("c"));
    expect(findCycles(nodes, [e("a", "b"), e("a", "c"), e("b", "c")])).toEqual(
      []
    );
  });

  it("finds both loops of a figure-8 sharing one node", () => {
    const nodes = rec(nid("a"), nid("b"), nid("m"), nid("z"));
    const cycles = findCycles(nodes, [
      e("m", "a"),
      e("a", "m"),
      e("m", "z"),
      e("z", "m"),
      e("b", "a"), // dead-end feeder, not part of any cycle
    ]);
    expect(cycles).toEqual([
      ["a", "m"],
      ["m", "z"],
    ]);
  });

  it("ignores self-loops", () => {
    const nodes = rec(nid("a"), nid("b"));
    expect(findCycles(nodes, [e("a", "a"), e("a", "b"), e("b", "a")])).toEqual([
      ["a", "b"],
    ]);
  });

  it("caps the number of cycles via maxCycles", () => {
    // three independent 2-cycles -> only the first survives the cap
    const nodes = rec(
      nid("a"),
      nid("b"),
      nid("c"),
      nid("d"),
      nid("e"),
      nid("f")
    );
    const edges = [
      e("a", "b"),
      e("b", "a"),
      e("c", "d"),
      e("d", "c"),
      e("e", "f"),
      e("f", "e"),
    ];
    expect(findCycles(nodes, edges, { maxCycles: 1 })).toEqual([["a", "b"]]);
  });

  it("caps cycle length via maxLen", () => {
    const nodes = rec(nid("a"), nid("b"), nid("c"));
    const tri = [e("a", "b"), e("b", "c"), e("c", "a")];
    expect(findCycles(nodes, tri, { maxLen: 2 })).toEqual([]);
    expect(findCycles(nodes, tri, { maxLen: 3 })).toEqual([["a", "b", "c"]]);
  });

  it("stops expanding when the step budget runs out", () => {
    const nodes = rec(nid("a"), nid("b"), nid("c"));
    const tri = [e("a", "b"), e("b", "c"), e("c", "a")];
    expect(findCycles(nodes, tri, { maxSteps: 1 })).toEqual([]);
  });
});

// ---- buildLoops --------------------------------------------------------------

describe("buildLoops", () => {
  it("classifies polarity by sign parity: even minus = reinforcing, odd = balancing", () => {
    const edges = [
      e("a", "b", "-"),
      e("b", "a", "-"), // two minuses -> reinforcing
      e("c", "d", "-"),
      e("d", "c", "+"), // one minus -> balancing
    ];
    const loops = buildLoops(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      edges
    );
    expect(loops.map((l) => l.kind)).toEqual(["reinforcing", "balancing"]);
  });

  it("names a loop by the declared tag shared across all its edges", () => {
    const edges = [e("a", "b", "+", ["R1", "B9"]), e("b", "a", "+", ["R1"])];
    const loops = buildLoops([["a", "b"]], edges);
    expect(loops[0].name).toBe("R1");
    expect(loops[0].declared).toBe(true);
    expect(loops[0].edges).toEqual([edgeKey("a", "b"), edgeKey("b", "a")]);
  });

  it("breaks shared-tag ties alphabetically", () => {
    const edges = [
      e("a", "b", "+", ["B2", "A1"]),
      e("b", "a", "+", ["A1", "B2"]),
    ];
    expect(buildLoops([["a", "b"]], edges)[0].name).toBe("A1");
  });

  it("auto-names untagged loops L1, L2, …", () => {
    const edges = [e("a", "b"), e("b", "a"), e("c", "d"), e("d", "c")];
    const loops = buildLoops(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      edges
    );
    expect(loops.map((l) => l.name)).toEqual(["L1", "L2"]);
    expect(loops.map((l) => l.declared)).toEqual([false, false]);
  });

  it("reserves declared loop tags before assigning auto names", () => {
    const edges = [
      e("a", "b"),
      e("b", "a"),
      e("c", "d", "+", ["L1"]),
      e("d", "c", "+", ["L1"]),
    ];
    const loops = buildLoops(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      edges,
      {
        L1: { label: "Named loop", path: "sys/loops/L1.md" },
      }
    );

    expect(loops.map((l) => [l.name, l.declared, l.label])).toEqual([
      ["L1", true, "Named loop"],
      ["L2", false, undefined],
    ]);
  });

  it("falls back to an auto name when two cycles claim the same tag", () => {
    const edges = [
      e("a", "b", "+", ["X"]),
      e("b", "a", "+", ["X"]),
      e("c", "d", "+", ["X"]),
      e("d", "c", "+", ["X"]),
    ];
    const names = buildLoops(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      edges
    )
      .map((l) => l.name)
      .sort();
    expect(names).toEqual(["L1", "X"]);
  });

  it("auto names skip over a declared tag that already took the slot", () => {
    const edges = [
      e("a", "b", "+", ["L1"]),
      e("b", "a", "+", ["L1"]),
      e("c", "d"),
      e("d", "c"),
    ];
    const names = buildLoops(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      edges
    ).map((l) => l.name);
    expect(names).toContain("L1");
    expect(names).toContain("L2");
  });

  it("attaches loop-card labels and sorts declared loops first, alphabetically", () => {
    const edges = [
      e("a", "b"),
      e("b", "a"),
      e("c", "d", "+", ["R2"]),
      e("d", "c", "+", ["R2"]),
      e("g", "h", "+", ["B1"]),
      e("h", "g", "+", ["B1"]),
    ];
    const loops = buildLoops(
      [
        ["a", "b"],
        ["c", "d"],
        ["g", "h"],
      ],
      edges,
      { R2: { label: "Sprawl", path: "sys/loops/R2.md" } }
    );
    expect(loops.map((l) => l.name)).toEqual(["B1", "R2", "L1"]);
    expect(loops[1].label).toBe("Sprawl");
    expect(loops[0].label).toBeUndefined();
  });
});

// ---- collectLoopCards --------------------------------------------------------

describe("collectLoopCards", () => {
  it("returns {} when loopFolders is unset", () => {
    expect(
      collectLoopCards(baseCfg, [mk("sys/loops/R1.md", { label: "X" })])
    ).toEqual({});
  });

  it("collects cards by id (frontmatter id or basename) with optional label", () => {
    const cfg: CausalCfg = { ...baseCfg, loopFolders: ["sys/loops"] };
    const notes = [
      mk("sys/loops/R1.md", { label: "Shortcut spiral" }),
      mk("sys/loops/loop-b.md", { id: "B1" }),
      mk("sys/nodes/a.md", { label: "not a loop" }),
    ];
    const cards = collectLoopCards(cfg, notes);
    expect(cards).toEqual({
      R1: { label: "Shortcut spiral", path: "sys/loops/R1.md" },
      B1: { label: undefined, path: "sys/loops/loop-b.md" },
    });
  });
});

// ---- layoutCausal --------------------------------------------------------------

const boxesOverlap = (a: CausalNode, b: CausalNode): boolean =>
  Math.abs(a.x! + a.w! / 2 - (b.x! + b.w! / 2)) < (a.w! + b.w!) / 2 &&
  Math.abs(a.y! + a.h! / 2 - (b.y! + b.h! / 2)) < (a.h! + b.h!) / 2;

describe("layoutCausal", () => {
  it("returns zero extents for an empty graph", () => {
    expect(layoutCausal({}, [])).toEqual({ contentRight: 0, contentBottom: 0 });
  });

  it("places every node with finite, margin-respecting coordinates", () => {
    const nodes = rec(nid("a"), nid("b"), nid("c"));
    const { contentRight, contentBottom } = layoutCausal(nodes, [
      e("a", "b"),
      e("b", "c"),
      e("c", "a"),
    ]);
    Object.values(nodes).forEach((n) => {
      expect(Number.isFinite(n.x!)).toBe(true);
      expect(Number.isFinite(n.y!)).toBe(true);
      expect(n.x!).toBeGreaterThanOrEqual(0);
      expect(n.y!).toBeGreaterThanOrEqual(0);
      expect(contentRight).toBeGreaterThanOrEqual(n.x! + n.w!);
      expect(contentBottom).toBeGreaterThanOrEqual(n.y! + n.h!);
    });
  });

  it("leaves no pair of boxes overlapping, even from a cramped start", () => {
    // tiny spacing forces the FR phase to squash nodes together, so the
    // overlap-relax phase has to actually separate them (both axes)
    const nodes = rec(nid("a"), nid("b"), nid("c"), nid("d"), nid("e"));
    const edges = [
      e("a", "b"),
      e("b", "c"),
      e("c", "d"),
      e("d", "e"),
      e("e", "a"),
      e("a", "c"),
      e("b", "d"),
    ];
    layoutCausal(nodes, edges, { spacing: 10, iterations: 50 });
    const all = Object.values(nodes);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++)
        expect(boxesOverlap(all[i], all[j])).toBe(false);
  });

  it("is deterministic: same input, same coordinates", () => {
    const mkNodes = () => rec(nid("a"), nid("b"), nid("c"), nid("d"));
    const edges = [e("a", "b"), e("b", "c"), e("c", "d"), e("d", "a")];
    const n1 = mkNodes(),
      n2 = mkNodes();
    layoutCausal(n1, edges);
    layoutCausal(n2, edges);
    Object.keys(n1).forEach((id) => {
      expect(n1[id].x).toBe(n2[id].x);
      expect(n1[id].y).toBe(n2[id].y);
    });
  });

  it("honours nodeWidth and grows the box for long labels", () => {
    const short = nid("a", { label: "Short" });
    const long = nid("b", {
      label: "A very long label that will certainly wrap across several lines",
    });
    layoutCausal(rec(short, long), [e("a", "b")], { nodeWidth: 140 });
    expect(short.w).toBe(140);
    expect(long.w).toBe(140);
    expect(long.h!).toBeGreaterThan(short.h!);
  });

  it("relaxOverlaps separates pairs along the cheaper axis, in both directions", () => {
    // wide flat boxes nearly side by side -> horizontal push, both orders
    const w2 = [100, 100];
    const h2 = [20, 20];
    const pxA = [0, 90];
    const pyA = [0, 0];
    relaxOverlaps(w2, h2, pxA, pyA, 4);
    expect(pxA[1] - pxA[0]).toBeGreaterThanOrEqual(104);
    const pxB = [90, 0]; // lower index on the right -> the other ternary arm
    const pyB = [0, 0];
    relaxOverlaps(w2, h2, pxB, pyB, 4);
    expect(pxB[0] - pxB[1]).toBeGreaterThanOrEqual(104);
    // nearly stacked boxes -> vertical push, both orders
    const pyC = [0, 15];
    const pxC = [0, 0];
    relaxOverlaps(w2, h2, pxC, pyC, 4);
    expect(pyC[1] - pyC[0]).toBeGreaterThanOrEqual(24);
    const pyD = [15, 0];
    const pxD = [0, 0];
    relaxOverlaps(w2, h2, pxD, pyD, 4);
    expect(pyD[0] - pyD[1]).toBeGreaterThanOrEqual(24);
  });

  it("resolveCausalLayout applies defaults and overrides", () => {
    expect(resolveCausalLayout()).toEqual({
      nodeW: 180,
      spacing: 270,
      iterations: 300,
    });
    expect(
      resolveCausalLayout({ nodeWidth: 100, spacing: 50, iterations: 10 })
    ).toEqual({
      nodeW: 100,
      spacing: 50,
      iterations: 10,
    });
  });
});

// ---- search + export path ------------------------------------------------------

describe("causalSearchMatch", () => {
  const n = nid("tech-debt", { label: "Accumulated tech debt" });
  it("matches label and id case-insensitively", () => {
    expect(causalSearchMatch(n, "TECH")).toBe(true);
    expect(causalSearchMatch(n, "accumulated")).toBe(true);
    expect(causalSearchMatch(n, "nope")).toBe(false);
  });
  it("empty term matches everything", () => {
    expect(causalSearchMatch(n, "")).toBe(true);
  });
});

describe("causalExportPath", () => {
  it("lands next to the note with a causal-map suffix", () => {
    expect(causalExportPath("notes/Retro.md")).toBe(
      "notes/Retro causal map.html"
    );
  });
});

// ---- integration: the reference systems repo format -----------------------------

describe("integration — reference card format end to end", () => {
  const cfg: CausalCfg = {
    folders: ["sys/nodes"],
    loopFolders: ["sys/loops"],
    where: { status: "active" },
  };
  const notes = [
    mk("sys/nodes/untested-code-live.md", {
      id: "untested-code-live",
      label: "Untested code live",
      type: "vice",
      status: "active",
      affects: [{ to: "incident", sign: "+", loops: ["R1", "B1"] }],
    }),
    mk("sys/nodes/incident.md", {
      id: "incident",
      label: "Broken demo / dev",
      type: "vice",
      status: "active",
      affects: [
        { to: "firefighting", sign: "+", loops: ["R1"] },
        { to: "blameless-postmortem", sign: "+", loops: ["B1"] },
      ],
    }),
    mk("sys/nodes/firefighting.md", {
      id: "firefighting",
      label: "Firefighting",
      type: "vice",
      status: "active",
      affects: [{ to: "invest-capacity", sign: "-", loops: ["R1"] }],
    }),
    mk("sys/nodes/invest-capacity.md", {
      id: "invest-capacity",
      label: "Capacity to invest",
      type: "capability",
      status: "active",
      affects: [{ to: "pipeline-trust", sign: "+", loops: ["R1"] }],
    }),
    mk("sys/nodes/pipeline-trust.md", {
      id: "pipeline-trust",
      label: "Pipeline trust",
      type: "capability",
      status: "active",
      affects: [{ to: "untested-code-live", sign: "-", loops: ["R1"] }],
    }),
    mk("sys/nodes/blameless-postmortem.md", {
      id: "blameless-postmortem",
      label: "Blameless postmortem",
      type: "virtue",
      status: "active",
      affects: [{ to: "system-improvements", sign: "+", loops: ["B1"] }],
    }),
    mk("sys/nodes/system-improvements.md", {
      id: "system-improvements",
      label: "System improvements",
      type: "virtue",
      status: "active",
      affects: [{ to: "release-gate-friction", sign: "-", loops: ["B1"] }],
    }),
    mk("sys/nodes/release-gate-friction.md", {
      id: "release-gate-friction",
      label: "Release-gate friction",
      type: "vice",
      status: "active",
      affects: [{ to: "bypass-release-process", sign: "+", loops: ["B1"] }],
    }),
    mk("sys/nodes/bypass-release-process.md", {
      id: "bypass-release-process",
      label: "Bypass the release process",
      type: "vice",
      status: "active",
      affects: [{ to: "untested-code-live", sign: "+", loops: ["B1"] }],
    }),
    mk("sys/nodes/dormant-thing.md", {
      id: "dormant-thing",
      type: "vice",
      status: "dormant",
      affects: [{ to: "incident", sign: "+" }],
    }),
    mk("sys/loops/R1.md", {
      id: "R1",
      label: "Shortcut spiral",
      kind: "reinforcing",
    }),
    mk("sys/loops/B1.md", {
      id: "B1",
      label: "Learning loop",
      kind: "balancing",
    }),
  ];

  it("detects R1 (reinforcing) and B1 (balancing) with card labels", () => {
    const nodes = collectCausalNodes(cfg, notes);
    expect(Object.keys(nodes)).toHaveLength(9); // dormant excluded
    const edges = buildCausalEdges(cfg, nodes);
    const cycles = findCycles(nodes, edges);
    const loops = buildLoops(cycles, edges, collectLoopCards(cfg, notes));
    expect(loops.map((l) => [l.name, l.kind, l.label])).toEqual([
      ["B1", "balancing", "Learning loop"],
      ["R1", "reinforcing", "Shortcut spiral"],
    ]);
    // layout runs clean over the real shape
    const { contentRight, contentBottom } = layoutCausal(nodes, edges);
    expect(contentRight).toBeGreaterThan(0);
    expect(contentBottom).toBeGreaterThan(0);
  });
});
