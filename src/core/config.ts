// Config types + palette + layout defaults for the mindmap core. Pure data,
// host-free: no obsidian/vscode/DOM imports anywhere under src/core/.

// flatuicolors.com/palette/defo — the original Flat UI palette
export const AUTO_COLORS = [
  "#1abc9c",
  "#3498db",
  "#9b59b6",
  "#e67e22",
  "#e74c3c",
  "#f1c40f",
  "#16a085",
  "#2980b9",
  "#8e44ad",
  "#d35400",
];
// bar-chart category -> colour, with a sensible default for client/prospect/trial
export const CATEGORY_COLORS: Record<string, string> = {
  client: "#2ecc71",
  prospect: "#f39c12",
  trial: "#3498db",
  customer: "#2ecc71",
  prospect_: "#f39c12",
};

// layout defaults (each overridable per-map via cfg.layout)
export const CARD_W = 270,
  NODE_H = 80,
  V_GAP = 12,
  COL_GAP = 150,
  TOP = 64;

// per-map layout overrides (YAML `layout:`); omitted keys fall back to the defaults above
export interface LayoutCfg {
  cardWidth?: number;
  cardHeight?: number;
  columnGap?: number;
  rowGap?: number;
  top?: number;
  titleLines?: number;
  subLines?: number;
}
export interface ResolvedLayout {
  cardW: number;
  nodeH: number;
  colGap: number;
  vGap: number;
  top: number;
  titleLines: number;
  subLines: number;
}
export const resolveLayout = (l?: LayoutCfg): ResolvedLayout => ({
  cardW: l?.cardWidth ?? CARD_W,
  nodeH: l?.cardHeight ?? NODE_H,
  colGap: l?.columnGap ?? COL_GAP,
  vGap: l?.rowGap ?? V_GAP,
  top: l?.top ?? TOP,
  titleLines: l?.titleLines ?? 2, // node-title lines before truncating (set 3 for a taller card)
  subLines: l?.subLines ?? 1, // subtitle lines before truncating (set 2+ to wrap the sub)
});

// bar chart: a field-name string (legacy) or an object with category mode + colours
export interface BarCfg {
  field: string;
  category?: "parens" | "value";
  colors?: Record<string, string>;
}
export interface CardCfg {
  title?: string;
  sub?: string;
  meta?: string[];
  progress?: string;
  bars?: string | BarCfg;
  labels?: string[];
}
export interface LevelCfg {
  id: string;
  label?: string;
  from: string;
  color?: string;
  card?: CardCfg;
  where?: Record<string, unknown>;
}
export interface EdgeCfg {
  from: string;
  to: string;
  via: string;
  reverse?: boolean;
  secondary?: boolean;
}
// how the same collected + filtered tree is laid out and drawn
export type ViewMode = "map" | "gantt" | "kanban";

// gantt view: field names for the date range + bar fill, all configurable like
// every card field. Milestone = start == end, or one of the two missing.
export interface GanttCfg {
  start: string; // frontmatter field with the start date (ISO)
  end: string; // frontmatter field with the end/due date (ISO)
  progress?: string; // 0-100 field for the bar fill (defaults to card progress)
  scale?: "week" | "month" | "quarter"; // axis tick unit (default month)
  groupRows?: boolean; // default true: DFS tree order + indent; false: flat path order
}

// kanban view: group visible nodes into columns by a frontmatter field
export interface KanbanCfg {
  groupBy: string;
  columns?: string[]; // explicit column order (unlisted values append in data order)
  colors?: Record<string, string>; // column value -> header colour
}

export interface SavedViewCfg {
  name: string;
  filters?: Record<string, string[]>;
  collapsed?: string[]; // node ids (paths) whose primary subtree is contracted
  view?: ViewMode; // a saved view pins filters + view mode ("devops · gantt")
}
export interface MapCfg {
  title?: string;
  height?: number;
  view?: ViewMode; // default "map" (backward compatible)
  levels: LevelCfg[];
  edges?: EdgeCfg[];
  filter?: string[];
  filterLabels?: Record<string, string>; // property -> display name for its filter group
  layout?: LayoutCfg;
  gantt?: GanttCfg;
  kanban?: KanbanCfg;
  properties?: boolean;
  views?: SavedViewCfg[];
  activeView?: string; // name of the saved view to auto-select on (re)render
}

// the minimal note shape the pure logic needs (a TFile-free stand-in)
export interface NoteLike {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown>;
}
// wikilink key + the path it was found in -> resolved note path, or null
export interface Resolver {
  (key: string, fromPath: string): string | null;
}

export interface MNode {
  id: string; // file path (unique key)
  levelIdx: number;
  path: string;
  basename: string;
  fm: Record<string, unknown>;
  title: string;
  sub: string;
  meta: string;
  labels: string[]; // small pill values rendered on the card (card.labels)
  labelColors: string[]; // stable color per configured label field index
  color: string;
  levelLabel: string;
  progress: number | null; // 0-100, or null
  bars: [string, number, string][]; // category -> count -> resolved colour
  collIdx: number; // order within its source folder (layout tiebreak)
  parents: Set<string>;
  children: Set<string>;
  primaryParent: string | null; // the one solid parent (secondary links don't set this)
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

// throws the documented error when the map has no levels (the code-block processor catches it)
export function validateConfig(
  cfg: MapCfg | null | undefined
): asserts cfg is MapCfg {
  if (!cfg || !Array.isArray(cfg.levels) || !cfg.levels.length)
    throw new Error("config needs a non-empty `levels:` list.");
}
