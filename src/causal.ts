// ============================================================================
// Causal maps (systems-thinking causal-loop diagrams) — pure logic, host-free
// like graph.ts. Nodes are notes carrying outgoing signed edges in frontmatter
// (`affects: [{to, sign, loops}]`); cycles are detected here and classified
// reinforcing/balancing by sign parity (even minuses = reinforcing). The
// Obsidian adapter (src/obsidian/causal.ts) draws what these functions return.
// ============================================================================

import {
  NoteLike,
  Resolver,
  asArray,
  getPath,
  inFolder,
  linkKey,
  matchesWhere,
  scalarStr,
  wrap,
} from "./graph";

export type Sign = "+" | "-";

// node type -> border colour, mirroring CLD conventions:
// driver purple (external forcing function), vice red (want low),
// capability blue (want high), virtue green (the learning loop)
export const CAUSAL_TYPE_COLORS: Record<string, string> = {
  driver: "#9b59b6",
  vice: "#e74c3c",
  capability: "#3498db",
  virtue: "#2ecc71",
};
export const CAUSAL_FALLBACK_COLOR = "#7f8c8d";

export interface CausalLayoutCfg {
  nodeWidth?: number;
  spacing?: number;
  iterations?: number;
}
export interface ResolvedCausalLayout {
  nodeW: number;
  spacing: number;
  iterations: number;
}
export const resolveCausalLayout = (
  l?: CausalLayoutCfg
): ResolvedCausalLayout => ({
  nodeW: l?.nodeWidth ?? 180,
  spacing: l?.spacing ?? 270,
  iterations: l?.iterations ?? 300,
});

export interface CausalCfg {
  title?: string;
  height?: number;
  folders: string[]; // where the variable cards live (required)
  loopFolders?: string[]; // optional loop cards supplying labels per tag
  edgesField?: string; // frontmatter field with outgoing edges (default "affects")
  labelField?: string; // default "label", falls back to the basename
  typeField?: string; // default "type"
  typeColors?: Record<string, string>; // per-map overrides of CAUSAL_TYPE_COLORS
  where?: Record<string, unknown>; // e.g. { status: active }
  properties?: boolean; // show all frontmatter in the note dialog
  layout?: CausalLayoutCfg;
}

export interface CausalNode {
  id: string; // logical id: frontmatter `id`, else basename
  path: string;
  basename: string;
  label: string;
  type: string;
  color: string;
  fm: Record<string, unknown>;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}
export interface CausalEdge {
  from: string; // logical ids
  to: string;
  sign: Sign;
  tags: string[]; // declared loop names this edge belongs to
}
export interface CausalLoop {
  name: string; // declared tag, or auto "L1", "L2", …
  label?: string; // from a loop card, when one exists
  kind: "reinforcing" | "balancing"; // computed from sign parity, cards don't override
  declared: boolean; // named by a tag (vs auto-detected only)
  nodes: string[]; // cycle order, first = lowest-sorted id
  edges: string[]; // edgeKey per step, same order (last one closes the loop)
}
export interface LoopCard {
  label?: string;
  path: string;
}

// throws the documented error when the map has no folders (the code-block processor catches it)
export function validateCausalConfig(
  cfg: CausalCfg | null | undefined
): asserts cfg is CausalCfg {
  if (!cfg || !Array.isArray(cfg.folders) || !cfg.folders.length)
    throw new Error(
      'A causal map needs a non-empty `folders:` list pointing at your variable cards. Click "Help" for an example.'
    );
}

// ---- node collection -------------------------------------------------------

// Notes under cfg.folders (passing `where`) become nodes keyed by logical id.
// The first note wins a duplicated id, matching collectNodes' first-level-wins.
export function collectCausalNodes(
  cfg: CausalCfg,
  notes: NoteLike[]
): Record<string, CausalNode> {
  const labelField = cfg.labelField || "label";
  const typeField = cfg.typeField || "type";
  const colors = { ...CAUSAL_TYPE_COLORS, ...cfg.typeColors };
  const nodes: Record<string, CausalNode> = {};
  notes.forEach((nt) => {
    if (!cfg.folders.some((f) => inFolder(nt.path, f))) return;
    if (!matchesWhere(nt.frontmatter, cfg.where)) return;
    const id = scalarStr(nt.frontmatter["id"]) || nt.basename;
    if (nodes[id]) return;
    const type = scalarStr(getPath(nt.frontmatter, typeField));
    nodes[id] = {
      id,
      path: nt.path,
      basename: nt.basename,
      label: scalarStr(getPath(nt.frontmatter, labelField)) || nt.basename,
      type,
      color: colors[type] || CAUSAL_FALLBACK_COLOR,
      fm: nt.frontmatter,
    };
  });
  return nodes;
}

// ---- edges -------------------------------------------------------------------

export const edgeKey = (from: string, to: string): string => from + "|" + to;

// Walk each node's outgoing-edge entries ({to, sign, loops}). A `to` resolves by
// logical id, then node basename, then the injected wikilink resolver. Unresolved
// targets, self-edges, and duplicate pairs are dropped (first declaration wins).
export function buildCausalEdges(
  cfg: CausalCfg,
  nodes: Record<string, CausalNode>,
  resolve?: Resolver
): CausalEdge[] {
  const edgesField = cfg.edgesField || "affects";
  const byBasename: Record<string, string> = {};
  const byPath: Record<string, string> = {};
  Object.values(nodes).forEach((n) => {
    byBasename[n.basename] = n.id;
    byPath[n.path] = n.id;
  });
  const seen = new Set<string>();
  const out: CausalEdge[] = [];
  Object.values(nodes).forEach((n) => {
    asArray(getPath(n.fm, edgesField)).forEach((raw) => {
      if (typeof raw !== "object" || raw === null) return;
      const entry = raw as Record<string, unknown>;
      const key = linkKey(entry["to"]);
      if (!key) return;
      const target =
        nodes[key]?.id ??
        byBasename[key] ??
        (resolve ? byPath[resolve(key, n.path) ?? ""] : undefined);
      if (!target || target === n.id) return;
      const k = edgeKey(n.id, target);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({
        from: n.id,
        to: target,
        sign: scalarStr(entry["sign"]) === "-" ? "-" : "+",
        tags: asArray(entry["loops"]).map(scalarStr).filter(Boolean),
      });
    });
  });
  return out;
}

// ---- cycle detection -----------------------------------------------------------

export interface CycleOpts {
  maxCycles?: number;
  maxLen?: number;
  maxSteps?: number;
}

// Every simple directed cycle, each reported once, rotated to start at its
// lowest-sorted node (starts are visited in sort order and a walk never enters a
// node that sorts below its start, so each cycle is found exactly once).
// Bounded (maxCycles / maxLen / maxSteps) so a dense graph degrades to "the
// first N loops" instead of hanging the render. Deterministic: adjacency sorted.
export function findCycles(
  nodes: Record<string, CausalNode>,
  edges: CausalEdge[],
  opts?: CycleOpts
): string[][] {
  const maxCycles = opts?.maxCycles ?? 64;
  const maxLen = opts?.maxLen ?? 12;
  let steps = opts?.maxSteps ?? 200000;
  const ids = Object.keys(nodes).sort();
  const idx = new Map(ids.map((id, i) => [id, i]));
  const adj = new Map<string, string[]>(ids.map((id) => [id, []]));
  edges.forEach((edge) => adj.get(edge.from)!.push(edge.to));
  ids.forEach((id) => adj.get(id)!.sort());

  const cycles: string[][] = [];
  for (const start of ids) {
    if (cycles.length >= maxCycles) break;
    const startIdx = idx.get(start)!;
    const stack: string[] = [];
    const onStack = new Set<string>();
    const dfs = (v: string): void => {
      stack.push(v);
      onStack.add(v);
      for (const w of adj.get(v)!) {
        if (cycles.length >= maxCycles || --steps < 0) break;
        if (idx.get(w)! < startIdx) continue; // that cycle belongs to a lower start
        if (w === start) {
          if (stack.length >= 2) cycles.push([...stack]); // length 1 = self-loop, skipped
          continue;
        }
        if (onStack.has(w) || stack.length >= maxLen) continue;
        dfs(w);
      }
      stack.pop();
      onStack.delete(v);
    };
    dfs(start);
  }
  return cycles;
}

// ---- loops (naming + polarity) ---------------------------------------------------

// A cycle whose edges all share a declared tag takes that tag as its name
// (alphabetical tie-break); the rest get auto names L1, L2, … Polarity is the
// sign product: an even number of "-" edges reinforces, odd balances.
export function buildLoops(
  cycles: string[][],
  edges: CausalEdge[],
  cards: Record<string, LoopCard> = {}
): CausalLoop[] {
  const byKey = new Map(
    edges.map((edge) => [edgeKey(edge.from, edge.to), edge])
  );
  const declaredNames = new Set<string>();
  let auto = 0;
  const drafts = cycles.map((cyc) => {
    const keys = cyc.map((id, i) => edgeKey(id, cyc[(i + 1) % cyc.length]));
    const cycEdges = keys.map((k) => byKey.get(k)!);
    const minus = cycEdges.filter((edge) => edge.sign === "-").length;
    const shared = cycEdges[0].tags
      .filter((t) => cycEdges.every((edge) => edge.tags.includes(t)))
      .sort();
    const name = shared.find((t) => !declaredNames.has(t)) ?? "";
    const declared = name !== "";
    const kind: CausalLoop["kind"] = minus % 2 ? "balancing" : "reinforcing";
    if (declared) declaredNames.add(name);
    return {
      name,
      declared,
      kind,
      nodes: cyc,
      edges: keys,
    };
  });
  const used = new Set(declaredNames);
  const loops: CausalLoop[] = drafts.map((draft) => {
    let { name } = draft;
    if (!draft.declared) {
      while (!name || used.has(name)) name = "L" + ++auto;
      used.add(name);
    }
    return {
      ...draft,
      name,
      label: draft.declared ? cards[name]?.label : undefined,
    };
  });
  // declared loops lead the rail alphabetically; auto-detected follow in discovery order
  return loops.sort(
    (a, b) =>
      Number(b.declared) - Number(a.declared) ||
      (a.declared ? a.name.localeCompare(b.name) : 0)
  );
}

// loop cards (loops/<id>.md) supply display labels for declared tags
export function collectLoopCards(
  cfg: CausalCfg,
  notes: NoteLike[]
): Record<string, LoopCard> {
  const folders = cfg.loopFolders || [];
  const cards: Record<string, LoopCard> = {};
  notes.forEach((nt) => {
    if (!folders.some((f) => inFolder(nt.path, f))) return;
    const id = scalarStr(nt.frontmatter["id"]) || nt.basename;
    cards[id] = {
      label: scalarStr(nt.frontmatter["label"]) || undefined,
      path: nt.path,
    };
  });
  return cards;
}

// ---- layout ------------------------------------------------------------------------

export const CAUSAL_MARGIN = 24;

// Deterministic force-directed layout: a circle seed in collection order, a
// Fruchterman–Reingold pass (repulsion k²/d, attraction d²/k, linear cooling),
// then overlap-relax sweeps. No randomness anywhere: same input, same picture.
// Mutates x/y/w/h on each node; returns the content extents for fit().
export function layoutCausal(
  nodes: Record<string, CausalNode>,
  edges: CausalEdge[],
  layoutCfg?: CausalLayoutCfg
): { contentRight: number; contentBottom: number } {
  const { nodeW, spacing, iterations } = resolveCausalLayout(layoutCfg);
  const ids = Object.keys(nodes);
  if (!ids.length) return { contentRight: 0, contentBottom: 0 };

  // size each box from its wrapped label (3 lines max; the adapter ellipsises)
  ids.forEach((id) => {
    const n = nodes[id];
    n.w = nodeW;
    n.h = Math.max(46, 24 + wrap(n.label, nodeW - 28, 11.5, 3).length * 16);
  });

  // circle seed, radius sized so neighbours start ~spacing apart
  const R = Math.max(spacing, (ids.length * spacing) / (2 * Math.PI));
  const px: number[] = [];
  const py: number[] = [];
  ids.forEach((_, i) => {
    const a = (2 * Math.PI * i) / ids.length;
    px.push(R * Math.cos(a));
    py.push(R * Math.sin(a));
  });
  const idx = new Map(ids.map((id, i) => [id, i]));

  const k = spacing;
  for (let it = 0; it < iterations; it++) {
    const dx = new Array<number>(ids.length).fill(0);
    const dy = new Array<number>(ids.length).fill(0);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const ddx = px[i] - px[j];
        const ddy = py[i] - py[j];
        const d = Math.max(Math.hypot(ddx, ddy), 1);
        const f = (k * k) / (d * d); // unit direction folded into ddx/d
        dx[i] += ddx * f;
        dy[i] += ddy * f;
        dx[j] -= ddx * f;
        dy[j] -= ddy * f;
      }
    edges.forEach((edge) => {
      const i = idx.get(edge.from)!;
      const j = idx.get(edge.to)!;
      const ddx = px[i] - px[j];
      const ddy = py[i] - py[j];
      const d = Math.max(Math.hypot(ddx, ddy), 1);
      const f = d / k;
      dx[i] -= ddx * f;
      dy[i] -= ddy * f;
      dx[j] += ddx * f;
      dy[j] += ddy * f;
    });
    const temp = k * 0.5 * (1 - it / iterations) + 1; // per-step displacement cap
    for (let i = 0; i < ids.length; i++) {
      const m = Math.hypot(dx[i], dy[i]);
      const c = Math.min(m, temp) / Math.max(m, 1e-9);
      px[i] += dx[i] * c;
      py[i] += dy[i] * c;
    }
  }

  relaxOverlaps(
    ids.map((id) => nodes[id].w!),
    ids.map((id) => nodes[id].h!),
    px,
    py,
    18
  );

  // normalise into positive space with a margin; report extents
  let minX = Infinity;
  let minY = Infinity;
  ids.forEach((id, i) => {
    const n = nodes[id];
    minX = Math.min(minX, px[i] - n.w! / 2);
    minY = Math.min(minY, py[i] - n.h! / 2);
  });
  let maxX = 0;
  let maxY = 0;
  ids.forEach((id, i) => {
    const n = nodes[id];
    n.x = px[i] - n.w! / 2 - minX + CAUSAL_MARGIN;
    n.y = py[i] - n.h! / 2 - minY + CAUSAL_MARGIN;
    maxX = Math.max(maxX, n.x + n.w!);
    maxY = Math.max(maxY, n.y + n.h!);
  });
  return { contentRight: maxX, contentBottom: maxY };
}

// Relax residual box overlaps: push each colliding pair of (center-anchored)
// boxes apart along the axis needing the smaller shove, in deterministic
// sweeps until stable. Mutates px/py in place.
export function relaxOverlaps(
  ws: number[],
  hs: number[],
  px: number[],
  py: number[],
  pad: number
): void {
  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (let i = 0; i < ws.length; i++)
      for (let j = i + 1; j < ws.length; j++) {
        const ox = (ws[i] + ws[j]) / 2 + pad - Math.abs(px[i] - px[j]);
        const oy = (hs[i] + hs[j]) / 2 + pad - Math.abs(py[i] - py[j]);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) {
          const s = ((px[i] < px[j] ? -1 : 1) * ox) / 2;
          px[i] += s;
          px[j] -= s;
        } else {
          const s = ((py[i] < py[j] ? -1 : 1) * oy) / 2;
          py[i] += s;
          py[j] -= s;
        }
      }
    if (!moved) break;
  }
}

// ---- search + export -------------------------------------------------------------

// case-insensitive match on label + id; empty term matches everything
export const causalSearchMatch = (n: CausalNode, term: string): boolean =>
  (n.label + " " + n.id).toLowerCase().includes(term.toLowerCase());

// HTML export destination: sibling of the note, ".md" -> " causal map.html"
// (distinct from mindmapExportPath so both exports can live next to one note)
export const causalExportPath = (notePath: string): string =>
  notePath.replace(/\.md$/i, "") + " causal map.html";
