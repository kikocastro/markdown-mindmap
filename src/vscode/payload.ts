// Flat, JSON-serialisable view model the extension host computes (via the pure
// core in ../graph) and hands to the webview to draw. The webview does no graph
// logic — only SVG rendering + pan/zoom + click-to-open.

export interface VNode {
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
  progress: number | null;
  bars: [string, number, string][];
  hasKids: boolean;
}

export interface VEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  secondary: boolean;
}

export interface VHeader {
  x: number;
  label: string;
}

export interface MapPayload {
  title: string;
  titleLines: number;
  subLines: number;
  nodes: VNode[];
  edges: VEdge[];
  headers: VHeader[];
  contentRight: number;
  contentBottom: number;
}
