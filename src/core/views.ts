// Saved views + search: pure list ops behind the views toolbar. The adapter owns
// the name prompt and writing `views:` back into the code block; here we just
// decide the next list.

import { MapCfg, MNode, SavedViewCfg } from "./config";

// "Save current as…": replace a same-named view in place, otherwise append.
export const upsertView = (
  views: SavedViewCfg[],
  view: SavedViewCfg
): SavedViewCfg[] => {
  const i = views.findIndex((v) => v.name === view.name);
  return i >= 0 ? views.map((v, j) => (j === i ? view : v)) : [...views, view];
};

// guard rename collisions: is `name` used by a view other than `exceptName`?
export const viewNameTaken = (
  views: SavedViewCfg[],
  name: string,
  exceptName?: string
): boolean => views.some((v) => v.name === name && v.name !== exceptName);

// The saved view to restore on (re)render, or null if activeView is unset or
// names a deleted view (stale guard). In-memory active state is gone after an
// Obsidian reload, so this is what keeps the picked view selected.
export const initialView = (cfg: MapCfg): SavedViewCfg | null =>
  (cfg.activeView && cfg.views?.find((v) => v.name === cfg.activeView)) || null;

// case-insensitive match across title + sub + meta; empty term matches everything
export const searchMatch = (n: MNode, term: string): boolean =>
  (n.title + " " + n.sub + " " + n.meta)
    .toLowerCase()
    .includes(term.toLowerCase());
