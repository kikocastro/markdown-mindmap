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
  if (cfg.filterKeepsHierarchy)
    return hierarchyVisible(nodes, collapsed, filters, cfg);
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

// hierarchy-aware filtering: a node is kept when it passes the filters, when a
// primary ancestor positively matches (subtasks ride along), or when a primary
// descendant positively matches (ancestors stay as context). "Positive" means
// the node actually HAS the selected property with a selected value — a node
// merely lacking the property is unconstrained but never anchors context.
// Collapse still hides the subtree under a contracted node.
function hierarchyVisible(
  nodes: Record<string, MNode>,
  collapsed: Set<string>,
  filters: Record<string, Set<string>>,
  cfg: MapCfg
): Set<string> {
  const positivelyMatches = (n: MNode): boolean =>
    (cfg.filter || []).every((p) => {
      const sel = filters[p];
      if (!sel || !sel.size) return true;
      return fieldArr(n.fm, p).some((v) => sel.has(v));
    });

  const kept = new Set<string>();
  const anchors: string[] = [];
  Object.values(nodes).forEach((n) => {
    if (passesFilters(n, filters, cfg)) kept.add(n.id);
    if (positivelyMatches(n)) anchors.push(n.id);
  });
  anchors.forEach((id) => {
    // upward: ancestors as context (cycle-guarded)
    const seen = new Set<string>();
    let cur = nodes[id].primaryParent;
    while (cur && nodes[cur] && !seen.has(cur)) {
      seen.add(cur);
      kept.add(cur);
      cur = nodes[cur].primaryParent;
    }
    // downward: the whole primary subtree rides along
    const stack = [...primKids(nodes, id)];
    while (stack.length) {
      const x = stack.pop()!;
      if (kept.has(x)) continue;
      kept.add(x);
      stack.push(...primKids(nodes, x));
    }
  });

  // collapse applies last: contracted nodes keep self, hide their subtree
  const hidden = new Set<string>();
  collapsed.forEach((rid) => {
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
  return new Set([...kept].filter((id) => !hidden.has(id)));
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
