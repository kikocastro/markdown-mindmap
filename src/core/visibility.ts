// Visibility: filters, collapse, focus, siblings, and filter options.

import { MapCfg, MNode } from "./config";
import { fieldArr, primKids } from "./helpers";

// a filter only constrains nodes that HAVE the property; multi-select is OR within a property, AND across
export const passesFilters = (
  n: MNode,
  filters: Record<string, Set<string>>,
  cfg: MapCfg
): boolean =>
  (cfg.filter || []).every((p) => {
    const sel = filters[p];
    if (!sel || !sel.size) return true;
    const own = fieldArr(n.fm, p);
    if (!own.length) return true;
    return own.some((v) => sel.has(v));
  });

// collapsed nodes hide their primary subtree (keep self); filtered-out nodes hide self + primary subtree
export function computeVisible(
  nodes: Record<string, MNode>,
  collapsed: Set<string>,
  filters: Record<string, Set<string>>,
  cfg: MapCfg
): Set<string> {
  const excluded = new Set<string>();
  Object.values(nodes).forEach((n) => {
    if (!passesFilters(n, filters, cfg)) excluded.add(n.id);
  });
  const hidden = new Set<string>(excluded);
  [...collapsed, ...excluded].forEach((rid) => {
    if (!nodes[rid]) return;
    const stack = [...primKids(nodes, rid)];
    while (stack.length) {
      const x = stack.pop()!;
      if (!hidden.has(x)) {
        hidden.add(x);
        stack.push(...primKids(nodes, x));
      }
    }
  });
  const vis = new Set<string>();
  Object.values(nodes).forEach((n) => {
    if (!hidden.has(n.id)) vis.add(n.id);
  });
  return vis;
}

// Focus is a pure tree filter over primary layout links. Null, empty, or stale
// ids mean no focus, so callers can clear stale UI state without hiding the map.
export function focusVisible(
  nodes: Record<string, MNode>,
  id: string | null | undefined
): Set<string> {
  const all = new Set(Object.keys(nodes));
  if (!id || !nodes[id]) return all;

  const vis = new Set<string>();
  const seenAncestors = new Set<string>();
  let current: string | null = id;
  while (current && nodes[current] && !seenAncestors.has(current)) {
    vis.add(current);
    seenAncestors.add(current);
    current = nodes[current].primaryParent;
  }

  const stack = [...primKids(nodes, id)];
  while (stack.length) {
    const child = stack.pop()!;
    if (!nodes[child] || vis.has(child)) continue;
    vis.add(child);
    stack.push(...primKids(nodes, child));
  }

  return vis;
}

// nodes that share at least one parent with `id` (primary or secondary), excluding itself,
// ordered by level then layout/collection order so the dialog lists them predictably.
export function siblings(nodes: Record<string, MNode>, id: string): string[] {
  const self = nodes[id];
  if (!self) return [];
  const out = new Set<string>();
  self.parents.forEach((p) =>
    nodes[p]?.children.forEach((c) => {
      if (c !== id && nodes[c]) out.add(c);
    })
  );
  return [...out].sort(
    (a, b) =>
      nodes[a].levelIdx - nodes[b].levelIdx ||
      nodes[a].collIdx - nodes[b].collIdx ||
      a.localeCompare(b)
  );
}

export function filterOptions(
  nodes: Record<string, MNode>,
  cfg: MapCfg
): Record<string, string[]> {
  const all = Object.values(nodes);
  const options: Record<string, string[]> = {};
  (cfg.filter || []).forEach((prop) => {
    const seen = new Set<string>();
    all.forEach((n) => fieldArr(n.fm, prop).forEach((v) => seen.add(v)));
    options[prop] = [...seen].sort((a, b) => a.localeCompare(b));
  });
  return options;
}
