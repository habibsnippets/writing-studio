/* ============================================================
   Diagram canvas for the writing studio.

   A deliberately small, dependency-free drawing surface in the
   spirit of Excalidraw: basic geometry, text, selection, resize,
   styling, undo, pan/zoom, and a screenshot-style export that
   saves a PNG into the post's asset folder.

   The scene is kept in localStorage per post slug. The PNG is
   the artifact that goes into the article; the editable scene
   stays in the browser so you can come back and change it.
   ============================================================ */

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const GRID = 24;
const HANDLE = 8;
const STORE_PREFIX = "writing-studio:canvas:";
const IMAGE_DB_NAME = "writing-studio";
const IMAGE_DB_STORE = "images";
const IMAGE_DB_PREFIX = "idb:";
const PDF_JS_ROOT = "/node_modules/pdfjs-dist/";
const PDF_MAX_PAGES = 20;
/* PDF pages are shown at up to 660 CSS px wide. Render them at 4x that
   width so the page stays crisp on Retina screens, at 200% canvas zoom,
   and in 2x exports. The edge cap keeps unusual poster-sized pages from
   allocating enormous canvases. */
const PDF_DISPLAY_WIDTH = 660;
const PDF_RENDER_WIDTH = PDF_DISPLAY_WIDTH * 4;
const PDF_RENDER_MAX_EDGE = 4600;
const HIGHLIGHT_COLOR = "#ffe066";
const BINDABLE_TYPES = ["rect", "diamond", "ellipse", "image"];
/* Connection points are the four corners and the four edge midpoints,
   the same idea as Excalidraw's shape anchors. */
const BIND_ANCHORS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const ANCHOR_SNAP = 18;
const CORNER_ROUND_RATIO = 0.25;
const MAX_CORNER_RADIUS = 32;
/* Curved edges bow out from their straight chord. The bulge is derived
   from the two endpoints, so a curve needs no extra stored state. */
const CURVE_BOW = 0.22;
/* Connectors can be drawn three ways, like Excalidraw's line types:
   sharp keeps the points as they were drawn, curved smooths through
   them, and elbow turns every diagonal step into right angles — the
   routing system-design flowcharts are drawn with. */
const PATH_STYLES = ["sharp", "curved", "elbow"];
const ARROWHEADS = ["none", "arrow", "triangle", "bar", "dot"];
/* How far an elbowed connector leaves a shape before it turns, and how
   round the right-angle corners are. */
const ELBOW_STUB = 22;
const ELBOW_CORNER = 10;

const STROKE_COLORS = [
  "#1e1e1e", "#f3f3f6", "#5c5f66", "#e03131", "#2f9e44", "#1971c2",
  "#f08c00", "#6741d9", "#0c8599", "#c2255c",
];
const FILL_COLORS = [
  "#ffc9c9", "#b2f2bb", "#a5d8ff", "#ffec99",
  "#d0bfff", "#ffd8a8", "#ced4da", "#f8f9fa",
];

const FONTS = {
  sans: '"Satoshi", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  serif: 'Georgia, "Times New Roman", serif',
  hand: '"Virgil", "Comic Sans MS", "Segoe Print", cursive',
};

const TOOL_KEYS = {
  v: "select", h: "hand",
  r: "rect", d: "diamond", o: "ellipse",
  l: "line", a: "arrow", p: "pen", t: "text",
  x: "ai",
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const uid = () => `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const isNum = (n) => typeof n === "number" && Number.isFinite(n);

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Deterministic pseudo-random. Each element carries a seed, so a
   sketchy shape does not shimmer every time it is redrawn. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d");

const fontFor = (el) => FONTS[el.fontFamily] || FONTS.sans;
const fontSpec = (el) => `${el.fontSize}px ${fontFor(el)}`;
const lineHeight = (el) => el.fontSize * 1.25;

function wrapText(text, width, el) {
  measureCtx.font = fontSpec(el);
  const paragraphs = String(text ?? "").split("\n");
  /* Text has no fixed box: it grows with its content and only breaks
     where the writer pressed Enter. */
  if (!el.wrap) return paragraphs;
  const max = Math.max(16, width);
  const out = [];

  for (const paragraph of paragraphs) {
    if (!paragraph) { out.push(""); continue; }
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || measureCtx.measureText(next).width <= max) {
        line = next;
      } else {
        out.push(line);
        line = word;
      }
      /* A single long token (URL, identifier) still has to wrap. */
      while (line && measureCtx.measureText(line).width > max) {
        let cut = line.length - 1;
        while (cut > 1 && measureCtx.measureText(line.slice(0, cut)).width > max) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out.length ? out : [""];
}

function textMetrics(el) {
  const lines = wrapText(el.text || "", el.w, el);
  measureCtx.font = fontSpec(el);
  let width = 0;
  for (const line of lines) width = Math.max(width, measureCtx.measureText(line).width);
  return { lines, width, height: Math.max(1, lines.length) * lineHeight(el) };
}

/* Auto-width, auto-height: the glyphs decide the size of the element,
   not a predefined rectangle. */
function refreshTextSize(el) {
  const m = textMetrics(el);
  el.w = el.wrap ? Math.max(m.width, 16) : Math.max(m.width, el.fontSize * 0.55);
  el.h = m.height;
}

/* --- geometry ---------------------------------------------- */

function boundsOf(el) {
  if (el.type === "line" || el.type === "arrow" || el.type === "pen" || el.type === "highlight") {
    const pts = el.points || [];
    if (!pts.length) return { x: el.x, y: el.y, w: el.w, h: el.h };
    /* Curved and elbowed connectors bow or bend away from their stored
       anchor points, so the visible route is what has a bounding box. */
    const drawn = el.type === "line" || el.type === "arrow"
      ? visualPoints(el)
      : absPoints(el);
    const xs = drawn.map((p) => p.x);
    const ys = drawn.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

function absPoints(el) {
  return (el.points || []).map((p) => ({ x: el.x + p.x, y: el.y + p.y }));
}

function curveControlPoint(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    x: (a.x + b.x) / 2 - dy * CURVE_BOW,
    y: (a.y + b.y) / 2 + dx * CURVE_BOW,
  };
}

function quadraticPoints(a, control, b, count = 18) {
  const out = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const mt = 1 - t;
    out.push({
      x: mt * mt * a.x + 2 * mt * t * control.x + t * t * b.x,
      y: mt * mt * a.y + 2 * mt * t * control.y + t * t * b.y,
    });
  }
  return out;
}

function pathStyleOf(item) {
  if (item && PATH_STYLES.includes(item.pathStyle)) return item.pathStyle;
  return item?.curve ? "curved" : "sharp";
}

/* Which end marks a connector carries. Stored per element; old scenes
   fall back to the plain arrowhead the type used to imply. */
function arrowheadOf(item, side) {
  const stored = side === "start" ? item?.startArrowhead : item?.endArrowhead;
  if (ARROWHEADS.includes(stored)) return stored;
  if (side === "start") return "none";
  return item?.type === "arrow" ? "arrow" : "none";
}

/* An anchor name says which way a connector should leave its shape:
   a side anchor has one obvious normal, a corner has two choices, and
   the one pointing towards the other end wins. */
const ANCHOR_SIDES = {
  n: ["n"], s: ["s"], e: ["e"], w: ["w"],
  nw: ["n", "w"], ne: ["n", "e"], se: ["s", "e"], sw: ["s", "w"],
};

function outwardSide(anchor, from, toward) {
  const sides = ANCHOR_SIDES[anchor];
  if (!sides) return null;
  if (sides.length === 1) return sides[0];
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  let best = sides[0];
  let bestScore = -Infinity;
  for (const side of sides) {
    const score = side === "e" ? dx : side === "w" ? -dx : side === "s" ? dy : -dy;
    if (score > bestScore) {
      bestScore = score;
      best = side;
    }
  }
  return best;
}

function sideOffset(point, side, distance) {
  if (side === "n") return { x: point.x, y: point.y - distance };
  if (side === "s") return { x: point.x, y: point.y + distance };
  if (side === "e") return { x: point.x + distance, y: point.y };
  if (side === "w") return { x: point.x - distance, y: point.y };
  return { ...point };
}

/* Right-angle route between two points. With known sides the turns are
   placed so the line leaves and enters the shapes straight on; without
   them the longer axis decides where the bend sits. */
function orthoJoin(a, b, aSide, bSide) {
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const horizontal = (side) => side === "e" || side === "w";
  if (aSide && bSide) {
    if (horizontal(aSide) && horizontal(bSide)) {
      return [{ x: midX, y: a.y }, { x: midX, y: b.y }];
    }
    if (!horizontal(aSide) && !horizontal(bSide)) {
      return [{ x: a.x, y: midY }, { x: b.x, y: midY }];
    }
    return [horizontal(aSide) ? { x: b.x, y: a.y } : { x: a.x, y: b.y }];
  }
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    return [{ x: midX, y: a.y }, { x: midX, y: b.y }];
  }
  return [{ x: a.x, y: midY }, { x: b.x, y: midY }];
}

function elbowSegment(a, b, aSide, bSide) {
  const out = [{ ...a }];
  const start = aSide ? sideOffset(a, aSide, ELBOW_STUB) : { ...a };
  const end = bSide ? sideOffset(b, bSide, ELBOW_STUB) : { ...b };
  if (aSide) out.push(start);
  out.push(...orthoJoin(start, end, aSide, bSide), end);
  if (bSide) out.push({ ...b });
  return out;
}

/* Drop duplicate points and collinear middles so the handle set on an
   elbowed connector only shows the corners that matter. */
function cleanRoute(points) {
  const out = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.5) continue;
    out.push(point);
  }
  if (out.length < 3) return out;
  const result = [out[0]];
  for (let i = 1; i < out.length - 1; i++) {
    const a = result[result.length - 1];
    const b = out[i];
    const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const straightX = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5;
    const straightY = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5;
    if (Math.abs(cross) < 0.5 && (straightX || straightY)) continue;
    result.push(b);
  }
  result.push(out[out.length - 1]);
  return result;
}

/* An elbowed route is derived, not stored: the element keeps the points
   the writer placed (or the two anchors it is bound to), and the right
   angles are computed from them each time it is drawn. */
function elbowRoute(item, points) {
  const first = points[0];
  const last = points[points.length - 1];
  const startSide = item.startBinding?.anchor
    ? outwardSide(item.startBinding.anchor, first, last)
    : null;
  const endSide = item.endBinding?.anchor
    ? outwardSide(item.endBinding.anchor, last, first)
    : null;
  const route = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segment = elbowSegment(
      a, b,
      i === 0 ? startSide : null,
      i === points.length - 2 ? endSide : null
    );
    if (i) route.push(...segment.slice(1));
    else route.push(...segment);
  }
  return cleanRoute(route);
}

/* Smooth a multi-point connector through the midpoints of its segments,
   the way a hand-drawn curve would pass through its waypoints. */
function smoothPoints(points, steps = 8) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    const start = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const end = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const mt = 1 - t;
      out.push({
        x: mt * mt * start.x + 2 * mt * t * b.x + t * t * end.x,
        y: mt * mt * start.y + 2 * mt * t * b.y + t * t * end.y,
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/* What the eye sees: the routed path rather than the anchor points that
   get stored. Used for drawing, hit testing and bounds alike. */
function visualPoints(item) {
  const pts = absPoints(item);
  if (pts.length < 2) return pts;
  const style = pathStyleOf(item);
  if (style === "curved") {
    if (pts.length === 2) {
      return quadraticPoints(pts[0], curveControlPoint(pts[0], pts[1]), pts[1]);
    }
    return smoothPoints(pts);
  }
  if (style === "elbow") return elbowRoute(item, pts);
  return pts;
}

function centerOf(item) {
  const b = boundsOf(item);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/* Where a connector should touch an element, looking from its centre
   towards the other end. Works for rectangles, images, diamonds and
   ellipses; everything else is treated as a rectangle. */
function outlinePoint(item, toward) {
  const b = boundsOf(item);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const rx = Math.max(1, b.w / 2);
  const ry = Math.max(1, b.h / 2);
  let t;
  if (item.type === "ellipse") {
    t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  } else if (item.type === "diamond") {
    t = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
  } else {
    t = Math.min(dx ? rx / Math.abs(dx) : Infinity, dy ? ry / Math.abs(dy) : Infinity);
  }
  return { x: cx + dx * t, y: cy + dy * t };
}

/* --- shape corners and connection anchors ------------------- */

function boxVertices(item) {
  const { x, y, w, h } = item;
  if (item.type === "diamond") {
    return [
      { x: x + w / 2, y },
      { x: x + w, y: y + h / 2 },
      { x: x + w / 2, y: y + h },
      { x, y: y + h / 2 },
    ];
  }
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function cornerRadius(item) {
  if (!item.roundness || (item.type !== "rect" && item.type !== "diamond")) return 0;
  const w = Math.abs(item.w || 0);
  const h = Math.abs(item.h || 0);
  return Math.min(MAX_CORNER_RADIUS, Math.min(w, h) * CORNER_ROUND_RATIO);
}

/* Each corner of a polygon is replaced by a quadratic bend. The returned
   entry/exit points also make it easy to put an anchor on the bend itself. */
function roundedCorners(vertices, radius) {
  const n = vertices.length;
  return vertices.map((point, i) => {
    const prev = vertices[(i - 1 + n) % n];
    const next = vertices[(i + 1) % n];
    const inLen = Math.max(1e-6, Math.hypot(point.x - prev.x, point.y - prev.y));
    const outLen = Math.max(1e-6, Math.hypot(next.x - point.x, next.y - point.y));
    const r = Math.max(0, Math.min(radius, inLen / 2, outLen / 2));
    if (r < 0.01) {
      return { point, entry: { ...point }, exit: { ...point }, r: 0 };
    }
    return {
      point,
      entry: {
        x: point.x + ((prev.x - point.x) / inLen) * r,
        y: point.y + ((prev.y - point.y) / inLen) * r,
      },
      exit: {
        x: point.x + ((next.x - point.x) / outLen) * r,
        y: point.y + ((next.y - point.y) / outLen) * r,
      },
      r,
    };
  });
}

function traceRoundedPolygon(g, vertices, radius) {
  g.beginPath();
  if (radius < 0.01) {
    g.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) g.lineTo(vertices[i].x, vertices[i].y);
    g.closePath();
    return;
  }
  const corners = roundedCorners(vertices, radius);
  g.moveTo(corners[0].entry.x, corners[0].entry.y);
  for (let i = 0; i < corners.length; i++) {
    if (i > 0) g.lineTo(corners[i].entry.x, corners[i].entry.y);
    g.quadraticCurveTo(
      corners[i].point.x, corners[i].point.y,
      corners[i].exit.x, corners[i].exit.y
    );
  }
  g.closePath();
}

/* Sampled outline used by the sketchy stroke pass, so rounded corners
   stay rounded even when the hand-drawn roughness is active. */
function roundedPolygonPoints(vertices, radius, stepsPerCorner = 6) {
  if (radius < 0.01) return vertices.map((point) => ({ ...point }));
  const corners = roundedCorners(vertices, radius);
  const points = [];
  for (let i = 0; i < corners.length; i++) {
    const c = corners[i];
    points.push({ ...c.entry });
    for (let s = 1; s <= stepsPerCorner; s++) {
      const t = s / stepsPerCorner;
      const mt = 1 - t;
      points.push({
        x: mt * mt * c.entry.x + 2 * mt * t * c.point.x + t * t * c.exit.x,
        y: mt * mt * c.entry.y + 2 * mt * t * c.point.y + t * t * c.exit.y,
      });
    }
  }
  return points;
}

/* Eight fixed connection points per shape: four corners and four edge
   midpoints. Rounded corners put their anchor on the bend itself. */
function connectionAnchors(item) {
  const b = boundsOf(item);
  if (item.type === "ellipse") {
    const angles = {
      e: 0, se: Math.PI / 4, s: Math.PI / 2, sw: (3 * Math.PI) / 4,
      w: Math.PI, nw: (5 * Math.PI) / 4, n: (3 * Math.PI) / 2, ne: (7 * Math.PI) / 4,
    };
    return BIND_ANCHORS.map((name) => ({
      name,
      x: b.x + b.w / 2 + Math.cos(angles[name]) * (b.w / 2),
      y: b.y + b.h / 2 + Math.sin(angles[name]) * (b.h / 2),
    }));
  }
  if (!["rect", "diamond", "image"].includes(item.type)) return [];

  const corners = roundedCorners(boxVertices(item), cornerRadius(item));
  const cornerNames = item.type === "diamond"
    ? ["n", "e", "s", "w"]
    : ["nw", "ne", "se", "sw"];
  const edgeNames = item.type === "diamond"
    ? ["ne", "se", "sw", "nw"]
    : ["n", "e", "s", "w"];
  const anchors = [];
  corners.forEach((c, i) => {
    anchors.push({
      name: cornerNames[i],
      x: (c.entry.x + 2 * c.point.x + c.exit.x) / 4,
      y: (c.entry.y + 2 * c.point.y + c.exit.y) / 4,
    });
  });
  corners.forEach((c, i) => {
    const next = corners[(i + 1) % corners.length];
    anchors.push({
      name: edgeNames[i],
      x: (c.exit.x + next.entry.x) / 2,
      y: (c.exit.y + next.entry.y) / 2,
    });
  });
  return anchors;
}

function anchorPoint(item, name) {
  const anchor = connectionAnchors(item).find((candidate) => candidate.name === name);
  return anchor ? { x: anchor.x, y: anchor.y } : null;
}

function nearestAnchor(item, x, y, maxDistance = Infinity) {
  let best = null;
  let bestDistance = maxDistance;
  for (const anchor of connectionAnchors(item)) {
    const distance = Math.hypot(anchor.x - x, anchor.y - y);
    if (distance <= bestDistance) {
      best = anchor;
      bestDistance = distance;
    }
  }
  return best;
}

/* Normalise a point list into x/y + relative points, preserving order
   so an arrow always keeps pointing at its last point. */
function setLinePoints(el, points) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  el.x = x;
  el.y = y;
  el.points = points.map((p) => ({ x: p.x - x, y: p.y - y }));
  el.w = Math.max(...xs) - x;
  el.h = Math.max(...ys) - y;
}

function unionBounds(els) {
  const bs = els.map(boundsOf);
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  const r = Math.max(...bs.map((b) => b.x + b.w));
  const b = Math.max(...bs.map((b) => b.y + b.h));
  return { x, y, w: r - x, h: b - y };
}

function rectsOverlap(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function distanceToPolyline(px, py, pts) {
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) {
    d = Math.min(d, distanceToSegment(px, py, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y));
  }
  return d;
}

function snapLine(start, end, enabled) {
  if (!enabled) return end;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  const len = Math.hypot(dx, dy);
  return { x: start.x + Math.cos(snapped) * len, y: start.y + Math.sin(snapped) * len };
}

function hitTest(el, x, y, tol) {
  const b = boundsOf(el);
  if (el.type === "line" || el.type === "arrow" || el.type === "pen" || el.type === "highlight") {
    const pts = visualPoints(el);
    const reach = el.type === "highlight" ? Math.max(8, el.strokeWidth * 3) : el.strokeWidth / 2;
    if (pts.length === 1) {
      return Math.hypot(x - pts[0].x, y - pts[0].y) <= tol + reach;
    }
    return distanceToPolyline(x, y, pts) <= tol + reach;
  }
  if (x < b.x - tol || x > b.x + b.w + tol || y < b.y - tol || y > b.y + b.h + tol) return false;
  if (el.type === "ellipse") {
    const nx = (x - (b.x + b.w / 2)) / (b.w / 2 + tol);
    const ny = (y - (b.y + b.h / 2)) / (b.h / 2 + tol);
    return nx * nx + ny * ny <= 1;
  }
  if (el.type === "diamond") {
    const nx = Math.abs(x - (b.x + b.w / 2)) / (b.w / 2 + tol);
    const ny = Math.abs(y - (b.y + b.h / 2)) / (b.h / 2 + tol);
    return nx + ny <= 1;
  }
  return true;
}

function handlesFor(el) {
  const b = boundsOf(el);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (el.type === "line" || el.type === "arrow") {
    /* Every waypoint of a multi-point connector can be dragged, so a
       route can be tuned without redrawing the whole thing. */
    return absPoints(el).map((point, i) => ({ name: `p${i}`, x: point.x, y: point.y }));
  }
  if (el.type === "text") {
    /* No resize handles: the words decide how wide the text is. */
    return [];
  }
  return [
    { name: "nw", x: b.x, y: b.y },
    { name: "n", x: cx, y: b.y },
    { name: "ne", x: b.x + b.w, y: b.y },
    { name: "e", x: b.x + b.w, y: cy },
    { name: "se", x: b.x + b.w, y: b.y + b.h },
    { name: "s", x: cx, y: b.y + b.h },
    { name: "sw", x: b.x, y: b.y + b.h },
    { name: "w", x: b.x, y: cy },
  ];
}

/* --- element factories ------------------------------------- */

function blankElement(type, x, y, w = 0, h = 0, style = {}) {
  const el = {
    id: uid(),
    type,
    x, y, w, h,
    stroke: style.stroke,
    fill: style.fill,
    fillStyle: style.fillStyle,
    strokeWidth: style.strokeWidth,
    strokeStyle: style.strokeStyle,
    opacity: style.opacity,
    roughness: style.roughness,
    roundness: style.roundness,
    seed: (Math.random() * 2147483647) | 0,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    textAlign: style.textAlign,
  };
  if (type === "text") {
    el.w = 0;
    el.h = 0;
    el.text = "";
    el.wrap = false;
    refreshTextSize(el);
  }
  if (type === "line" || type === "arrow") {
    el.points = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    el.pathStyle = PATH_STYLES.includes(style.pathStyle)
      ? style.pathStyle
      : style.curve ? "curved" : "sharp";
    el.curve = el.pathStyle === "curved";
    /* New arrows end in an arrowhead; new lines stay plain until one is
       picked in the Ends row. */
    el.startArrowhead = ARROWHEADS.includes(style.startArrowhead) ? style.startArrowhead : "none";
    el.endArrowhead = ARROWHEADS.includes(style.endArrowhead)
      ? style.endArrowhead
      : type === "arrow" ? "arrow" : "none";
    el.startBinding = null;
    el.endBinding = null;
  }
  if (type === "pen" || type === "highlight") {
    el.points = [{ x: 0, y: 0 }];
  }
  return el;
}

/* --- mount ------------------------------------------------- */

export function mountCanvas(opts = {}) {
  const root = opts.root;
  if (!root) throw new Error("mountCanvas needs a root element");

  const $ = (id) => root.querySelector(`#${id}`);
  const canvas = $("drawCanvas");
  const stage = $("drawStage");
  const ctx = canvas.getContext("2d");

  const el = {
    empty: $("drawEmpty"),
    hint: $("drawHint"),
    textEditor: $("drawTextEditor"),
    undo: $("drawUndo"),
    redo: $("drawRedo"),
    export: $("drawExport"),
    strokeSwatches: $("strokeSwatches"),
    fillSwatches: $("fillSwatches"),
    strokeCustom: $("strokeCustom"),
    fillCustom: $("fillCustom"),
    fillStyles: $("fillStyles"),
    strokeWidths: $("strokeWidths"),
    strokeStyles: $("strokeStyles"),
    pathStyles: $("pathStyles"),
    startHeads: $("startHeads"),
    endHeads: $("endHeads"),
    edgeStyles: $("edgeStyles"),
    roughness: $("roughness"),
    opacity: $("opacity"),
    opacityValue: $("opacityValue"),
    fontFamily: $("fontFamily"),
    fontSize: $("fontSize"),
    textAlign: $("textAlign"),
    count: $("drawCount"),
    status: $("drawStatus"),
    zoomLabel: $("drawZoomLabel"),
    zoomOut: $("drawZoomOut"),
    zoomIn: $("drawZoomIn"),
    zoomFit: $("drawFit"),
    exportPanel: $("exportPanel"),
    exportThumb: $("exportThumb"),
    exportTitle: $("exportTitle"),
    exportSnippet: $("exportSnippet"),
    exportSave: $("exportSave"),
    exportCopy: $("exportCopy"),
    exportDownload: $("exportDownload"),
    exportInsert: $("exportInsert"),
    exportRetake: $("exportRetake"),
    exportCancel: $("exportCancel"),
    imageTrigger: $("drawImage"),
    imageInput: $("imageInput"),
    pdfTrigger: $("drawPdf"),
    pdfInput: $("pdfInput"),
    pdfPanel: $("pdfPanel"),
    pdfName: $("pdfName"),
    pdfMeta: $("pdfMeta"),
    pdfPages: $("pdfPages"),
    pdfNote: $("pdfNote"),
    pdfImport: $("pdfImport"),
    pdfCancel: $("pdfCancel"),
    pdfUrlRow: $("pdfUrlRow"),
    pdfUrlInput: $("pdfUrlInput"),
    pdfUrlSubmit: $("pdfUrlSubmit"),
    pdfFilePickBtn: $("pdfFilePickBtn"),
    pdfExtractRow: $("pdfExtractRow"),
    pdfChoiceAll: $("pdfChoiceAll"),
    pdfChoiceSome: $("pdfChoiceSome"),
    pdfFieldWrap: $("pdfFieldWrap"),
    aiExplainCard: $("aiExplainCard"),
    aiCardClose: $("aiCardClose"),
    aiCardModel: $("aiCardModel"),
    aiCardQuoteText: $("aiCardQuoteText"),
    aiCardLoading: $("aiCardLoading"),
    aiCardResponse: $("aiCardResponse"),
    aiCardQaInput: $("aiCardQaInput"),
    aiCardQaSubmit: $("aiCardQaSubmit"),
    aiCardCopyBtn: $("aiCardCopyBtn"),
    aiCardInsertBtn: $("aiCardInsertBtn"),
    aiCardPinBtn: $("aiCardPinBtn"),
  };

  const state = {
    elements: [],
    selected: new Set(),
    tool: "select",
    style: {
      stroke: "#1e1e1e",
      fill: "#a5d8ff",
      fillStyle: "none",
      pathStyle: "sharp",
      curve: false,
      startArrowhead: "none",
      endArrowhead: "arrow",
      strokeWidth: 2,
      strokeStyle: "solid",
      opacity: 1,
      roughness: 1,
      roundness: 0,
      fontSize: 20,
      fontFamily: "sans",
      textAlign: "left",
    },
    view: { x: 0, y: 0, zoom: 1 },
    isOpen: false,
    slug: null,
    key: null,
    action: null,
    draft: null,
    pending: null,
    bindHover: null,
    bindAnchor: null,
    marquee: null,
    exportMode: false,
    exportRect: null,
    exportMarkdown: "",
    editingId: null,
    editingNew: false,
    clipboard: [],
    pasteHandled: false,
    space: false,
    lastPointer: null,
    history: [],
    historyIndex: -1,
    saveTimer: null,
    dpr: 1,
  };

  const keyFor = (slug) => `${STORE_PREFIX}${slug || "scratch"}`;
  const selected = () => state.elements.filter((e) => state.selected.has(e.id));
  const firstSelected = () => selected()[0] || null;

  function notify(message) {
    if (typeof opts.notify === "function") opts.notify(message);
  }

  function setStatus(text, tone = "saved") {
    el.status.textContent = text;
    el.status.dataset.state = tone;
  }

  /* --- pasted screenshots ---------------------------------- */

  const IMAGE_MAX = 1600;
  const IMAGE_MAX_BYTES = 2_500_000;
  const imageCache = new Map();

  /* Page-sized bitmaps outgrow localStorage, so imported PDF pages live
     in IndexedDB. The scene only keeps a small "idb:" token for them. */
  let imageDbPromise = null;

  function openImageDB() {
    if (!imageDbPromise) {
      imageDbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error("IndexedDB is not available"));
          return;
        }
        const req = indexedDB.open(IMAGE_DB_NAME, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(IMAGE_DB_STORE)) {
            req.result.createObjectStore(IMAGE_DB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("Could not open browser storage"));
      }).catch((err) => {
        imageDbPromise = null;
        throw err;
      });
    }
    return imageDbPromise;
  }

  async function imageDbTask(mode, run) {
    const db = await openImageDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IMAGE_DB_STORE, mode);
      const req = run(tx.objectStore(IMAGE_DB_STORE));
      let value;
      req.onsuccess = () => { value = req.result; };
      req.onerror = () => reject(req.error || new Error("Browser storage failed"));
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error || new Error("Browser storage failed"));
      tx.onabort = () => reject(tx.error || new Error("Browser storage was aborted"));
    });
  }

  const putImageBlob = (id, blob) => imageDbTask("readwrite", (store) => store.put(blob, id));
  const getImageBlob = (id) => imageDbTask("readonly", (store) => store.get(id));

  function imageEntry(src) {
    let entry = imageCache.get(src);
    if (entry) return entry;
    const img = new Image();
    let settle = () => {};
    const ready = new Promise((resolve) => { settle = resolve; });
    entry = { img, ready };
    imageCache.set(src, entry);
    img.onload = () => {
      if (state.isOpen) render();
      settle();
    };
    img.onerror = () => settle();
    if (src.startsWith(IMAGE_DB_PREFIX)) {
      getImageBlob(src.slice(IMAGE_DB_PREFIX.length))
        .then((blob) => {
          if (!blob) throw new Error("missing image");
          img.src = URL.createObjectURL(blob);
        })
        .catch(() => settle());
    } else {
      img.src = src;
    }
    return entry;
  }

  function drawableImage(src) {
    const { img } = imageEntry(src);
    return img.complete && img.naturalWidth ? img : null;
  }

  function readClipboardImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result || "");
        const img = new Image();
        img.onload = () => {
          const naturalW = img.naturalWidth || img.width;
          const naturalH = img.naturalHeight || img.height;
          if (!naturalW || !naturalH) {
            reject(new Error("That image has no size"));
            return;
          }
          const scale = Math.min(1, IMAGE_MAX / Math.max(naturalW, naturalH));
          if (scale === 1 && src.length <= IMAGE_MAX_BYTES) {
            resolve({ src, naturalW, naturalH });
            return;
          }
          /* Screenshots are often bigger than localStorage can hold, so
             keep a high-resolution but sane copy of the bitmap. */
          const w = Math.max(1, Math.round(naturalW * scale));
          const h = Math.max(1, Math.round(naturalH * scale));
          const copy = document.createElement("canvas");
          copy.width = w;
          copy.height = h;
          const g = copy.getContext("2d");
          g.imageSmoothingQuality = "high";
          g.drawImage(img, 0, 0, w, h);
          let out = src;
          try {
            out = copy.toDataURL(/^data:image\/jpe?g/i.test(src) ? "image/jpeg" : "image/png", 0.92);
          } catch {}
          resolve({ src: out, naturalW, naturalH });
        };
        img.onerror = () => reject(new Error("That image could not be decoded"));
        img.src = src;
      };
      reader.onerror = () => reject(new Error("Could not read the pasted image"));
      reader.readAsDataURL(file);
    });
  }

  function addImage(src, naturalW, naturalH, at = null) {
    if (state.editingId) commitText();
    const { w: vw, h: vh } = stageSize();
    const maxW = Math.max(160, Math.min(720, vw - 80));
    const maxH = Math.max(120, Math.min(560, vh - 80));
    const fit = Math.min(1, maxW / naturalW, maxH / naturalH);
    const w = Math.max(40, Math.round(naturalW * fit));
    const h = Math.max(30, Math.round(naturalH * fit));
    /* Dropped images land under the cursor; pasted ones sit in the middle. */
    const cx = at ? at.x : wx(vw / 2);
    const cy = at ? at.y : wy(vh / 2);
    const item = {
      id: uid(),
      type: "image",
      src,
      x: cx - w / 2,
      y: cy - h / 2,
      w,
      h,
      opacity: 1,
      seed: (Math.random() * 2147483647) | 0,
    };
    state.elements.push(item);
    state.selected = new Set([item.id]);
    state.tool = "select";
    syncToolUI();
    syncStyleUI();
    commitHistory();
    updateUI();
    render();
    scheduleSave();
    notify(`Image added · ${naturalW} × ${naturalH}`);
  }

  async function insertImageFile(file, at = null) {
    try {
      const { src, naturalW, naturalH } = await readClipboardImage(file);
      addImage(src, naturalW, naturalH, at);
    } catch (err) {
      notify(err.message || "Could not add the image");
    }
  }

  async function insertImageFiles(files, at = null) {
    for (const [i, file] of files.entries()) {
      const point = at ? { x: at.x + i * 24, y: at.y + i * 24 } : null;
      await insertImageFile(file, point);
    }
  }

  async function ensureImages() {
    await Promise.all(
      state.elements
        .filter((item) => item.type === "image" && item.src)
        .map((item) => imageEntry(item.src).ready)
    );
  }

  /* --- PDF pages -------------------------------------------- */

  let pdfjsPromise = null;
  const pdf = { file: null, doc: null, at: null, busy: false, fetchController: null, choice: "all" };

  function loadPdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import(`${PDF_JS_ROOT}build/pdf.min.mjs`)
        .then((lib) => {
          lib.GlobalWorkerOptions.workerSrc = `${PDF_JS_ROOT}build/pdf.worker.min.mjs`;
          return lib;
        })
        .catch((err) => {
          pdfjsPromise = null;
          throw new Error(`PDF support is not installed. Run npm install in the repo. (${err.message})`);
        });
    }
    return pdfjsPromise;
  }

  function setPdfNote(text, tone = "") {
    el.pdfNote.textContent = text;
    el.pdfNote.dataset.tone = tone;
  }

  function isPdfUrl(str) {
    if (!str || typeof str !== "string") return false;
    const s = str.trim();
    if (!/^https?:\/\//i.test(s) && !/^(?:www\.)?arxiv\.org\//i.test(s)) return false;
    return (
      /arxiv\.org\/(?:pdf|abs)\//i.test(s) ||
      /\.pdf(?:[?#]|$)/i.test(s) ||
      /\/pdf(?:\/|[?#]|$)/i.test(s) ||
      /openreview\.net\/pdf/i.test(s) ||
      /(?:biorxiv|medrxiv)\.org\/content\/.*\.pdf/i.test(s)
    );
  }

  function closePdfPanel({ focus = true } = {}) {
    if (pdf.busy) return;
    if (pdf.fetchController) {
      try { pdf.fetchController.abort(); } catch {}
      pdf.fetchController = null;
    }
    const wasOpen = !el.pdfPanel.hidden;
    el.pdfPanel.hidden = true;
    el.pdfNote.dataset.tone = "";
    el.pdfPages.value = "";
    el.pdfPages.disabled = true;
    el.pdfImport.disabled = true;
    el.pdfCancel.disabled = false;
    if (el.pdfUrlRow) el.pdfUrlRow.hidden = true;
    if (el.pdfUrlInput) el.pdfUrlInput.value = "";
    if (el.pdfExtractRow) el.pdfExtractRow.hidden = true;
    if (el.pdfFieldWrap) el.pdfFieldWrap.hidden = false;
    pdf.file = null;
    pdf.at = null;
    pdf.choice = "all";
    const doc = pdf.doc;
    pdf.doc = null;
    if (doc) doc.destroy?.();
    /* Hand the keyboard back so tool shortcuts work right after an import. */
    if (wasOpen && focus && state.isOpen) canvas.focus({ preventScroll: true });
  }

  function promptPdfImport() {
    if (!state.isOpen) return;
    if (pdf.busy) {
      notify("Hold on — still importing the previous PDF");
      return;
    }
    if (state.editingId) commitText();
    if (state.exportMode) cancelExport();
    closePdfPanel({ focus: false });

    el.pdfPanel.hidden = false;
    el.pdfUrlRow.hidden = false;
    el.pdfExtractRow.hidden = true;
    el.pdfFieldWrap.hidden = true;
    el.pdfName.textContent = "Import from link or file";
    el.pdfMeta.textContent = "";
    el.pdfImport.hidden = true;
    el.pdfImport.disabled = true;
    el.pdfCancel.disabled = false;
    setPdfNote("Paste an arXiv or PDF link, or browse a local file.");
    el.pdfUrlInput.value = "";
    el.pdfUrlInput.focus({ preventScroll: true });
  }

  async function importPdfFromUrl(urlStr, at = null) {
    if (!state.isOpen || !urlStr) return;
    if (pdf.busy) {
      notify("Hold on — still importing the previous PDF");
      return;
    }
    if (state.editingId) commitText();
    if (state.exportMode) cancelExport();
    closePdfPanel({ focus: false });

    let url = urlStr.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    url = url
      .replace(/arxiv\.org\/abs\/([0-9.]+)(?:v\d+)?(?:\.pdf)?/i, "arxiv.org/pdf/$1.pdf")
      .replace(/arxiv\.org\/pdf\/([0-9.]+)(?:v\d+)?(?!\.pdf)$/i, "arxiv.org/pdf/$1.pdf");

    // Display title derived from URL
    let displayName = "paper.pdf";
    try {
      const parsed = new URL(url);
      displayName = parsed.pathname.split("/").filter(Boolean).pop() || "paper.pdf";
      if (!/\.pdf$/i.test(displayName)) displayName += ".pdf";
    } catch {}

    el.pdfPanel.hidden = false;
    el.pdfUrlRow.hidden = true;
    el.pdfExtractRow.hidden = true;
    el.pdfFieldWrap.hidden = true;
    el.pdfName.textContent = displayName;
    el.pdfMeta.textContent = "downloading…";
    el.pdfPages.value = "";
    el.pdfPages.disabled = true;
    el.pdfImport.hidden = false;
    el.pdfImport.disabled = true;
    el.pdfCancel.disabled = false;
    setPdfNote("Fetching PDF paper from link…");

    const controller = new AbortController();
    pdf.fetchController = controller;
    pdf.at = at;

    try {
      const res = await fetch(`/api/proxy-pdf?url=${encodeURIComponent(url)}`, {
        signal: controller.signal,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}: Failed to download PDF`);
      }

      const xFilename = res.headers.get("x-filename");
      if (xFilename) {
        try {
          displayName = decodeURIComponent(xFilename);
        } catch {}
      }

      const blob = await res.blob();
      if (controller.signal.aborted) return;
      pdf.fetchController = null;

      const file = new File([blob], displayName, { type: "application/pdf" });
      await openPdfDoc(file, at);
    } catch (err) {
      if (err.name === "AbortError") return;
      pdf.fetchController = null;
      pdf.file = null;
      el.pdfMeta.textContent = "failed";
      setPdfNote(err.message || "Could not download that PDF paper.", "error");
    }
  }

  function setPdfChoice(choice, focusInput = true) {
    pdf.choice = choice;
    const doc = pdf.doc;
    const total = doc?.numPages || 1;
    const first = Math.min(total, PDF_MAX_PAGES);

    el.pdfChoiceAll.classList.toggle("is-active", choice === "all");
    el.pdfChoiceSome.classList.toggle("is-active", choice === "some");

    if (choice === "all") {
      el.pdfPages.value = first === 1 ? "1" : `1-${first}`;
      setPdfNote(
        total > PDF_MAX_PAGES
          ? `All pages selected (first ${PDF_MAX_PAGES} of ${total}) · choose 'Some pages' to specify.`
          : `All ${total} pages selected · click 'Some pages' if you only need certain pages.`
      );
    } else {
      setPdfNote(`Enter page numbers (e.g. 1-3, 5) up to ${total}.`);
      if (focusInput) {
        el.pdfPages.focus({ preventScroll: true });
        el.pdfPages.select();
      }
    }
  }

  async function openPdfDoc(file, at = null) {
    pdf.file = file;
    pdf.at = at;
    el.pdfPanel.hidden = false;
    el.pdfUrlRow.hidden = true;
    el.pdfExtractRow.hidden = true;
    el.pdfFieldWrap.hidden = false;
    el.pdfName.textContent = file.name || "document.pdf";
    el.pdfMeta.textContent = "";
    el.pdfPages.value = "";
    el.pdfPages.disabled = true;
    el.pdfImport.hidden = false;
    el.pdfImport.disabled = true;
    el.pdfCancel.disabled = false;
    setPdfNote("Opening the document…");

    try {
      const data = await file.arrayBuffer();
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs.getDocument({
        data,
        cMapUrl: `${PDF_JS_ROOT}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${PDF_JS_ROOT}standard_fonts/`,
        wasmUrl: `${PDF_JS_ROOT}wasm/`,
      }).promise;

      /* The panel may have been closed while the document loaded. */
      if (pdf.file !== file) {
        doc.destroy?.();
        return;
      }

      pdf.doc = doc;
      const total = doc.numPages;
      const first = Math.min(total, PDF_MAX_PAGES);
      el.pdfMeta.textContent = `${total} page${total === 1 ? "" : "s"}`;
      el.pdfPages.value = first === 1 ? "1" : `1-${first}`;
      el.pdfPages.disabled = false;
      el.pdfImport.disabled = false;

      el.pdfExtractRow.hidden = false;
      setPdfChoice("all", false);

      el.pdfPages.focus({ preventScroll: true });
      el.pdfPages.select();
    } catch (err) {
      pdf.file = null;
      el.pdfMeta.textContent = "could not open";
      setPdfNote(err.message || "That PDF could not be opened.", "error");
    }
  }

  async function openPdfPanel(file, at = null) {
    if (!state.isOpen || !file) return;
    if (pdf.busy) {
      notify("Hold on — still importing the previous PDF");
      return;
    }
    if (state.editingId) commitText();
    if (state.exportMode) cancelExport();
    closePdfPanel({ focus: false });
    await openPdfDoc(file, at);
  }

  function parsePageRange(text, total) {
    const pages = [];
    for (const part of String(text || "").split(/[,;\s]+/).filter(Boolean)) {
      const match = part.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
      if (!match) return [];
      const from = Number(match[1]);
      const to = match[2] ? Number(match[2]) : from;
      if (from < 1 || to < from || to > total) return [];
      for (let p = from; p <= to; p++) if (!pages.includes(p)) pages.push(p);
    }
    return pages;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode that page"));
      }, type, quality);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read that page"));
      reader.readAsDataURL(blob);
    });
  }

  async function importPdfPages() {
    const doc = pdf.doc;
    if (!doc || pdf.busy) return;
    const total = doc.numPages;
    const pages = parsePageRange(el.pdfPages.value, total);
    if (!pages.length) {
      setPdfNote(`Use page numbers from 1 to ${total}, like 1-3 or 2, 5.`, "error");
      el.pdfPages.focus({ preventScroll: true });
      return;
    }
    if (pages.length > PDF_MAX_PAGES) {
      setPdfNote(`That is ${pages.length} pages — import at most ${PDF_MAX_PAGES} at once.`, "error");
      return;
    }

    pdf.busy = true;
    el.pdfPages.disabled = true;
    el.pdfImport.disabled = true;
    el.pdfCancel.disabled = true;

    const made = [];
    let inlineFallback = false;
    try {
      for (const [index, num] of pages.entries()) {
        setPdfNote(`Rendering page ${num} · ${index + 1} of ${pages.length}…`);
        const page = await doc.getPage(num);
        try {
          const base = page.getViewport({ scale: 1 });
          const widthScale = PDF_RENDER_WIDTH / Math.max(1, base.width);
          const edgeScale = PDF_RENDER_MAX_EDGE / Math.max(base.width, base.height);
          const scale = clamp(Math.min(widthScale, edgeScale), 0.5, 8);
          const viewport = page.getViewport({ scale });
          const bitmap = document.createElement("canvas");
          bitmap.width = Math.max(1, Math.round(viewport.width));
          bitmap.height = Math.max(1, Math.round(viewport.height));
          const g = bitmap.getContext("2d", { alpha: false });
          g.fillStyle = "#ffffff";
          g.fillRect(0, 0, bitmap.width, bitmap.height);
          await page.render({ canvasContext: g, viewport }).promise;

          let textItems = [];
          try {
            const textContent = await page.getTextContent();
            for (const item of textContent.items) {
              if (!item.str || !item.str.trim()) continue;
              const tx = item.transform[4];
              const ty = item.transform[5];
              const fontHeight = Math.hypot(item.transform[2], item.transform[3]) || 12;
              const itemWidth = item.width || 0;
              /* PDF.js v6 removed convertToViewportRectangle(); map the two
                 corners separately so text can still be selected on the page. */
              const [x1, y1] = viewport.convertToViewportPoint(tx, ty);
              const [x2, y2] = viewport.convertToViewportPoint(tx + itemWidth, ty + fontHeight);
              const rx = Math.min(x1, x2) / viewport.width;
              const ry = Math.min(y1, y2) / viewport.height;
              const rw = Math.abs(x2 - x1) / viewport.width;
              const rh = Math.abs(y2 - y1) / viewport.height;
              textItems.push({
                text: item.str,
                rx, ry, rw, rh,
              });
            }
          } catch (e) {
            console.warn("Could not extract text items:", e);
          }

          /* PNG keeps PDF text and fine rules sharp. JPEG's block
             compression was visibly smearing glyph edges, especially
             once the bitmap was scaled for display. */
          const blob = await canvasToBlob(bitmap, "image/png");
          let src;
          try {
            const id = `pdf-${Date.now().toString(36)}-${num}-${Math.random().toString(36).slice(2, 7)}`;
            await putImageBlob(id, blob);
            src = `${IMAGE_DB_PREFIX}${id}`;
          } catch {
            src = await blobToDataUrl(blob);
            inlineFallback = true;
          }
          made.push({ src, w: bitmap.width, h: bitmap.height, textItems, pageNum: num });
        } finally {
          page.cleanup();
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    } catch (err) {
      pdf.busy = false;
      el.pdfPages.disabled = false;
      el.pdfImport.disabled = false;
      el.pdfCancel.disabled = false;
      setPdfNote(err.message || "Could not render that PDF.", "error");
      return;
    }

    pdf.busy = false;
    const at = pdf.at;
    closePdfPanel();
    if (!made.length) {
      notify("No pages were rendered");
      return;
    }
    addPdfPages(made, at);
    notify(
      inlineFallback
        ? `${made.length} page${made.length === 1 ? "" : "s"} added · browser storage was full, kept inline`
        : `${made.length} page${made.length === 1 ? "" : "s"} added · draw on top, then export the area`
    );
  }

  function addPdfPages(pages, at = null) {
    const { w: vw, h: vh } = stageSize();
    const width = Math.max(240, Math.min(PDF_DISPLAY_WIDTH, vw - 120));
    const gap = 28;
    const firstH = Math.round(width * (pages[0].h / pages[0].w));
    const cx = at ? at.x : wx(vw / 2);
    const cy = at ? at.y : wy(vh / 2);
    const x = Math.round(cx - width / 2);
    let y = Math.round(cy - firstH / 2);

    const items = pages.map((page) => {
      const h = Math.max(1, Math.round(width * (page.h / page.w)));
      const item = {
        id: uid(),
        type: "image",
        src: page.src,
        x,
        y,
        w: width,
        h,
        opacity: 1,
        seed: (Math.random() * 2147483647) | 0,
        pdfMeta: {
          pageNum: page.pageNum,
          textItems: page.textItems || [],
          fileName: pdf.file?.name || "document.pdf",
        },
      };
      y += h + gap;
      return item;
    });

    /* Pages go underneath existing strokes so annotations stay on top. */
    state.elements = [...items, ...state.elements];
    state.selected = new Set(items.map((item) => item.id));
    state.tool = "select";
    syncToolUI();
    syncStyleUI();
    commitHistory();
    updateUI();
    render();
    scheduleSave();
    revealBounds(boundsOf(items[0]));
  }

  function revealBounds(b) {
    const { w } = stageSize();
    if (w < 2) return;
    const pad = 40;
    const z = clamp(Math.min(state.view.zoom, (w - pad * 2) / Math.max(1, b.w)), MIN_ZOOM, MAX_ZOOM);
    state.view.zoom = z;
    state.view.x = b.x - pad / z;
    state.view.y = b.y - pad / z;
    updateZoomLabel();
    render();
    scheduleSave();
  }

  /* --- persistence ----------------------------------------- */

  function writeScene() {
    if (!state.key) return;
    try {
      const data = JSON.stringify({
        elements: state.elements,
        view: state.view,
        style: state.style,
      });
      localStorage.setItem(state.key, data);
      setStatus("saved locally", "saved");
    } catch {
      setStatus("not saved", "error");
    }
  }

  function scheduleSave() {
    setStatus("saving…", "dirty");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(writeScene, 450);
  }

  function flushScene() {
    clearTimeout(state.saveTimer);
    writeScene();
  }

  function loadScene() {
    let data = null;
    try {
      const raw = localStorage.getItem(state.key);
      if (raw) data = JSON.parse(raw);
    } catch {
      data = null;
    }

    state.elements = Array.isArray(data?.elements) ? data.elements : [];
    /* Scenes saved before auto-sizing may carry a fixed text width, and
       connectors used to know only "curved or not" plus a single implied
       arrowhead. Bring both shapes of old data up to date. */
    for (const item of state.elements) {
      if (item.type === "text") refreshTextSize(item);
      if (item.type === "line" || item.type === "arrow") {
        item.pathStyle = pathStyleOf(item);
        if (!ARROWHEADS.includes(item.startArrowhead)) item.startArrowhead = "none";
        if (!ARROWHEADS.includes(item.endArrowhead)) {
          item.endArrowhead = item.type === "arrow" ? "arrow" : "none";
        }
      }
    }
    routeBoundArrows();
    const v = data?.view;
    state.view = v && isNum(v.x) && isNum(v.y) && isNum(v.zoom)
      ? { x: v.x, y: v.y, zoom: clamp(v.zoom, MIN_ZOOM, MAX_ZOOM) }
      : { x: 0, y: 0, zoom: 1 };
    if (data?.style) state.style = { ...state.style, ...data.style };

    state.selected.clear();
    state.action = null;
    state.draft = null;
    state.pending = null;
    state.bindHover = null;
    state.bindAnchor = null;
    state.marquee = null;
    state.exportMode = false;
    state.exportRect = null;
    state.exportMarkdown = "";
    el.exportPanel.hidden = true;
    closeTextEditor();
    resetHistory();
    syncStyleUI();
    updateUI();
    setStatus(data ? "saved locally" : "new drawing", data ? "saved" : "dirty");
    render();
  }

  function setSlug(slug, { migrate = false, reset = false } = {}) {
    const next = slug || null;
    const nextKey = keyFor(next);
    if (nextKey === state.key && !reset) return;

    const oldKey = state.key;
    if (oldKey) flushScene();
    if (!el.pdfPanel.hidden) closePdfPanel({ focus: false });

    if (reset) {
      try { localStorage.removeItem(nextKey); } catch {}
      state.elements = [];
      state.selected.clear();
      state.view = { x: 0, y: 0, zoom: 1 };
      state.action = null;
      state.draft = null;
      state.marquee = null;
      state.exportMode = false;
      state.exportRect = null;
      state.exportMarkdown = "";
      el.exportPanel.hidden = true;
      closeTextEditor();
      state.slug = next;
      state.key = nextKey;
      resetHistory();
      syncStyleUI();
      updateUI();
      setStatus("new drawing", "dirty");
      render();
      scheduleSave();
      return;
    }

    /* First save of a brand-new post: move the scratch scene to the
       real slug. Keep the in-memory state (and any open export panel)
       because the scene itself did not change. */
    if (migrate && !state.slug && next) {
      try {
        const data = localStorage.getItem(oldKey);
        if (data && !localStorage.getItem(nextKey)) {
          localStorage.setItem(nextKey, data);
          localStorage.removeItem(oldKey);
        }
      } catch {}
      state.slug = next;
      state.key = nextKey;
      scheduleSave();
      return;
    }

    state.slug = next;
    state.key = nextKey;
    loadScene();
    if (state.isOpen) requestAnimationFrame(resize);
  }

  function resetHistory() {
    state.history = [JSON.stringify(state.elements)];
    state.historyIndex = 0;
    updateUndoRedo();
  }

  function commitHistory() {
    const snap = JSON.stringify(state.elements);
    if (snap === state.history[state.historyIndex]) return;
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snap);
    if (state.history.length > 100) state.history.shift();
    state.historyIndex = state.history.length - 1;
    updateUndoRedo();
    scheduleSave();
  }

  function restoreSnapshot(index) {
    if (index < 0 || index >= state.history.length) return;
    state.historyIndex = index;
    state.elements = JSON.parse(state.history[index]);
    routeBoundArrows();
    state.selected.clear();
    state.action = null;
    state.draft = null;
    state.marquee = null;
    closeTextEditor();
    syncStyleUI();
    updateUI();
    render();
    scheduleSave();
  }

  function undo() {
    if (state.historyIndex <= 0) return;
    restoreSnapshot(state.historyIndex - 1);
  }

  function redo() {
    if (state.historyIndex >= state.history.length - 1) return;
    restoreSnapshot(state.historyIndex + 1);
  }

  /* --- sizing and coordinates ------------------------------ */

  function stageSize() {
    const r = stage.getBoundingClientRect();
    return { w: Math.max(1, r.width), h: Math.max(1, r.height) };
  }

  function resize() {
    const r = stage.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const pw = Math.max(1, Math.round(r.width * dpr));
    const ph = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    state.dpr = dpr;
    render();

    if (el.aiExplainCard && !el.aiExplainCard.hidden) {
      if (aiCardUserMoved) {
        const left = parseFloat(el.aiExplainCard.style.left) || 0;
        const top = parseFloat(el.aiExplainCard.style.top) || 0;
        const pos = clampAiCard(left, top);
        el.aiExplainCard.style.left = `${pos.left}px`;
        el.aiExplainCard.style.top = `${pos.top}px`;
      } else if (activeAiHighlight) {
        positionAiExplainCard(activeAiHighlight.bounds);
      }
    }
  }

  const sx = (wx) => (wx - state.view.x) * state.view.zoom;
  const sy = (wy) => (wy - state.view.y) * state.view.zoom;
  const wx = (px) => px / state.view.zoom + state.view.x;
  const wy = (py) => py / state.view.zoom + state.view.y;

  function pointerPos(event) {
    const r = canvas.getBoundingClientRect();
    const px = event.clientX - r.left;
    const py = event.clientY - r.top;
    return { px, py, x: wx(px), y: wy(py) };
  }

  /* --- drawing primitives ---------------------------------- */

  function traceBox(g, item) {
    const { x, y, w, h } = item;
    if (item.type === "rect") {
      const r = cornerRadius(item);
      if (r > 0.01) {
        traceRoundedPolygon(g, boxVertices(item), r);
      } else {
        g.beginPath();
        g.rect(x, y, w, h);
      }
    } else if (item.type === "diamond") {
      traceRoundedPolygon(g, boxVertices(item), cornerRadius(item));
    } else {
      g.beginPath();
      g.ellipse(
        x + w / 2, y + h / 2,
        Math.max(0.01, w / 2), Math.max(0.01, h / 2),
        0, 0, Math.PI * 2
      );
    }
  }

  function applyStroke(g, item) {
    g.strokeStyle = item.stroke;
    g.lineWidth = Math.max(0.5, item.strokeWidth);
    g.lineJoin = "round";
    g.lineCap = "round";
    const sw = Math.max(1, item.strokeWidth);
    if (item.strokeStyle === "dashed") g.setLineDash([sw * 4 + 4, sw * 3 + 3]);
    else if (item.strokeStyle === "dotted") g.setLineDash([0.5, sw * 2.4 + 3]);
    else g.setLineDash([]);
  }

  function fillBox(g, item) {
    if (!item.fill || item.fillStyle === "none") return;
    if (item.fillStyle === "solid") {
      g.fillStyle = item.fill;
      traceBox(g, item);
      g.fill();
      return;
    }
    /* Hachure: diagonal lines clipped to the shape. */
    const b = boundsOf(item);
    g.save();
    traceBox(g, item);
    g.clip();
    g.strokeStyle = item.fill;
    g.lineWidth = 1;
    g.setLineDash([]);
    g.globalAlpha *= 0.6;
    for (let i = -b.h; i < b.w + b.h; i += 7) {
      g.beginPath();
      g.moveTo(b.x + i, b.y);
      g.lineTo(b.x + i - b.h, b.y + b.h);
      g.stroke();
    }
    g.restore();
  }

  function outlinePoints(item) {
    const { x, y, w, h } = item;
    if (item.type === "rect" || item.type === "diamond") {
      return roundedPolygonPoints(boxVertices(item), cornerRadius(item), 8);
    }
    const pts = [];
    const cx = x + w / 2;
    const cy = y + h / 2;
    const count = 40;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      pts.push({ x: cx + Math.cos(a) * (w / 2), y: cy + Math.sin(a) * (h / 2) });
    }
    return pts;
  }

  function roughStroke(g, item, pts, closed) {
    const rand = mulberry32((item.seed || 1) >>> 0);
    const amp = item.roughness > 1 ? 1.9 : 1.2;
    const passes = item.roughness > 1 ? 3 : 2;
    const list = closed ? [...pts, pts[0]] : pts;
    g.save();
    applyStroke(g, item);
    for (let pass = 0; pass < passes; pass++) {
      g.beginPath();
      for (let i = 0; i < list.length - 1; i++) {
        const a = list[i];
        const b = list[i + 1];
        const ax = a.x + (rand() - 0.5) * amp;
        const ay = a.y + (rand() - 0.5) * amp;
        const bx = b.x + (rand() - 0.5) * amp;
        const by = b.y + (rand() - 0.5) * amp;
        const mx = (ax + bx) / 2 + (rand() - 0.5) * amp * 2;
        const my = (ay + by) / 2 + (rand() - 0.5) * amp * 2;
        if (i === 0) g.moveTo(ax, ay);
        g.quadraticCurveTo(mx, my, bx, by);
      }
      g.stroke();
    }
    g.restore();
  }

  function drawBox(g, item) {
    if (item.w <= 0 || item.h <= 0) return;
    fillBox(g, item);
    if (item.roughness > 0) {
      roughStroke(g, item, outlinePoints(item), true);
    } else {
      applyStroke(g, item);
      traceBox(g, item);
      g.stroke();
    }
  }

  /* End marks. Excalidraw offers the same small family of arrowheads and
   architects use all of them: open arrows for flow, filled triangles
   for direction, bars for "and then", dots for junctions. */
  function drawArrowHead(g, item, tip, from, kind) {
    if (!kind || kind === "none" || !from) return;
    const angle = Math.atan2(from.y - tip.y, from.x - tip.x);
    const len = 9 + item.strokeWidth * 2.2;
    applyStroke(g, item);
    if (kind === "bar") {
      const half = len * 0.5;
      g.beginPath();
      g.moveTo(tip.x + Math.cos(angle + Math.PI / 2) * half, tip.y + Math.sin(angle + Math.PI / 2) * half);
      g.lineTo(tip.x + Math.cos(angle - Math.PI / 2) * half, tip.y + Math.sin(angle - Math.PI / 2) * half);
      g.stroke();
      return;
    }
    if (kind === "dot") {
      g.fillStyle = item.stroke;
      g.beginPath();
      g.arc(tip.x, tip.y, Math.max(2, len * 0.32), 0, Math.PI * 2);
      g.fill();
      return;
    }
    if (kind === "triangle") {
      const spread = 0.44;
      g.fillStyle = item.stroke;
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      g.lineTo(tip.x + Math.cos(angle - spread) * len, tip.y + Math.sin(angle - spread) * len);
      g.lineTo(tip.x + Math.cos(angle + spread) * len, tip.y + Math.sin(angle + spread) * len);
      g.closePath();
      g.fill();
      return;
    }
    const spread = 0.42;
    g.beginPath();
    g.moveTo(tip.x + Math.cos(angle - spread) * len, tip.y + Math.sin(angle - spread) * len);
    g.lineTo(tip.x, tip.y);
    g.lineTo(tip.x + Math.cos(angle + spread) * len, tip.y + Math.sin(angle + spread) * len);
    g.stroke();
  }

  function traceRoundedPolyline(g, pts, radius) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    if (pts.length < 3 || radius < 0.5) {
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      return;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const next = pts[i + 1];
      const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
      const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
      const r = Math.min(radius, inLen / 2, outLen / 2);
      /* A rounded corner on a point that does not actually turn would
         bulge the line, so straight-through points stay square. */
      const turn = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
      if (Math.abs(turn) < 0.5 || r < 0.5) {
        g.lineTo(cur.x, cur.y);
        continue;
      }
      g.lineTo(cur.x + ((prev.x - cur.x) / inLen) * r, cur.y + ((prev.y - cur.y) / inLen) * r);
      g.quadraticCurveTo(
        cur.x, cur.y,
        cur.x + ((next.x - cur.x) / outLen) * r, cur.y + ((next.y - cur.y) / outLen) * r
      );
    }
    g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }

  /* Sampled version of the same rounded path, for the sketchy stroke. */
  function roundedPolylinePoints(pts, radius) {
    if (pts.length < 3 || radius < 0.5) return pts; 
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const next = pts[i + 1];
      const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
      const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
      const r = Math.min(radius, inLen / 2, outLen / 2);
      const turn = (cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x);
      if (Math.abs(turn) < 0.5 || r < 0.5) {
        out.push({ ...cur });
        continue;
      }
      const entry = {
        x: cur.x + ((prev.x - cur.x) / inLen) * r,
        y: cur.y + ((prev.y - cur.y) / inLen) * r,
      };
      const exit = {
        x: cur.x + ((next.x - cur.x) / outLen) * r,
        y: cur.y + ((next.y - cur.y) / outLen) * r,
      };
      out.push(entry);
      out.push(...quadraticPoints(entry, cur, exit, 5).slice(1));
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function drawPen(g, item) {
    const pts = absPoints(item);
    if (!pts.length) return;
    applyStroke(g, item);

    /* A click with the pen is a dot, not an invisible zero-length path. */
    if (pts.length === 1) {
      g.fillStyle = item.stroke;
      g.beginPath();
      g.arc(pts[0].x, pts[0].y, Math.max(1, item.strokeWidth / 2), 0, Math.PI * 2);
      g.fill();
      return;
    }

    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2) {
      g.lineTo(pts[1].x, pts[1].y);
    } else {
      /* Quadratic smoothing through the midpoint of each segment —
         keeps the stroke soft without needing the full point list. */
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      const last = pts[pts.length - 1];
      g.lineTo(last.x, last.y);
    }
    g.stroke();
  }

  function drawLinear(g, item) {
    const pts = absPoints(item);
    if (pts.length < 2) return;
    const style = pathStyleOf(item);
    const path = visualPoints(item);
    if (path.length < 2) return;

    if (item.roughness > 0) {
      roughStroke(
        g, item,
        style === "elbow" ? roundedPolylinePoints(path, ELBOW_CORNER) : path,
        false
      );
    } else {
      applyStroke(g, item);
      if (style === "elbow") traceRoundedPolyline(g, path, ELBOW_CORNER);
      else {
        g.beginPath();
        g.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y);
      }
      g.stroke();
    }

    /* Both ends can carry a mark, and the head follows the routed path's
       tangent rather than the chord of the element's anchor points. */
    const endKind = arrowheadOf(item, "end");
    const startKind = arrowheadOf(item, "start");
    if (endKind !== "none") {
      drawArrowHead(g, item, path[path.length - 1], path[path.length - 2], endKind);
    }
    if (startKind !== "none") {
      drawArrowHead(g, item, path[0], path[1], startKind);
    }
  }

  function drawHighlight(g, item) {
    const pts = absPoints(item);
    if (!pts.length) return;
    g.save();
    g.globalAlpha *= 0.42;
    /* Multiply keeps whatever is underneath readable, which is exactly
       what a marker over a PDF page or a screenshot should do. */
    g.globalCompositeOperation = "multiply";
    g.strokeStyle = item.stroke;
    g.lineWidth = Math.max(8, Math.max(1, item.strokeWidth) * 5);
    g.lineJoin = "round";
    g.lineCap = "butt";
    g.setLineDash([]);

    if (pts.length === 1) {
      g.beginPath();
      g.arc(pts[0].x, pts[0].y, g.lineWidth / 2, 0, Math.PI * 2);
      g.fillStyle = item.stroke;
      g.fill();
      g.restore();
      return;
    }

    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2) {
      g.lineTo(pts[1].x, pts[1].y);
    } else {
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        g.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      const last = pts[pts.length - 1];
      g.lineTo(last.x, last.y);
    }
    g.stroke();
    g.restore();
  }

  function drawText(g, item) {
    if (!item.text) return;
    const { lines } = textMetrics(item);
    g.font = fontSpec(item);
    g.fillStyle = item.stroke;
    g.textBaseline = "top";
    g.textAlign = item.textAlign === "center" ? "center" : item.textAlign === "right" ? "right" : "left";
    const x = item.x + (item.textAlign === "center" ? item.w / 2 : item.textAlign === "right" ? item.w : 0);
    const lh = lineHeight(item);
    for (let i = 0; i < lines.length; i++) {
      g.fillText(lines[i], x, item.y + i * lh);
    }
  }

  function drawImageElement(g, item) {
    const img = item.src ? drawableImage(item.src) : null;
    if (!img) return;
    /* PDF pages and screenshots are usually downscaled to fit the
       canvas. High-quality resampling keeps their text from turning
       soft when they are drawn at display size. */
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, item.x, item.y, item.w, item.h);
  }

  function drawElement(g, item) {
    g.save();
    g.globalAlpha = clamp(item.opacity ?? 1, 0, 1);
    if (item.type === "text") drawText(g, item);
    else if (item.type === "image") drawImageElement(g, item);
    else if (item.type === "pen") drawPen(g, item);
    else if (item.type === "highlight") drawHighlight(g, item);
    else if (item.type === "line" || item.type === "arrow") drawLinear(g, item);
    else drawBox(g, item);
    g.restore();
  }

  const isDarkTheme = () => document.documentElement.getAttribute("data-theme") === "dark";

  function drawGrid(w, h) {
    const z = state.view.zoom;
    let step = GRID * z;
    while (step < 11) step *= 2;
    const startX = ((-state.view.x * z) % step + step) % step;
    const startY = ((-state.view.y * z) % step + step) % step;
    ctx.fillStyle = isDarkTheme() ? "rgba(255, 255, 255, 0.08)" : "rgba(72, 58, 34, 0.14)";
    for (let x = startX; x < w; x += step) {
      for (let y = startY; y < h; y += step) ctx.fillRect(x, y, 1, 1);
    }
  }

  function drawHandle(px, py) {
    const half = HANDLE / 2;
    ctx.fillStyle = isDarkTheme() ? "#191924" : "#fffdf7";
    ctx.strokeStyle = isDarkTheme() ? "#38bdf8" : "#0b62c4";
    ctx.lineWidth = 1.4;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.rect(px - half, py - half, HANDLE, HANDLE);
    ctx.fill();
    ctx.stroke();
  }

  function drawSelection() {
    if (state.exportMode || state.editingId) return;
    const items = selected();
    if (!items.length) return;

    const z = state.view.zoom;
    ctx.save();
    ctx.strokeStyle = isDarkTheme() ? "#38bdf8" : "#0b62c4";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);

    if (items.length === 1) {
      const b = boundsOf(items[0]);
      ctx.strokeRect(sx(b.x) - 2, sy(b.y) - 2, b.w * z + 4, b.h * z + 4);
      ctx.setLineDash([]);
      for (const h of handlesFor(items[0])) drawHandle(sx(h.x), sy(h.y));
    } else {
      const b = unionBounds(items);
      ctx.strokeRect(sx(b.x) - 2, sy(b.y) - 2, b.w * z + 4, b.h * z + 4);
    }
    ctx.restore();
  }

  function drawBindHover() {
    if (!state.bindHover) return;
    const item = bindingById(state.bindHover);
    if (!item) return;
    const z = state.view.zoom;
    const dark = isDarkTheme();
    ctx.save();
    ctx.strokeStyle = "#0b62c4";
    ctx.lineWidth = 2 / z;
    ctx.setLineDash([]);
    ctx.translate(-state.view.x * z, -state.view.y * z);
    ctx.scale(z, z);
    if (item.type === "image") {
      ctx.beginPath();
      ctx.rect(item.x, item.y, item.w, item.h);
    } else {
      traceBox(ctx, item);
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    /* Corner and edge anchors stay visible while a connector is hovering
       the shape; the one closest to the cursor fills in. */
    for (const anchor of connectionAnchors(item)) {
      const active = anchor.name === state.bindAnchor;
      ctx.beginPath();
      ctx.arc(sx(anchor.x), sy(anchor.y), active ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = active ? "#0b62c4" : dark ? "#191924" : "#fffdf7";
      ctx.strokeStyle = dark ? "#7dd3fc" : "#0b62c4";
      ctx.lineWidth = active ? 2.4 : 1.6;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMarquee() {
    if (state.action?.kind !== "marquee") return;
    const a = state.action.start;
    const b = state.action.current;
    const x = sx(Math.min(a.x, b.x));
    const y = sy(Math.min(a.y, b.y));
    const w = Math.abs(b.x - a.x) * state.view.zoom;
    const h = Math.abs(b.y - a.y) * state.view.zoom;
    ctx.save();
    ctx.fillStyle = "rgba(11, 98, 196, 0.07)";
    ctx.strokeStyle = "#0b62c4";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function drawExportOverlay() {
    if (!state.exportMode || !state.exportRect) return;
    const r = state.exportRect;
    const x = sx(r.x);
    const y = sy(r.y);
    const w = r.w * state.view.zoom;
    const h = r.h * state.view.zoom;
    const cw = canvas.width / state.dpr;
    const ch = canvas.height / state.dpr;

    ctx.save();
    ctx.fillStyle = "rgba(34, 29, 21, 0.11)";
    ctx.fillRect(0, 0, cw, y);
    ctx.fillRect(0, y + h, cw, ch - (y + h));
    ctx.fillRect(0, y, x, h);
    ctx.fillRect(x + w, y, cw - (x + w), h);
    ctx.strokeStyle = "#0b62c4";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function drawAiSelectOverlay() {
    if (state.action?.kind !== "ai-select") return;
    const a = state.action.start;
    const b = state.action.current;
    const x = sx(Math.min(a.x, b.x));
    const y = sy(Math.min(a.y, b.y));
    const w = Math.abs(b.x - a.x) * state.view.zoom;
    const h = Math.abs(b.y - a.y) * state.view.zoom;
    ctx.save();
    ctx.fillStyle = "rgba(124, 58, 237, 0.12)";
    ctx.strokeStyle = "#8b5cf6";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  function render() {
    const dpr = state.dpr || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    if (!w || !h) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawGrid(w, h);

    const z = state.view.zoom;
    ctx.save();
    ctx.translate(-state.view.x * z, -state.view.y * z);
    ctx.scale(z, z);
    for (const item of state.elements) {
      if (item.id === state.editingId) continue;
      drawElement(ctx, item);
    }
    if (state.draft) drawElement(ctx, state.draft);
    ctx.restore();

    drawBindHover();
    drawSelection();
    drawMarquee();
    drawExportOverlay();
    drawAiSelectOverlay();
  }

  /* --- chrome ---------------------------------------------- */

  function updateUndoRedo() {
    el.undo.disabled = state.historyIndex <= 0;
    el.redo.disabled = state.historyIndex >= state.history.length - 1;
  }

  function updateCount() {
    const n = state.elements.length;
    el.count.textContent = `${n} element${n === 1 ? "" : "s"}`;
    el.empty.hidden = n > 0 || !!state.editingId || state.exportMode || !!state.draft;
  }

  function updateZoomLabel() {
    el.zoomLabel.textContent = `${Math.round(state.view.zoom * 100)}%`;
  }

  function updateHint() {
    let text = "Drag to draw · Drop or paste an image or PDF · Space to pan · V R D O L A P ⇧H X pick a tool";
    if (state.pending) {
      text = "Click to place the far end · drop it on a shape to connect · Esc to cancel";
    } else if (state.tool === "ai") {
      text = "Drag a box over lines, equations or figures to explain with AI · Esc to cancel";
    } else if (state.exportMode) {
      text = state.exportRect
        ? "Save to post, or copy/download the PNG · Esc to cancel"
        : "Drag a box around the diagram · Esc to cancel";
    } else if (state.tool === "text") {
      text = "Click to place text · Esc to finish";
    } else if (state.tool === "pen") {
      text = "Drag to draw freehand · V to select · Esc to finish";
    } else if (state.tool === "highlight") {
      text = "Drag over the page to highlight · pick a colour above · V to select";
    } else if (state.tool === "arrow" || state.tool === "line") {
      text = "Drag between shapes · ends snap to edges · Path \"elbow\" for right-angle flowcharts · Shift locks 45°";
    } else if (state.tool === "hand") {
      text = "Drag to pan · scroll to move";
    } else if (state.selected.size) {
      const picked = selected();
      const connector = picked.length === 1
        && (picked[0].type === "line" || picked[0].type === "arrow");
      text = connector
        ? "Drag an end to reconnect · double-click a straight/curved line to add a waypoint · Start/End marks above"
        : "Drag to move · handles resize · double-click text to edit";
    }
    el.hint.textContent = text;
  }

  function updateUI() {
    updateUndoRedo();
    updateCount();
    updateZoomLabel();
    updateHint();
    el.export.disabled = state.elements.length === 0;
    el.export.setAttribute("aria-pressed", String(state.exportMode));
  }

  function syncToolUI() {
    root.querySelectorAll("[data-tool]").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.tool === state.tool);
    });
    stage.classList.toggle("is-select", state.tool === "select");
    stage.classList.toggle("is-text", state.tool === "text");
  }

  function cursorForHandle(name) {
    return {
      nw: "nwse-resize", se: "nwse-resize",
      ne: "nesw-resize", sw: "nesw-resize",
      n: "ns-resize", s: "ns-resize",
      e: "ew-resize", w: "ew-resize",
      p0: "crosshair", p1: "crosshair",
    }[name] || (name.startsWith("p") ? "crosshair" : "default");
  }

  function handleAt(px, py) {
    const items = selected();
    if (items.length !== 1) return null;
    for (const h of handlesFor(items[0])) {
      if (Math.abs(px - sx(h.x)) <= HANDLE / 2 + 3 && Math.abs(py - sy(h.y)) <= HANDLE / 2 + 3) {
        return h.name;
      }
    }
    return null;
  }

  function hitElementAt(x, y) {
    const tol = 6 / state.view.zoom;
    for (let i = state.elements.length - 1; i >= 0; i--) {
      if (hitTest(state.elements[i], x, y, tol)) return state.elements[i];
    }
    return null;
  }

  /* --- connector binding ----------------------------------- */

  function bindingById(id) {
    return id ? state.elements.find((item) => item.id === id) || null : null;
  }

  /* The element an arrow/line would attach to at this point: anything
     under the cursor, or within a comfortable ring around a shape edge. */
  function bindableAt(x, y, excludeId = null) {
    const tol = 10 / state.view.zoom;
    for (let i = state.elements.length - 1; i >= 0; i--) {
      const item = state.elements[i];
      if (item.id === excludeId || !BINDABLE_TYPES.includes(item.type)) continue;
      if (hitTest(item, x, y, tol)) return item;
    }
    return null;
  }

  /* Like bindableAt, but also reports the nearest corner or edge anchor
     when the cursor is close to one. This is what makes a specific corner
     clickable rather than only the middle of a side. */
  function bindingTargetAt(x, y, excludeId = null) {
    const direct = bindableAt(x, y, excludeId);
    if (direct) {
      const anchor = nearestAnchor(direct, x, y, ANCHOR_SNAP / state.view.zoom);
      return { item: direct, anchor: anchor ? anchor.name : null };
    }

    /* Just outside a shape, a corner dot is still a valid target. Prefer
       the closest anchor among the topmost candidates. */
    const snap = ANCHOR_SNAP / state.view.zoom;
    let best = null;
    let bestDistance = snap;
    for (let i = state.elements.length - 1; i >= 0; i--) {
      const item = state.elements[i];
      if (item.id === excludeId || !BINDABLE_TYPES.includes(item.type)) continue;
      const anchor = nearestAnchor(item, x, y, snap);
      if (!anchor) continue;
      const distance = Math.hypot(anchor.x - x, anchor.y - y);
      if (distance <= bestDistance) {
        best = { item, anchor: anchor.name };
        bestDistance = distance;
      }
    }
    return best;
  }

  function bindingEndpoint(binding, item, toward) {
    const anchored = binding?.anchor ? anchorPoint(item, binding.anchor) : null;
    if (anchored) return anchored;
    /* An auto-bound end still resolves to one of the eight anchors, so a
       connector drawn between two shapes lands on a corner or edge rather
       than at an arbitrary point on the bounding box. */
    const nearest = nearestAnchor(item, toward.x, toward.y);
    return nearest ? { x: nearest.x, y: nearest.y } : outlinePoint(item, toward);
  }

  /* Re-route a connector so its endpoints sit on the edges of whatever it
     is bound to. A corner/edge anchor stays fixed; auto-bound ends slide
     along the outline towards the other end. */
  function routeLinear(item, startAt = null, endAt = null) {
    const pts = absPoints(item);
    if (!pts.length) return;
    let start = startAt || pts[0];
    let end = endAt || pts[pts.length - 1];
    const s = bindingById(item.startBinding?.id);
    const e = bindingById(item.endBinding?.id);
    if (s && e) {
      start = bindingEndpoint(item.startBinding, s, centerOf(e));
      end = bindingEndpoint(item.endBinding, e, centerOf(s));
    } else if (s) {
      start = bindingEndpoint(item.startBinding, s, end);
    } else if (e) {
      end = bindingEndpoint(item.endBinding, e, start);
    }
    /* Waypoints in the middle belong to the writer: only the ends move
       when a shape they are tied to moves. */
    const middle = pts.slice(1, -1);
    setLinePoints(item, [start, ...middle, end]);
  }

  function routeBoundArrows() {
    for (const item of state.elements) {
      if ((item.type === "line" || item.type === "arrow") && (item.startBinding || item.endBinding)) {
        routeLinear(item);
      }
    }
  }

  /* Copies keep their links only when both ends were copied together. */
  function remapBindings(copies, sources) {
    const map = new Map(sources.map((source, i) => [source.id, copies[i].id]));
    for (const copy of copies) {
      for (const side of ["startBinding", "endBinding"]) {
        const id = copy[side]?.id;
        if (!id) continue;
        copy[side] = map.has(id) ? { ...copy[side], id: map.get(id) } : null;
      }
    }
  }

  function updateCursor() {
    if (state.action?.kind === "pan") {
      stage.style.cursor = "grabbing";
      return;
    }
    if (state.space || state.tool === "hand") {
      stage.style.cursor = "grab";
      return;
    }
    if (state.exportMode) {
      stage.style.cursor = "crosshair";
      return;
    }
    if (state.tool === "text") {
      stage.style.cursor = "text";
      return;
    }
    if (state.tool !== "select") {
      stage.style.cursor = "crosshair";
      return;
    }
    const p = state.lastPointer;
    if (p) {
      const h = handleAt(p.px, p.py);
      if (h) { stage.style.cursor = cursorForHandle(h); return; }
      /* Only an already-selected element is draggable. An unselected
         shape keeps the normal pointer so the first click selects it
         (and a double-click can open its text). */
      const hovered = hitElementAt(p.x, p.y);
      if (hovered && state.selected.has(hovered.id)) {
        stage.style.cursor = "move";
        return;
      }
    }
    stage.style.cursor = "default";
  }

  function setTool(tool) {
    if (!["select", "hand", "rect", "diamond", "ellipse", "line", "arrow", "pen", "highlight", "text", "ai"].includes(tool)) return;
    if (state.editingId) commitText();
    if (state.pending) cancelPendingDraw();
    if (tool === "ai") {
      const aiCfg = typeof opts.getAiConfig === "function" ? opts.getAiConfig() : null;
      if (!aiCfg || !aiCfg.apiKey?.trim()) {
        if (typeof opts.openAiSettings === "function") opts.openAiSettings();
        notify("Please enter your AI API key in Settings first");
        return;
      }
    }
    /* A highlighter that draws in the current ink colour is not much of a
       highlighter, so pick a marker yellow unless a colour was chosen. */
    if (tool === "highlight" && state.tool !== "highlight" && state.style.stroke === "#1e1e1e") {
      state.style.stroke = HIGHLIGHT_COLOR;
      syncStyleUI();
    }
    state.tool = tool;
    state.bindHover = null;
    state.bindAnchor = null;
    if (tool !== "select" && tool !== "hand") {
      state.selected.clear();
      syncStyleUI();
    }
    syncToolUI();
    updateHint();
    updateCursor();
    render();
  }

  function selectOnly(item) {
    state.selected = new Set([item.id]);
    syncStyleUI();
    updateHint();
  }

  /* --- drawing --------------------------------------------- */

  function updateDraft(p, event) {
    const a = state.action;
    if (!a || !state.draft) return;
    const item = state.draft;
    const start = a.start;

    if (item.type === "pen" || item.type === "highlight") {
      const last = item.points[item.points.length - 1];
      const step = 1.5 / state.view.zoom;
      if (!last || Math.hypot(p.x - start.x - last.x, p.y - start.y - last.y) >= step) {
        item.points.push({ x: p.x - start.x, y: p.y - start.y });
      }
      render();
      return;
    }

    if (item.type === "line" || item.type === "arrow") {
      const free = event.shiftKey
        ? snapLine({ x: start.x, y: start.y }, { x: p.x, y: p.y }, true)
        : { x: p.x, y: p.y };
      /* Snap the far end onto a shape as soon as the cursor is over one,
         and outline that shape so the connection is obvious. */
      const target = bindingTargetAt(p.x, p.y, item.startBinding?.id || null);
      item.endBinding = target ? { id: target.item.id, anchor: target.anchor } : null;
      state.bindHover = target ? target.item.id : null;
      state.bindAnchor = target ? target.anchor : null;
      routeLinear(item, { x: start.x, y: start.y }, free);
      render();
      return;
    } else {
      let x1 = start.x;
      let y1 = start.y;
      let x2 = p.x;
      let y2 = p.y;
      if (event.shiftKey) {
        const size = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
        x2 = x1 + (x2 < x1 ? -size : size);
        y2 = y1 + (y2 < y1 ? -size : size);
      }
      if (event.altKey) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        x1 = start.x - dx;
        y1 = start.y - dy;
      }
      item.x = Math.min(x1, x2);
      item.y = Math.min(y1, y2);
      item.w = Math.abs(x2 - x1);
      item.h = Math.abs(y2 - y1);
    }
    render();
  }

  function finishDraw() {
    const item = state.draft;
    state.draft = null;
    if (!item) return;

    if (item.type === "pen" || item.type === "highlight") {
      setLinePoints(item, absPoints(item));
    } else if (item.type === "line" || item.type === "arrow") {
      if (item.w < 2 && item.h < 2) {
        item.startBinding = null;
        item.endBinding = null;
        setLinePoints(item, [{ x: item.x, y: item.y }, { x: item.x + 180, y: item.y }]);
      } else {
        routeLinear(item);
      }
      state.bindHover = null;
      state.bindAnchor = null;
    } else {
      if (item.w < 4) item.w = 160;
      if (item.h < 4) item.h = 100;
    }

    state.elements.push(item);

    /* Do not leave a new shape selected. The select tool is active, but
       the move cursor/handles only appear after the user deliberately
       clicks the shape. That keeps a fresh shape out of "drag mode", so
       a double-click inside it can start typing immediately. Freehand
       drawing stays active so several strokes can be drawn in a row. */
    state.selected.clear();
    if (item.type !== "pen" && item.type !== "highlight") {
      state.tool = "select";
      syncToolUI();
    }

    commitHistory();
    syncStyleUI();
    updateUI();
    updateCursor();
    render();
    scheduleSave();
  }

  /* --- click, then click again ----------------------------- */

  /* A connector started with a click (rather than a drag) follows the
     cursor until the next click, like Excalidraw's two-point arrows. */
  function startPendingDraw(action) {
    state.pending = { item: action.item, start: { x: action.start.x, y: action.start.y } };
    state.draft = action.item;
    state.bindHover = null;
    state.bindAnchor = null;
    updateHint();
    render();
  }

  function cancelPendingDraw() {
    if (!state.pending) return;
    state.pending = null;
    state.draft = null;
    state.bindHover = null;
    state.bindAnchor = null;
    updateHint();
    updateUI();
    render();
  }

  /* Esc abandons whatever gesture is in flight — an unfinished box or
     arrow, a drag, a resize, a marquee or a pan — and returns to the
     normal pointer. The draft is discarded rather than committed. */
  function abortGesture() {
    const a = state.action;
    const active = !!a || !!state.pending || !!state.draft;
    if (!active) return false;

    if (a?.kind === "move") {
      for (const original of a.items) {
        const item = state.elements.find((e) => e.id === original.id);
        if (!item) continue;
        item.x = original.x;
        item.y = original.y;
      }
    } else if (a?.kind === "resize") {
      const item = a.item;
      if (item) {
        item.x = a.start.x;
        item.y = a.start.y;
        item.w = a.start.w;
        item.h = a.start.h;
        if (a.points) item.points = a.points.map((p) => ({ ...p }));
        if (item.type === "text") refreshTextSize(item);
      }
    } else if (a?.kind === "pan") {
      state.view = { ...a.view };
    }

    state.action = null;
    state.draft = null;
    state.pending = null;
    state.bindHover = null;
    state.bindAnchor = null;
    state.tool = "select";
    syncToolUI();
    routeBoundArrows();
    updateHint();
    updateUI();
    updateCursor();
    render();
    return true;
  }

  function finishPendingDraw(p) {
    const pending = state.pending;
    if (!pending) return;
    state.pending = null;
    state.draft = pending.item;
    const target = bindingTargetAt(p.x, p.y, pending.item.startBinding?.id || null);
    pending.item.endBinding = target ? { id: target.item.id, anchor: target.anchor } : null;
    state.bindHover = null;
    state.bindAnchor = null;
    routeLinear(pending.item, pending.start, { x: p.x, y: p.y });
    finishDraw();
  }

  /* --- moving / resizing ----------------------------------- */

  function beginMove(start) {
    state.action = {
      kind: "move",
      start,
      items: selected().map((item) => ({ id: item.id, x: item.x, y: item.y })),
      moved: false,
    };
    stage.style.cursor = "move";
  }

  function updateMove(p, shift) {
    const a = state.action;
    let dx = p.x - a.start.x;
    let dy = p.y - a.start.y;
    /* A few pixels of slack before anything actually moves, so the two
       clicks of a double-click never nudge a shape out of place. */
    if (!a.moved && Math.hypot(dx, dy) * state.view.zoom < 3) return;
    if (shift) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    /* Dragging a connector itself detaches it; otherwise re-routing would
       pin it in place and the drag would feel broken. A plain click does
       not move it, so its links survive selecting the arrow. */
    if (!a.detached && Math.abs(dx) + Math.abs(dy) > 0.5) {
      a.detached = true;
      for (const original of a.items) {
        const item = state.elements.find((e) => e.id === original.id);
        if (item && (item.type === "line" || item.type === "arrow")) {
          item.startBinding = null;
          item.endBinding = null;
        }
      }
    }
    for (const original of a.items) {
      const item = state.elements.find((e) => e.id === original.id);
      if (!item) continue;
      item.x = original.x + dx;
      item.y = original.y + dy;
    }
    if (Math.abs(dx) + Math.abs(dy) > 0.5) a.moved = true;
    routeBoundArrows();
    render();
  }

  function beginResize(item, handle) {
    state.action = {
      kind: "resize",
      item,
      handle,
      start: { x: item.x, y: item.y, w: item.w, h: item.h },
      points: item.points ? item.points.map((p) => ({ ...p })) : null,
      moved: false,
    };
    stage.style.cursor = cursorForHandle(handle);
  }

  function bindDraggedEnd(item, handle) {
    const pts = absPoints(item);
    const index = handle.startsWith("p") ? Number(handle.slice(1)) : -1;
    /* Only the two ends can attach to a shape; waypoints stay free. */
    if (index !== 0 && index !== pts.length - 1) return;
    const point = pts[index];
    const other = index === 0 ? item.endBinding?.id : item.startBinding?.id;
    const target = bindingTargetAt(point.x, point.y, other || null);
    if (!target) return;
    if (index === 0) item.startBinding = { id: target.item.id, anchor: target.anchor };
    else item.endBinding = { id: target.item.id, anchor: target.anchor };
    routeLinear(item);
  }

  function updateResize(p, event) {
    const a = state.action;
    const item = a.item;
    const b = a.start;
    const shift = event.shiftKey;

    if (item.type === "line" || item.type === "arrow") {
      const abs = a.points.map((pt) => ({ x: b.x + pt.x, y: b.y + pt.y }));
      const index = a.handle.startsWith("p") ? Number(a.handle.slice(1)) : abs.length - 1;
      const atStart = index === 0;
      const atEnd = index === abs.length - 1;
      /* Pulling an end away detaches that side; releasing it over another
         shape re-binds there, which is handled in onPointerUp. Moving a
         middle waypoint leaves both bindings alone. */
      if (atStart) item.startBinding = null;
      else if (atEnd) item.endBinding = null;
      const anchor = atEnd ? abs[Math.max(0, abs.length - 2)] : abs[Math.min(abs.length - 1, 1)];
      const moving = shift ? snapLine(anchor, p, true) : { x: p.x, y: p.y };
      abs[index] = moving;
      setLinePoints(item, abs);
      routeLinear(item);
      a.moved = true;
      render();
      return;
    }

    if (item.type === "text") {
      let left = b.x;
      let right = b.x + b.w;
      if (a.handle === "w") left = Math.min(p.x, right - 60);
      else right = Math.max(p.x, left + 60);
      item.x = left;
      item.w = right - left;
      refreshTextSize(item);
      a.moved = true;
      render();
      return;
    }

    let left = b.x;
    let right = b.x + b.w;
    let top = b.y;
    let bottom = b.y + b.h;
    if (a.handle.includes("w")) left = p.x;
    if (a.handle.includes("e")) right = p.x;
    if (a.handle.includes("n")) top = p.y;
    if (a.handle.includes("s")) bottom = p.y;

    const MIN = 6;
    if (right - left < MIN) {
      if (a.handle.includes("w")) left = right - MIN;
      else right = left + MIN;
    }
    if (bottom - top < MIN) {
      if (a.handle.includes("n")) top = bottom - MIN;
      else bottom = top + MIN;
    }

    if (shift && a.handle.length === 2) {
      const ratio = b.w / Math.max(1, b.h);
      const w = right - left;
      const h = bottom - top;
      if (w / Math.max(1, h) > ratio) {
        const nh = w / ratio;
        if (a.handle.includes("n")) top = bottom - nh;
        else bottom = top + nh;
      } else {
        const nw = h * ratio;
        if (a.handle.includes("w")) left = right - nw;
        else right = left + nw;
      }
    }

    /* Images keep their aspect ratio; otherwise a screenshot turns
       into a squashed rectangle the moment you resize it. */
    if (item.type === "image" && b.w > 0 && b.h > 0) {
      const ratio = b.w / b.h;
      let w = right - left;
      let h = bottom - top;
      if (w / Math.max(1, h) > ratio) w = h * ratio;
      else h = w / ratio;
      if (a.handle.includes("w")) left = right - w;
      else right = left + w;
      if (a.handle.includes("n")) top = bottom - h;
      else bottom = top + h;
    }

    if (item.type === "pen" || item.type === "highlight") {
      const nextW = Math.max(1, right - left);
      const nextH = Math.max(1, bottom - top);
      const scaleX = b.w > 0 ? nextW / b.w : 1;
      const scaleY = b.h > 0 ? nextH / b.h : 1;
      item.points = a.points.map((pt) => ({ x: pt.x * scaleX, y: pt.y * scaleY }));
    }

    item.x = left;
    item.y = top;
    item.w = Math.max(1, right - left);
    item.h = Math.max(1, bottom - top);
    if (item.type === "text") refreshTextSize(item);
    routeBoundArrows();
    a.moved = true;
    render();
  }

  /* --- marquee --------------------------------------------- */

  function finishMarquee(a) {
    const r = {
      x: Math.min(a.start.x, a.current.x),
      y: Math.min(a.start.y, a.current.y),
      w: Math.abs(a.current.x - a.start.x),
      h: Math.abs(a.current.y - a.start.y),
    };
    if (r.w < 2 && r.h < 2) {
      render();
      return;
    }
    const hits = state.elements.filter((item) => rectsOverlap(r, boundsOf(item)));
    state.selected = new Set([...a.base, ...hits.map((item) => item.id)]);
    syncStyleUI();
    updateHint();
    render();
  }

  /* --- in-place text --------------------------------------- */

  function positionTextEditor(item) {
    const z = state.view.zoom;
    const ta = el.textEditor;
    ta.style.left = `${sx(item.x)}px`;
    ta.style.top = `${sy(item.y)}px`;
    ta.style.font = `${item.fontSize * z}px ${fontFor(item)}`;
    ta.style.lineHeight = "1.25";
    ta.style.color = item.stroke;
    ta.style.textAlign = item.textAlign || "left";
    autoGrowText();
  }

  function autoGrowText() {
    const ta = el.textEditor;
    if (ta.hidden) return;
    const item = state.elements.find((e) => e.id === state.editingId);
    const z = state.view.zoom;
    const size = item ? item.fontSize : 20;
    ta.style.height = "auto";
    ta.style.height = `${Math.max(size * z * 1.25, ta.scrollHeight)}px`;
    /* The editor grows sideways with the longest line, so typing feels
       like writing on the canvas rather than filling a text box. */
    if (item) {
      measureCtx.font = fontSpec(item);
      let width = 0;
      for (const line of String(ta.value || "").split("\n")) {
        width = Math.max(width, measureCtx.measureText(line).width);
      }
      ta.style.width = `${Math.max(size * 0.55, width) * z + 2}px`;
    }
  }

  function startNewTextAt(p) {
    const item = blankElement("text", p.x, p.y, 0, 0, state.style);
    state.elements.push(item);
    state.tool = "select";
    state.selected = new Set([item.id]);
    syncToolUI();
    startTextEdit(item, true);
    updateUI();
    render();
  }

  function startTextEdit(item, isNew) {
    if (state.editingId) commitText();
    state.editingId = item.id;
    state.editingNew = !!isNew;
    state.selected = new Set([item.id]);
    state.tool = "select";
    syncToolUI();
    syncStyleUI();

    const ta = el.textEditor;
    ta.value = item.text || "";
    ta.hidden = false;
    positionTextEditor(item);
    updateUI();
    render();
    ta.focus({ preventScroll: true });
    if (!isNew) ta.select();
  }

  function closeTextEditor() {
    state.editingId = null;
    state.editingNew = false;
    if (el.textEditor) {
      el.textEditor.hidden = true;
      el.textEditor.value = "";
    }
  }

  function commitText() {
    if (!state.editingId) return;
    const item = state.elements.find((e) => e.id === state.editingId);
    const ta = el.textEditor;
    const value = ta.value.replace(/\r/g, "");
    const wasNew = state.editingNew;

    state.editingId = null;
    state.editingNew = false;
    ta.hidden = true;

    if (!item) {
      updateUI();
      render();
      return;
    }

    if (!value.trim()) {
      state.elements = state.elements.filter((e) => e !== item);
      state.selected.delete(item.id);
      if (!wasNew) commitHistory();
      syncStyleUI();
      updateUI();
      render();
      scheduleSave();
      return;
    }

    item.text = value;
    refreshTextSize(item);
    /* A freshly typed label should look like ink on the canvas, not a
       selected object with a bounding box around it. */
    if (wasNew) state.selected.delete(item.id);
    commitHistory();
    syncStyleUI();
    updateUI();
    render();
    scheduleSave();
  }

  /* Text height depends on the font that actually loaded. The hand
     font arrives after first paint, so re-measure once it is ready. */
  function recomputeTextHeights() {
    let changed = false;
    for (const item of state.elements) {
      if (item.type !== "text") continue;
      const beforeW = item.w;
      const beforeH = item.h;
      refreshTextSize(item);
      if (Math.abs(item.h - beforeH) > 0.01 || Math.abs(item.w - beforeW) > 0.01) changed = true;
    }
    if (state.editingId) {
      const item = state.elements.find((e) => e.id === state.editingId);
      if (item) positionTextEditor(item);
    }
    if (changed) scheduleSave();
    if (state.isOpen) render();
  }

  /* --- selection helpers ----------------------------------- */

  function deleteSelected() {
    if (!state.selected.size) return;
    const removed = new Set(state.selected);
    state.elements = state.elements.filter((item) => !removed.has(item.id));
    for (const item of state.elements) {
      if (item.startBinding && removed.has(item.startBinding.id)) item.startBinding = null;
      if (item.endBinding && removed.has(item.endBinding.id)) item.endBinding = null;
    }
    state.selected.clear();
    commitHistory();
    syncStyleUI();
    updateUI();
    render();
  }

  function copySelected() {
    const items = selected();
    if (!items.length) return;
    state.clipboard = JSON.parse(JSON.stringify(items));
    notify(`Copied ${items.length} element${items.length === 1 ? "" : "s"}`);
  }

  function pasteClipboard() {
    if (!state.clipboard.length) return;
    const source = JSON.parse(JSON.stringify(state.clipboard));
    const b = unionBounds(source);
    const target = state.lastPointer;
    const dx = target ? target.x - b.x : 24;
    const dy = target ? target.y - b.y : 24;
    const copies = source.map((item) => ({
      ...item,
      id: uid(),
      seed: (Math.random() * 2147483647) | 0,
      x: item.x + dx,
      y: item.y + dy,
    }));
    remapBindings(copies, source);
    state.elements.push(...copies);
    routeBoundArrows();
    state.selected = new Set(copies.map((item) => item.id));
    commitHistory();
    syncStyleUI();
    updateUI();
    render();
  }

  function duplicateSelected() {
    const items = selected();
    if (!items.length) return;
    const copies = JSON.parse(JSON.stringify(items)).map((item) => ({
      ...item,
      id: uid(),
      seed: (Math.random() * 2147483647) | 0,
      x: item.x + 22,
      y: item.y + 22,
    }));
    remapBindings(copies, items);
    state.elements.push(...copies);
    routeBoundArrows();
    state.selected = new Set(copies.map((item) => item.id));
    commitHistory();
    syncStyleUI();
    updateUI();
    render();
  }

  /* --- export ---------------------------------------------- */

  function renderCrop(rect, scale = 2) {
    const area = Math.max(1, rect.w * rect.h);
    let s = scale;
    if (area * s * s > 12_000_000) s = Math.sqrt(12_000_000 / area);
    s = Math.min(s, 8192 / Math.max(1, rect.w), 8192 / Math.max(1, rect.h));
    s = Math.max(0.2, s);

    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(rect.w * s));
    out.height = Math.max(1, Math.round(rect.h * s));
    const g = out.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.setTransform(s, 0, 0, s, -rect.x * s, -rect.y * s);
    for (const item of state.elements) drawElement(g, item);
    return out;
  }

  /* How many output pixels a world unit deserves. Vector shapes look
     right at 2x, but a PDF page bitmap carries around six pixels per
     world unit; exporting it at 2x threw away two thirds of the detail
     the page had already been rendered with. When the crop contains a
     bitmap, follow its own density (capped, because renderCrop still
     keeps the total pixel budget in check). */
  function exportScaleFor(rect) {
    let density = 0;
    for (const item of state.elements) {
      if (item.type !== "image" || !item.src || item.w <= 0) continue;
      if (!rectsOverlap(boundsOf(item), rect)) continue;
      const img = drawableImage(item.src);
      const natural = img?.naturalWidth || 0;
      if (natural > 0) density = Math.max(density, natural / item.w);
    }
    return clamp(Math.max(2, density), 2, 6);
  }

  function cropBlob() {
    const rect = state.exportRect;
    if (!rect) return Promise.reject(new Error("Select an area first"));

    /* Wait for the diagram fonts (including Virgil) before rasterising,
       otherwise a text element can fall back to a different face. */
    return Promise.all([ensureExportFonts(), ensureImages()]).then(() => {
      const out = renderCrop(rect, exportScaleFor(rect));
      return new Promise((resolve, reject) => {
        out.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Could not render the PNG"));
        }, "image/png");
      });
    });
  }

  async function ensureExportFonts() {
    if (!document.fonts?.load) return;
    const specs = new Set(['20px "Virgil"']);
    for (const item of state.elements) {
      if (item.type === "text") specs.add(fontSpec(item));
    }
    await Promise.all([...specs].map((spec) => document.fonts.load(spec).catch(() => {})));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function beginExport() {
    if (!state.elements.length) {
      notify("Draw something first");
      return;
    }
    if (state.exportMode) {
      cancelExport();
      return;
    }
    if (state.editingId) commitText();
    state.exportMode = true;
    state.exportRect = null;
    state.exportMarkdown = "";
    state.selected.clear();
    el.exportPanel.hidden = true;
    el.exportInsert.hidden = true;
    syncStyleUI();
    updateUI();
    render();
    notify("Drag a box around the area to export");
  }

  function cancelExport() {
    state.exportMode = false;
    state.exportRect = null;
    state.exportMarkdown = "";
    el.exportPanel.hidden = true;
    updateUI();
    render();
  }

  function retakeExport() {
    el.exportPanel.hidden = true;
    state.exportRect = null;
    state.exportMarkdown = "";
    el.exportInsert.hidden = true;
    updateHint();
    render();
  }

  async function showExportPanel() {
    const r = state.exportRect;
    if (!r) return;
    await Promise.all([ensureExportFonts(), ensureImages()]);
    if (state.exportRect !== r) return;
    const thumbScale = Math.min(1, 150 / Math.max(1, r.w), 110 / Math.max(1, r.h));
    el.exportThumb.src = renderCrop(r, thumbScale).toDataURL("image/png");
    el.exportTitle.textContent = `Selection · ${Math.round(r.w)} × ${Math.round(r.h)}`;
    el.exportSnippet.textContent = state.exportMarkdown || "Save to post to get the markdown path.";
    el.exportSave.disabled = false;
    el.exportSave.textContent = "Save to post";
    el.exportInsert.hidden = !state.exportMarkdown;
    el.exportInsert.disabled = !state.exportMarkdown;
    el.exportPanel.hidden = false;
    updateHint();
  }

  async function saveExport() {
    if (!state.exportRect) return;
    el.exportSave.disabled = true;
    el.exportSave.textContent = "Saving…";
    try {
      let slug;
      if (typeof opts.ensureSlug === "function") slug = await opts.ensureSlug();
      else slug = opts.getSlug?.() || null;
      if (!slug) {
        notify("Add a title first — then the diagram can be saved next to the post");
        return;
      }

      const blob = await cropBlob();
      const d = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const name = `diagram-${stamp}.png`;

      let data;
      if (typeof opts.uploadImage === "function") {
        data = await opts.uploadImage(blob, name);
      } else {
        const res = await fetch(`/api/upload?slug=${encodeURIComponent(slug)}`, {
          method: "POST",
          headers: {
            "content-type": "image/png",
            "x-filename": encodeURIComponent(name),
          },
          body: blob,
        });
        data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Upload failed");
      }

      const markdown = `![diagram](${data.path})`;
      state.exportMarkdown = markdown;
      el.exportSnippet.textContent = markdown;
      el.exportTitle.textContent = `Selection · ${Math.round(state.exportRect.w)} × ${Math.round(state.exportRect.h)} · saved`;
      el.exportInsert.hidden = false;
      el.exportInsert.disabled = false;

      const copied = await copyText(markdown);
      notify(copied ? "Saved · markdown copied — paste it into the post" : "Saved · copy the markdown from the panel");
    } catch (err) {
      notify(err.message || "Could not save the diagram");
    } finally {
      el.exportSave.disabled = false;
      el.exportSave.textContent = "Save to post";
    }
  }

  async function copyExportImage() {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("This browser cannot copy images — use Download instead");
      }
      const blob = await cropBlob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      notify("PNG copied to the clipboard");
    } catch (err) {
      notify(err.message || "Could not copy the image");
    }
  }

  async function downloadExport() {
    try {
      const blob = await cropBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "diagram.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      notify("PNG downloaded");
    } catch (err) {
      notify(err.message || "Could not download the image");
    }
  }

  function insertExport() {
    if (!state.exportMarkdown) return;
    if (typeof opts.insertMarkdown === "function") opts.insertMarkdown(state.exportMarkdown);
    notify("Inserted into the post");
    cancelExport();
  }

  /* --- AI Line Explainer ----------------------------------- */

  let activeAiHighlight = null;
  let currentAiExplanation = "";

  const AI_PROVIDER_NAMES = {
    google: "Google",
    openai: "OpenAI",
    anthropic: "Anthropic",
    openrouter: "OpenRouter",
    groq: "Groq",
  };

  function extractPdfTextInBounds(rawBounds) {
    if (!rawBounds) return null;
    const padY = Math.max(16, (rawBounds.h < 12 ? 16 : 6));
    const padX = Math.max(12, (rawBounds.w < 12 ? 12 : 6));
    const bounds = {
      x: rawBounds.x - padX,
      y: rawBounds.y - padY,
      w: Math.max(rawBounds.w + padX * 2, 28),
      h: Math.max(rawBounds.h + padY * 2, 28),
    };

    for (const item of state.elements) {
      if (item.type !== "image") continue;
      const pb = boundsOf(item);
      if (!rectsOverlap(bounds, pb)) continue;

      if (item.pdfMeta?.textItems?.length) {
        const rx1 = (bounds.x - item.x) / item.w;
        const ry1 = (bounds.y - item.y) / item.h;
        const rx2 = (bounds.x + bounds.w - item.x) / item.w;
        const ry2 = (bounds.y + bounds.h - item.y) / item.h;

        const hits = [];
        for (const t of item.pdfMeta.textItems) {
          const itemX2 = t.rx + t.rw;
          const itemY2 = t.ry + t.rh;
          const overlaps = !(rx2 < t.rx || rx1 > itemX2 || ry2 < t.ry || ry1 > itemY2);
          if (overlaps) hits.push(t);
        }

        if (hits.length) {
          hits.sort((a, b) => {
            if (Math.abs(a.ry - b.ry) < 0.012) return a.rx - b.rx;
            return a.ry - b.ry;
          });

          let text = "";
          let lastRy = null;
          for (const hit of hits) {
            if (lastRy !== null && Math.abs(hit.ry - lastRy) >= 0.012) {
              text += "\n" + hit.text;
            } else {
              text += (text ? " " : "") + hit.text;
            }
            lastRy = hit.ry;
          }

          text = text.replace(/ +/g, " ").trim();
          return { page: item, text, bounds };
        }
      }

      return { page: item, text: "", bounds };
    }

    return { page: null, text: "", bounds };
  }

  let aiCardDrag = null;
  let aiCardUserMoved = false;

  function clampAiCard(left, top, cardW = el.aiExplainCard?.offsetWidth || 440, cardH = el.aiExplainCard?.offsetHeight || 360) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    return {
      left: clamp(left, margin, Math.max(margin, vw - cardW - margin)),
      top: clamp(top, margin, Math.max(margin, vh - cardH - margin)),
    };
  }

  function positionAiExplainCard(bounds) {
    if (!el.aiExplainCard || !bounds) return;
    const stageRect = stage.getBoundingClientRect();
    const cardW = el.aiExplainCard.offsetWidth || 440;
    const cardH = el.aiExplainCard.offsetHeight || 360;
    const targetX = stageRect.left + sx(bounds.x + bounds.w + 14);
    const targetY = stageRect.top + sy(bounds.y);

    let left = targetX;
    if (left + cardW + 12 > window.innerWidth) {
      left = stageRect.left + sx(bounds.x) - cardW - 14;
    }
    if (left < 10) left = Math.max(12, (window.innerWidth - cardW) / 2);

    const top = clamp(targetY, 12, Math.max(12, window.innerHeight - cardH - 12));
    const pos = clampAiCard(left, top, cardW, cardH);

    el.aiExplainCard.style.left = `${Math.round(pos.left)}px`;
    el.aiExplainCard.style.top = `${Math.round(pos.top)}px`;
  }

  function startAiCardDrag(event) {
    if (!el.aiExplainCard || el.aiExplainCard.hidden) return;
    if (event.button !== 0) return;
    if (event.target.closest("button, input, textarea, select, a")) return;

    event.preventDefault();
    const cardRect = el.aiExplainCard.getBoundingClientRect();
    aiCardDrag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - cardRect.left,
      offsetY: event.clientY - cardRect.top,
      cardW: el.aiExplainCard.offsetWidth,
      cardH: el.aiExplainCard.offsetHeight,
    };
    aiCardUserMoved = true;
    el.aiExplainCard.classList.add("is-dragging");
    try { el.aiExplainCard.setPointerCapture(event.pointerId); } catch {}
    window.addEventListener("pointermove", onAiCardDragMove);
    window.addEventListener("pointerup", stopAiCardDrag);
    window.addEventListener("pointercancel", stopAiCardDrag);
  }

  function onAiCardDragMove(event) {
    if (!aiCardDrag || !el.aiExplainCard) return;
    const left = event.clientX - aiCardDrag.offsetX;
    const top = event.clientY - aiCardDrag.offsetY;
    const pos = clampAiCard(left, top, aiCardDrag.cardW, aiCardDrag.cardH);

    /* Keep the card under the pointer without snapping to whole pixels. */
    el.aiExplainCard.style.left = `${pos.left}px`;
    el.aiExplainCard.style.top = `${pos.top}px`;
  }

  function stopAiCardDrag() {
    if (!aiCardDrag) return;
    try {
      if (el.aiExplainCard?.hasPointerCapture(aiCardDrag.pointerId)) {
        el.aiExplainCard.releasePointerCapture(aiCardDrag.pointerId);
      }
    } catch {}
    aiCardDrag = null;
    el.aiExplainCard?.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onAiCardDragMove);
    window.removeEventListener("pointerup", stopAiCardDrag);
    window.removeEventListener("pointercancel", stopAiCardDrag);
  }

  function closeAiExplainCard() {
    stopAiCardDrag();
    aiCardUserMoved = false;
    if (el.aiExplainCard) el.aiExplainCard.hidden = true;
    currentAiExplanation = "";
  }

  function formatAiMarkdown(text) {
    if (!text) return "";
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n\n+/g, "<br><br>")
      .replace(/\n/g, "<br>");
  }

  async function triggerAiExplain(question = null) {
    if (!activeAiHighlight) return;

    const aiCfg = typeof opts.getAiConfig === "function" ? opts.getAiConfig() : null;
    if (!aiCfg || !aiCfg.apiKey?.trim()) {
      if (typeof opts.openAiSettings === "function") opts.openAiSettings();
      notify("Please configure your AI API key in Settings first");
      return;
    }

    const b = activeAiHighlight.bounds;
    el.aiExplainCard.hidden = false;
    if (!aiCardUserMoved) positionAiExplainCard(b);

    const pageNum = activeAiHighlight.page?.pdfMeta?.pageNum || 1;
    const fileName = activeAiHighlight.page?.pdfMeta?.fileName || "Paper";
    el.aiCardModel.textContent = `${AI_PROVIDER_NAMES[aiCfg.provider] || aiCfg.provider} · ${aiCfg.model}`;
    el.aiCardQuoteText.textContent = activeAiHighlight.text || `Visual excerpt from page ${pageNum}`;

    if (!question) {
      el.aiCardLoading.hidden = false;
      el.aiCardResponse.innerHTML = "";
      currentAiExplanation = "";
    } else {
      const qDiv = document.createElement("div");
      qDiv.style.margin = "8px 0 4px";
      qDiv.style.fontWeight = "600";
      qDiv.style.color = "var(--sky)";
      qDiv.textContent = `Q: ${question}`;
      el.aiCardResponse.appendChild(qDiv);

      const loadDiv = document.createElement("div");
      loadDiv.className = "ai-card-loading";
      loadDiv.innerHTML = `<div class="ai-spinner"></div><span>Thinking…</span>`;
      el.aiCardResponse.appendChild(loadDiv);
    }

    const pad = 18;
    const cropRect = {
      x: b.x - pad,
      y: b.y - pad,
      w: b.w + pad * 2,
      h: b.h + pad * 2,
    };
    let imageBase64 = null;
    try {
      /* PDF pages load from IndexedDB asynchronously; without this the
         visual excerpt can be blank if the page has not finished decoding. */
      await ensureImages();
      const cropCanvas = renderCrop(cropRect, 2);
      imageBase64 = cropCanvas.toDataURL("image/png");
    } catch (e) {
      console.warn("Could not render crop for AI:", e);
    }

    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: aiCfg.provider,
          apiKey: aiCfg.apiKey,
          model: aiCfg.model,
          baseUrl: aiCfg.baseUrl,
          text: activeAiHighlight.text,
          imageBase64,
          question,
          paperTitle: `${fileName} (Page ${pageNum})`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "AI explanation failed");

      el.aiCardLoading.hidden = true;
      const loaders = el.aiCardResponse.querySelectorAll(".ai-card-loading");
      loaders.forEach((l) => l.remove());

      currentAiExplanation = data.explanation;

      const answerDiv = document.createElement("div");
      answerDiv.className = "ai-answer-content";
      answerDiv.innerHTML = formatAiMarkdown(data.explanation);
      el.aiCardResponse.appendChild(answerDiv);
      el.aiCardResponse.scrollTop = el.aiCardResponse.scrollHeight;
    } catch (err) {
      el.aiCardLoading.hidden = true;
      const loaders = el.aiCardResponse.querySelectorAll(".ai-card-loading");
      loaders.forEach((l) => l.remove());

      const errDiv = document.createElement("div");
      errDiv.className = "ai-test-result is-error";
      errDiv.style.margin = "8px 0";
      errDiv.textContent = `✕ ${err.message}`;
      el.aiCardResponse.appendChild(errDiv);
    }
  }

  /* --- zoom ------------------------------------------------- */

  function zoomAt(factor, px, py) {
    const z0 = state.view.zoom;
    const z = clamp(z0 * factor, MIN_ZOOM, MAX_ZOOM);
    if (z === z0) return;
    const worldX = px / z0 + state.view.x;
    const worldY = py / z0 + state.view.y;
    state.view.zoom = z;
    state.view.x = worldX - px / z;
    state.view.y = worldY - py / z;
    updateZoomLabel();
    updateCursor();
    render();
    scheduleSave();
  }

  function zoomBy(factor) {
    const { w, h } = stageSize();
    zoomAt(factor, w / 2, h / 2);
  }

  function resetZoom() {
    const { w, h } = stageSize();
    zoomAt(1 / state.view.zoom, w / 2, h / 2);
  }

  function fitView() {
    if (!state.elements.length) {
      state.view = { x: 0, y: 0, zoom: 1 };
      updateZoomLabel();
      render();
      scheduleSave();
      return;
    }
    const { w, h } = stageSize();
    if (w < 2 || h < 2) return;
    const b = unionBounds(state.elements);
    const pad = 56;
    const z = clamp(
      Math.min((w - pad * 2) / Math.max(1, b.w), (h - pad * 2) / Math.max(1, b.h)),
      MIN_ZOOM,
      1.6
    );
    state.view.zoom = z;
    state.view.x = b.x + b.w / 2 - w / (2 * z);
    state.view.y = b.y + b.h / 2 - h / (2 * z);
    updateZoomLabel();
    render();
    scheduleSave();
  }

  /* --- pointer --------------------------------------------- */

  function onPointerDown(event) {
    if (!state.isOpen) return;
    if (event.button === 2) return;
    if (state.editingId) commitText();

    const p = pointerPos(event);
    state.lastPointer = p;

    const wantsPan = event.button === 1 || state.space || state.tool === "hand";
    if (wantsPan) {
      event.preventDefault();
      try { canvas.setPointerCapture(event.pointerId); } catch {}
      state.action = {
        kind: "pan",
        start: { px: p.px, py: p.py },
        view: { ...state.view },
      };
      stage.style.cursor = "grabbing";
      render();
      return;
    }

    if (event.button !== 0) return;
    event.preventDefault();
    try { canvas.setPointerCapture(event.pointerId); } catch {}

    if (state.pending) {
      finishPendingDraw(p);
      return;
    }

    if (state.exportMode) {
      el.exportPanel.hidden = true;
      state.exportMarkdown = "";
      el.exportInsert.hidden = true;
      state.exportRect = null;
      state.action = {
        kind: "export",
        start: { x: p.x, y: p.y },
        current: { x: p.x, y: p.y },
      };
      updateHint();
      render();
      return;
    }

    if (state.tool === "text") {
      startNewTextAt(p);
      return;
    }

    if (state.tool === "ai") {
      state.action = {
        kind: "ai-select",
        start: { x: p.x, y: p.y },
        current: { x: p.x, y: p.y },
      };
      updateHint();
      render();
      return;
    }

    if (state.tool !== "select") {
      state.draft = blankElement(state.tool, p.x, p.y, 0, 0, state.style);
      /* Starting a connector on a shape attaches this end to it. */
      if (state.tool === "arrow" || state.tool === "line") {
        const target = bindingTargetAt(p.x, p.y);
        if (target) state.draft.startBinding = { id: target.item.id, anchor: target.anchor };
      }
      state.action = {
        kind: "draw",
        start: { x: p.x, y: p.y },
        item: state.draft,
      };
      updateCount();
      render();
      return;
    }

    const handle = handleAt(p.px, p.py);
    if (handle) {
      beginResize(selected()[0], handle);
      return;
    }

    const hit = hitElementAt(p.x, p.y);
    if (hit) {
      if (event.shiftKey) {
        if (state.selected.has(hit.id)) state.selected.delete(hit.id);
        else state.selected.add(hit.id);
        syncStyleUI();
        updateHint();
        render();
        return;
      }
      if (!state.selected.has(hit.id)) selectOnly(hit);
      beginMove(p);
      return;
    }

    if (!event.shiftKey) {
      state.selected.clear();
      syncStyleUI();
    }
    state.action = {
      kind: "marquee",
      start: { x: p.x, y: p.y },
      current: { x: p.x, y: p.y },
      base: new Set(state.selected),
    };
    updateHint();
    render();
  }

  function onPointerMove(event) {
    if (!state.isOpen) return;
    const p = pointerPos(event);
    state.lastPointer = p;

    if (state.pending) {
      const item = state.pending.item;
      const target = bindingTargetAt(p.x, p.y, item.startBinding?.id || null);
      item.endBinding = target ? { id: target.item.id, anchor: target.anchor } : null;
      state.bindHover = target ? target.item.id : null;
      state.bindAnchor = target ? target.anchor : null;
      routeLinear(item, state.pending.start, { x: p.x, y: p.y });
      render();
      return;
    }

    const a = state.action;
    if (!a) {
      /* With a connector tool, outline whatever a click would attach to. */
      if (state.tool === "arrow" || state.tool === "line") {
        const target = bindingTargetAt(p.x, p.y);
        const id = target ? target.item.id : null;
        const anchor = target ? target.anchor : null;
        if (state.bindHover !== id || state.bindAnchor !== anchor) {
          state.bindHover = id;
          state.bindAnchor = anchor;
          render();
        }
      } else if (state.bindHover || state.bindAnchor) {
        state.bindHover = null;
        state.bindAnchor = null;
        render();
      }
      updateCursor();
      return;
    }

    if (a.kind === "pan") {
      state.view.x = a.view.x - (p.px - a.start.px) / state.view.zoom;
      state.view.y = a.view.y - (p.py - a.start.py) / state.view.zoom;
      render();
      if (activeAiHighlight && !aiCardUserMoved && el.aiExplainCard && !el.aiExplainCard.hidden) {
        positionAiExplainCard(activeAiHighlight.bounds);
      }
      return;
    }

    if (a.kind === "draw") {
      updateDraft(p, event);
      return;
    }

    if (a.kind === "move") {
      updateMove(p, event.shiftKey);
      return;
    }

    if (a.kind === "resize") {
      updateResize(p, event);
      return;
    }

    if (a.kind === "marquee") {
      a.current = { x: p.x, y: p.y };
      render();
      return;
    }

    if (a.kind === "ai-select") {
      a.current = { x: p.x, y: p.y };
      render();
      return;
    }

    if (a.kind === "export") {
      a.current = { x: p.x, y: p.y };
      const w = Math.abs(p.x - a.start.x);
      const h = Math.abs(p.y - a.start.y);
      state.exportRect = w > 2 && h > 2
        ? {
            x: Math.min(a.start.x, p.x),
            y: Math.min(a.start.y, p.y),
            w,
            h,
          }
        : null;
      render();
    }
  }

  function onPointerUp(event) {
    if (!state.isOpen) return;
    try {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    } catch {}

    const a = state.action;
    state.action = null;

    if (a?.kind === "draw") {
      const p = pointerPos(event);
      const tiny = Math.hypot(p.x - a.start.x, p.y - a.start.y) < 5 / state.view.zoom;
      if (tiny && (a.item.type === "arrow" || a.item.type === "line")) {
        startPendingDraw(a);
      } else {
        finishDraw();
      }
    } else if ((a?.kind === "move" || a?.kind === "resize") && a.moved) {
      if (a.kind === "resize" && (a.item.type === "arrow" || a.item.type === "line")) {
        bindDraggedEnd(a.item, a.handle);
      }
      commitHistory();
      scheduleSave();
      syncStyleUI();
    } else if (a?.kind === "marquee") {
      finishMarquee(a);
    } else if (a?.kind === "ai-select") {
      const w = Math.abs(a.current.x - a.start.x);
      const h = Math.abs(a.current.y - a.start.y);
      let rect = {
        x: Math.min(a.start.x, a.current.x),
        y: Math.min(a.start.y, a.current.y),
        w: Math.max(w, 24),
        h: Math.max(h, 24),
      };
      if (w < 8 && h < 8) {
        const hit = hitElementAt(a.start.x, a.start.y);
        if (hit) {
          const hb = boundsOf(hit);
          rect = { x: hb.x, y: hb.y, w: hb.w, h: hb.h };
        }
      }
      activeAiHighlight = extractPdfTextInBounds(rect) || { bounds: rect, text: "", page: null };
      triggerAiExplain();
      setTool("select");
    } else if (a?.kind === "export") {
      if (state.exportRect && state.exportRect.w >= 8 && state.exportRect.h >= 8) {
        showExportPanel();
      } else {
        state.exportRect = null;
        updateHint();
      }
    } else if (a?.kind === "pan") {
      scheduleSave();
    }

    updateUI();
    updateCursor();
    render();
  }

  function onPointerCancel() {
    state.draft = null;
    state.pending = null;
    state.bindHover = null;
    state.bindAnchor = null;
    state.action = null;
    updateUI();
    updateCursor();
    render();
  }

  function onWheel(event) {
    if (!state.isOpen) return;
    if (state.editingId) commitText();
    event.preventDefault();

    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const dx = event.deltaX * unit;
    const dy = event.deltaY * unit;

    if (event.ctrlKey || event.metaKey) {
      const p = pointerPos(event);
      const factor = Math.exp(-dy * 0.0022);
      zoomAt(factor, p.px, p.py);
      return;
    }

    const px = event.shiftKey ? dy : dx;
    const py = event.shiftKey ? 0 : dy;
    state.view.x += px / state.view.zoom;
    state.view.y += py / state.view.zoom;
    updateCursor();
    render();
    scheduleSave();
    if (activeAiHighlight && !aiCardUserMoved && el.aiExplainCard && !el.aiExplainCard.hidden) {
      positionAiExplainCard(activeAiHighlight.bounds);
    }
  }

  function onDoubleClick(event) {
    if (state.exportMode) return;
    const p = pointerPos(event);
    const hit = hitElementAt(p.x, p.y);
    if (state.tool !== "select" && !hit) return;
    event.preventDefault();

    /* Double-clicking a selected connector adds a waypoint there, the
       gesture Excalidraw uses to bend an arrow after drawing it. */
    if (hit && (hit.type === "line" || hit.type === "arrow") && state.selected.has(hit.id)) {
      if (pathStyleOf(hit) === "elbow") {
        notify("Elbow routes are automatic — pick straight or curved to place waypoints");
        return;
      }
      addWaypoint(hit, p);
      return;
    }

    if (hit?.type === "text") {
      startTextEdit(hit, false);
      return;
    }
    /* Double-clicking a shape opens a caret at that point, so a box can
       be labelled without switching tools or creating a separate frame.
       Lines and freehand strokes have no interior, so they are skipped. */
    if (hit && (hit.type === "line" || hit.type === "arrow" || hit.type === "pen" || hit.type === "highlight")) {
      return;
    }
    startNewTextAt(p);
  }

  function addWaypoint(item, p) {
    const pts = absPoints(item);
    let at = pts.length - 1;
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distanceToSegment(p.x, p.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
      if (d < best) {
        best = d;
        at = i + 1;
      }
    }
    pts.splice(at, 0, { x: p.x, y: p.y });
    setLinePoints(item, pts);
    commitHistory();
    syncStyleUI();
    updateHint();
    render();
    scheduleSave();
    notify("Waypoint added · drag it to shape the route");
  }

  /* --- keyboard -------------------------------------------- */

  function nudge(dx, dy) {
    if (!state.selected.size) return;
    for (const item of selected()) {
      item.x += dx;
      item.y += dy;
    }
    routeBoundArrows();
    commitHistory();
    render();
  }

  function onKeyDown(event) {
    if (!state.isOpen) return;
    if (!el.pdfPanel.hidden && event.key === "Escape" && !pdf.busy) {
      event.preventDefault();
      closePdfPanel();
      return;
    }
    const tag = (event.target?.tagName || "").toLowerCase();
    const inputType = String(event.target?.type || "").toLowerCase();
    const typing =
      !!event.target?.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
    /* Sliders and colour pickers can keep focus after a change, but they do
       not consume letters — tool shortcuts should still work there. */
    const toolTyping =
      !!event.target?.isContentEditable ||
      tag === "textarea" ||
      tag === "select" ||
      (tag === "input" && !["range", "color", "checkbox", "radio", "button", "submit"].includes(inputType));

    if (event.key === " " && !typing) {
      if (!event.repeat) {
        state.space = true;
        updateCursor();
      }
      event.preventDefault();
      return;
    }
    if (typing && toolTyping) return;

    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (typing) {
      if (!mod && event.shiftKey && key === "h") {
        event.preventDefault();
        setTool("highlight");
      } else if (!mod && TOOL_KEYS[key]) {
        event.preventDefault();
        setTool(TOOL_KEYS[key]);
      }
      return;
    }

    if (mod) {
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (key === "y") { event.preventDefault(); redo(); return; }
      if (key === "a") {
        event.preventDefault();
        state.selected = new Set(state.elements.map((item) => item.id));
        syncStyleUI();
        updateHint();
        render();
        return;
      }
      if (key === "c") { event.preventDefault(); copySelected(); return; }
      if (key === "v") {
        /* Let the browser fire a paste event first so a screenshot on the
           clipboard wins; fall back to the in-memory element clipboard
           when no paste event arrives. */
        state.pasteHandled = false;
        if (state.clipboard.length) {
          setTimeout(() => {
            if (!state.pasteHandled && state.isOpen) pasteClipboard();
          }, 0);
        }
        return;
      }
      if (key === "d") { event.preventDefault(); duplicateSelected(); return; }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      if (el.aiExplainCard && !el.aiExplainCard.hidden) {
        closeAiExplainCard();
      } else if (abortGesture()) {
        /* The in-flight shape/arrow is gone and the select tool is back. */
      } else if (state.tool === "ai") {
        setTool("select");
      } else if (state.exportMode) {
        cancelExport();
      } else if (state.selected.size) {
        state.selected.clear();
        syncStyleUI();
        updateHint();
        updateCursor();
        render();
      } else if (state.tool !== "select") {
        setTool("select");
      }
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (state.selected.size) {
        event.preventDefault();
        deleteSelected();
      }
      return;
    }

    if (event.key === "Enter") {
      const items = selected();
      if (items.length === 1 && items[0].type === "text") {
        event.preventDefault();
        startTextEdit(items[0], false);
      }
      return;
    }

    const arrow = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }[event.key];
    if (arrow && state.selected.size) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      nudge(arrow[0] * step, arrow[1] * step);
      return;
    }

    if (event.shiftKey && key === "h") setTool("highlight");
    else if (TOOL_KEYS[key]) setTool(TOOL_KEYS[key]);
  }

  function onKeyUp(event) {
    if (event.key === " ") {
      state.space = false;
      updateCursor();
    }
  }

  function clipboardImageFile(data) {
    if (!data) return null;
    for (const item of Array.from(data.items || [])) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
    return Array.from(data.files || []).find((file) => file.type.startsWith("image/")) || null;
  }

  function onPaste(event) {
    if (!state.isOpen) return;
    state.pasteHandled = true;

    const target = event.target;
    const tag = (target?.tagName || "").toLowerCase();
    const inputType = String(target?.type || "").toLowerCase();
    const textTarget =
      !!target?.isContentEditable ||
      tag === "textarea" ||
      tag === "select" ||
      (tag === "input" && !["range", "color", "checkbox", "radio", "button", "submit"].includes(inputType));
    if (state.editingId || textTarget) return;

    const file = clipboardImageFile(event.clipboardData);
    if (file) {
      event.preventDefault();
      insertImageFile(file);
      return;
    }

    const text = event.clipboardData?.getData("text/plain")?.trim();
    if (text && isPdfUrl(text)) {
      event.preventDefault();
      importPdfFromUrl(text);
      return;
    }

    if (state.clipboard.length) {
      event.preventDefault();
      pasteClipboard();
    }
  }

  /* --- dropped images -------------------------------------- */

  function onDragOver(event) {
    if (!state.isOpen) return;
    if (!Array.from(event.dataTransfer?.types || []).includes("Files") && !Array.from(event.dataTransfer?.types || []).includes("text/plain")) return;
    /* Without this the browser navigates away to the dropped file. */
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    stage.classList.add("is-drop-target");
  }

  function onDragLeave(event) {
    if (!stage.contains(event.relatedTarget)) stage.classList.remove("is-drop-target");
  }

  function onDrop(event) {
    if (!state.isOpen) return;
    stage.classList.remove("is-drop-target");
    const files = Array.from(event.dataTransfer?.files || []);

    const uriList = (event.dataTransfer?.getData("text/uri-list") || "").trim();
    const plainText = (event.dataTransfer?.getData("text/plain") || "").trim();
    const droppedUrl = uriList || plainText;

    if (!files.length && droppedUrl && isPdfUrl(droppedUrl)) {
      event.preventDefault();
      const at = pointerPos(event);
      importPdfFromUrl(droppedUrl, at);
      return;
    }

    if (!files.length) return;

    event.preventDefault();
    const images = files.filter((file) => file.type.startsWith("image/"));
    const pdfFile = files.find(
      (file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")
    );
    if (!images.length && !pdfFile) {
      notify("Drop an image or a PDF");
      return;
    }
    const at = pointerPos(event);
    if (images.length) insertImageFiles(images, at);
    if (pdfFile) openPdfPanel(pdfFile, at);
  }

  /* --- style panel ----------------------------------------- */

  function buildSwatches(container, colors, onPick) {
    for (const color of colors) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.dataset.color = color;
      b.title = color === "transparent" ? "No fill" : color;
      b.setAttribute("aria-label", b.title);
      if (color !== "transparent") b.style.background = color;
      b.addEventListener("click", () => onPick(color));
      container.appendChild(b);
    }
  }

  function normalizeHex(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : null;
  }

  function setActive(container, key, value) {
    container.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("is-active", b.dataset[key] === String(value));
    });
  }

  function syncStyleUI() {
    const item = firstSelected();
    const s = item || state.style;
    const fillStyle = s.fillStyle || "none";
    const fill = s.fill || state.style.fill;
    const stroke = s.stroke || state.style.stroke;

    el.strokeSwatches.querySelectorAll(".swatch").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.color === stroke);
    });
    el.fillSwatches.querySelectorAll(".swatch").forEach((b) => {
      const target = fillStyle === "none" ? "transparent" : fill;
      b.classList.toggle("is-active", b.dataset.color === target);
    });

    const strokeHex = normalizeHex(stroke);
    if (strokeHex) el.strokeCustom.value = strokeHex;
    const fillHex = normalizeHex(fill);
    if (fillHex) el.fillCustom.value = fillHex;

    setActive(el.fillStyles, "fill", fillStyle);
    setActive(el.strokeWidths, "width", s.strokeWidth);
    setActive(el.strokeStyles, "stroke", s.strokeStyle || "solid");
    setActive(el.pathStyles, "path", pathStyleOf(s));
    setActive(el.startHeads, "head", arrowheadOf(s, "start"));
    setActive(el.endHeads, "head", arrowheadOf(s, "end"));
    setActive(el.edgeStyles, "edge", s.roundness ? "round" : "sharp");
    setActive(el.roughness, "rough", s.roughness ?? 1);
    setActive(el.textAlign, "align", s.textAlign || "left");

    const opacity = Math.round(clamp(s.opacity ?? 1, 0.1, 1) * 100);
    el.opacity.value = String(opacity);
    el.opacityValue.textContent = `${opacity}%`;

    el.fontFamily.value = s.fontFamily || "sans";
    el.fontSize.value = String(s.fontSize || 20);
  }

  function applyStyle(patch, { commit = true, live = false } = {}) {
    Object.assign(state.style, patch);
    if ("opacity" in patch) state.style.opacity = clamp(patch.opacity, 0.1, 1);

    const items = selected();
    for (const item of items) {
      if ("stroke" in patch) item.stroke = patch.stroke;
      if ("fill" in patch) item.fill = patch.fill;
      if ("fillStyle" in patch) item.fillStyle = patch.fillStyle;
      if ("strokeWidth" in patch) item.strokeWidth = patch.strokeWidth;
      if ("strokeStyle" in patch) item.strokeStyle = patch.strokeStyle;
      if ("pathStyle" in patch) {
        item.pathStyle = patch.pathStyle;
        item.curve = patch.pathStyle === "curved";
      }
      if ("startArrowhead" in patch) item.startArrowhead = patch.startArrowhead;
      if ("endArrowhead" in patch) item.endArrowhead = patch.endArrowhead;
      if ("roundness" in patch) item.roundness = patch.roundness;
      if ("opacity" in patch) item.opacity = clamp(patch.opacity, 0.1, 1);
      if ("roughness" in patch) item.roughness = patch.roughness;
      if ("fontSize" in patch) {
        item.fontSize = patch.fontSize;
        if (item.type === "text") refreshTextSize(item);
      }
      if ("fontFamily" in patch) {
        item.fontFamily = patch.fontFamily;
        if (item.type === "text") refreshTextSize(item);
      }
      if ("textAlign" in patch) item.textAlign = patch.textAlign;
    }

    if (state.editingId) {
      const editing = state.elements.find((item) => item.id === state.editingId);
      if (editing) positionTextEditor(editing);
    }

    /* Rounded corners move their anchors, so linked connectors have to
       follow immediately rather than waiting for the next drag. */
    routeBoundArrows();
    render();
    syncStyleUI();
    if (items.length && commit && !live) commitHistory();
    else scheduleSave();
  }

  function commitStyleChange() {
    if (selected().length) commitHistory();
    scheduleSave();
  }

  function initStyleUI() {
    buildSwatches(el.strokeSwatches, STROKE_COLORS, (color) => {
      applyStyle({ stroke: color });
    });
    buildSwatches(el.fillSwatches, ["transparent", ...FILL_COLORS], (color) => {
      if (color === "transparent") {
        applyStyle({ fillStyle: "none" });
        return;
      }
      const current = firstSelected() || state.style;
      applyStyle({
        fill: color,
        fillStyle: current.fillStyle === "none" ? "solid" : current.fillStyle,
      });
    });

    el.strokeCustom.addEventListener("input", (event) => {
      applyStyle({ stroke: event.target.value }, { commit: false, live: true });
    });
    el.strokeCustom.addEventListener("change", commitStyleChange);

    el.fillCustom.addEventListener("input", (event) => {
      const current = firstSelected() || state.style;
      applyStyle({
        fill: event.target.value,
        fillStyle: current.fillStyle === "none" ? "solid" : current.fillStyle,
      }, { commit: false, live: true });
    });
    el.fillCustom.addEventListener("change", commitStyleChange);

    el.fillStyles.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => applyStyle({ fillStyle: b.dataset.fill }));
    });
    el.strokeWidths.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => applyStyle({ strokeWidth: Number(b.dataset.width) }));
    });
    el.strokeStyles.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => applyStyle({ strokeStyle: b.dataset.stroke }));
    });
    el.pathStyles.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => applyStyle({ pathStyle: b.dataset.path }));
    });
    for (const [container, key] of [[el.startHeads, "startArrowhead"], [el.endHeads, "endArrowhead"]]) {
      container.querySelectorAll("button").forEach((b) => {
        b.addEventListener("click", () => applyStyle({ [key]: b.dataset.head }));
      });
    }
    el.edgeStyles.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => applyStyle({ roundness: b.dataset.edge === "round" ? 1 : 0 }));
    });
    el.roughness.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => applyStyle({ roughness: Number(b.dataset.rough) }));
    });
    el.textAlign.querySelectorAll("button").forEach((b) => {
      b.addEventListener("click", () => applyStyle({ textAlign: b.dataset.align }));
    });

    el.opacity.addEventListener("input", (event) => {
      const value = Number(event.target.value) / 100;
      el.opacityValue.textContent = `${event.target.value}%`;
      applyStyle({ opacity: value }, { commit: false, live: true });
    });
    el.opacity.addEventListener("change", commitStyleChange);

    el.fontFamily.addEventListener("change", (event) => {
      applyStyle({ fontFamily: event.target.value });
      canvas.focus({ preventScroll: true });
    });
    el.fontSize.addEventListener("change", (event) => {
      applyStyle({ fontSize: Number(event.target.value) });
      canvas.focus({ preventScroll: true });
    });

    syncStyleUI();
  }

  /* --- events ---------------------------------------------- */

  function initEvents() {
    root.querySelectorAll("[data-tool]").forEach((b) => {
      b.addEventListener("click", () => setTool(b.dataset.tool));
    });

    el.undo.addEventListener("click", undo);
    el.redo.addEventListener("click", redo);
    el.export.addEventListener("click", beginExport);

    el.zoomOut.addEventListener("click", () => zoomBy(1 / 1.2));
    el.zoomIn.addEventListener("click", () => zoomBy(1.2));
    el.zoomLabel.addEventListener("click", resetZoom);
    el.zoomFit.addEventListener("click", fitView);

    el.exportSave.addEventListener("click", saveExport);
    el.exportCopy.addEventListener("click", copyExportImage);
    el.exportDownload.addEventListener("click", downloadExport);
    el.exportInsert.addEventListener("click", insertExport);
    el.exportRetake.addEventListener("click", retakeExport);
    el.exportCancel.addEventListener("click", cancelExport);
    window.addEventListener("themechange", () => render());

    el.imageTrigger.addEventListener("click", async () => {
      if (!state.isOpen) return;
      if (state.editingId) commitText();
      if (state.exportMode) cancelExport();
      el.imageInput.click();
    });
    el.imageInput.addEventListener("change", async () => {
      const file = el.imageInput.files?.[0];
      el.imageInput.value = "";
      if (!file) return;
      await insertImageFile(file);
      canvas.focus({ preventScroll: true });
    });

    el.pdfTrigger.addEventListener("click", promptPdfImport);
    el.pdfUrlSubmit.addEventListener("click", () => {
      const url = el.pdfUrlInput.value.trim();
      if (!url) {
        setPdfNote("Please paste a PDF or arXiv URL first.", "error");
        el.pdfUrlInput.focus();
        return;
      }
      importPdfFromUrl(url);
    });
    el.pdfUrlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const url = el.pdfUrlInput.value.trim();
        if (url) importPdfFromUrl(url);
      }
    });
    el.pdfFilePickBtn.addEventListener("click", () => el.pdfInput.click());
    el.pdfChoiceAll.addEventListener("click", () => setPdfChoice("all"));
    el.pdfChoiceSome.addEventListener("click", () => setPdfChoice("some"));
    el.pdfPages.addEventListener("input", () => {
      const doc = pdf.doc;
      if (!doc) return;
      const total = doc.numPages;
      const first = Math.min(total, PDF_MAX_PAGES);
      const allVal = first === 1 ? "1" : `1-${first}`;
      const isAll = el.pdfPages.value.trim() === allVal;
      el.pdfChoiceAll.classList.toggle("is-active", isAll);
      el.pdfChoiceSome.classList.toggle("is-active", !isAll);
    });
    el.pdfInput.addEventListener("change", () => {
      const file = el.pdfInput.files?.[0];
      el.pdfInput.value = "";
      if (file) openPdfPanel(file);
    });
    el.pdfImport.addEventListener("click", importPdfPages);
    el.pdfCancel.addEventListener("click", closePdfPanel);
    el.pdfPages.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        importPdfPages();
      }
    });
    el.exportSnippet.addEventListener("click", () => {
      if (state.exportMarkdown) copyText(state.exportMarkdown).then((ok) => {
        if (ok) notify("Markdown copied");
      });
    });

    el.aiExplainCard?.querySelector(".ai-card-head")?.addEventListener("pointerdown", startAiCardDrag);
    if (el.aiCardClose) {
      el.aiCardClose.addEventListener("click", closeAiExplainCard);
    }
    if (el.aiCardCopyBtn) {
      el.aiCardCopyBtn.addEventListener("click", () => {
        if (!currentAiExplanation) return;
        const text = activeAiHighlight?.text
          ? `> ${activeAiHighlight.text}\n\n${currentAiExplanation}`
          : currentAiExplanation;
        copyText(text).then((ok) => {
          if (ok) notify("Explanation copied to clipboard");
        });
      });
    }
    if (el.aiCardInsertBtn) {
      el.aiCardInsertBtn.addEventListener("click", () => {
        if (!currentAiExplanation) return;
        const pageNum = activeAiHighlight?.page?.pdfMeta?.pageNum || 1;
        const passage = activeAiHighlight?.text
          ? `> "${activeAiHighlight.text}"\n> — *(Page ${pageNum})*\n\n`
          : "";
        const snippet = `${passage}**AI Explanation**:\n${currentAiExplanation}\n`;
        if (typeof opts.insertMarkdown === "function") {
          opts.insertMarkdown(snippet);
          notify("Inserted AI explanation into post");
        }
      });
    }
    if (el.aiCardPinBtn) {
      el.aiCardPinBtn.addEventListener("click", () => {
        if (!currentAiExplanation || !activeAiHighlight) return;
        const p = activeAiHighlight.page;
        const b = activeAiHighlight.bounds;
        const targetX = p ? p.x + p.w + 24 : b.x + b.w + 24;
        const targetY = b.y;

        const note = blankElement("text", targetX, targetY, 280, 100, {
          stroke: "#1e1e1e",
          fontSize: 16,
          fontFamily: "sans",
        });
        const header = activeAiHighlight.text ? `Note on: "${activeAiHighlight.text.slice(0, 50)}…"\n\n` : "";
        note.text = `${header}${currentAiExplanation.slice(0, 400)}${currentAiExplanation.length > 400 ? "…" : ""}`;
        refreshTextSize(note);
        state.elements.push(note);
        commitHistory();
        render();
        scheduleSave();
        notify("Pinned AI note to canvas");
        closeAiExplainCard();
      });
    }
    if (el.aiCardQaSubmit) {
      el.aiCardQaSubmit.addEventListener("click", () => {
        const q = el.aiCardQaInput?.value?.trim();
        if (q) {
          el.aiCardQaInput.value = "";
          triggerAiExplain(q);
        }
      });
    }
    if (el.aiCardQaInput) {
      el.aiCardQaInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const q = el.aiCardQaInput.value.trim();
          if (q) {
            el.aiCardQaInput.value = "";
            triggerAiExplain(q);
          }
        }
      });
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDoubleClick);
    canvas.addEventListener("pointerleave", () => {
      if ((state.bindHover || state.bindAnchor) && !state.pending && state.action?.kind !== "draw") {
        state.bindHover = null;
        state.bindAnchor = null;
        render();
      }
    });
    stage.addEventListener("dragover", onDragOver);
    stage.addEventListener("dragleave", onDragLeave);
    stage.addEventListener("drop", onDrop);
    document.addEventListener("paste", onPaste);

    el.textEditor.addEventListener("blur", commitText);
    el.textEditor.addEventListener("input", autoGrowText);
    el.textEditor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        commitText();
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        commitText();
      }
    });

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", () => {
      state.space = false;
      updateCursor();
    });
    window.addEventListener("pagehide", flushScene);

    const observer = new ResizeObserver(() => {
      if (state.isOpen) resize();
    });
    observer.observe(stage);

    if (document.fonts) {
      document.fonts.load('20px "Virgil"').catch(() => {});
      document.fonts.ready.then(recomputeTextHeights).catch(() => {});
      document.fonts.addEventListener?.("loadingdone", recomputeTextHeights);
    }
  }

  /* --- public surface -------------------------------------- */

  function open({ focus = true } = {}) {
    state.isOpen = true;
    resize();
    requestAnimationFrame(() => {
      resize();
      updateUI();
      updateCursor();
      render();
      if (focus) canvas.focus({ preventScroll: true });
    });
  }

  function close() {
    if (state.editingId) commitText();
    closePdfPanel({ focus: false });
    flushScene();
    state.isOpen = false;
    state.space = false;
    state.action = null;
    state.draft = null;
    state.pending = null;
    state.bindHover = null;
    state.bindAnchor = null;
    if (state.exportMode) cancelExport();
    updateCursor();
  }

  initStyleUI();
  initEvents();
  setSlug(opts.getSlug?.() || null);

  return { open, close, setSlug, render, fitView };
}
