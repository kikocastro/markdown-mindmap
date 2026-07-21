// Gantt layout: one row per visible node in tree (DFS) order, a linear time
// axis from min(start)..max(end) padded to scale boundaries, bar geometry with
// progress fill, milestone diamonds. Pure: positions only, no DOM.
// ponytail: no dependency arrows (the real data has empty `dependencies` almost
// everywhere) and no date-range filtering (filterOptions is discrete-string
// based) — both deliberate v1 ceilings.

import { MNode, MapCfg } from "./config";
import { getPath, num, scalarStr } from "./helpers";
import { treeSequence } from "./layout-tree";

// gantt drawing constants (labelWidth also anchors the time axis origin)
export const GANTT = {
  labelWidth: 260,
  rowH: 30,
  rowGap: 6,
  top: 64,
  axisY: 36,
  indent: 14, // px per hierarchy depth on the row label
  dayPx: { week: 12, month: 4, quarter: 1.5 },
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
}
export interface GanttTick {
  x: number;
  label: string;
}
export interface GanttModel {
  labelWidth: number;
  axisY: number;
  rows: GanttRow[];
  ticks: GanttTick[];
  contentRight: number;
  contentBottom: number;
}

// period starts covering [minDay, maxDay], padded to scale boundaries
function tickDays(
  minDay: number,
  maxDay: number,
  scale: "week" | "month" | "quarter"
): { day: number; label: string }[] {
  const out: { day: number; label: string }[] = [];
  if (scale === "week") {
    // floor to Monday (day 0, 1970-01-01, was a Thursday: Monday-based dow = day + 3)
    let d = minDay - ((minDay + 3) % 7);
    for (; ; d += 7) {
      const dt = new Date(d * DAY_MS);
      out.push({
        day: d,
        label: `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`,
      });
      if (d > maxDay) break;
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

export function layoutGantt(
  cfg: MapCfg,
  nodes: Record<string, MNode>,
  byLevel: MNode[][],
  vis: Set<string>
): GanttModel {
  const g = cfg.gantt;
  if (!g || !g.start || !g.end)
    throw new Error("gantt view needs `gantt: { start, end }` field names.");
  const scale = g.scale ?? "month";
  const px = GANTT.dayPx[scale];
  const groupRows = g.groupRows !== false;

  const ids = groupRows
    ? treeSequence(cfg, nodes, byLevel, vis)
    : [...vis].sort((a, b) => a.localeCompare(b));

  // resolve each row's day range first so the axis can span them all
  const dated = ids.map((id) => {
    const fm = nodes[id].fm;
    return {
      id,
      start: parseDay(getPath(fm, g.start)),
      end: parseDay(getPath(fm, g.end)),
    };
  });
  const allDays = dated.flatMap((d) =>
    [d.start, d.end].filter((x): x is number => x != null)
  );

  let ticks: GanttTick[] = [];
  let day0: number | null = null;
  let chartRight = GANTT.labelWidth + 40;
  const dayX = (day: number) => GANTT.labelWidth + (day - day0!) * px;
  if (allDays.length) {
    const tickList = tickDays(
      Math.min(...allDays),
      Math.max(...allDays),
      scale
    );
    day0 = tickList[0].day;
    ticks = tickList.map((t) => ({ x: dayX(t.day), label: t.label }));
    chartRight = ticks[ticks.length - 1].x;
  }

  const rows: GanttRow[] = dated.map(({ id, start, end }, i) => {
    const n = nodes[id];
    const y = GANTT.top + i * (GANTT.rowH + GANTT.rowGap);
    let bar: GanttRow["bar"] = null;
    let milestone: GanttRow["milestone"] = null;
    if (start != null && end != null && end > start) {
      const p = g.progress ? num(getPath(n.fm, g.progress)) : n.progress;
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
    return {
      id,
      y,
      h: GANTT.rowH,
      label: n.title,
      indent: groupRows ? depth(nodes, id) : 0,
      color: n.color,
      bar,
      milestone,
    };
  });

  return {
    labelWidth: GANTT.labelWidth,
    axisY: GANTT.axisY,
    rows,
    ticks,
    contentRight: chartRight,
    contentBottom: rows.length
      ? rows[rows.length - 1].y + GANTT.rowH
      : GANTT.top,
  };
}
