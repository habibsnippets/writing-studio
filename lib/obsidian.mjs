/* ============================================================
   Obsidian vault support.

   A vault is just folders of Markdown and attachments. The studio
   imports it as private notes, then this module makes the writer's
   Obsidian syntax work in the preview:

     [[Note]]                 links between notes
     [[Note#Heading|Alias]]   heading links
     ![[Note]]                note transclusion
     ![[picture.png|320]]     image embeds, optional width
     ![[drawing.canvas]]      Obsidian Canvas
     ![[drawing.excalidraw]]  Excalidraw drawings

   Link resolution follows Obsidian's shortest-path rule: the note's
   own folder first, then the vault root, then anywhere in the vault.
   ============================================================ */

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";

import { splitFrontmatter } from "./frontmatter.mjs";
import { escapeHtml, escapeAttr } from "./html.mjs";
import { renderObsidianCanvas } from "./obsidian-canvas.mjs";
import { extractExcalidrawScene, renderExcalidrawScene } from "./excalidraw.mjs";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".bmp", ".ico", ".tif", ".tiff"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v"]);
const NOTE_EXT = new Set([".md", ".markdown", ".mdx"]);

const WIKILINK_RE = /!?\[\[([^[\]\n]+?)\]\]/g;
const CODE_RE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;
const MAX_DEPTH = 4;

const cleanHeading = (value = "") =>
  String(value)
    .replace(/[*_`~]/g, "")
    .replace(/\s+#+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

const slugifyHeading = (value = "") =>
  cleanHeading(value)
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";

const normalizeName = (value = "") =>
  String(value)
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

function entryInfo(rel) {
  const name = path.posix.basename(rel);
  const ext = path.posix.extname(name).toLowerCase();
  const folder = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
  const stem = name.slice(0, Math.max(0, name.length - ext.length));
  return {
    rel,
    name,
    ext,
    folder,
    lowerRel: rel.toLowerCase(),
    lowerName: name.toLowerCase(),
    lowerStem: stem.toLowerCase(),
    normalizedName: normalizeName(name),
    normalizedStem: normalizeName(stem),
  };
}

async function walkVault(root, folder = "", depth = 0, entries = []) {
  if (depth > 24) return entries;
  let dirents;
  try {
    dirents = await readdir(folder ? path.join(root, ...folder.split("/")) : root, { withFileTypes: true });
  } catch {
    return entries;
  }
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".") || dirent.name === "__MACOSX") continue;
    const rel = folder ? `${folder}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) {
      await walkVault(root, rel, depth + 1, entries);
    } else if (dirent.isFile()) {
      entries.push(entryInfo(rel));
    }
  }
  return entries;
}

/** Scan a private-notes folder into a flat, case-insensitive index. */
export async function buildVaultIndex(root) {
  const entries = await walkVault(root);
  const byRel = new Map();
  for (const entry of entries) {
    if (!byRel.has(entry.lowerRel)) byRel.set(entry.lowerRel, entry);
  }
  return { root, entries, byRel };
}

function safeVariants(value) {
  const normalized = path.posix.normalize(value).replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) return [];
  const ext = path.posix.extname(normalized).toLowerCase();
  const variants = [normalized];
  if (!ext) {
    variants.push(`${normalized}.md`, `${normalized}.canvas`, `${normalized}.excalidraw`, `${normalized}.excalidraw.md`);
  } else if (ext === ".excalidraw") {
    variants.push(`${normalized}.md`);
  }
  return variants;
}

function scoreEntry(entry, folder) {
  let score = entry.rel.split("/").length;
  if (entry.folder === folder) score -= 100;
  else if (entry.folder === "") score -= 50;
  if (NOTE_EXT.has(entry.ext)) score -= 5;
  return score;
}

/**
 * Resolve an Obsidian target the way the reading view does.
 * Returns `{ entry, anchor }`, `{ entry: null, anchor }`, or null for self.
 */
export function resolveVaultTarget(index, target, notePath = "") {
  let value = String(target || "").replace(/\\/g, "/").trim();
  let anchor = "";
  const hash = value.indexOf("#");
  if (hash !== -1) {
    anchor = value.slice(hash + 1).trim();
    value = value.slice(0, hash).trim();
  }
  if (!value) return { entry: null, anchor, self: true };

  const absolute = value.startsWith("/");
  value = value.replace(/^\/+/, "").replace(/^\.\//, "");
  if (!value) return { entry: null, anchor, self: true };

  const noteFolder = notePath ? path.posix.dirname(notePath) : "";
  const folder = noteFolder === "." ? "" : noteFolder;
  const bases = absolute ? [""] : [folder, ""];
  for (const base of bases) {
    const candidate = base ? `${base}/${value}` : value;
    for (const variant of safeVariants(candidate)) {
      const entry = index.byRel.get(variant.toLowerCase());
      if (entry) return { entry, anchor };
    }
  }

  const name = path.posix.basename(value);
  const ext = path.posix.extname(name).toLowerCase();
  const lowerName = name.toLowerCase();
  const normalized = normalizeName(name);
  const matches = [];
  for (const entry of index.entries) {
    if (ext) {
      const sameExt = entry.ext === ext;
      const excalidrawAlias = ext === ".excalidraw" && entry.lowerRel.endsWith(".excalidraw.md");
      if (!sameExt && !excalidrawAlias) continue;
    }
    if (
      entry.lowerName === lowerName ||
      entry.lowerStem === lowerName ||
      (normalized && (entry.normalizedName === normalized || entry.normalizedStem === normalized)) ||
      (ext === ".excalidraw" && entry.lowerName === `${lowerName}.md`)
    ) {
      matches.push(entry);
    }
  }
  matches.sort((a, b) => scoreEntry(a, folder) - scoreEntry(b, folder) || a.rel.localeCompare(b.rel));
  return { entry: matches[0] || null, anchor };
}

function kindOf(entry) {
  if (!entry) return "missing";
  if (entry.ext === ".canvas") return "canvas";
  if (entry.ext === ".excalidraw" || entry.lowerRel.endsWith(".excalidraw.md")) return "drawing";
  if (IMAGE_EXT.has(entry.ext)) return "image";
  if (AUDIO_EXT.has(entry.ext)) return "audio";
  if (VIDEO_EXT.has(entry.ext)) return "video";
  if (entry.ext === ".pdf") return "pdf";
  if (NOTE_EXT.has(entry.ext)) return "note";
  return "file";
}

export const noteAssetUrl = (rel = "") =>
  `/note-assets/${String(rel)
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/")}`;

function missing(raw, label = "Missing note or file") {
  return `<span class="obsidian-missing" title="${escapeAttr(label)}">${escapeHtml(raw)}</span>`;
}

function sectionFromBody(body, anchor) {
  if (!anchor) return body;
  const lines = body.split(/\r?\n/);

  if (anchor.startsWith("^")) {
    const id = anchor.slice(1).trim();
    const index = lines.findIndex((line) => new RegExp(`\\^${escapeRegExp(id)}\\s*$`).test(line));
    if (index === -1) return null;
    let start = index;
    while (start > 0 && lines[start - 1].trim()) start--;
    let end = index + 1;
    while (end < lines.length && lines[end].trim()) end++;
    return lines.slice(start, end).join("\n");
  }

  const wanted = cleanHeading(anchor).toLowerCase();
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match && cleanHeading(match[2]).toLowerCase() === wanted) {
      start = i;
      level = match[1].length;
      break;
    }
  }
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match && match[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readVaultText(index, entry) {
  return readFile(path.join(index.root, ...entry.rel.split("/")), "utf8");
}

function embedBlock(html, className = "", target = "") {
  const source = target ? ` data-obsidian-embed="${escapeAttr(target)}"` : "";
  return `\n\n<div class="obsidian-embed ${className}"${source}>${html}</div>\n\n`;
}

async function renderNoteEmbed(entry, anchor, ctx) {
  if (ctx.depth >= MAX_DEPTH || ctx.stack.has(entry.lowerRel)) {
    return missing(`![[${entry.rel}${anchor ? `#${anchor}` : ""}]]`, "This note embeds itself or nests too deeply");
  }
  let raw;
  try {
    raw = await readVaultText(ctx.index, entry);
  } catch {
    return missing(`![[${entry.rel}]]`, "This note could not be read");
  }
  const body = splitFrontmatter(raw).body;
  const section = sectionFromBody(body, anchor);
  if (section === null) return missing(`![[${entry.rel}#${anchor}]]`, "That heading or block was not found");
  const stack = new Set(ctx.stack);
  stack.add(entry.lowerRel);
  const html = await ctx.render(section, entry.rel, ctx.depth + 1, stack);
  return embedBlock(html, "obsidian-note-embed", entry.rel);
}

async function renderCanvasEmbed(entry, ctx) {
  let raw;
  try {
    raw = await readVaultText(ctx.index, entry);
  } catch {
    return missing(`![[${entry.rel}]]`, "This Canvas could not be read");
  }
  const stack = new Set(ctx.stack);
  stack.add(entry.lowerRel);
  const html = await renderObsidianCanvas(raw, {
    resolve: (target) => resolveVaultTarget(ctx.index, target, entry.rel),
    assetUrl: noteAssetUrl,
    renderMarkdown: (markdown) => ctx.render(markdown, entry.rel, ctx.depth + 1, stack),
  });
  return embedBlock(html, "obsidian-canvas-embed", entry.rel);
}

async function renderDrawingEmbed(entry, ctx) {
  let raw;
  try {
    raw = await readVaultText(ctx.index, entry);
  } catch {
    return missing(`![[${entry.rel}]]`, "This drawing could not be read");
  }
  const scene = extractExcalidrawScene(raw);
  if (!scene) return missing(`![[${entry.rel}]]`, "This Excalidraw drawing has no readable scene");
  return embedBlock(renderExcalidrawScene(scene, { label: entry.name }), "obsidian-drawing-embed", entry.rel);
}

function imageEmbed(entry, alias, raw) {
  let width = "";
  let height = "";
  let alt = alias;
  const size = String(alias || "").trim();
  const match = size.match(/^(\d+)(?:x(\d+))?$/i);
  if (match) {
    width = match[1];
    height = match[2] || "";
    alt = "";
  } else if (size) {
    alt = size;
  }
  const style = width ? ` style="width:${Number(width)}px${height ? `;height:${Number(height)}px` : ""}"` : "";
  return `<img class="obsidian-image" src="${escapeAttr(noteAssetUrl(entry.rel))}" alt="${escapeAttr(alt || entry.name)}" data-obsidian-embed="${escapeAttr(entry.rel)}"${style} loading="lazy" decoding="async">`;
}

function mediaEmbed(entry) {
  const src = escapeAttr(noteAssetUrl(entry.rel));
  const kind = kindOf(entry);
  if (kind === "pdf") {
    return `<iframe src="${src}" title="${escapeAttr(entry.name)}" loading="lazy"></iframe><a href="${src}" target="_blank" rel="noopener">Open ${escapeHtml(entry.name)}</a>`;
  }
  if (kind === "audio") {
    return `<audio class="obsidian-media" controls src="${src}" title="${escapeAttr(entry.name)}"></audio>`;
  }
  if (kind === "video") {
    return `<video class="obsidian-media" controls src="${src}" title="${escapeAttr(entry.name)}"></video>`;
  }
  return `<a class="obsidian-link obsidian-file" href="${src}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.name)}</a>`;
}

async function renderWikiToken(match, ctx) {
  const raw = match[0];
  const embed = raw.startsWith("!");
  const inner = match[1];
  const pipe = inner.indexOf("|");
  const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
  const alias = (pipe === -1 ? "" : inner.slice(pipe + 1)).trim();
  const resolved = resolveVaultTarget(ctx.index, target, ctx.notePath);
  const label = alias || (resolved?.entry ? path.posix.basename(resolved.entry.name, resolved.entry.ext) : target);

  if (!resolved) return missing(raw);

  /* [[#Heading]] and [[Note#Heading]] */
  if (target.startsWith("#") && !resolved.entry) {
    const anchor = target.slice(1);
    if (!embed) return `<a class="obsidian-link obsidian-note-link" href="#${escapeAttr(slugifyHeading(anchor))}">${escapeHtml(label || anchor)}</a>`;
    const current = ctx.index.byRel.get(String(ctx.notePath || "").toLowerCase());
    return current ? renderNoteEmbed(current, anchor, ctx) : missing(raw);
  }

  if (!resolved.entry) {
    return missing(raw, `“${target}” was not found in this vault`);
  }

  const kind = kindOf(resolved.entry);
  const entry = resolved.entry;

  if (embed) {
    if (kind === "image") return imageEmbed(entry, alias, raw);
    if (kind === "note") return renderNoteEmbed(entry, resolved.anchor, ctx);
    if (kind === "canvas") return renderCanvasEmbed(entry, ctx);
    if (kind === "drawing") return renderDrawingEmbed(entry, ctx);
    if (kind === "pdf" || kind === "audio" || kind === "video" || kind === "file") {
      return embedBlock(mediaEmbed(entry), kind === "pdf" ? "obsidian-pdf" : `obsidian-${kind}-embed`, entry.rel);
    }
    return missing(raw);
  }

  const text = escapeHtml(label);
  if (kind === "note") {
    return `<a class="obsidian-link obsidian-note-link" href="#" data-note-link="${escapeAttr(entry.rel)}"${
      resolved.anchor ? ` data-note-anchor="${escapeAttr(resolved.anchor)}"` : ""
    }>${text}</a>`;
  }
  if (kind === "canvas" || kind === "drawing") {
    /* A plain link to a drawing opens JSON, not the drawing. Keep the
       useful embed form; a non-embed link is shown as a labelled chip. */
    return `<span class="obsidian-link obsidian-file" title="Use ![[${escapeAttr(entry.rel)}]] to embed this drawing">${text}</span>`;
  }
  return `<a class="obsidian-link obsidian-file" href="${escapeAttr(noteAssetUrl(entry.rel))}" target="_blank" rel="noopener noreferrer">${text}</a>`;
}

async function transformSegment(segment, ctx) {
  let text = segment
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/[ \t]+\^[A-Za-z0-9-]+\s*$/gm, "")
    .replace(/==([^=\n]+)==/g, "<mark>$1</mark>")
    .replace(/(^|[\s(])#([\p{L}\p{N}_/-]+)/gu, "$1<span class=\"obsidian-tag\">#$2</span>");

  const matches = [...text.matchAll(WIKILINK_RE)];
  if (!matches.length) return text;
  let output = "";
  let last = 0;
  for (const match of matches) {
    output += text.slice(last, match.index);
    output += await renderWikiToken(match, ctx);
    last = match.index + match[0].length;
  }
  output += text.slice(last);
  return output;
}

/**
 * Rewrite Obsidian syntax in a Markdown body. Code spans and fences are
 * left alone, so examples of [[links]] stay examples.
 *
 * @param {string} markdown
 * @param {{
 *   index: object,
 *   notePath?: string,
 *   depth?: number,
 *   stack?: Set<string>,
 *   render: (markdown: string, notePath: string, depth: number, stack: Set<string>) => Promise<string>,
 * }} ctx
 */
export async function transformObsidianMarkdown(markdown, ctx) {
  const segments = String(markdown).split(CODE_RE);
  let output = "";
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 1) {
      output += segments[i];
    } else {
      output += await transformSegment(segments[i], ctx);
    }
  }
  return output;
}

/** Turn Obsidian callout blockquotes into styled callout HTML after parsing. */
export function styleObsidianHtml(html = "") {
  return String(html).replace(
    /<blockquote>\s*<p>\[!([A-Za-z][\w-]*)\]([+-]?)([^\n]*?)(?=\n|<\/p>)/g,
    (whole, type, mark, title) => {
      const name = String(type).toLowerCase();
      /* marked has already escaped the title; stripping inline tags keeps
         entities such as &amp; from being escaped twice. */
      const label = cleanHeading(String(title).replace(/<[^>]*>/g, "")) || name.charAt(0).toUpperCase() + name.slice(1);
      return `<blockquote class="callout callout-${escapeAttr(name)}"${mark === "+" ? ' data-fold="open"' : mark === "-" ? ' data-fold="closed"' : ""}><p><span class="callout-title">${label}</span>`;
    }
  );
}
