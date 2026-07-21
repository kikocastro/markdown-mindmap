// Webview bootstrap: draw the host-computed RenderModel with the shared
// renderer, wire pan/zoom, and post clicks back so the host opens the note.
// No graph logic here — the extension host computes everything.
// ponytail: v1 draws + pan/zoom + click-to-open. Search/filter/collapse/the note
// dialog are deferred to a later pass; add them when the VS Code UX is shaped.

import { renderModel } from "../render/renderer";
import { attachPanZoom } from "../render/panzoom";
import type { RenderModel } from "../graph";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
declare global {
  interface Window {
    __mmPayload: RenderModel;
  }
}

const NS = "http://www.w3.org/2000/svg";
const vscodeApi = acquireVsCodeApi();
const data = window.__mmPayload;

const stage = document.getElementById("stage") as HTMLDivElement;
const svg = stage.querySelector("svg") as SVGSVGElement;
const rootG = document.createElementNS(NS, "g");
svg.appendChild(rootG);

renderModel(document, rootG, data, {
  onNodeClick: (id) => vscodeApi.postMessage({ type: "open", path: id }),
});

const panZoom = attachPanZoom({
  stage,
  rootG,
  dragClass: "drag",
  getViewport: () => ({
    w: svg.clientWidth || 800,
    h: svg.clientHeight || 600,
  }),
  getContent: () => ({
    right: data.contentRight,
    bottom: data.contentBottom,
  }),
});

panZoom.fit();
window.addEventListener("resize", () => panZoom.fit());
