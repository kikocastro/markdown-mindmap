import {
  App,
  MarkdownPostProcessorContext,
  Notice,
  Plugin,
  TFile,
  parseYaml,
} from "obsidian";
import { svgEl } from "./svg";
import { LinkRow, NoteModal } from "./modals";
import { MNode, NoteLike, Resolver, wrap } from "../graph";
import {
  CausalCfg,
  CausalNode,
  Sign,
  buildCausalEdges,
  buildLoops,
  causalExportPath,
  causalSearchMatch,
  collectCausalNodes,
  collectLoopCards,
  findCycles,
  layoutCausal,
  validateCausalConfig,
} from "../causal";

// ============================================================================
// Causal map — render a systems-thinking causal-loop diagram from note
// frontmatter (`affects:` signed edges). One ```causalmap block = one diagram.
// Pure logic (collection, cycles, layout) lives in src/causal.ts; this file
// only draws and wires interactions, mirroring main.ts' mindmap renderer.
// ============================================================================

// loop polarity -> accent: reinforcing amber (runaway), balancing teal (stabilising)
const LOOP_KIND_COLORS: Record<"reinforcing" | "balancing", string> = {
  reinforcing: "#e67e22",
  balancing: "#16a085",
};

export function renderCausalMap(
  app: App,
  plugin: Plugin,
  source: string,
  host: HTMLElement,
  ctx: MarkdownPostProcessorContext
) {
  const cfg = parseYaml(source) as CausalCfg;
  validateCausalConfig(cfg);

  // adapt the vault to the pure layer (same shape main.ts feeds graph.ts)
  const fileByPath: Record<string, TFile> = {};
  const notes: NoteLike[] = app.vault.getMarkdownFiles().map((f) => {
    fileByPath[f.path] = f;
    return {
      path: f.path,
      basename: f.basename,
      frontmatter: app.metadataCache.getFileCache(f)?.frontmatter || {},
    };
  });
  const resolveLink: Resolver = (key, fromPath) =>
    app.metadataCache.getFirstLinkpathDest(key, fromPath)?.path ?? null;

  const nodes = collectCausalNodes(cfg, notes);
  const edges = buildCausalEdges(cfg, nodes, resolveLink);
  const loops = buildLoops(
    findCycles(nodes, edges),
    edges,
    collectLoopCards(cfg, notes)
  );
  const { contentRight, contentBottom } = layoutCausal(
    nodes,
    edges,
    cfg.layout
  );

  // ---- per-instance view state ----
  let searchTerm = "";
  let selected: string | null = null; // sticky node highlight (set by click)
  let selectedLoop: string | null = null; // loop picked in the rail
  const view = { x: 20, y: 8, k: 1 };

  // ---- DOM scaffold (mm-* classes shared with the mindmap) ----
  host.empty();
  const wrapEl = host.createDiv({ cls: "mm-wrap" });
  if (cfg.height) wrapEl.setCssStyles({ height: cfg.height + "px" });
  const toolbar = wrapEl.createDiv({ cls: "mm-toolbar" });
  const head = toolbar.createDiv({ cls: "mm-head" });
  if (cfg.title) head.createSpan({ cls: "mm-title", text: cfg.title });
  const barToggle = head.createEl("button", {
    cls: "mm-icon mm-bartoggle",
    text: "«",
    attr: { title: "Collapse sidebar" },
  });
  barToggle.onclick = () => {
    const collapsedBar = toolbar.classList.toggle("mm-bar-collapsed");
    barToggle.setText(collapsedBar ? "☰" : "«");
    barToggle.setAttr(
      "title",
      collapsedBar ? "Expand sidebar" : "Collapse sidebar"
    );
    fit();
  };

  const search = toolbar.createEl("input", {
    cls: "mm-search",
    attr: { type: "search", placeholder: "Search…" },
  });
  search.oninput = () => {
    searchTerm = search.value.trim().toLowerCase();
    reapply();
  };

  // loop rail: one chip per detected loop, kind-coloured dot, click to spotlight
  const loopChips: Record<string, HTMLButtonElement> = {};
  if (loops.length) {
    const grp = toolbar.createDiv({ cls: "mm-fltgroup cm-loopgroup" });
    grp.createSpan({ cls: "mm-fltlabel", text: "Loops" });
    loops.forEach((lp) => {
      const chip = grp.createEl("button", { cls: "mm-chip cm-loopchip" });
      chip
        .createSpan({ cls: "cm-loopdot" })
        .setCssStyles({ backgroundColor: LOOP_KIND_COLORS[lp.kind] });
      chip.createSpan({
        cls: "cm-looptext",
        text: lp.label ? `${lp.name} · ${lp.label}` : lp.name,
      });
      chip.setAttr(
        "title",
        `${lp.kind[0].toUpperCase() + lp.kind.slice(1)} loop: ` +
          [...lp.nodes, lp.nodes[0]].map((id) => nodes[id].label).join(" → ")
      );
      chip.onclick = () => {
        selectedLoop = selectedLoop === lp.name ? null : lp.name;
        selected = null;
        syncLoopChips();
        reapply();
      };
      loopChips[lp.name] = chip;
    });
  }
  function syncLoopChips() {
    Object.entries(loopChips).forEach(([name, chip]) =>
      chip.toggleClass("on", name === selectedLoop)
    );
  }

  // type legend (only the types actually present)
  const typesPresent = [
    ...new Set(
      Object.values(nodes)
        .map((n) => n.type)
        .filter(Boolean)
    ),
  ];
  if (typesPresent.length) {
    const grp = toolbar.createDiv({ cls: "mm-fltgroup" });
    grp.createSpan({ cls: "mm-fltlabel", text: "Types" });
    typesPresent.forEach((t) => {
      const color = Object.values(nodes).find((n) => n.type === t)!.color;
      const row = grp.createDiv({ cls: "cm-legendrow" });
      row
        .createSpan({ cls: "cm-swatch" })
        .setCssStyles({ backgroundColor: color });
      row.createSpan({ text: t });
    });
  }

  // footer utilities, mirroring the mindmap rail's grammar
  const foot = toolbar.createDiv({ cls: "mm-foot" });
  const displayGroup = foot.createDiv({ cls: "mm-actiongroup" });
  displayGroup.createSpan({ cls: "mm-fltlabel", text: "Display" });
  const fsBtn = displayGroup.createEl("button", {
    text: "Fullscreen",
    attr: { title: "Toggle fullscreen" },
  });
  fsBtn.onclick = () => {
    if (activeDocument.fullscreenElement) void activeDocument.exitFullscreen();
    else void wrapEl.requestFullscreen();
  };
  const exportGroup = foot.createDiv({ cls: "mm-actiongroup" });
  exportGroup.createSpan({ cls: "mm-fltlabel", text: "Export" });
  const exportBtn = exportGroup.createEl("button", {
    text: "HTML",
    attr: { title: "Save this diagram as a standalone .html next to the note" },
  });
  exportBtn.onclick = exportHtml;
  const footUtil = foot.createDiv({ cls: "mm-utilrow" });
  const resetBtn = footUtil.createEl("button", { text: "Reset" });
  resetBtn.onclick = () => {
    searchTerm = "";
    search.value = "";
    selected = null;
    selectedLoop = null;
    syncLoopChips();
    reapply();
    fit();
  };

  plugin.registerDomEvent(activeDocument, "fullscreenchange", () => {
    fsBtn.toggleClass("on", activeDocument.fullscreenElement === wrapEl);
    window.requestAnimationFrame(fit);
  });

  // ---- stage + one-shot draw (layout is static; interaction is class toggles) ----
  const stage = wrapEl.createDiv({ cls: "mm-stage" });
  const svg = svgEl("svg", {}, stage) as SVGSVGElement;
  const rootG = svgEl("g", {}, svg);
  const linkLayer = svgEl("g", {}, rootG);
  const nodeLayer = svgEl("g", {}, rootG);

  const edgeEls: { el: SVGElement; from: string; to: string; key: string }[] =
    [];
  const nodeEls: Record<string, SVGElement> = {};

  if (!Object.keys(nodes).length)
    stage.createDiv({
      cls: "cm-empty",
      text: `No notes matched folders: ${cfg.folders.join(", ")}`,
    });

  // point on n's border (plus a small gap) along the ray from its centre to (tx,ty)
  function borderPoint(n: CausalNode, tx: number, ty: number) {
    const cx = n.x! + n.w! / 2;
    const cy = n.y! + n.h! / 2;
    const dx = tx - cx;
    const dy = ty - cy;
    const t = Math.min(
      (n.w! / 2 + 5) / Math.max(Math.abs(dx), 1e-9),
      (n.h! / 2 + 5) / Math.max(Math.abs(dy), 1e-9)
    );
    return { x: cx + dx * t, y: cy + dy * t };
  }

  // edges: curved arrows bowing left of travel (so a↔b pairs split apart),
  // arrowhead at the target, and a +/− badge at the curve's midpoint.
  edges.forEach((e) => {
    const a = nodes[e.from];
    const b = nodes[e.to];
    const acx = a.x! + a.w! / 2;
    const acy = a.y! + a.h! / 2;
    const bcx = b.x! + b.w! / 2;
    const bcy = b.y! + b.h! / 2;
    const dist = Math.max(Math.hypot(bcx - acx, bcy - acy), 1);
    const nx = -(bcy - acy) / dist;
    const ny = (bcx - acx) / dist;
    const bow = Math.min(48, dist * 0.18);
    const mx = (acx + bcx) / 2 + nx * bow;
    const my = (acy + bcy) / 2 + ny * bow;
    const p1 = borderPoint(a, mx, my);
    const p2 = borderPoint(b, mx, my);
    const g = svgEl(
      "g",
      { class: "cm-edge" + (e.sign === "-" ? " cm-neg" : "") },
      linkLayer
    );
    svgEl(
      "path",
      {
        class: "cm-line",
        d: `M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`,
        stroke: a.color,
        "stroke-width": 2,
      },
      g
    );
    const tl = Math.max(Math.hypot(p2.x - mx, p2.y - my), 1);
    const ux = (p2.x - mx) / tl;
    const uy = (p2.y - my) / tl;
    const bx = p2.x - ux * 9;
    const by = p2.y - uy * 9;
    svgEl(
      "polygon",
      {
        class: "cm-arrow",
        points: `${p2.x},${p2.y} ${bx - uy * 4.5},${by + ux * 4.5} ${bx + uy * 4.5},${by - ux * 4.5}`,
        fill: a.color,
      },
      g
    );
    const qx = 0.25 * p1.x + 0.5 * mx + 0.25 * p2.x;
    const qy = 0.25 * p1.y + 0.5 * my + 0.25 * p2.y;
    svgEl("circle", { class: "cm-signbg", cx: qx, cy: qy, r: 8 }, g);
    svgEl("text", { class: "cm-sign", x: qx, y: qy + 3.5 }, g).textContent =
      e.sign === "-" ? "−" : "+";
    edgeEls.push({ el: g, from: e.from, to: e.to, key: e.from + "|" + e.to });
  });

  // nodes: rounded boxes, centred wrapped label, type-coloured border
  Object.values(nodes).forEach((n) => {
    const g = svgEl("g", { class: "mm-node" }, nodeLayer);
    svgEl(
      "rect",
      {
        class: "mm-box",
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        rx: 10,
        fill: "var(--background-secondary)",
        stroke: n.color,
      },
      g
    );
    const lines = wrap(n.label, n.w! - 28, 11.5, 3);
    const lh = 16;
    let ty = n.y! + n.h! / 2 - ((lines.length - 1) * lh) / 2 + 4;
    lines.forEach((t) => {
      svgEl(
        "text",
        { class: "mm-t1 cm-t", x: n.x! + n.w! / 2, y: ty, "font-size": 11.5 },
        g
      ).textContent = t;
      ty += lh;
    });
    if (lines.join(" ").length < n.label.replace(/\s+/g, " ").trim().length)
      svgEl("title", {}, g).textContent = n.label;
    g.addEventListener("mouseenter", () => {
      if (!searchTerm) highlightNode(n.id);
    });
    g.addEventListener("mouseleave", reapply);
    g.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openNode(n.id);
    });
    nodeEls[n.id] = g;
  });

  // ---- highlight modes: search > hovered/selected node > selected loop > clear ----
  function setClasses(
    hotEdges: Set<string> | null,
    keepNodes: Set<string> | null
  ) {
    edgeEls.forEach(({ el, key }) => {
      el.classList.toggle("mm-hot", !!hotEdges?.has(key));
      el.classList.toggle("mm-dim", !!hotEdges && !hotEdges.has(key));
    });
    Object.entries(nodeEls).forEach(([id, el]) => {
      el.classList.toggle("mm-dim", !!keepNodes && !keepNodes.has(id));
      el.classList.remove("mm-hit");
    });
  }
  function highlightNode(id: string) {
    const hot = new Set<string>();
    const keep = new Set([id]);
    edgeEls.forEach(({ from, to, key }) => {
      if (from !== id && to !== id) return;
      hot.add(key);
      keep.add(from);
      keep.add(to);
    });
    setClasses(hot, keep);
  }
  function highlightLoop(name: string) {
    const lp = loops.find((l) => l.name === name)!;
    setClasses(new Set(lp.edges), new Set(lp.nodes));
  }
  function applySearch() {
    Object.entries(nodeEls).forEach(([id, el]) => {
      const hit = causalSearchMatch(nodes[id], searchTerm);
      el.classList.toggle("mm-hit", hit);
      el.classList.toggle("mm-dim", !hit);
    });
    edgeEls.forEach(({ el }) => {
      el.classList.remove("mm-hot");
      el.classList.add("mm-dim");
    });
  }
  function reapply() {
    if (searchTerm) applySearch();
    else if (selected && nodeEls[selected]) highlightNode(selected);
    else if (selectedLoop) highlightLoop(selectedLoop);
    else setClasses(null, null);
  }

  // ---- note dialog (NoteModal reuse; the type plays the level badge) ----
  const causalRow = (
    id: string,
    sign: Sign,
    relation: "parent" | "child"
  ): LinkRow => ({
    id,
    title: (sign === "-" ? "− " : "+ ") + nodes[id].label,
    levelLabel: nodes[id].type || "variable",
    color: nodes[id].color,
    secondary: false,
    relation,
  });
  function openNode(id: string) {
    selected = id;
    reapply();
    const n = nodes[id];
    const mn: MNode = {
      id: n.id,
      levelIdx: 0,
      path: n.path,
      basename: n.basename,
      fm: n.fm,
      title: n.label,
      sub: "",
      meta: "",
      labels: [],
      labelColors: [],
      color: n.color,
      levelLabel: n.type || "variable",
      progress: null,
      bars: [],
      collIdx: 0,
      parents: new Set(edges.filter((e) => e.to === id).map((e) => e.from)),
      children: new Set(edges.filter((e) => e.from === id).map((e) => e.to)),
      primaryParent: null,
    };
    const rows: LinkRow[] = [
      ...edges
        .filter((e) => e.to === id)
        .map((e) => causalRow(e.from, e.sign, "parent")),
      ...edges
        .filter((e) => e.from === id)
        .map((e) => causalRow(e.to, e.sign, "child")),
    ];
    new NoteModal(
      app,
      mn,
      rows,
      fileByPath[n.path],
      openNode,
      (focusId) => {
        selected = focusId;
        reapply();
      },
      cfg.properties === true
    ).open();
  }

  // ---- pan / zoom / fit (same maths as the mindmap renderer) ----
  const apply = () =>
    rootG.setAttribute(
      "transform",
      `translate(${view.x},${view.y}) scale(${view.k})`
    );
  function fit() {
    const w = svg.clientWidth || wrapEl.clientWidth;
    const h = svg.clientHeight || 600;
    const barW = toolbar.classList.contains("mm-bar-collapsed")
      ? 0
      : toolbar.offsetWidth + 16;
    view.k =
      Math.min(
        (w - barW) / (contentRight + 40),
        h / (contentBottom + 40),
        1.4
      ) || 1;
    view.x = barW + 20;
    view.y = 8;
    apply();
  }

  // standalone .html export next to the note; same computed-style freeze as the mindmap
  function exportHtml() {
    const PAD = 24;
    const PROPS = [
      "fill",
      "stroke",
      "stroke-width",
      "stroke-dasharray",
      "opacity",
      "font-family",
      "font-size",
      "font-weight",
      "text-anchor",
      "letter-spacing",
      "filter",
    ];
    const box = (rootG as SVGGraphicsElement).getBBox();
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const live = svg.querySelectorAll<SVGElement>("*");
    const copies = clone.querySelectorAll<SVGElement>("*");
    live.forEach((el, i) => {
      const cs = getComputedStyle(el);
      copies[i].setAttribute(
        "style",
        PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";")
      );
    });
    clone.querySelector("g")?.removeAttribute("transform");
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute(
      "viewBox",
      `${box.x - PAD} ${box.y - PAD} ${box.width + PAD * 2} ${box.height + PAD * 2}`
    );
    clone.setAttribute("width", String(Math.ceil(box.width + PAD * 2)));
    clone.setAttribute("height", String(Math.ceil(box.height + PAD * 2)));
    const bg = getComputedStyle(wrapEl).backgroundColor || "#fff";
    const esc = (s: string) =>
      s.replace(/[<>&]/g, (c) =>
        c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"
      );
    const html =
      `<!doctype html><meta charset="utf-8"><title>${esc(cfg.title || "Causal map")}</title>` +
      `<body style="margin:0;background:${bg}">${clone.outerHTML}</body>`;
    const path = causalExportPath(ctx.sourcePath);
    void app.vault.adapter.write(path, html).then(
      () => new Notice("Exported to " + path),
      (e: unknown) =>
        new Notice(
          "Export failed: " + (e instanceof Error ? e.message : String(e))
        )
    );
  }

  let drag: { x: number; y: number } | null = null;
  stage.addEventListener("mousedown", (e) => {
    drag = { x: e.clientX - view.x, y: e.clientY - view.y };
    stage.classList.add("mm-drag");
  });
  plugin.registerDomEvent(activeWindow, "mousemove", (e: MouseEvent) => {
    if (drag) {
      view.x = e.clientX - drag.x;
      view.y = e.clientY - drag.y;
      apply();
    }
  });
  plugin.registerDomEvent(activeWindow, "mouseup", () => {
    drag = null;
    stage.classList.remove("mm-drag");
  });
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const step = Math.min(0.06, Math.abs(e.deltaY) * 0.0009);
      const f = e.deltaY < 0 ? 1 + step : 1 / (1 + step);
      const nk = Math.max(0.2, Math.min(3, view.k * f));
      const r = nk / view.k;
      const rect = stage.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      view.x = px - (px - view.x) * r;
      view.y = py - (py - view.y) * r;
      view.k = nk;
      apply();
    },
    { passive: false }
  );
  // background click clears the sticky node highlight (the loop selection stays)
  stage.addEventListener("click", () => {
    selected = null;
    reapply();
  });

  reapply();
  window.requestAnimationFrame(fit);
}
