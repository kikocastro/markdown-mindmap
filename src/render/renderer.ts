// Shared SVG renderer: draws a RenderModel into a given SVG root. The one copy
// of the card/label/bar/edge drawing both adapters use — Obsidian passes
// activeDocument, the VS Code webview passes document. Host theming stays in
// each host's CSS (classes below); geometry and content come from the model.
// Like the adapters, this file is validated by build + manual check, not unit
// tests (established split: pure logic is tested, rendering is not).

import { AUTO_COLORS, CARD_METRICS, subWidth, wrap } from "../graph";
import type { RNode, RenderModel } from "../graph";

const NS = "http://www.w3.org/2000/svg";

// interactivity is optional: the webview only passes onNodeClick, so toggles and
// hover lineage simply don't render/fire there.
export interface RendererCallbacks {
  onNodeClick?(id: string): void;
  onToggle?(id: string): void; // collapse/expand clicked (adapter flips state + redraws)
  onNodeEnter?(id: string): void;
  onNodeLeave?(): void;
}

// handles the adapters need for overlays (hover lineage, search dim) after a draw
export interface RenderHandles {
  nodeEls: Record<string, SVGElement>;
  links: { el: SVGElement; a: string; b: string }[];
}

export function renderModel(
  doc: Document,
  rootG: SVGElement,
  model: RenderModel,
  cb: RendererCallbacks = {}
): RenderHandles {
  const svgEl = (
    tag: string,
    attrs: Record<string, string | number | undefined>,
    parent: Element
  ): SVGElement => {
    const e = doc.createElementNS(NS, tag);
    for (const k in attrs) {
      const v = attrs[k];
      if (v != null) e.setAttribute(k, String(v));
    }
    parent.appendChild(e);
    return e;
  };

  while (rootG.firstChild) rootG.removeChild(rootG.firstChild);
  const links: RenderHandles["links"] = [];
  const nodeEls: RenderHandles["nodeEls"] = {};
  const M = CARD_METRICS;
  const titleOnly = model.titleOnly;

  const linkLayer = svgEl("g", {}, rootG),
    nodeLayer = svgEl("g", {}, rootG);

  // column headers
  model.headers.forEach((h) => {
    svgEl("text", { class: "mm-colhead", x: h.x, y: 36 }, rootG).textContent =
      h.label;
  });

  // edges (parent right-mid -> child left-mid); secondary links draw dashed + fainter
  model.edges.forEach((e) => {
    const mx = (e.x1 + e.x2) / 2;
    const path = svgEl(
      "path",
      {
        class: "mm-link" + (e.secondary ? " mm-also" : ""),
        d: `M${e.x1},${e.y1} C${mx},${e.y1} ${mx},${e.y2} ${e.x2},${e.y2}`,
        stroke: e.color,
        "stroke-width": 2.5,
      },
      linkLayer
    );
    links.push({ el: path, a: e.a, b: e.b });
  });

  // small value pills along the card's bottom strip; drops any that don't fit on one
  // row. sit above the bar when there is one, so the bar is always the card's last row.
  function drawLabels(g: SVGElement, n: RNode) {
    const hasBar = n.progress != null || n.bars.length > 0;
    const top = n.y + n.h - (hasBar ? 53 : 31),
      h = 15,
      size = 9,
      pad = 11;
    const maxX = n.x + n.w - 12;
    let bx = n.x + 12;
    for (let i = 0; i < n.labels.length; i++) {
      const t = n.labels[i];
      // ponytail: width estimated from char count — SVG has no cheap text metrics, fine for short labels
      const w = Math.ceil(t.length * size * 0.62) + pad * 2;
      if (bx + w > maxX) break;
      const color = n.labelColors[i] || AUTO_COLORS[i % AUTO_COLORS.length];
      svgEl(
        "rect",
        {
          class: "mm-label",
          x: bx,
          y: top,
          width: w,
          height: h,
          rx: 7,
          fill: color,
          "fill-opacity": 0.14,
          stroke: color,
        },
        g
      );
      svgEl(
        "text",
        {
          class: "mm-label-t",
          x: bx + w / 2,
          y: top + 11,
          "font-size": size,
          fill: color,
        },
        g
      ).textContent = t;
      bx += w + 5;
    }
  }

  // progress bar (0-100) and/or stacked category bar, pinned to the card's last row
  function drawBar(g: SVGElement, n: RNode) {
    const x = n.x + 14,
      w = n.w - 28,
      y = n.y + n.h - 23;
    if (n.progress != null) {
      const p = Math.max(0, Math.min(100, n.progress));
      svgEl("rect", { class: "mm-track", x, y, width: w, height: 6, rx: 3 }, g);
      svgEl(
        "rect",
        { x, y, width: (w * p) / 100, height: 6, rx: 3, fill: n.color },
        g
      );
      svgEl(
        "text",
        { class: "mm-barlbl", x: x + w, y: y - 3, "text-anchor": "end" },
        g
      ).textContent = p + "%";
    } else if (n.bars.length) {
      const total = n.bars.reduce((s, [, c]) => s + c, 0) || 1;
      let bx = x;
      n.bars.forEach(([cat, c, color]) => {
        const seg = (w * c) / total;
        const r = svgEl(
          "rect",
          {
            x: bx,
            y,
            width: Math.max(0, seg - 1.5),
            height: 7,
            rx: 2,
            fill: color,
          },
          g
        );
        svgEl("title", {}, r).textContent = `${c} ${cat}`;
        bx += seg;
      });
      svgEl(
        "text",
        { class: "mm-barlbl", x: x + w, y: y - 3, "text-anchor": "end" },
        g
      ).textContent = String(total);
    }
  }

  model.nodes.forEach((n) => {
    const hasBar = !titleOnly && (n.progress != null || n.bars.length > 0);
    const g = svgEl("g", { class: "mm-node" }, nodeLayer);
    svgEl(
      "rect",
      {
        class: "mm-box",
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        rx: 9,
        stroke: n.color,
      },
      g
    );

    // text block: padded from top/bottom, with bars/labels reserved at the bottom
    const padR = n.hasKids ? M.padRightToggle : M.padRight;
    const labelH = !titleOnly && n.labels.length ? M.labelStrip : 0;
    const barH = hasBar ? M.barStrip : 0;
    const lines: { t: string; cls: string; size: number; lh: number }[] = [];
    let truncated = false;
    const titleWrapped = wrap(
      n.title,
      n.w - M.padLeft - padR,
      M.titleSize,
      model.titleLines
    );
    if (
      titleWrapped.join(" ").length < n.title.replace(/\s+/g, " ").trim().length
    )
      truncated = true;
    titleWrapped.forEach((t) =>
      lines.push({ t, cls: "mm-t1", size: M.titleSize, lh: M.titleLine })
    );
    if (!titleOnly && n.sub) {
      const subWrapped = wrap(n.sub, subWidth(n.w), M.subSize, model.subLines);
      if (
        subWrapped.join(" ").length < n.sub.replace(/\s+/g, " ").trim().length
      )
        truncated = true;
      subWrapped.forEach((t) =>
        lines.push({ t, cls: "mm-t2", size: M.subSize, lh: M.subLine })
      );
    }
    if (!titleOnly && n.meta)
      lines.push({
        t: n.meta,
        cls: "mm-meta",
        size: M.metaSize,
        lh: M.metaLine,
      });
    const totalH = lines.reduce((s, b) => s + b.lh, 0);
    const firstSize = lines[0]?.size || M.titleSize;
    const textTop = n.y + M.padTop;
    const textBottom = n.y + n.h - M.padBottom - barH - labelH;
    const freeH = Math.max(totalH, textBottom - textTop);
    let ty =
      hasBar || labelH
        ? textTop + firstSize
        : textTop + (freeH - totalH) / 2 + firstSize;
    lines.forEach((b) => {
      svgEl(
        "text",
        { class: b.cls, x: n.x + M.padLeft, y: ty, "font-size": b.size },
        g
      ).textContent = b.t;
      ty += b.lh;
    });

    // native tooltip with the full text when title/subtitle was clipped
    if (truncated)
      svgEl("title", {}, g).textContent = n.title + (n.sub ? "\n" + n.sub : "");

    // bottom strip: label pills, then the progress/category bar as the last row
    if (labelH) drawLabels(g, n);
    if (hasBar) drawBar(g, n);

    // collapse toggle in the top-right corner (clear of the right-edge link connector);
    // only when the adapter handles toggling (the webview doesn't)
    if (n.hasKids && cb.onToggle) {
      const cx = n.x + n.w - 16,
        cy = n.y + 15;
      // collapsed toggles get a distinct class + bigger circle so contracted subtrees stand out
      const tg = svgEl(
        "g",
        { class: "mm-toggle" + (n.collapsed ? " mm-collapsed" : "") },
        g
      );
      svgEl("circle", { cx, cy, r: n.collapsed ? 9 : 8 }, tg);
      svgEl("text", { x: cx, y: cy + 4 }, tg).textContent = n.collapsed
        ? "+"
        : "−";
      tg.addEventListener("click", (ev) => {
        ev.stopPropagation();
        cb.onToggle!(n.id);
      });
    }

    if (cb.onNodeEnter)
      g.addEventListener("mouseenter", () => cb.onNodeEnter!(n.id));
    if (cb.onNodeLeave)
      g.addEventListener("mouseleave", () => cb.onNodeLeave!());
    if (cb.onNodeClick)
      g.addEventListener("click", (ev) => {
        ev.stopPropagation();
        cb.onNodeClick!(n.id);
      });
    nodeEls[n.id] = g;
  });

  return { nodeEls, links };
}
