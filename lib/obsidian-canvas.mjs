/* ============================================================
   Obsidian Canvas (.canvas) → read-only HTML.

   Canvas files are JSON: absolutely positioned text, files, links
   and groups, joined by edges. The studio is not a Canvas editor,
   so this renderer preserves the writer's layout at 100% zoom and
   lets the preview scroll when the canvas is larger than the pane.
   ============================================================ */

import path from "node:path";
import { escapeHtml, escapeAttr } from "./html.mjs";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".bmp", ".ico", ".tif", ".tiff"]);
const NOTE_EXT = new Set([".md", ".markdown", ".mdx"]);

const COLOR_CLASS = ["", "is-red", "is-orange", "is-yellow", "is-green", "is-cyan", "is-violet"];
const PAD = 36;
let canvasId = 0;

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const clampSize = (value, fallback) => Math.max(40, Math.min(10000, num(value, fallback)));

function fileTitle(entry) {
  const ext = path.posix.extname(entry.name);
  return path.posix.basename(entry.name, ext);
}

function nodeKind(entry) {
  if (!entry) return "missing";
  if (IMAGE_EXT.has(entry.ext)) return "image";
  if (NOTE_EXT.has(entry.ext)) return "note";
  if (entry.ext === ".canvas") return "canvas";
  if (entry.ext === ".excalidraw" || entry.lowerRel.endsWith(".excalidraw.md")) return "drawing";
  if (entry.ext === ".pdf") return "pdf";
  return "file";
}

function fileCard(entry, opts) {
  if (!entry) return `<div class="obsidian-canvas-missing">Missing file</div>`;
  const kind = nodeKind(entry);
  const src = opts.assetUrl(entry.rel);
  const label = escapeHtml(fileTitle(entry));

  if (kind === "image") {
    return `<img class="obsidian-canvas-image" src="${escapeAttr(src)}" alt="${label}" loading="lazy" decoding="async">`;
  }
  if (kind === "note") {
    return `<a class="obsidian-canvas-file" href="#" data-note-link="${escapeAttr(entry.rel)}">${label}</a>`;
  }
  const icon = kind === "canvas" ? "▦" : kind === "drawing" ? "✎" : kind === "pdf" ? "PDF" : "↗";
  /* Canvas and Excalidraw files are drawing payloads, not downloadable
     pages. Show their identity instead of linking to raw JSON. */
  if (kind === "canvas" || kind === "drawing") {
    return `<span class="obsidian-canvas-file" title="${escapeAttr(entry.rel)}">
      <span class="obsidian-canvas-file-icon" aria-hidden="true">${icon}</span>
      <span>${label}</span>
    </span>`;
  }
  return `<a class="obsidian-canvas-file" href="${escapeAttr(src)}" target="_blank" rel="noopener noreferrer">
    <span class="obsidian-canvas-file-icon" aria-hidden="true">${icon}</span>
    <span>${label}</span>
  </a>`;
}

function linkCard(node) {
  const raw = String(node.url || "").trim();
  let href = "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") href = parsed.href;
  } catch {}
  const title = String(node.label || "").trim() || (href ? new URL(href).hostname : raw);
  if (!href) return `<div class="obsidian-canvas-link"><span>${escapeHtml(title)}</span></div>`;
  return `<a class="obsidian-canvas-link" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer">
    <span>${escapeHtml(title)}</span>
    <small>${escapeHtml(href)}</small>
  </a>`;
}

function edgePoint(node, side) {
  const x = num(node.x);
  const y = num(node.y);
  const w = clampSize(node.width, 240);
  const h = clampSize(node.height, 120);
  switch (side) {
    case "top":
      return [x + w / 2, y];
    case "left":
      return [x, y + h / 2];
    case "bottom":
      return [x + w / 2, y + h];
    default:
      return [x + w, y + h / 2];
  }
}

function renderEdges(edges, nodesById, offsetX, offsetY, markerId) {
  const drawn = [];
  for (const edge of edges) {
    const from = nodesById.get(edge.fromNode);
    const to = nodesById.get(edge.toNode);
    if (!from || !to) continue;
    const [x1, y1] = edgePoint(from, edge.fromSide).map((n, i) => n + (i ? offsetY : offsetX));
    const [x2, y2] = edgePoint(to, edge.toSide).map((n, i) => n + (i ? offsetY : offsetX));
    const color = COLOR_CLASS[Number(edge.color)] ? ` canvas-edge-${Number(edge.color)}` : "";
    /* Canvas edges point by default; only an explicit "none" removes it. */
    const arrowStart = edge.fromEnd === "arrow" ? ` marker-start="url(#${markerId})"` : "";
    const arrowEnd = edge.toEnd === "none" ? "" : ` marker-end="url(#${markerId})"`;
    drawn.push(`<line class="canvas-edge${color}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${arrowStart}${arrowEnd}></line>`);
    const label = String(edge.label || "").trim();
    if (label) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      drawn.push(`<text class="canvas-edge-label" x="${mx}" y="${my}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(label)}</text>`);
    }
  }
  return drawn.join("");
}

/**
 * Render a .canvas file body.
 *
 * @param {string} text
 * @param {{
 *   resolve: (target: string) => {entry: object|null},
 *   assetUrl: (rel: string) => string,
 *   renderMarkdown: (markdown: string) => Promise<string>,
 * }} opts
 */
export async function renderObsidianCanvas(text, opts) {
  let data;
  try {
    data = JSON.parse(String(text || ""));
  } catch {
    return `<div class="obsidian-embed obsidian-missing">This Canvas file could not be read.</div>`;
  }

  const nodes = (Array.isArray(data?.nodes) ? data.nodes : [])
    .filter((node) => node && typeof node === "object" && String(node.id || "").trim())
    .slice(0, 600);
  if (!nodes.length) {
    return `<div class="obsidian-embed obsidian-missing">This Canvas is empty.</div>`;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const x = num(node.x);
    const y = num(node.y);
    const w = clampSize(node.width, node.type === "group" ? 400 : 240);
    const h = clampSize(node.height, node.type === "group" ? 300 : 120);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  const width = Math.max(200, maxX - minX + PAD * 2);
  const height = Math.max(120, maxY - minY + PAD * 2);
  const offsetX = PAD - minX;
  const offsetY = PAD - minY;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges = Array.isArray(data?.edges) ? data.edges.slice(0, 1200) : [];
  const id = `canvas-${++canvasId}`;
  const markerId = `${id}-arrow`;
  const edgeHtml = renderEdges(edges, nodesById, offsetX, offsetY, markerId);

  const cards = [];
  for (const node of nodes) {
    const x = num(node.x) + offsetX;
    const y = num(node.y) + offsetY;
    const w = clampSize(node.width, node.type === "group" ? 400 : 240);
    const h = clampSize(node.height, node.type === "group" ? 300 : 120);
    const color = COLOR_CLASS[Number(node.color)] || "";
    const style = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    const type = String(node.type || "text");
    let inner = "";

    if (type === "group") {
      inner = `<div class="canvas-group-label">${escapeHtml(node.label || "Group")}</div>`;
    } else if (type === "file") {
      const resolved = opts.resolve(String(node.file || ""));
      inner = fileCard(resolved?.entry, opts);
    } else if (type === "link") {
      inner = linkCard(node);
    } else {
      const markdown = String(node.text || "");
      inner = markdown
        ? `<div class="canvas-text">${await opts.renderMarkdown(markdown)}</div>`
        : `<div class="obsidian-canvas-empty">Empty card</div>`;
    }

    cards.push(
      `<div class="obsidian-canvas-node canvas-${escapeAttr(type)} ${color}" style="${style}">${inner}</div>`
    );
  }

  return `<div class="obsidian-embed obsidian-canvas" data-canvas="${id}">
  <div class="obsidian-canvas-stage" style="width:${Math.ceil(width)}px;height:${Math.ceil(height)}px">
    <svg class="obsidian-canvas-edges" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" aria-hidden="true">
      <defs>
        <marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"></path>
        </marker>
      </defs>
      ${edgeHtml}
    </svg>
    ${cards.join("\n    ")}
  </div>
</div>`;
}
