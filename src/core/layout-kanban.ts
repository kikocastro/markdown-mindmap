// Kanban layout: group visible nodes into columns by a configurable frontmatter
// field, reuse the card content/height rules, stack with the existing row-gap.
// Pure: mutates x/y/w/h on the MNodes (like orderAndLayout) and returns column
// headers + per-column card order + content bounds.

import { AUTO_COLORS, MNode, MapCfg, resolveLayout } from "./config";
import { MIN_H, cardContentHeight, fieldStr } from "./helpers";

export const KANBAN = {
  left: 40,
  colGap: 24, // tighter than the map's edge-routing gap
} as const;

export interface KanbanHeader {
  x: number;
  label: string;
  color: string;
  count: number;
}
export interface KanbanLayout {
  headers: KanbanHeader[];
  columns: string[][]; // node ids per column, top -> bottom
  contentRight: number;
  contentBottom: number;
}

// `_nodes` is unused but kept so all three layouts share one call shape
export function layoutKanban(
  cfg: MapCfg,
  _nodes: Record<string, MNode>,
  byLevel: MNode[][],
  vis: Set<string>
): KanbanLayout {
  const k = cfg.kanban;
  if (!k || !k.groupBy)
    throw new Error("kanban view needs `kanban: { groupBy }`.");
  const { cardW, vGap, top, titleLines, subLines } = resolveLayout(cfg.layout);
  const floor = cfg.layout?.cardHeight ?? MIN_H;

  // visible nodes in data order (level order, then folder order within a level)
  const visible = byLevel.flatMap((arr) => arr.filter((n) => vis.has(n.id)));
  const valueOf = (n: MNode) => fieldStr(n.fm, k.groupBy);

  // column order: configured first, then unlisted values as seen in the data;
  // valueless nodes gather under a trailing "(none)" column
  const values: string[] = [...(k.columns ?? [])];
  let hasNone = false;
  visible.forEach((n) => {
    const v = valueOf(n);
    if (!v) hasNone = true;
    else if (!values.includes(v)) values.push(v);
  });
  if (hasNone) values.push("");

  const headers: KanbanHeader[] = [];
  const columns: string[][] = [];
  const cursors: number[] = [];
  values.forEach((v, i) => {
    const x = KANBAN.left + i * (cardW + KANBAN.colGap);
    const members = visible.filter((n) => valueOf(n) === v);
    let cursor = top;
    const col: string[] = [];
    members.forEach((n) => {
      n.w = cardW;
      n.h = Math.max(floor, cardContentHeight(n, cardW, titleLines, subLines));
      n.x = x;
      n.y = cursor;
      cursor = n.y + n.h + vGap;
      col.push(n.id);
    });
    headers.push({
      x,
      label: v || "(none)",
      color: k.colors?.[v] || AUTO_COLORS[i % AUTO_COLORS.length],
      count: members.length,
    });
    columns.push(col);
    cursors.push(cursor);
  });

  return {
    headers,
    columns,
    contentRight:
      KANBAN.left + values.length * (cardW + KANBAN.colGap) - KANBAN.colGap,
    contentBottom: Math.max(top, ...cursors),
  };
}
