// Edge building: walk cfg.edges, resolve `via` links, record parent/child links.

import { MapCfg, MNode, Resolver } from "./config";
import { asArray, getPath, linkKey, scalarStr } from "./helpers";

// Walk cfg.edges, resolve each `via` value to a node in the parent level, and
// record parent/child links. Returns edgeKind: "primary" (solid) vs "secondary"
// (dashed). A node's primaryParent is its FIRST non-secondary parent.
export function buildEdges(
  cfg: MapCfg,
  nodes: Record<string, MNode>,
  byLevel: MNode[][],
  resolveLink?: Resolver
): Map<string, string> {
  // index each level by basename, `title`, and `id` frontmatter for link
  // resolution (`id` makes pm-style parentId -> id hierarchies resolve)
  const levelIndex = byLevel.map((arr) => {
    const byBase: Record<string, string> = {},
      byTitle: Record<string, string> = {},
      byId: Record<string, string> = {};
    arr.forEach((n) => {
      byBase[n.basename] = n.id;
      const t = scalarStr(n.fm.title).trim();
      if (t) byTitle[t] = n.id;
      const i = scalarStr(n.fm.id).trim();
      if (i) byId[i] = n.id;
    });
    return { byBase, byTitle, byId };
  });
  const levelByIdNum: Record<string, number> = {};
  cfg.levels.forEach((l, i) => (levelByIdNum[l.id] = i));

  const edgeKind = new Map<string, string>();
  const link = (parentId: string, childId: string, secondary?: boolean) => {
    if (!nodes[parentId] || !nodes[childId] || parentId === childId) return;
    nodes[parentId].children.add(childId);
    nodes[childId].parents.add(parentId);
    const key = parentId + "|" + childId;
    if (!secondary) {
      edgeKind.set(key, "primary");
      if (!nodes[childId].primaryParent)
        nodes[childId].primaryParent = parentId;
    } else if (!edgeKind.has(key)) {
      edgeKind.set(key, "secondary");
    }
  };
  // resolution order: injected link resolver (e.g. Obsidian wikilink) -> basename -> `title`
  const resolveInLevel = (
    li: number,
    raw: unknown,
    sourcePath: string
  ): string | null => {
    const key = linkKey(raw);
    const dest = resolveLink ? resolveLink(key, sourcePath) : null;
    if (dest && nodes[dest] && nodes[dest].levelIdx === li) return dest;
    return (
      levelIndex[li].byBase[key] ||
      levelIndex[li].byTitle[key] ||
      levelIndex[li].byId[key] ||
      null
    );
  };
  (cfg.edges || []).forEach((e) => {
    const fi = levelByIdNum[e.from],
      ti = levelByIdNum[e.to];
    if (fi == null || ti == null) return;
    if (!e.reverse) {
      // `via` is a property on the `to` notes pointing up to a `from` note
      byLevel[ti].forEach((to) =>
        asArray(getPath(to.fm, e.via)).forEach((raw) => {
          const fromId = resolveInLevel(fi, raw, to.path);
          if (fromId) link(fromId, to.id, e.secondary);
        })
      );
    } else {
      // `via` is a property on the `from` notes pointing down to `to` notes
      byLevel[fi].forEach((from) =>
        asArray(getPath(from.fm, e.via)).forEach((raw) => {
          const toId = resolveInLevel(ti, raw, from.path);
          if (toId) link(from.id, toId, e.secondary);
        })
      );
    }
  });
  return edgeKind;
}

export const isSecondary = (
  edgeKind: Map<string, string>,
  p: string,
  c: string
): boolean => edgeKind.get(p + "|" + c) === "secondary";
