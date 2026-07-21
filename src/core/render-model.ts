// RenderModel: the core-owned, host-free view model. Everything drawable,
// pre-positioned, JSON-serializable. The VS Code extension ships it to the
// webview verbatim; the Obsidian adapter draws it in place. No DOM here — the
// renderer (src/render) is the only code that turns this into SVG.

import {
  MNode,
  MapCfg,
  NoteLike,
  Resolver,
  ViewMode,
  resolveLayout,
  validateConfig,
} from "./config";
import { collectNodes } from "./collect";
import { buildEdges, isSecondary } from "./edges";
import { computeVisible, focusVisible } from "./visibility";
import { orderAndLayout } from "./layout-tree";
import { GanttModel, layoutGantt } from "./layout-gantt";
import { layoutKanban } from "./layout-kanban";

// transient UI state the adapters own (chips, collapse clicks, focus, density)
export interface UiState {
  collapsed?: string[];
  filters?: Record<string, string[]>;
  focused?: string | null;
  titleOnly?: boolean;
  view?: ViewMode; // toolbar override of cfg.view
}

export interface RNode {
  id: string; // note path; sent back on click so the host can open it
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  title: string;
  sub: string;
  meta: string;
  labels: string[];
  labelColors: string[];
  progress: number | null;
  bars: [string, number, string][];
  hasKids: boolean; // has children at all (drives the toggle + title padding)
  collapsed: boolean;
}

export interface REdge {
  a: string; // parent id (adapters use a/b for hover-lineage highlighting)
  b: string; // child id
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  secondary: boolean;
}

export interface RHeader {
  x: number;
  label: string;
  color?: string; // kanban column colour
  count?: number; // kanban column card count
}

export interface RenderModel {
  view: ViewMode;
  title: string;
  titleLines: number;
  subLines: number;
  titleOnly: boolean;
  nodes: RNode[]; // map + kanban cards
  edges: REdge[]; // map only
  headers: RHeader[]; // map column heads / kanban column heads
  gantt?: GanttModel; // gantt only
  contentRight: number;
  contentBottom: number;
}

// The one pipeline both adapters run: collect -> edges -> visibility -> layout,
// then flatten the mutated MNodes into plain drawable records.
export function buildRenderModel(
  cfg: MapCfg,
  notes: NoteLike[],
  resolveLink?: Resolver,
  ui: UiState = {}
): RenderModel {
  validateConfig(cfg);
  const { nodes, byLevel } = collectNodes(cfg, notes);
  const edgeKind = buildEdges(cfg, nodes, byLevel, resolveLink);
  return modelFromGraph(cfg, nodes, byLevel, edgeKind, ui);
}

// Same flattening for a caller that already collected the graph (the Obsidian
// adapter redraws many times per render and keeps its MNodes for the note dialog).
export function modelFromGraph(
  cfg: MapCfg,
  nodes: Record<string, MNode>,
  byLevel: MNode[][],
  edgeKind: Map<string, string>,
  ui: UiState = {}
): RenderModel {
  const collapsed = new Set(ui.collapsed ?? []);
  const filters: Record<string, Set<string>> = {};
  Object.entries(ui.filters ?? {}).forEach(
    ([prop, values]) => (filters[prop] = new Set(values))
  );
  const baseVis = computeVisible(nodes, collapsed, filters, cfg);
  let vis = baseVis;
  if (ui.focused) {
    const focusVis = focusVisible(nodes, ui.focused);
    vis = new Set([...baseVis].filter((id) => focusVis.has(id)));
  }

  const { titleLines, subLines } = resolveLayout(cfg.layout);
  const view: ViewMode = ui.view ?? cfg.view ?? "map";
  const base = {
    view,
    title: cfg.title || "",
    titleLines,
    subLines,
    titleOnly: ui.titleOnly === true,
  };
  const toRNode = (id: string): RNode => {
    const n = nodes[id];
    return {
      id: n.id,
      x: n.x!,
      y: n.y!,
      w: n.w!,
      h: n.h!,
      color: n.color,
      title: n.title,
      sub: n.sub,
      meta: n.meta,
      labels: n.labels,
      labelColors: n.labelColors,
      progress: n.progress,
      bars: n.bars,
      hasKids: n.children.size > 0,
      collapsed: collapsed.has(n.id),
    };
  };

  // filters/collapse/focus applied above, BEFORE any layout, so chips, saved
  // views, and search behave identically in all three views.
  if (view === "gantt") {
    const gantt = layoutGantt(cfg, nodes, byLevel, vis);
    return {
      ...base,
      nodes: [],
      edges: [],
      headers: [],
      gantt,
      contentRight: gantt.contentRight,
      contentBottom: gantt.contentBottom,
    };
  }

  if (view === "kanban") {
    const board = layoutKanban(cfg, nodes, byLevel, vis);
    return {
      ...base,
      nodes: board.columns.flat().map(toRNode),
      edges: [],
      headers: board.headers,
      contentRight: board.contentRight,
      contentBottom: board.contentBottom,
    };
  }

  const { order, levelX, contentBottom, contentRight } = orderAndLayout(
    cfg,
    nodes,
    byLevel,
    vis
  );

  const edges: REdge[] = [];
  Object.values(nodes).forEach((p) => {
    if (!vis.has(p.id)) return;
    [...p.children]
      .filter((c) => vis.has(c))
      .forEach((cid) => {
        const c = nodes[cid];
        edges.push({
          a: p.id,
          b: cid,
          x1: p.x! + p.w!,
          y1: p.y! + p.h! / 2,
          x2: c.x!,
          y2: c.y! + c.h! / 2,
          color: p.color,
          secondary: isSecondary(edgeKind, p.id, cid),
        });
      });
  });

  const headers: RHeader[] = cfg.levels
    .map((lvl, i) => ({ x: levelX[i], label: lvl.label || "" }))
    .filter((h) => h.label);

  return {
    ...base,
    // nodes in draw order (level by level, DFS order within each)
    nodes: order.flatMap((ids) => ids.map(toRNode)),
    edges,
    headers,
    contentRight,
    contentBottom,
  };
}
