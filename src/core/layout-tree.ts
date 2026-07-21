// Tree layout: DFS ordering by primary parent + right->left vertical placement.

import { MapCfg, MNode, resolveLayout } from "./config";
import { MIN_H, cardContentHeight, primKids } from "./helpers";

// DFS by primary parent so siblings stay contiguous — the one "tree reading
// order" shared by the map layout and the gantt rows. Pre-order across levels;
// visible nodes never reached from a root (parent filtered/collapsed/
// secondary-only) are appended afterwards, level by level.
export function treeSequence(
  cfg: MapCfg,
  nodes: Record<string, MNode>,
  byLevel: MNode[][],
  vis: Set<string>
): string[] {
  const visN = (id: string) => vis.has(id);
  const seq: string[] = [];
  const seen = new Set<string>();
  const childrenSorted = (n: MNode) =>
    primKids(nodes, n.id)
      .filter(visN)
      .map((id) => nodes[id])
      .sort((a, b) => a.collIdx - b.collIdx);
  const dfs = (n: MNode) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    seq.push(n.id);
    childrenSorted(n).forEach(dfs);
  };
  byLevel[0].filter((n) => visN(n.id)).forEach(dfs);
  cfg.levels.forEach((_, li) =>
    byLevel[li].forEach((n) => {
      if (visN(n.id) && !seen.has(n.id)) {
        seen.add(n.id);
        seq.push(n.id);
      }
    })
  );
  return seq;
}

// the same sequence bucketed per level (what the column layout consumes)
export function treeOrder(
  cfg: MapCfg,
  nodes: Record<string, MNode>,
  byLevel: MNode[][],
  vis: Set<string>
): string[][] {
  const order: string[][] = cfg.levels.map(() => []);
  treeSequence(cfg, nodes, byLevel, vis).forEach((id) =>
    order[nodes[id].levelIdx].push(id)
  );
  return order;
}

// DFS by primary parent so siblings stay contiguous, then place right->left so a
// parent centres on its visible primary children. Mutates x/y/w/h on each node.
export function orderAndLayout(
  cfg: MapCfg,
  nodes: Record<string, MNode>,
  byLevel: MNode[][],
  vis: Set<string>
): {
  order: string[][];
  levelX: number[];
  contentBottom: number;
  contentRight: number;
} {
  const visN = (id: string) => vis.has(id);
  const {
    cardW,
    colGap,
    vGap,
    top: TOP,
    titleLines,
    subLines,
  } = resolveLayout(cfg.layout);
  const floor = cfg.layout?.cardHeight ?? MIN_H;
  const levelX = cfg.levels.map((_, i) => 40 + i * (cardW + colGap));

  const order = treeOrder(cfg, nodes, byLevel, vis);

  const cursor = cfg.levels.map(() => TOP);
  for (let li = cfg.levels.length - 1; li >= 0; li--) {
    for (const id of order[li]) {
      const n = nodes[id];
      const kids = primKids(nodes, id)
        .filter((c) => visN(c) && nodes[c].levelIdx === li + 1)
        .map((c) => nodes[c]);
      n.w = cardW;
      n.h = Math.max(floor, cardContentHeight(n, cardW, titleLines, subLines));
      n.x = levelX[li];
      if (kids.length) {
        const top = Math.min(...kids.map((k) => k.y!)),
          bot = Math.max(...kids.map((k) => k.y! + k.h!));
        n.y = Math.max(cursor[li], (top + bot) / 2 - n.h / 2);
      } else n.y = cursor[li];
      cursor[li] = n.y + n.h + vGap;
    }
  }
  const contentBottom = Math.max(TOP, ...cfg.levels.map((_, li) => cursor[li]));
  const contentRight = levelX[cfg.levels.length - 1] + cardW;
  return { order, levelX, contentBottom, contentRight };
}
