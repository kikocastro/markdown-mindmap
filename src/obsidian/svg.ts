// SVG element helper shared by the renderer. Obsidian adapter only (touches the DOM).

const NS = "http://www.w3.org/2000/svg";

export const svgEl = (
  tag: string,
  attrs: Record<string, string | number | undefined>,
  parent: Element
): SVGElement => {
  const e = activeDocument.createElementNS(NS, tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v != null) e.setAttribute(k, String(v));
  }
  parent.appendChild(e);
  return e;
};
