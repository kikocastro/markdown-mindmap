// Gantt layout: one row per visible node in tree (DFS) order, a linear time
// axis from min(start)..max(end) padded to scale boundaries, bar geometry with
// progress fill, milestone diamonds. Pure: positions only, no DOM.
// ponytail: no dependency arrows (the real data has empty `dependencies` almost
// everywhere) and no date-range filtering (filterOptions is discrete-string
// based) — both deliberate v1 ceilings.

import { GanttDensity, GanttScale, MNode, MapCfg } from "./config";
import { CARD_METRICS, getPath, num, primKids, scalarStr } from "./helpers";

// density multipliers applied to the compact base geometry below
const DENSITY: Record<GanttDensity, number> = { compact: 1, comfortable: 1.4 };

// status string -> bar/milestone colour. Normalized case/space-insensitively;
// unknown or missing statuses return null (caller falls back to the node colour).
const STATUS_COLOR: Record<string, string> = {
  done: "#2ecc71",
  complete: "#2ecc71",
  completed: "#2ecc71",
  closed: "#2ecc71",
  shipped: "#2ecc71",
  "in progress": "#3498db",
  "in-progress": "#3498db",
  doing: "#3498db",
  active: "#3498db",
  wip: "#3498db",
  started: "#3498db",
  ongoing: "#3498db",
  todo: "#95a5a6",
  "to do": "#95a5a6",
  "to-do": "#95a5a6",
  planned: "#95a5a6",
  backlog: "#95a5a6",
  open: "#95a5a6",
  "not started": "#95a5a6",
  new: "#95a5a6",
  pending: "#95a5a6",
};
export const statusColor = (v: unknown): string | null => {
  const s = scalarStr(v).trim().toLowerCase().replace(/\s+/g, " ");
  return s ? (STATUS_COLOR[s] ?? null) : null;
};

// gantt drawing constants (labelWidth also anchors the time axis origin)
export const GANTT = {
  labelWidth: 260,
  // tall enough for a 2-line title + a tags line in the label column
  rowH: 50,
  rowGap: 6,
  top: 64,
  axisY: 36,
  indent: 14, // px per hierarchy depth on the row label
  dayPx: { week: 12, month: 4, quarter: 1.5, year: 0.4 },
} as const;

const DAY_MS = 86400000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// an ISO date (or Date — some YAML parsers emit them) -> UTC day number, or null
export const parseDay = (v: unknown): number | null => {
  if (v instanceof Date) return Math.floor(v.getTime() / DAY_MS);
  const s = scalarStr(v).trim();
  if (!s) return null;
  const ms = Date.parse(s);
  return isNaN(ms) ? null : Math.floor(ms / DAY_MS);
};

export interface GanttRow {
  id: string;
  y: number;
  h: number;
  label: string;
  indent: number; // hierarchy depth (0 = root)
  color: string;
  bar: { x: number; w: number; progressW: number | null } | null;
  milestone: { x: number } | null; // diamond centre
  labelText: string; // card.labels joined, drawn as discreet text right after the row title
  tooltip: string; // native hover title on the bar/milestone (name + dates + status)
  hasKids: boolean; // has primary children (drives the collapse toggle)
  collapsed: boolean;
}
export interface GanttTick {
  x: number;
  label: string;
  major: boolean; // start of the next-larger period (week->month, month/quarter->year boundary etc.)
}
// row geometry + font sizes, scaled by density; the renderer reads these
// instead of hardcoding, so compact/comfortable is one number in one place.
export interface GanttMetrics {
  rowH: number;
  titleSize: number;
  subSize: number;
  barH: number;
  lineH: number; // baseline step between wrapped title lines
  indent: number; // px per hierarchy depth on the row label
}
export interface GanttModel {
  labelWidth: number;
  axisY: number;
  metrics: GanttMetrics;
  rows: GanttRow[];
  ticks: GanttTick[];
  todayX: number | null; // x of the "today" marker, or null if out of range / no ticks
  contentRight: number;
  contentBottom: number;
}

// period starts covering [minDay, maxDay], padded to scale boundaries. `major`
// flags the boundary of the next-larger period (week->new month, month->new
// quarter, quarter->new year, year->new decade) so the renderer can draw a
// slightly firmer divider there.
type TickDay = { day: number; label: string; major: boolean };
function tickDays(
  minDay: number,
  maxDay: number,
  scale: GanttScale
): TickDay[] {
  const out: TickDay[] = [];
  if (scale === "week") {
    // floor to Monday (day 0, 1970-01-01, was a Thursday: Monday-based dow = day + 3)
    let d = minDay - ((minDay + 3) % 7);
    let prevMonth = -1;
    for (; ; d += 7) {
      const dt = new Date(d * DAY_MS);
      const m = dt.getUTCMonth();
      out.push({
        day: d,
        label: `${dt.getUTCDate()} ${MONTHS[m]}`,
        major: m !== prevMonth, // first week landing in a new month
      });
      prevMonth = m;
      if (d > maxDay) break;
    }
    return out;
  }
  if (scale === "year") {
    let y = new Date(minDay * DAY_MS).getUTCFullYear();
    for (; ; y++) {
      const day = Math.floor(Date.UTC(y, 0, 1) / DAY_MS);
      out.push({ day, label: `${y}`, major: y % 10 === 0 }); // decade boundary
      if (day > maxDay) break;
    }
    return out;
  }
  const step = scale === "quarter" ? 3 : 1;
  const start = new Date(minDay * DAY_MS);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth() - (start.getUTCMonth() % step);
  for (;;) {
    const day = Math.floor(Date.UTC(y, m, 1) / DAY_MS);
    out.push({
      day,
      label: scale === "quarter" ? `Q${m / 3 + 1} ${y}` : `${MONTHS[m]} ${y}`,
      // quarter view: firmer line at the year start (Q1); month view: at the
      // quarter start (Jan/Apr/Jul/Oct).
      major: scale === "quarter" ? m === 0 : m % 3 === 0,
    });
    if (day > maxDay) break;
    m += step;
    if (m > 11) {
      m -= 12;
      y += 1;
    }
  }
  return out;
}

// hierarchy depth over primary parents (guarded against cycles)
function depth(nodes: Record<string, MNode>, id: string): number {
  const seen = new Set<string>([id]);
  let d = 0,
    cur = nodes[id].primaryParent;
  while (cur && nodes[cur] && !seen.has(cur)) {
    seen.add(cur);
    d++;
    cur = nodes[cur].primaryParent;
  }
  return d;
}

export interface GanttOpts {
  collapsed?: Set<string>; // for the per-row toggle state
  scale?: GanttScale; // UI override of cfg.gantt.scale
  density?: GanttDensity; // UI override of cfg.gantt.density
  today?: number; // UTC day number for the "today" marker (adapter supplies live value)
}

export function layoutGantt(
  cfg: MapCfg,
  nodes: Record<string, MNode>,
  byLevel: MNode[][],
  vis: Set<string>,
  opts: GanttOpts = {}
): GanttModel {
  const g = cfg.gantt;
  if (!g || !g.start || !g.end)
    throw new Error("gantt view needs `gantt: { start, end }` field names.");
  const scale = opts.scale ?? g.scale ?? "month";
  const px = GANTT.dayPx[scale];
  const den = DENSITY[opts.density ?? g.density ?? "compact"];
  const metrics: GanttMetrics = {
    rowH: Math.round(GANTT.rowH * den),
    titleSize: CARD_METRICS.titleSize * den,
    subSize: CARD_METRICS.subSize * den,
    barH: Math.round(14 * den),
    lineH: Math.round(15 * den),
    indent: Math.round(GANTT.indent * den),
  };
  const rowGap = Math.round(GANTT.rowGap * den);
  const groupRows = g.groupRows !== false;
  const sortByStart = g.sortByStart !== false;

  // start-date key: start, else end, else +Inf so dateless rows sort last.
  const startKey = (id: string) =>
    parseDay(getPath(nodes[id].fm, g.start)) ??
    parseDay(getPath(nodes[id].fm, g.end)) ??
    Number.POSITIVE_INFINITY;

  // default order: crescent start date, but children stay grouped UNDER their
  // parent — siblings (and roots) are sorted among themselves, the tree is not
  // flattened. `x || tiebreak`: two dateless give Inf-Inf=NaN (falsy) so they
  // fall through to the stable collIdx tiebreak.
  const cmp = sortByStart
    ? (a: string, b: string) =>
        startKey(a) - startKey(b) || nodes[a].collIdx - nodes[b].collIdx
    : (a: string, b: string) => nodes[a].collIdx - nodes[b].collIdx;

  const ids = groupRows ? orderTree() : flatOrder();

  // hierarchical order: sort roots (any node with no visible primary parent) by
  // `cmp`, DFS, sorting each node's visible children by `cmp` too.
  function orderTree(): string[] {
    const seq: string[] = [];
    const seen = new Set<string>();
    // ponytail: no revisit guard needed. primKids keys on the single
    // primaryParent, so the root-reachable set is a forest; true cycles never
    // reach a root and fall to the trailing unreached loop below.
    const dfs = (id: string) => {
      seen.add(id);
      seq.push(id);
      primKids(nodes, id)
        .filter((k) => vis.has(k))
        .sort(cmp)
        .forEach(dfs);
    };
    const isRoot = (id: string) => {
      const p = nodes[id].primaryParent;
      return !p || !nodes[p] || !vis.has(p);
    };
    cfg.levels
      .flatMap((_, li) => byLevel[li])
      .filter((n) => vis.has(n.id) && isRoot(n.id))
      .map((n) => n.id)
      .sort(cmp)
      .forEach(dfs);
    // anything still unreached (primary-parent cycle) appended stably
    cfg.levels.forEach((_, li) =>
      byLevel[li].forEach((n) => {
        if (vis.has(n.id) && !seen.has(n.id)) {
          seen.add(n.id);
          seq.push(n.id);
        }
      })
    );
    return seq;
  }
  function flatOrder(): string[] {
    const flat = [...vis].sort((a, b) => a.localeCompare(b));
    if (!sortByStart) return flat;
    const pos = new Map(flat.map((id, i) => [id, i]));
    return [...flat].sort(
      (a, b) => startKey(a) - startKey(b) || pos.get(a)! - pos.get(b)!
    );
  }

  const dated = ids.map((id) => ({
    id,
    start: parseDay(getPath(nodes[id].fm, g.start)),
    end: parseDay(getPath(nodes[id].fm, g.end)),
  }));
  const allDays = dated.flatMap((d) =>
    [d.start, d.end].filter((x): x is number => x != null)
  );

  let ticks: GanttTick[] = [];
  let day0: number | null = null;
  let todayX: number | null = null;
  let chartRight = GANTT.labelWidth + 40;
  const dayX = (day: number) => GANTT.labelWidth + (day - day0!) * px;
  if (allDays.length) {
    const tickList = tickDays(
      Math.min(...allDays),
      Math.max(...allDays),
      scale
    );
    day0 = tickList[0].day;
    ticks = tickList.map((t) => ({
      x: dayX(t.day),
      label: t.label,
      major: t.major,
    }));
    chartRight = ticks[ticks.length - 1].x;
    const lastDay = tickList[tickList.length - 1].day;
    if (opts.today != null && opts.today >= day0 && opts.today <= lastDay)
      todayX = dayX(opts.today);
  }

  const showLabels = g.showLabels !== false;
  const fmtDay = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);
  const rows: GanttRow[] = dated.map(({ id, start, end }, i) => {
    const n = nodes[id];
    const y = GANTT.top + i * (metrics.rowH + rowGap);
    let bar: GanttRow["bar"] = null;
    let milestone: GanttRow["milestone"] = null;
    const p = g.progress ? num(getPath(n.fm, g.progress)) : n.progress;
    if (start != null && end != null && end > start) {
      const w = (end - start) * px;
      bar = {
        x: dayX(start),
        w,
        progressW: p == null ? null : (w * Math.max(0, Math.min(100, p))) / 100,
      };
    } else if (start != null || end != null) {
      // start == end, or only one of the two present: a milestone diamond
      milestone = { x: dayX((start ?? end)!) };
    }
    const rowIndent = groupRows ? depth(nodes, id) : 0;
    // tags render as one discreet run right after the row title (renderer places
    // + truncates them); joined here, not positioned.
    const labelText = showLabels ? n.labels.join(" · ") : "";
    // native hover tooltip on the bar/milestone: full title + dates + status
    const range =
      start != null && end != null
        ? `${fmtDay(start)} → ${fmtDay(end)}`
        : start != null || end != null
          ? fmtDay((start ?? end)!)
          : "";
    const statusText = scalarStr(getPath(n.fm, g.status ?? "status")).trim();
    // rich hover tooltip: title, then labelled detail lines for whatever exists
    const tooltip = [
      n.title,
      range,
      statusText && `Status: ${statusText}`,
      p != null && `Progress: ${Math.round(Math.max(0, Math.min(100, p)))}%`,
      labelText && `Tags: ${labelText}`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      id,
      y,
      h: metrics.rowH,
      label: n.title,
      indent: rowIndent,
      color: statusColor(getPath(n.fm, g.status ?? "status")) ?? n.color,
      bar,
      milestone,
      labelText,
      tooltip,
      hasKids: primKids(nodes, id).length > 0,
      collapsed: opts.collapsed?.has(id) ?? false,
    };
  });

  return {
    labelWidth: GANTT.labelWidth,
    axisY: GANTT.axisY,
    metrics,
    rows,
    ticks,
    todayX,
    contentRight: chartRight,
    contentBottom: rows.length
      ? rows[rows.length - 1].y + metrics.rowH
      : GANTT.top,
  };
}
