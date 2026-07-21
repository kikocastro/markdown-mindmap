// Export builders: pure data->data mappers for the HTML / Excalidraw export
// buttons in the Obsidian adapter. No DOM here — the adapter clones the live
// SVG for HTML and feeds geometry from the RenderModel for Excalidraw.

// ---- export --------------------------------------------------------------

// HTML export destination: sibling of the note, ".md" swapped for " mindmap.html".
// ponytail: multiple mindmap blocks in one note share this path; later exports overwrite.
export const mindmapExportPath = (notePath: string): string =>
  notePath.replace(/\.md$/i, "") + " mindmap.html";

// ---- Excalidraw export ---------------------------------------------------

// Minimal geometry the builder needs; both adapters already have it.
export interface ExNode {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  text: string;
}
export interface ExEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  // node indices into the nodes[] array; when both set the arrow binds to
  // those rectangles so dragging a node re-routes the arrow in Excalidraw.
  source?: number;
  target?: number;
}

// Pure data->data builder for an Excalidraw v2 file. Each node becomes a
// rounded rectangle with a bound (centered) text label; each edge a straight
// arrow. ids are deterministic (test-stable); seeds are constant (Excalidraw
// tolerates duplicates). v1 is lossy by design:
// ponytail: straight arrows (no bezier), no label pills / progress bars /
// column headers. Arrows bind to boxes when the edge carries source/target.
export const mapToExcalidraw = (
  nodes: ExNode[],
  edges: ExEdge[]
): {
  type: "excalidraw";
  version: 2;
  source: string;
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
} => {
  let n = 0;
  const id = () => "mm-" + n++;
  const base = (i: number) => ({
    angle: 0,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    seed: 1 + i,
    version: 1,
    versionNonce: 1 + i,
    isDeleted: false,
    updated: 1,
    link: null,
    locked: false,
  });

  const elements: Record<string, unknown>[] = [];
  // rect element per node index, so edges can bind to them after the fact.
  const rects: { id: string; boundElements: { type: string; id: string }[] }[] =
    [];
  nodes.forEach((node, i) => {
    const rectId = id();
    const textId = id();
    const boundElements: { type: string; id: string }[] = [
      { type: "text", id: textId },
    ];
    const rect = {
      ...base(i),
      id: rectId,
      type: "rectangle",
      x: node.x,
      y: node.y,
      width: node.w,
      height: node.h,
      strokeColor: node.color,
      roundness: { type: 3 },
      boundElements,
    };
    rects[i] = { id: rectId, boundElements };
    elements.push(rect);
    elements.push({
      ...base(i),
      id: textId,
      type: "text",
      x: node.x,
      y: node.y,
      width: node.w,
      height: node.h,
      strokeColor: "#1e1e1e",
      roundness: null,
      boundElements: [],
      text: node.text,
      originalText: node.text,
      fontSize: 16,
      fontFamily: 1,
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.25,
      containerId: rectId,
    });
  });
  edges.forEach((e, i) => {
    const arrowId = id();
    const start = e.source != null ? rects[e.source] : undefined;
    const end = e.target != null ? rects[e.target] : undefined;
    // focus 0 (box center) + small gap; Excalidraw recomputes exact attach
    // points on load and on every drag.
    const bind = (r: typeof start) =>
      r ? { elementId: r.id, focus: 0, gap: 4 } : null;
    if (start) start.boundElements.push({ type: "arrow", id: arrowId });
    if (end) end.boundElements.push({ type: "arrow", id: arrowId });
    elements.push({
      ...base(nodes.length + i),
      id: arrowId,
      type: "arrow",
      x: e.x1,
      y: e.y1,
      width: e.x2 - e.x1,
      height: e.y2 - e.y1,
      strokeColor: e.color,
      roundness: { type: 2 },
      boundElements: [],
      points: [
        [0, 0],
        [e.x2 - e.x1, e.y2 - e.y1],
      ],
      lastCommittedPoint: null,
      startBinding: bind(start),
      endBinding: bind(end),
      startArrowhead: null,
      endArrowhead: "arrow",
    });
  });

  return {
    type: "excalidraw",
    version: 2,
    source: "markdown-mindmap",
    elements,
    appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
    files: {},
  };
};

// Excalidraw export destination: sibling of the note, ".md" -> ".excalidraw".
export const mindmapExcalidrawPath = (notePath: string): string =>
  notePath.replace(/\.md$/i, "") + " mindmap.excalidraw";
