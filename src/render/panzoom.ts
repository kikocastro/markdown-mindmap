// Shared pan / zoom / fit for the map stage. One copy for both adapters; the
// host passes viewport + inset callbacks (Obsidian's sidebar overlays the left
// of the stage) and, if it needs managed cleanup, its own window-event binder.

export interface PanZoomOptions {
  stage: HTMLElement; // drag/wheel surface; gets dragClass while dragging
  rootG: SVGElement; // transformed group
  getViewport(): { w: number; h: number };
  getContent(): { right: number; bottom: number }; // fit target (re-read every fit)
  getInsetLeft?(): number; // px kept clear on the left (Obsidian toolbar rail)
  dragClass?: string;
  // Obsidian passes plugin.registerDomEvent so listeners die with the plugin
  listenWindow?: (
    type: "mousemove" | "mouseup",
    handler: (e: MouseEvent) => void
  ) => void;
}

export interface PanZoom {
  view: { x: number; y: number; k: number };
  apply(): void;
  fit(): void;
}

export function attachPanZoom(o: PanZoomOptions): PanZoom {
  const dragClass = o.dragClass ?? "mm-drag";
  const listenWindow =
    o.listenWindow ??
    ((type: "mousemove" | "mouseup", handler: (e: MouseEvent) => void) =>
      window.addEventListener(type, handler));
  const view = { x: 20, y: 8, k: 1 };
  const apply = () =>
    o.rootG.setAttribute(
      "transform",
      `translate(${view.x},${view.y}) scale(${view.k})`
    );
  function fit() {
    const { w, h } = o.getViewport();
    const barW = o.getInsetLeft?.() ?? 0;
    const { right, bottom } = o.getContent();
    view.k = Math.min((w - barW) / (right + 40), h / (bottom + 40), 1.4) || 1;
    view.x = barW + 20;
    view.y = 8;
    apply();
  }

  let drag: { x: number; y: number } | null = null;
  o.stage.addEventListener("mousedown", (e) => {
    drag = { x: e.clientX - view.x, y: e.clientY - view.y };
    o.stage.classList.add(dragClass);
  });
  listenWindow("mousemove", (e) => {
    if (drag) {
      view.x = e.clientX - drag.x;
      view.y = e.clientY - drag.y;
      apply();
    }
  });
  listenWindow("mouseup", () => {
    drag = null;
    o.stage.classList.remove(dragClass);
  });
  o.stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const step = Math.min(0.06, Math.abs(e.deltaY) * 0.0009),
        f = e.deltaY < 0 ? 1 + step : 1 / (1 + step);
      const nk = Math.max(0.2, Math.min(3, view.k * f)),
        r = nk / view.k;
      const rect = o.stage.getBoundingClientRect(),
        px = e.clientX - rect.left,
        py = e.clientY - rect.top;
      view.x = px - (px - view.x) * r;
      view.y = py - (py - view.y) * r;
      view.k = nk;
      apply();
    },
    { passive: false }
  );

  return { view, apply, fit };
}
