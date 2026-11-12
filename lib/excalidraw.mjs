/* ============================================================
   Excalidraw → static SVG.

   Obsidian's Excalidraw plugin stores drawings either as a plain
   `.excalidraw` JSON file or as a `.excalidraw.md` note containing
   uncompressed JSON or a `compressed-json` block. This renderer
   covers the shapes, arrows, freedraw strokes, text and embedded
   images that make up normal drawings, without pulling the full
   Excalidraw editor into the studio.
   ============================================================ */

import LZString from "lz-string";
import { escapeHtml, escapeAttr } from "./html.mjs";

const FONT_FAMILIES = {
  1: '"Virgil", "Comic Sans MS", "Segoe Print", cursive',
  2: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  3: '"Cascadia Code", "JetBrains Mono", ui-monospace, monospace',
};

const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z]+)$/i;
let drawingId = 0;

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const safeColor = (value, fallback = "#1e1e1e") => {
  const text = String(value || "").trim();
  if (!text || text === "transparent") return text === "transparent" ? "none" : fallback;
  return SAFE_COLOR.test(text) ? text : fallback;
};
const dashFor = (style) => (style === "dashed" ? ' stroke-dasharray="9 7"' : style === "dotted" ? ' stroke-dasharray="2 5"' : "");
const opacityFor = (element) => {
  const value = num(element?.opacity, 100);
  return Math.max(0, Math.min(100, value)) / 100;
};
const rotationFor = (element, cx, cy) => {
  const angle = num(element?.angle, 0);
  return angle ? ` transform="rotate(${(angle * 180) / Math.PI} ${cx} ${cy})"` : "";
};

function pointBounds(points, x, y) {
  if (!Array.isArray(points) || !points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Array.isArray(point)) continue;
    const px = x + num(point[0]);
    const py = y + num(point[1]);
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function elementBounds(element) {
  const x = num(element.x);
  const y = num(element.y);
  const points = pointBounds(element.points, x, y);
  if (points && (element.type === "line" || element.type === "arrow" || element.type === "freedraw")) return points;
  const w = Math.max(1, num(element.width, 1));
  const h = Math.max(1, num(element.height, 1));
  return { minX: x, minY: y, maxX: x + w, maxY: y + h };
}

function renderText(element) {
  const text = String(element.text ?? "");
  if (!text) return "";
  const fontSize = Math.max(4, num(element.fontSize, 20));
  const lineHeight = Math.max(0.8, num(element.lineHeight, 1.25));
  const lines = text.split(/\r?\n/);
  const x = num(element.x);
  const y = num(element.y);
  const width = Math.max(1, num(element.width, 0));
  const height = Math.max(1, num(element.height, lines.length * fontSize * lineHeight));
  const align = String(element.textAlign || "left");
  const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
  const textX = align === "center" ? x + width / 2 : align === "right" ? x + width : x;
  const vertical = String(element.verticalAlign || "top");
  const blockHeight = lines.length * fontSize * lineHeight;
  const top = vertical === "middle" ? y + (height - blockHeight) / 2 : vertical === "bottom" ? y + height - blockHeight : y;
  const baseline = top + fontSize * 0.82;
  const font = FONT_FAMILIES[Number(element.fontFamily)] || FONT_FAMILIES[1];
  const color = safeColor(element.strokeColor, "#1e1e1e");
  const tspans = lines
    .map((line, index) => `<tspan x="${textX}" y="${baseline + index * fontSize * lineHeight}">${escapeHtml(line)}</tspan>`)
    .join("");
  return `<text class="ex-text" fill="${escapeAttr(color)}" font-family="${escapeAttr(font)}" font-size="${fontSize}" text-anchor="${anchor}" opacity="${opacityFor(element)}"${rotationFor(element, x + width / 2, y + height / 2)}>${tspans}</text>`;
}

function renderElement(element, scene, markerId) {
  const type = String(element.type || "");
  const x = num(element.x);
  const y = num(element.y);
  const width = Math.max(1, num(element.width, 1));
  const height = Math.max(1, num(element.height, 1));
  const cx = x + width / 2;
  const cy = y + height / 2;
  const stroke = safeColor(element.strokeColor, "#1e1e1e");
  const fill = safeColor(element.backgroundColor, "none");
  const fillOpacity = fill === "none" ? 0 : element.fillStyle === "solid" ? 1 : 0.18;
  const common = `stroke="${escapeAttr(stroke)}" stroke-width="${Math.max(0.5, num(element.strokeWidth, 2))}"${dashFor(element.strokeStyle)} opacity="${opacityFor(element)}"${rotationFor(element, cx, cy)}`;
  const dashFill = `fill="${escapeAttr(fill)}" fill-opacity="${fillOpacity}"`;

  if (type === "rectangle" || type === "frame") {
    const radius = type === "rectangle" && element.roundness ? Math.min(width, height) * 0.12 : 0;
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" ${dashFill} ${common}></rect>`;
  }
  if (type === "ellipse") {
    return `<ellipse cx="${cx}" cy="${cy}" rx="${width / 2}" ry="${height / 2}" ${dashFill} ${common}></ellipse>`;
  }
  if (type === "diamond") {
    const points = `${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`;
    return `<polygon points="${points}" ${dashFill} ${common}></polygon>`;
  }
  if (type === "line" || type === "arrow" || type === "freedraw") {
    const points = (Array.isArray(element.points) ? element.points : [])
      .filter((point) => Array.isArray(point))
      .map((point) => `${x + num(point[0])},${y + num(point[1])}`)
      .join(" ");
    if (!points) return "";
    const markerStart = type === "arrow" && element.startArrowhead ? ` marker-start="url(#${markerId})"` : "";
    const markerEnd = type === "arrow" && element.endArrowhead ? ` marker-end="url(#${markerId})"` : "";
    return `<polyline points="${points}" fill="none" stroke="${escapeAttr(stroke)}" stroke-width="${Math.max(0.5, num(element.strokeWidth, 2))}" stroke-linecap="round" stroke-linejoin="round"${dashFor(element.strokeStyle)}${markerStart}${markerEnd} opacity="${opacityFor(element)}"></polyline>`;
  }
  if (type === "text") return renderText(element);
  if (type === "image") {
    const file = scene.files?.[element.fileId] || scene.files?.[element.fileId?.toString?.()];
    const dataURL = String(typeof file === "string" ? file : file?.dataURL || "");
    const href = /^data:image\//i.test(dataURL) ? dataURL : /^https?:\/\//i.test(dataURL) ? dataURL : "";
    if (!href) return "";
    const label = escapeAttr(element.altText || element.fileId || "Drawing image");
    return `<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escapeAttr(href)}" preserveAspectRatio="xMidYMid meet" opacity="${opacityFor(element)}"${rotationFor(element, cx, cy)} aria-label="${label}"></image>`;
  }
  return "";
}

/** Pull an Excalidraw scene out of a .excalidraw or .excalidraw.md file. */
export function extractExcalidrawScene(text) {
  const source = String(text || "").trim();
  if (!source) return null;

  if (source.startsWith("{")) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed?.elements)) return parsed;
    } catch {}
  }

  const blocks = [...source.matchAll(/```(compressed-json|json)\s*\n([\s\S]*?)```/gi)];
  for (const [, language, body] of blocks) {
    const raw = body.trim();
    if (!raw) continue;

    if (language.toLowerCase() === "json") {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.elements)) return parsed;
      } catch {}
    }

    let decoded = "";
    try {
      decoded = LZString.decompressFromBase64(raw) || LZString.decompressFromUTF16(raw) || "";
    } catch {}
    if (!decoded) {
      try {
        decoded = LZString.decompressFromBase64(decodeURIComponent(raw)) || "";
      } catch {}
    }
    if (decoded) {
      try {
        const parsed = JSON.parse(decoded);
        if (Array.isArray(parsed?.elements)) return parsed;
      } catch {}
    }
  }

  return null;
}

/**
 * Render an Excalidraw scene to static SVG.
 * @param {object} scene
 * @param {{label?: string}} [opts]
 */
export function renderExcalidrawScene(scene, opts = {}) {
  const elements = (Array.isArray(scene?.elements) ? scene.elements : [])
    .filter((element) => element && !element.isDeleted && String(element.type || "").trim())
    .slice(0, 4000);
  if (!elements.length) return `<div class="obsidian-embed obsidian-missing">This Excalidraw drawing is empty.</div>`;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    const bounds = elementBounds(element);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return `<div class="obsidian-embed obsidian-missing">This Excalidraw drawing is empty.</div>`;
  }

  const pad = 28;
  const width = Math.max(40, maxX - minX + pad * 2);
  const height = Math.max(40, maxY - minY + pad * 2);
  const id = `drawing-${++drawingId}`;
  const markerId = `${id}-arrow`;
  const body = elements.map((element) => renderElement(element, scene, markerId)).join("\n      ");
  const label = escapeAttr(opts.label || "Excalidraw drawing");

  return `<div class="obsidian-embed obsidian-drawing">
  <svg class="obsidian-excalidraw" viewBox="${minX - pad} ${minY - pad} ${width} ${height}" role="img" aria-label="${label}">
    <defs>
      <marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"></path>
      </marker>
    </defs>
    ${body}
  </svg>
</div>`;
}
