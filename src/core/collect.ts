// Node collection: folders -> levels, frontmatter -> card fields.

import { AUTO_COLORS, MapCfg, MNode, NoteLike } from "./config";
import {
  catColor,
  countByCat,
  fieldStr,
  getPath,
  inFolder,
  matchesWhere,
  normalizeBars,
  num,
} from "./helpers";

// Folders -> columns. A note lands in its FIRST matching level only; `where`
// filters per level; card fields are extracted into the MNode.
export function collectNodes(
  cfg: MapCfg,
  notes: NoteLike[]
): { nodes: Record<string, MNode>; byLevel: MNode[][] } {
  const nodes: Record<string, MNode> = {};
  const byLevel: MNode[][] = cfg.levels.map(() => []);
  cfg.levels.forEach((lvl, li) => {
    const color = lvl.color || AUTO_COLORS[li % AUTO_COLORS.length];
    const files = notes
      .filter((f) => inFolder(f.path, lvl.from))
      .sort((a, b) => a.path.localeCompare(b.path));
    files.forEach((file, ci) => {
      if (nodes[file.path]) return; // a note appears in its first matching level only
      const fm = file.frontmatter || {};
      if (!matchesWhere(fm, lvl.where)) return; // per-level frontmatter filter (e.g. {parentId: null})
      const card = lvl.card || {};
      const bar = normalizeBars(card.bars);
      const labelEntries = (card.labels || [])
        .map((k, i) => ({
          text: fieldStr(fm, k),
          color: AUTO_COLORS[i % AUTO_COLORS.length],
        }))
        .filter((l) => l.text);
      const n: MNode = {
        id: file.path,
        levelIdx: li,
        path: file.path,
        basename: file.basename,
        fm,
        color,
        collIdx: ci,
        levelLabel: lvl.label || lvl.id,
        title: fieldStr(fm, card.title) || file.basename,
        sub: fieldStr(fm, card.sub),
        meta: (card.meta || [])
          .map((k) => fieldStr(fm, k))
          .filter(Boolean)
          .join("  ·  "),
        labels: labelEntries.map((l) => l.text),
        labelColors: labelEntries.map((l) => l.color),
        progress: num(getPath(fm, card.progress)),
        bars: bar
          ? countByCat(fm, bar.field, bar.category).map(
              ([cat, c], i): [string, number, string] => [
                cat,
                c,
                catColor(cat, i, bar.colors),
              ]
            )
          : [],
        parents: new Set(),
        children: new Set(),
        primaryParent: null,
      };
      nodes[file.path] = n;
      byLevel[li].push(n);
    });
  });
  return { nodes, byLevel };
}
