import {
  App, Component, MarkdownPostProcessorContext, MarkdownRenderer,
  Modal, Plugin, TFile, parseYaml,
} from "obsidian";

// ============================================================================
// Notes Mindmap — render a leveled left->right tree from note frontmatter links.
// One ```mindmap code block = one map. Config is inline YAML (see README).
// Logic ported from strategy/docs/d0-tree (template.html) and generalised.
// ============================================================================

const NS = "http://www.w3.org/2000/svg";
// flatuicolors.com/palette/defo — the original Flat UI palette
const AUTO_COLORS = ["#1abc9c", "#3498db", "#9b59b6", "#e67e22", "#e74c3c", "#f1c40f", "#16a085", "#2980b9", "#8e44ad", "#d35400"];
// bar-chart category -> colour, with a sensible default for client/prospect/trial
const CATEGORY_COLORS: Record<string, string> = { client: "#2ecc71", prospect: "#f39c12", trial: "#3498db", customer: "#2ecc71", prospect_: "#f39c12" };

// layout constants
const CARD_W = 270, NODE_H = 80, V_GAP = 12, COL_GAP = 150, TOP = 64;

interface CardCfg { title?: string; sub?: string; meta?: string[]; progress?: string; bars?: string; }
interface LevelCfg { id: string; label?: string; from: string; color?: string; card?: CardCfg; where?: Record<string, any>; }
interface EdgeCfg { from: string; to: string; via: string; reverse?: boolean; secondary?: boolean; }
interface MapCfg { title?: string; height?: number; levels: LevelCfg[]; edges?: EdgeCfg[]; filter?: string[]; }

interface MNode {
  id: string;          // file path (unique key)
  levelIdx: number;
  file: TFile;
  fm: Record<string, any>;
  title: string;
  sub: string;
  meta: string;
  color: string;
  levelLabel: string;
  progress: number | null;       // 0-100, or null
  bars: [string, number][];      // category -> count
  collIdx: number;     // order within its source folder (layout tiebreak)
  parents: Set<string>;
  children: Set<string>;
  primaryParent: string | null;  // the one solid parent (secondary links don't set this)
  x?: number; y?: number; w?: number; h?: number;
}

export default class NotesMindmapPlugin extends Plugin {
  async onload() {
    this.registerMarkdownCodeBlockProcessor("mindmap", (source, el, ctx) => {
      try {
        renderMindmap(this.app, this, source, el, ctx);
      } catch (e) {
        el.createEl("pre", { text: "Notes Mindmap error:\n" + (e?.message || String(e)) });
      }
    });
  }
}

// ---- helpers -------------------------------------------------------------

const svgEl = (tag: string, attrs: Record<string, any>, parent: Element): SVGElement => {
  const e = document.createElementNS(NS, tag) as SVGElement;
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent.appendChild(e);
  return e;
};

const inFolder = (file: TFile, folder: string): boolean => {
  const f = folder.replace(/^\/+|\/+$/g, "");
  return f === "" ? true : file.path === `${f}/${file.name}` || file.path.startsWith(`${f}/`);
};

// "[[Note|alias]]" / "[[Note#hd]]" / "Title" -> the lookup key (Note / Title)
const linkKey = (raw: any): string => {
  const s = String(raw ?? "").trim();
  const m = s.match(/\[\[([^\]|#]+)/);
  return (m ? m[1] : s).trim();
};

const asArray = (v: any): any[] => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);

const wrap = (s: string, width: number, size: number, max: number): string[] => {
  const cpl = Math.max(8, Math.floor(width / (size * 0.55)));
  const words = String(s).split(/\s+/), out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > cpl) { out.push(cur); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out.slice(0, max);
};

// dotted access so `via`/card fields can reach nested frontmatter (e.g. customFields.serves)
const getPath = (fm: Record<string, any>, key?: string): any => {
  if (!fm || !key) return undefined;
  if (key.indexOf(".") < 0) return fm[key];
  return key.split(".").reduce((o: any, k) => (o == null ? o : o[k]), fm);
};

const fieldStr = (fm: Record<string, any>, key?: string): string =>
  key ? asArray(getPath(fm, key)).map(linkKey).join(", ") : "";

const fieldArr = (fm: Record<string, any>, key?: string): string[] =>
  key ? asArray(getPath(fm, key)).map(linkKey).filter(Boolean) : [];

// per-level include filter, e.g. { parentId: null } keeps only top-level roadmap tasks
const matchesWhere = (fm: Record<string, any>, where?: Record<string, any>): boolean =>
  !where || Object.keys(where).every((k) =>
    where[k] === null ? getPath(fm, k) == null : fieldStr(fm, k) === String(where[k]));

// list field -> [category, count]; category = text in trailing parens, else the value itself
const countByCat = (fm: Record<string, any>, key?: string): [string, number][] => {
  if (!key) return [];
  const counts: Record<string, number> = {};
  asArray(getPath(fm, key)).forEach((raw) => {
    const s = String(raw).trim();
    if (!s) return;
    const m = s.match(/\(([^)]+)\)\s*$/);
    const cat = (m ? m[1] : s).trim().toLowerCase();
    counts[cat] = (counts[cat] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const num = (v: any): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
};

const catColor = (cat: string, i: number): string => CATEGORY_COLORS[cat] || AUTO_COLORS[i % AUTO_COLORS.length];

// ---- core ----------------------------------------------------------------

function renderMindmap(app: App, plugin: Plugin, source: string, host: HTMLElement, ctx: MarkdownPostProcessorContext) {
  const cfg = parseYaml(source) as MapCfg;
  if (!cfg || !Array.isArray(cfg.levels) || !cfg.levels.length)
    throw new Error("config needs a non-empty `levels:` list.");

  // 1) collect nodes per level
  const nodes: Record<string, MNode> = {};
  const byLevel: MNode[][] = cfg.levels.map(() => []);
  cfg.levels.forEach((lvl, li) => {
    const color = lvl.color || AUTO_COLORS[li % AUTO_COLORS.length];
    const files = app.vault.getMarkdownFiles().filter((f) => inFolder(f, lvl.from)).sort((a, b) => a.path.localeCompare(b.path));
    files.forEach((file, ci) => {
      if (nodes[file.path]) return; // a note appears in its first matching level only
      const fm = app.metadataCache.getFileCache(file)?.frontmatter || {};
      if (!matchesWhere(fm, lvl.where)) return; // per-level frontmatter filter (e.g. {parentId: null})
      const card = lvl.card || {};
      const n: MNode = {
        id: file.path, levelIdx: li, file, fm, color, collIdx: ci,
        levelLabel: lvl.label || lvl.id,
        title: fieldStr(fm, card.title) || file.basename,
        sub: fieldStr(fm, card.sub),
        meta: (card.meta || []).map((k) => fieldStr(fm, k)).filter(Boolean).join("  ·  "),
        progress: num(getPath(fm, card.progress)),
        bars: countByCat(fm, card.bars),
        parents: new Set(), children: new Set(), primaryParent: null,
      };
      nodes[file.path] = n;
      byLevel[li].push(n);
    });
  });

  // index each level by basename and by `title` frontmatter for link resolution
  const levelIndex = byLevel.map((arr) => {
    const byBase: Record<string, string> = {}, byTitle: Record<string, string> = {};
    arr.forEach((n) => { byBase[n.file.basename] = n.id; if (n.fm.title) byTitle[String(n.fm.title).trim()] = n.id; });
    return { byBase, byTitle };
  });
  const levelByIdNum: Record<string, number> = {};
  cfg.levels.forEach((l, i) => (levelByIdNum[l.id] = i));

  // 2) build edges. edgeKind tracks whether a parent->child link is solid (primary) or dashed (secondary).
  const edgeKind = new Map<string, string>();
  const link = (parentId: string, childId: string, secondary?: boolean) => {
    if (!nodes[parentId] || !nodes[childId] || parentId === childId) return;
    nodes[parentId].children.add(childId);
    nodes[childId].parents.add(parentId);
    const key = parentId + "|" + childId;
    if (!secondary) {
      edgeKind.set(key, "primary");
      if (!nodes[childId].primaryParent) nodes[childId].primaryParent = parentId;
    } else if (!edgeKind.has(key)) {
      edgeKind.set(key, "secondary");
    }
  };
  const resolveInLevel = (li: number, raw: any, sourcePath: string): string | null => {
    const key = linkKey(raw);
    const dest = app.metadataCache.getFirstLinkpathDest(key, sourcePath);
    if (dest && nodes[dest.path] && nodes[dest.path].levelIdx === li) return dest.path;
    return levelIndex[li].byBase[key] || levelIndex[li].byTitle[key] || null;
  };
  (cfg.edges || []).forEach((e) => {
    const fi = levelByIdNum[e.from], ti = levelByIdNum[e.to];
    if (fi == null || ti == null) return;
    if (!e.reverse) {
      // `via` is a property on the `to` notes pointing up to a `from` note
      byLevel[ti].forEach((to) => asArray(getPath(to.fm, e.via)).forEach((raw) => {
        const fromId = resolveInLevel(fi, raw, to.file.path);
        if (fromId) link(fromId, to.id, e.secondary);
      }));
    } else {
      // `via` is a property on the `from` notes pointing down to `to` notes
      byLevel[fi].forEach((from) => asArray(getPath(from.fm, e.via)).forEach((raw) => {
        const toId = resolveInLevel(ti, raw, from.file.path);
        if (toId) link(from.id, toId, e.secondary);
      }));
    }
  });
  const isSecondary = (p: string, c: string) => edgeKind.get(p + "|" + c) === "secondary";
  // primary children = the ones this node is the solid parent of (used for layout + collapse)
  const primKids = (id: string) => [...nodes[id].children].filter((c) => nodes[c].primaryParent === id);

  // ---- per-instance view state ----
  const collapsed = new Set<string>();
  const filters: Record<string, Set<string>> = {}; // prop -> selected values (empty = all)
  (cfg.filter || []).forEach((p) => (filters[p] = new Set()));
  let searchTerm = "";
  const view = { x: 20, y: 8, k: 1 };
  let selected: string | null = null;

  // ---- DOM scaffold ----
  host.empty();
  const wrapEl = host.createDiv({ cls: "mm-wrap" });
  if (cfg.height) wrapEl.style.height = cfg.height + "px";
  const toolbar = wrapEl.createDiv({ cls: "mm-toolbar" });
  if (cfg.title) toolbar.createSpan({ cls: "mm-title", text: cfg.title });

  // search box (Miro-style: highlights matching cards, dims the rest)
  const search = toolbar.createEl("input", { cls: "mm-search", attr: { type: "search", placeholder: "Search…" } });
  search.oninput = () => { searchTerm = search.value.trim().toLowerCase(); reapply(); };

  // multiselect filters: one toggle-chip group per property (OR within a group, AND across groups)
  (cfg.filter || []).forEach((prop) => {
    const values = Array.from(new Set(Object.values(nodes).flatMap((n) => fieldArr(n.fm, prop)))).sort();
    if (!values.length) return;
    const grp = toolbar.createDiv({ cls: "mm-fltgroup" });
    grp.createSpan({ cls: "mm-fltlabel", text: prop });
    values.forEach((v) => {
      const chip = grp.createEl("button", { cls: "mm-chip", text: v });
      chip.onclick = () => {
        if (filters[prop].has(v)) { filters[prop].delete(v); chip.removeClass("on"); }
        else { filters[prop].add(v); chip.addClass("on"); }
        draw(); fit();
      };
    });
  });

  const spacer = toolbar.createSpan({ cls: "mm-spacer" });
  const fsBtn = toolbar.createEl("button", { cls: "mm-icon", text: "⛶", attr: { title: "Fullscreen" } });
  fsBtn.onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else wrapEl.requestFullscreen(); };
  plugin.registerDomEvent(document, "fullscreenchange", () => requestAnimationFrame(fit));

  const resetBtn = toolbar.createEl("button", { text: "Reset" });
  resetBtn.onclick = () => {
    collapsed.clear(); selected = null; searchTerm = ""; search.value = "";
    (cfg.filter || []).forEach((p) => filters[p].clear());
    toolbar.querySelectorAll(".mm-chip.on").forEach((c: HTMLElement) => c.removeClass("on"));
    draw(); fit();
  };

  const stage = wrapEl.createDiv({ cls: "mm-stage" });
  const svg = svgEl("svg", {}, stage) as SVGSVGElement;
  const rootG = svgEl("g", {}, svg);

  // ---- visibility (filters + collapse) ----
  // a filter only constrains nodes that HAVE the property; multi-select is OR within a property
  const passesFilters = (n: MNode) =>
    (cfg.filter || []).every((p) => {
      const sel = filters[p]; if (!sel.size) return true;
      const own = fieldArr(n.fm, p); if (!own.length) return true;
      return own.some((v) => sel.has(v));
    });
  function computeVisible(): Set<string> {
    // roots of hiding: collapsed nodes (hide their primary subtree, keep self) and filtered-out nodes (hide self + subtree)
    const excluded = new Set<string>();
    Object.values(nodes).forEach((n) => { if (!passesFilters(n)) excluded.add(n.id); });
    const hidden = new Set<string>(excluded);
    [...collapsed, ...excluded].forEach((rid) => {
      const stack = [...primKids(rid)];
      while (stack.length) { const x = stack.pop()!; if (!hidden.has(x)) { hidden.add(x); stack.push(...primKids(x)); } }
    });
    const vis = new Set<string>();
    Object.values(nodes).forEach((n) => { if (!hidden.has(n.id)) vis.add(n.id); });
    return vis;
  }

  // ---- adjacency for hover-highlight (built from currently drawn edges) ----
  let upAdj: Record<string, Set<string>> = {}, dnAdj: Record<string, Set<string>> = {};
  let links: { el: SVGElement; a: string; b: string }[] = [];
  let nodeEls: Record<string, SVGElement> = {};

  function highlight(id: string) {
    const keep = new Set([id]);
    const walk = (adj: Record<string, Set<string>>, start: string) => {
      const q = [start];
      while (q.length) { const n = q.shift()!; (adj[n] ? [...adj[n]] : []).forEach((m) => { if (!keep.has(m)) { keep.add(m); q.push(m); } }); }
    };
    walk(upAdj, id); walk(dnAdj, id);
    links.forEach((lk) => { const hot = keep.has(lk.a) && keep.has(lk.b); lk.el.classList.toggle("mm-hot", hot); lk.el.classList.toggle("mm-dim", !hot); });
    Object.keys(nodeEls).forEach((n) => { nodeEls[n].classList.toggle("mm-dim", !keep.has(n)); nodeEls[n].classList.remove("mm-hit"); });
  }
  function applySearch() {
    Object.keys(nodeEls).forEach((id) => {
      const n = nodes[id];
      const hit = (n.title + " " + n.sub + " " + n.meta).toLowerCase().includes(searchTerm);
      nodeEls[id].classList.toggle("mm-hit", hit);
      nodeEls[id].classList.toggle("mm-dim", !hit);
    });
    links.forEach((lk) => { lk.el.classList.remove("mm-hot"); lk.el.classList.add("mm-dim"); });
  }
  function clearHi() {
    links.forEach((lk) => lk.el.classList.remove("mm-hot", "mm-dim"));
    Object.values(nodeEls).forEach((g) => g.classList.remove("mm-dim", "mm-hit"));
  }
  // sticky overlay after any redraw / on mouseleave: search wins, then a selected node, else clear
  function reapply() {
    if (searchTerm) applySearch();
    else if (selected && nodeEls[selected]) highlight(selected);
    else clearHi();
  }

  // ---- layout + draw (re-runnable) ----
  let contentBottom = TOP, contentRight = 0;
  function draw() {
    while (rootG.firstChild) rootG.removeChild(rootG.firstChild);
    links = []; nodeEls = {}; upAdj = {}; dnAdj = {};

    const vis = computeVisible();
    const visN = (id: string) => vis.has(id);
    const levelX = cfg.levels.map((_, i) => 40 + i * (CARD_W + COL_GAP));

    // order nodes within each level via DFS along primary parents, so siblings stay contiguous
    const order: string[][] = cfg.levels.map(() => []);
    const seen = new Set<string>();
    const childrenSorted = (n: MNode) => primKids(n.id).filter(visN).map((id) => nodes[id]).sort((a, b) => a.collIdx - b.collIdx);
    const dfs = (n: MNode) => {
      if (seen.has(n.id)) return; seen.add(n.id);
      order[n.levelIdx].push(n.id);
      childrenSorted(n).forEach(dfs);
    };
    byLevel[0].filter((n) => visN(n.id)).forEach(dfs);
    // any visible node not reached from a root (parent filtered/collapsed/secondary-only) — append to its level
    cfg.levels.forEach((_, li) => byLevel[li].forEach((n) => { if (visN(n.id) && !seen.has(n.id)) { seen.add(n.id); order[li].push(n.id); } }));

    // place right->left so a parent centres on its visible *primary* children
    const cursor = cfg.levels.map(() => TOP);
    for (let li = cfg.levels.length - 1; li >= 0; li--) {
      for (const id of order[li]) {
        const n = nodes[id];
        const kids = primKids(id).filter((c) => visN(c) && nodes[c].levelIdx === li + 1).map((c) => nodes[c]);
        n.w = CARD_W; n.h = NODE_H; n.x = levelX[li];
        if (kids.length) {
          const top = Math.min(...kids.map((k) => k.y!)), bot = Math.max(...kids.map((k) => k.y! + k.h!));
          n.y = Math.max(cursor[li], (top + bot) / 2 - NODE_H / 2);
        } else n.y = cursor[li];
        cursor[li] = n.y + NODE_H + V_GAP;
      }
    }
    contentBottom = Math.max(TOP, ...cfg.levels.map((_, li) => cursor[li]));
    contentRight = levelX[cfg.levels.length - 1] + CARD_W;

    const linkLayer = svgEl("g", {}, rootG), nodeLayer = svgEl("g", {}, rootG);

    // column headers
    cfg.levels.forEach((lvl, li) => {
      if (lvl.label) svgEl("text", { class: "mm-colhead", x: levelX[li], y: 36 }, rootG).textContent = lvl.label;
    });

    // edges (parent right-mid -> child left-mid); secondary links draw dashed + fainter
    Object.values(nodes).forEach((p) => {
      if (!visN(p.id)) return;
      [...p.children].filter(visN).forEach((cid) => {
        const c = nodes[cid];
        const sec = isSecondary(p.id, cid);
        const x1 = p.x! + p.w!, y1 = p.y! + p.h! / 2, x2 = c.x!, y2 = c.y! + c.h! / 2, mx = (x1 + x2) / 2;
        const path = svgEl("path", { class: "mm-link" + (sec ? " mm-also" : ""), d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, stroke: p.color, "stroke-width": 2.5 }, linkLayer);
        links.push({ el: path, a: p.id, b: c.id });
        (dnAdj[p.id] = dnAdj[p.id] || new Set()).add(c.id);
        (upAdj[c.id] = upAdj[c.id] || new Set()).add(p.id);
      });
    });

    // nodes
    cfg.levels.forEach((_, li) => order[li].forEach((id) => {
      const n = nodes[id];
      const hasKids = n.children.size > 0;
      const hasBar = n.progress != null || n.bars.length > 0;
      const g = svgEl("g", { class: "mm-node" }, nodeLayer);
      svgEl("rect", { class: "mm-box", x: n.x, y: n.y, width: n.w, height: n.h, rx: 9, fill: "var(--background-secondary)", stroke: n.color }, g);

      // text block: top-aligned when a bar reserves the lower strip, else vertically centred
      const padR = hasKids ? 42 : 16;
      const lines: { t: string; cls: string; size: number; lh: number }[] = [];
      wrap(n.title, n.w! - 14 - padR, 12, 2).forEach((t) => lines.push({ t, cls: "mm-t1", size: 12, lh: 16 }));
      if (n.sub) lines.push({ t: n.sub.length > 46 ? n.sub.slice(0, 45) + "…" : n.sub, cls: "mm-t2", size: 10.5, lh: 15 });
      if (n.meta) lines.push({ t: n.meta, cls: "mm-meta", size: 9.5, lh: 14 });
      const totalH = lines.reduce((s, b) => s + b.lh, 0);
      const slot = hasBar ? n.h! - 18 : n.h!;
      let ty = n.y! + (hasBar ? 18 : (slot - totalH) / 2 + (lines[0]?.size || 12));
      if (!hasBar) ty = n.y! + (n.h! - totalH) / 2 + (lines[0]?.size || 12);
      lines.forEach((b) => { svgEl("text", { class: b.cls, x: n.x! + 14, y: ty, "font-size": b.size }, g).textContent = b.t; ty += b.lh; });

      // bottom strip: progress bar and/or category bar chart
      if (hasBar) drawBar(g, n);

      // collapse toggle in the top-right corner (clear of the right-edge link connector)
      if (hasKids) {
        const cx = n.x! + n.w! - 16, cy = n.y! + 15, isC = collapsed.has(n.id);
        const tg = svgEl("g", { class: "mm-toggle" }, g);
        svgEl("circle", { cx, cy, r: 8 }, tg);
        svgEl("text", { x: cx, y: cy + 4 }, tg).textContent = isC ? "+" : "−";
        tg.addEventListener("click", (ev) => { ev.stopPropagation(); if (isC) collapsed.delete(n.id); else collapsed.add(n.id); draw(); });
      }

      g.addEventListener("mouseenter", () => { if (!searchTerm) highlight(n.id); });
      g.addEventListener("mouseleave", reapply);
      g.addEventListener("click", (ev) => { ev.stopPropagation(); selected = n.id; new NoteModal(app, plugin, n).open(); });
      nodeEls[n.id] = g;
    }));

    apply();
    reapply();
  }

  // progress bar (0-100) and/or stacked category bar, pinned to the card's lower strip
  function drawBar(g: SVGElement, n: MNode) {
    const x = n.x! + 14, w = n.w! - 28, y = n.y! + n.h! - 14;
    if (n.progress != null) {
      const p = Math.max(0, Math.min(100, n.progress));
      svgEl("rect", { class: "mm-track", x, y, width: w, height: 6, rx: 3 }, g);
      svgEl("rect", { x, y, width: (w * p) / 100, height: 6, rx: 3, fill: n.color }, g);
      svgEl("text", { class: "mm-barlbl", x: x + w, y: y - 3, "text-anchor": "end" }, g).textContent = p + "%";
    } else if (n.bars.length) {
      const total = n.bars.reduce((s, [, c]) => s + c, 0) || 1;
      let bx = x;
      n.bars.forEach(([cat, c], i) => {
        const seg = (w * c) / total;
        const r = svgEl("rect", { x: bx, y, width: Math.max(0, seg - 1.5), height: 7, rx: 2, fill: catColor(cat, i) }, g);
        svgEl("title", {}, r).textContent = `${c} ${cat}`;
        bx += seg;
      });
      svgEl("text", { class: "mm-barlbl", x: x + w, y: y - 3, "text-anchor": "end" }, g).textContent = String(total);
    }
  }

  // ---- pan / zoom / fit ----
  const apply = () => rootG.setAttribute("transform", `translate(${view.x},${view.y}) scale(${view.k})`);
  function fit() {
    const w = svg.clientWidth || wrapEl.clientWidth, h = svg.clientHeight || 600;
    view.k = Math.min(w / (contentRight + 40), h / (contentBottom + 40), 1.4) || 1;
    view.x = 20; view.y = 8; apply();
  }
  let drag: { x: number; y: number } | null = null;
  stage.addEventListener("mousedown", (e) => { drag = { x: e.clientX - view.x, y: e.clientY - view.y }; stage.classList.add("mm-drag"); });
  plugin.registerDomEvent(window, "mousemove", (e: MouseEvent) => { if (drag) { view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; apply(); } });
  plugin.registerDomEvent(window, "mouseup", () => { drag = null; stage.classList.remove("mm-drag"); });
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const step = Math.min(0.06, Math.abs(e.deltaY) * 0.0009), f = e.deltaY < 0 ? 1 + step : 1 / (1 + step);
    const nk = Math.max(0.2, Math.min(3, view.k * f)), r = nk / view.k;
    const rect = stage.getBoundingClientRect(), px = e.clientX - rect.left, py = e.clientY - rect.top;
    view.x = px - (px - view.x) * r; view.y = py - (py - view.y) * r; view.k = nk; apply();
  }, { passive: false });
  stage.addEventListener("click", () => { selected = null; reapply(); });

  draw();
  // first fit after the element has real dimensions
  requestAnimationFrame(fit);
}

// ---- note dialog ---------------------------------------------------------

class NoteModal extends Modal {
  private comp = new Component();
  constructor(app: App, private plugin: Plugin, private node: MNode) { super(app); }

  async onOpen() {
    this.comp.load();
    const { contentEl, modalEl } = this;
    modalEl.addClass("mm-modal");
    contentEl.empty();
    const n = this.node;

    // header: title, level badge, sub/meta, progress/demand breakdown
    const head = contentEl.createDiv({ cls: "mm-note-head" });
    head.style.setProperty("--mm-accent", n.color);
    const badges = head.createDiv({ cls: "mm-note-badges" });
    badges.createSpan({ cls: "mm-badge", text: n.levelLabel });
    if (n.progress != null) badges.createSpan({ cls: "mm-badge", text: `progress ${Math.round(n.progress)}%` });
    head.createEl("h2", { cls: "mm-note-title", text: n.title });
    if (n.sub) head.createDiv({ cls: "mm-note-sub", text: n.sub });
    if (n.meta) head.createDiv({ cls: "mm-note-meta", text: n.meta });
    if (n.bars.length) {
      const br = head.createDiv({ cls: "mm-note-bars" });
      n.bars.forEach(([cat, c], i) => {
        const pill = br.createSpan({ cls: "mm-note-pill", text: `${c} ${cat}` });
        pill.style.setProperty("--mm-cat", catColor(cat, i));
      });
    }

    const open = head.createEl("button", { cls: "mm-note-open", text: "Open note ↗" });
    open.onclick = () => { this.app.workspace.getLeaf("tab").openFile(n.file); this.close(); };

    const body = contentEl.createDiv({ cls: "mm-note markdown-rendered" });
    const content = await this.app.vault.cachedRead(n.file);
    await MarkdownRenderer.render(this.app, content, body, n.file.path, this.comp);
  }
  onClose() { this.comp.unload(); this.contentEl.empty(); }
}
