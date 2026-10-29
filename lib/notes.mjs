/* ============================================================
   Private local notes.

   These live under data/notes/ — a folder that is deliberately
   outside content/ and outside any connected GitHub Pages repo.
   Nothing here is ever read by the site builder, the Pages
   scanner, or the publish flow.

   A note is a plain Markdown file. Folders are real directories,
   Obsidian-style, so the same vault can be opened in another
   Markdown editor if you ever want to.
   ============================================================ */

import path from "node:path";
import { readFile, writeFile, mkdir, readdir, stat, unlink, rm, access } from "node:fs/promises";

import {
  splitFrontmatter,
  updateFrontmatter,
  replaceBody,
  createFrontmatter,
  filenameSlug,
  filenameTitle,
  titleFromBody,
} from "./frontmatter.mjs";

const DIR = path.resolve(import.meta.dirname, "..");
export const NOTES_ROOT = path.join(DIR, "data", "notes");
const ASSETS_ROOT = path.join(NOTES_ROOT, ".assets");

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]);

const exists = (p) => access(p).then(() => true, () => false);

function httpError(message, code = 400) {
  return Object.assign(new Error(message), { code });
}

/* A path segment is a real folder/file name: no traversal, no hidden
   entries, no control characters, and no Windows device names. */
function segmentOk(segment) {
  const value = String(segment || "").trim();
  if (!value || value === "." || value === "..") return false;
  if (value.startsWith(".")) return false;
  if (/[\\/\0-\x1f]/.test(value)) return false;
  if (Buffer.byteLength(value) > 160) return false;
  if (WINDOWS_RESERVED.test(value.replace(/\.[^.]+$/, ""))) return false;
  return true;
}

function cleanFolder(folder = "") {
  const parts = String(folder || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  for (const part of parts) {
    if (!segmentOk(part)) throw httpError("Folder names cannot contain slashes, start with a dot, or use reserved names.");
  }
  return parts.join("/");
}

function cleanNotePath(notePath = "") {
  const parts = String(notePath || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  if (!parts.length) throw httpError("A note path is required.");
  for (const part of parts) {
    if (!segmentOk(part)) throw httpError("That note path is not valid.");
  }
  if (!/\.md$/i.test(parts[parts.length - 1])) throw httpError("Private notes must be Markdown (.md) files.");
  return parts.join("/");
}

function absoluteNote(notePath) {
  const clean = cleanNotePath(notePath);
  const target = path.resolve(NOTES_ROOT, clean);
  if (target !== NOTES_ROOT && !target.startsWith(NOTES_ROOT + path.sep)) {
    throw httpError("That note path is outside the private notes folder.");
  }
  return { clean, target };
}

function absoluteFolder(folder) {
  const clean = cleanFolder(folder);
  const target = clean ? path.resolve(NOTES_ROOT, clean) : NOTES_ROOT;
  if (target !== NOTES_ROOT && !target.startsWith(NOTES_ROOT + path.sep)) {
    throw httpError("That folder is outside the private notes folder.");
  }
  return { clean, target };
}

function titleFor(parsed, filename) {
  const frontmatterTitle = parsed.data?.title;
  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim()) return frontmatterTitle.trim();
  return titleFromBody(parsed.body) || filenameTitle(filename);
}

function countWords(markdown = "") {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function readingMinutes(words) {
  return Math.max(1, Math.round(words / 210));
}

async function readNoteMeta(notePath, { includeBody = false } = {}) {
  const { clean, target } = absoluteNote(notePath);
  const [raw, info] = await Promise.all([readFile(target, "utf8"), stat(target)]);
  const parsed = splitFrontmatter(raw);
  const body = parsed.body;
  const words = countWords(body);
  const created = typeof parsed.data?.created === "string" && parsed.data.created
    ? parsed.data.created
    : info.birthtime.toISOString();
  const updated = typeof parsed.data?.updated === "string" && parsed.data.updated
    ? parsed.data.updated
    : info.mtime.toISOString();
  const folder = path.posix.dirname(clean) === "." ? "" : path.posix.dirname(clean);

  return {
    meta: {
      path: clean,
      folder,
      filename: path.posix.basename(clean),
      title: titleFor(parsed, clean),
      created,
      updated,
      dateISO: String(created).slice(0, 10),
      words,
      minutes: readingMinutes(words),
      private: true,
    },
    markdown: includeBody ? body : undefined,
    raw,
  };
}

async function walk(folder, depth = 0, folders = [], notes = []) {
  if (depth > 12) return { folders, notes };
  const dir = folder ? path.join(NOTES_ROOT, folder) : NOTES_ROOT;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { folders, notes };
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      folders.push({
        path: rel,
        name: entry.name,
        parent: folder,
        depth,
      });
      await walk(rel, depth + 1, folders, notes);
    } else if (entry.isFile() && /\.md$/i.test(entry.name)) {
      try {
        const { meta } = await readNoteMeta(rel);
        notes.push(meta);
      } catch {
        /* A broken or unreadable note should not hide the rest of the vault. */
      }
    }
  }
  return { folders, notes };
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

export async function listNotes() {
  await mkdir(NOTES_ROOT, { recursive: true });
  const { folders, notes } = await walk("", 0);
  folders.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
  notes.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return {
    root: "data/notes",
    folders,
    notes,
    counts: {
      notes: notes.length,
      folders: folders.length,
    },
  };
}

export async function getNote(notePath) {
  const data = await readNoteMeta(notePath, { includeBody: true });
  return { meta: data.meta, markdown: data.markdown };
}

export async function createNote({ folder = "", title = "" } = {}) {
  const { clean: parent } = absoluteFolder(folder);
  const dir = parent ? path.join(NOTES_ROOT, parent) : NOTES_ROOT;
  await mkdir(dir, { recursive: true });

  const cleanTitle = String(title || "").trim() || "Untitled note";
  const base = filenameSlug(cleanTitle) || "note";
  let filename = `${base}.md`;
  for (let n = 2; await exists(path.join(dir, filename)); n++) filename = `${base}-${n}.md`;

  const rel = parent ? `${parent}/${filename}` : filename;
  const now = new Date().toISOString();
  const raw = createFrontmatter({ title: cleanTitle, created: now, updated: now }) + "\n";
  await writeFile(path.join(NOTES_ROOT, rel), raw);

  return getNote(rel);
}

export async function saveNote({ path: notePath, title = "", markdown = "" } = {}) {
  const { clean, target } = absoluteNote(notePath);
  const raw = await readFile(target, "utf8");
  const parsed = splitFrontmatter(raw);
  const nextTitle = String(title || "").trim() || titleFor(parsed, clean);
  const now = new Date().toISOString();

  let next = updateFrontmatter(
    raw,
    [
      { key: "title", value: nextTitle },
      { key: "updated", value: now },
    ],
    { create: true }
  );
  next = replaceBody(next, markdown);

  await writeFile(target, next);
  return getNote(clean);
}

export async function deleteNote(notePath) {
  const { clean, target } = absoluteNote(notePath);
  await unlink(target).catch((err) => {
    if (err.code === "ENOENT") throw httpError("That note no longer exists.", 404);
    throw err;
  });
  await removeNoteAssets(clean);
  return { ok: true, path: clean };
}

export async function createFolder({ parent = "", name = "" } = {}) {
  const { clean: parentPath } = absoluteFolder(parent);
  const cleanName = String(name || "").trim();
  if (!segmentOk(cleanName)) {
    throw httpError("Use a folder name without slashes or leading dots.");
  }
  const rel = parentPath ? `${parentPath}/${cleanName}` : cleanName;
  const { target } = absoluteFolder(rel);
  if (await exists(target)) throw httpError("A folder with that name already exists.", 409);
  await mkdir(target, { recursive: true });
  return { path: rel, name: cleanName, parent: parentPath };
}

export async function deleteFolder(folder) {
  const { clean, target } = absoluteFolder(folder);
  if (!clean) throw httpError("The notes root cannot be deleted.");
  if (!(await exists(target))) throw httpError("That folder no longer exists.", 404);
  const { notes } = await walk(clean, 0);
  await rm(target, { recursive: true, force: true });
  await Promise.allSettled(notes.map((note) => removeNoteAssets(note.path)));
  return { ok: true, path: clean };
}

/* --- note images ------------------------------------------ */

function assetKey(notePath) {
  const clean = cleanNotePath(notePath).replace(/\.md$/i, "");
  return clean
    .split("/")
    .map((part) => part.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "note")
    .join("--");
}

async function removeNoteAssets(notePath) {
  const dir = path.join(ASSETS_ROOT, assetKey(notePath));
  await rm(dir, { recursive: true, force: true });
}

export function noteAssetBase(notePath) {
  return `/note-assets/${assetKey(notePath)}/`;
}

export async function uploadNoteAsset(notePath, filename, bytes) {
  const { clean } = absoluteNote(notePath);
  if (!(await exists(path.join(NOTES_ROOT, clean)))) throw httpError("Save the note before adding media.", 404);

  let name = String(filename || "image.png");
  const ext = path.extname(name).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) throw httpError(`Unsupported image type "${ext || "none"}"`);

  let base =
    path
      .basename(name, ext)
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "image";
  if (WINDOWS_RESERVED.test(base)) base += "-file";

  const dir = path.join(ASSETS_ROOT, assetKey(clean));
  await mkdir(dir, { recursive: true });

  let file = path.join(dir, base + ext);
  for (let n = 2; await exists(file); n++) file = path.join(dir, `${base}-${n}${ext}`);

  if (!bytes?.length) throw httpError("Empty file");
  await writeFile(file, bytes);

  return {
    path: `${noteAssetBase(clean)}${path.basename(file)}`,
    name: path.basename(file),
    bytes: bytes.length,
  };
}

export function resolveNoteAsset(assetPath = "") {
  const parts = String(assetPath || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) return null;
  for (const part of parts) {
    if (!segmentOk(part)) return null;
  }
  const target = path.resolve(ASSETS_ROOT, ...parts);
  if (target !== ASSETS_ROOT && !target.startsWith(ASSETS_ROOT + path.sep)) return null;
  return target;
}
