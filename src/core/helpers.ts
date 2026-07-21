// Field access, string, and card-metric helpers shared across the core.

import { AUTO_COLORS, CATEGORY_COLORS, MNode, BarCfg } from "./config";

export const inFolder = (path: string, folder: string): boolean => {
  const f = folder.replace(/^\/+|\/+$/g, "");
  return f === "" ? true : path.startsWith(`${f}/`);
};

// stringify a scalar frontmatter value; null/objects/arrays -> "" (links, categories
// and filter targets are always YAML scalars). Keeps String() off bare `unknown`,
// which would otherwise risk an "[object Object]" stringification.
export const scalarStr = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean"
    ? String(v)
    : "";

// "[[Note|alias]]" / "[[Note#hd]]" / "Title" -> the lookup key (Note / Title)
export const linkKey = (raw: unknown): string => {
  const s = scalarStr(raw).trim();
  const m = s.match(/\[\[([^\]|#]+)/);
  return (m ? m[1] : s).trim();
};

export const asArray = (v: unknown): unknown[] =>
  Array.isArray(v) ? (v as unknown[]) : v == null || v === "" ? [] : [v];

export const wrap = (
  s: string,
  width: number,
  size: number,
  max: number
): string[] => {
  const cpl = Math.max(8, Math.floor(width / (size * 0.55)));
  const words = String(s).split(/\s+/),
    out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > cpl) {
      out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out.slice(0, max);
};

// card height that hugs its content. Mirrors the vertical metrics the renderer
// draws with (pad 14/14, title 16, sub 15, meta 14, bar 20, label strip 24) —
// see CARD_METRICS, the single copy both this function and src/render use.
// cardHeight config acts as a minimum floor.
export const MIN_H = 44;

// Card drawing metrics, one copy. cardContentHeight sizes cards from these and
// the renderer places text/bars/labels with them, so retuning here retunes both.
export const CARD_METRICS = {
  padTop: 14,
  padBottom: 14,
  padLeft: 14,
  padRight: 16, // right text padding on a childless card
  padRightToggle: 42, // right text padding reserving the collapse toggle
  titleSize: 12,
  titleLine: 16,
  subSize: 10.5,
  subLine: 15,
  metaSize: 9.5,
  metaLine: 14,
  barStrip: 20, // progress / category bar row height
  labelStrip: 24, // label-pill row height
} as const;

// sub line sits below the collapse toggle, so it gets the full text width (only the
// left/right text padding reserved), unlike the title which reserves padR for the toggle.
export const subWidth = (cardW: number) =>
  cardW - CARD_METRICS.padLeft - CARD_METRICS.padRight;
export const cardContentHeight = (
  n: MNode,
  cardW: number,
  titleLines: number,
  subLines: number
): number => {
  const M = CARD_METRICS;
  const padR = n.children.size > 0 ? M.padRightToggle : M.padRight;
  const tLines =
    wrap(n.title, cardW - M.padLeft - padR, M.titleSize, titleLines).length ||
    1;
  const sLines = n.sub
    ? wrap(n.sub, subWidth(cardW), M.subSize, subLines).length || 1
    : 0;
  const hasBar = n.progress != null || n.bars.length > 0;
  return (
    M.padTop +
    tLines * M.titleLine +
    sLines * M.subLine +
    (n.meta ? M.metaLine : 0) +
    (hasBar ? M.barStrip : 0) +
    (n.labels.length ? M.labelStrip : 0) +
    M.padBottom
  );
};

// dotted access so `via`/card fields can reach nested frontmatter (e.g. customFields.serves)
export const getPath = (fm: Record<string, unknown>, key?: string): unknown => {
  if (!fm || !key) return undefined;
  if (key.indexOf(".") < 0) return fm[key];
  return key
    .split(".")
    .reduce<unknown>(
      (o, k) => (o == null ? o : (o as Record<string, unknown>)[k]),
      fm
    );
};

export const fieldStr = (fm: Record<string, unknown>, key?: string): string =>
  key ? asArray(getPath(fm, key)).map(linkKey).join(", ") : "";

export const fieldArr = (
  fm: Record<string, unknown>,
  key?: string
): string[] =>
  key ? asArray(getPath(fm, key)).map(linkKey).filter(Boolean) : [];

// per-level include filter, e.g. { parentId: null } keeps only top-level roadmap tasks.
// a `null` target matches null, missing, OR empty (stringifies to "") — the strategy map relies on this.
export const matchesWhere = (
  fm: Record<string, unknown>,
  where?: Record<string, unknown>
): boolean =>
  !where ||
  Object.keys(where).every((k) =>
    where[k] === null
      ? fieldStr(fm, k) === ""
      : fieldStr(fm, k) === scalarStr(where[k])
  );

// list field -> [category, count]. mode "parens" (default): category = text in
// trailing parens, else the value. mode "value": category = the whole value.
export const countByCat = (
  fm: Record<string, unknown>,
  key?: string,
  mode: "parens" | "value" = "parens"
): [string, number][] => {
  if (!key) return [];
  const counts: Record<string, number> = {};
  asArray(getPath(fm, key)).forEach((raw) => {
    const s = scalarStr(raw).trim();
    if (!s) return;
    const m = mode === "value" ? null : s.match(/\(([^)]+)\)\s*$/);
    const cat = (m ? m[1] : s).trim().toLowerCase();
    counts[cat] = (counts[cat] || 0) + 1;
  });
  return Object.entries(counts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
  );
};

// card.bars may be a field-name string (legacy) or a BarCfg object; null when absent/invalid
export const normalizeBars = (bars?: string | BarCfg): BarCfg | null =>
  !bars
    ? null
    : typeof bars === "string"
      ? { field: bars }
      : bars.field
        ? bars
        : null;

export const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

// colour for a bar category: configured `colors` map (defaults to CATEGORY_COLORS), else cycle AUTO_COLORS
export const catColor = (
  cat: string,
  i: number,
  colors: Record<string, string> = CATEGORY_COLORS
): string => colors[cat] || AUTO_COLORS[i % AUTO_COLORS.length];

// children this node is the solid (primary) parent of — used by layout + collapse
export const primKids = (nodes: Record<string, MNode>, id: string): string[] =>
  [...nodes[id].children].filter((c) => nodes[c].primaryParent === id);
