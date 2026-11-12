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
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  splitFrontmatter,
  updateFrontmatter,
  replaceBody,
  createFrontmatter,
  filenameSlug,
  filenameTitle,
  titleFromBody,
} from "./frontmatter.mjs";
import { NOTES_ROOT, isInside } from "./paths.mjs";

export { NOTES_ROOT };
const ASSETS_ROOT = path.join(NOTES_ROOT, ".assets");

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]);
export const NOTE_MEDIA_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ".pdf", ".ico", ".bmp", ".tif", ".tiff",
  ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac",
  ".mp4", ".webm", ".mov", ".mkv", ".m4v",
  ".zip", ".json", ".csv", ".drawio", ".excalidraw", ".canvas",
]);

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt", ".text"]);
const CONVERT_TO_MARKDOWN = new Set([".markdown", ".mdx", ".txt", ".text"]);

const exists = (p) => access(p).then(() => true, () => false);

/* Some Obsidian notes carry pasted screenshots as data: URIs instead of
   file embeds. Left in place, a single image turns the Markdown source
   into a wall of base64. Import extracts the bytes beside the note and
   leaves a normal relative image link behind. */
const IMAGE_MIME_EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
};

const CODE_SEGMENTS = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

function imageStem(value, fallback) {
  const stem = String(value || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return stem || fallback;
}

async function replaceCodeSafe(markdown, transform) {
  const segments = String(markdown).split(CODE_SEGMENTS);
  let output = "";
  for (let i = 0; i < segments.length; i++) {
    output += i % 2 === 1 ? segments[i] : await transform(segments[i]);
  }
  return output;
}

async function replaceAsync(text, regex, replacer) {
  let output = "";
  let last = 0;
  for (const match of text.matchAll(regex)) {
    output += text.slice(last, match.index);
    output += await replacer(match);
    last = match.index + match[0].length;
  }
  return output + text.slice(last);
}

async function writeEmbeddedImage(assetsDir, mime, base64, alt, index) {
  const ext = IMAGE_MIME_EXTENSIONS[String(mime).toLowerCase()] || ".png";
  const bytes = Buffer.from(String(base64).replace(/\s+/g, ""), "base64");
  if (!bytes.length) return null;

  await mkdir(assetsDir, { recursive: true });
  const stem = imageStem(alt, `embedded-image-${index}`);
  /* Re-importing the same note must reuse its existing image instead of
     writing embedded-image-1-2.png beside it. */
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`;
    const file = path.join(assetsDir, name);
    if (!(await exists(file))) {
      await writeFile(file, bytes);
      return `assets/${name}`;
    }
    if ((await readFile(file)).equals(bytes)) return `assets/${name}`;
  }
}

/* Write an imported file only when the destination doesn't already hold the
   same bytes. Importing a vault twice should find its notes, not make a
   second copy of every note and image with a "-2" suffix. */
async function writeImportedFile(dir, filename, data) {
  const stem = path.basename(filename, path.extname(filename));
  const suffix = path.extname(filename);
  for (let n = 1; ; n++) {
    const name = n === 1 ? filename : `${stem}-${n}${suffix}`;
    const target = path.join(dir, name);
    if (!(await exists(target))) {
      await writeFile(target, data);
      return { name, reused: false };
    }
    if ((await readFile(target)).equals(data)) return { name, reused: true };
  }
}

/** Replace inline base64 images with files and portable relative links. */
export async function extractEmbeddedImages(markdown, assetsDir) {
  let count = 0;

  const replaceMarkdown = (segment) =>
    replaceAsync(
      segment,
      /!\[([^\]]*)\]\(\s*data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+?)\s*\)/gi,
      async (match) => {
        const [raw, alt, mime, base64] = match;
        const relative = await writeEmbeddedImage(assetsDir, mime, base64, alt, count + 1).catch(() => null);
        if (!relative) return raw;
        count++;
        return `![${alt}](${relative})`;
      }
    );

  const replaceHtml = (segment) =>
    replaceAsync(
      segment,
      /<img\b[^>]*?\bsrc=(["'])data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+?)\1[^>]*>/gi,
      async (match) => {
        const [raw, , mime, base64] = match;
        const alt = raw.match(/\balt\s*=\s*(["'])(.*?)\1/i)?.[2] || "";
        const relative = await writeEmbeddedImage(assetsDir, mime, base64, alt, count + 1).catch(() => null);
        if (!relative) return raw;
        count++;
        return raw.replace(/\bsrc=(["'])data:image\/[^"']+\1/i, `src="${relative}"`);
      }
    );

  const output = await replaceCodeSafe(markdown, async (segment) => replaceHtml(await replaceMarkdown(segment)));
  return { markdown: output, count };
}

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
  if (!isInside(NOTES_ROOT, target)) {
    throw httpError("That note path is outside the private notes folder.");
  }
  return { clean, target };
}

function absoluteFolder(folder) {
  const clean = cleanFolder(folder);
  const target = clean ? path.resolve(NOTES_ROOT, clean) : NOTES_ROOT;
  if (!isInside(NOTES_ROOT, target)) {
    throw httpError("That folder is outside the private notes folder.");
  }
  return { clean, target };
}

export async function allocateNotePath({ folder = "", title = "Untitled note", ext = ".md" } = {}) {
  const { clean: parent } = absoluteFolder(folder);
  const dir = parent ? path.join(NOTES_ROOT, parent) : NOTES_ROOT;
  await mkdir(dir, { recursive: true });

  const base = filenameSlug(String(title || "").trim() || "Untitled note") || "note";
  let filename = `${base}${ext}`;
  for (let n = 2; await exists(path.join(dir, filename)); n++) filename = `${base}-${n}${ext}`;

  return {
    folder: parent,
    path: parent ? `${parent}/${filename}` : filename,
    absolute: path.join(dir, filename),
    dir,
    assetsDir: path.join(dir, "assets"),
  };
}

function noteFolderOf(notePath) {
  const folder = path.posix.dirname(cleanNotePath(notePath));
  return folder === "." ? "" : folder;
}

function noteAssetsDir(notePath) {
  const folder = noteFolderOf(notePath);
  return folder ? path.join(NOTES_ROOT, folder, "assets") : path.join(NOTES_ROOT, "assets");
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
      title: titleFor(parsed, path.posix.basename(clean)),
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
      /* Excalidraw's `.excalidraw.md` is a drawing payload, not prose.
         It stays readable as an attachment/embed but is not listed as a note. */
      if (/\.excalidraw\.md$/i.test(entry.name)) continue;
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

const IMPORT_EXTENSIONS = new Set([".md", ".markdown", ".mdx", ".txt", ".text"]);

/** Read an uploaded text file into the pieces every destination needs. */
export function parseImport(filename, text) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (!IMPORT_EXTENSIONS.has(ext)) {
    throw httpError(`"${ext || filename}" can't be imported — use a Markdown (.md, .markdown, .mdx) or plain text (.txt) file.`, 415);
  }
  const raw = String(text ?? "").replace(/^\uFEFF/, "");
  if (raw.includes("\0")) throw httpError("That file isn't text, so it can't be imported.", 415);
  const parsed = splitFrontmatter(raw);
  const stem = path.basename(String(filename), ext) + ".md";
  const fmTitle = typeof parsed.data?.title === "string" ? parsed.data.title.trim() : "";
  const title = fmTitle || titleFromBody(parsed.body) || filenameTitle(stem);
  return { raw, parsed, body: parsed.body, title, slug: filenameSlug(stem) };
}

export async function importNote({ folder = "", filename = "", text = "" } = {}) {
  const { title, raw, parsed, slug } = parseImport(filename, text);
  const { clean: parent } = absoluteFolder(folder);
  const dir = parent ? path.join(NOTES_ROOT, parent) : NOTES_ROOT;
  await mkdir(dir, { recursive: true });

  const extracted = await extractEmbeddedImages(raw, path.join(dir, "assets"));
  const body = splitFrontmatter(extracted.markdown).body;

  /* Picking the same file twice should open the note that is already there.
     Compare the body, since the first import added its own frontmatter. */
  let name = `${slug}.md`;
  for (let n = 2; ; n++) {
    const candidate = path.join(dir, name);
    if (!(await exists(candidate))) break;
    if (splitFrontmatter(await readFile(candidate, "utf8")).body === body) {
      return getNote(parent ? `${parent}/${name}` : name);
    }
    name = `${slug}-${n}.md`;
  }

  const now = new Date().toISOString();
  const changes = [{ key: "title", value: title }, { key: "updated", value: now }];
  if (!parsed.data?.created) changes.push({ key: "created", value: now });
  const rel = parent ? `${parent}/${name}` : name;
  await writeFile(path.join(NOTES_ROOT, rel), updateFrontmatter(extracted.markdown, changes, { create: true }));
  return getNote(rel);
}

/* A folder import sends one file at a time, with its path relative to the
   chosen private folder. The directory layout is kept exactly, so images
   that sit beside a note keep working after the import. */
export async function importFolderFile({ folder = "", relPath = "", bytes } = {}) {
  const { clean: parent } = absoluteFolder(folder);
  const parts = String(relPath || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);

  if (!parts.length) throw httpError("A file path is required.");
  for (const part of parts) {
    if (part === "__MACOSX") throw httpError("That file is a macOS metadata sidecar and was skipped.", 415);
    if (!segmentOk(part)) throw httpError(`"${part}" is not a valid name for an imported file.`);
  }

  const original = parts[parts.length - 1];
  const ext = path.extname(original).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && !NOTE_MEDIA_EXTENSIONS.has(ext)) {
    throw httpError(`"${ext || original}" can't be imported from a folder.`, 415);
  }

  const dirParts = parts.slice(0, -1);
  let filename = original;
  let data = bytes;

  if (TEXT_EXTENSIONS.has(ext)) {
    if (!bytes?.length) throw httpError("That file is empty.");
    const text = Buffer.from(bytes).toString("utf8");
    if (text.includes("\0")) throw httpError("That file isn't text, so it can't be imported.", 415);
    if (CONVERT_TO_MARKDOWN.has(ext)) filename = `${path.basename(original, ext)}.md`;
    data = Buffer.from(text, "utf8");
  } else if (!bytes?.length) {
    throw httpError("That file is empty.");
  }

  const targetDir = path.join(NOTES_ROOT, parent, ...dirParts);
  if (!isInside(NOTES_ROOT, targetDir)) {
    throw httpError("That import path is outside the private notes folder.");
  }
  await mkdir(targetDir, { recursive: true });

  if (TEXT_EXTENSIONS.has(ext)) {
    const extracted = await extractEmbeddedImages(Buffer.from(data).toString("utf8"), path.join(targetDir, "assets"));
    if (extracted.count) data = Buffer.from(extracted.markdown, "utf8");
  }

  const { name, reused } = await writeImportedFile(targetDir, filename, data);
  const rel = [...(parent ? parent.split("/") : []), ...dirParts, name].join("/");
  return {
    path: rel,
    name,
    folder: [...(parent ? parent.split("/") : []), ...dirParts].join("/"),
    reused,
    /* Excalidraw's Markdown wrapper is a drawing payload, not prose. */
    markdown: TEXT_EXTENSIONS.has(ext) && !/\.excalidraw\.md$/i.test(original),
  };
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

/* Old studios kept every note's pictures in a hidden `data/notes/.assets`
   tree. That key is still needed to read existing notes and to move them. */
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

/* New notes keep media in an `assets` folder beside the note:
     data/notes/Topic/assets/diagram.png
   The markdown therefore gets a portable relative path, and the whole
   topic folder can be copied, imported or moved as one unit. */
export function noteAssetBase(notePath) {
  const folder = noteFolderOf(notePath);
  return `/note-assets/${folder ? `${folder}/` : ""}`;
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

  const dir = noteAssetsDir(clean);
  await mkdir(dir, { recursive: true });

  let file = path.join(dir, base + ext);
  for (let n = 2; await exists(file); n++) file = path.join(dir, `${base}-${n}${ext}`);

  if (!bytes?.length) throw httpError("Empty file");
  await writeFile(file, bytes);

  return {
    /* Relative to the note, so it survives a move between folders. */
    path: `assets/${path.basename(file)}`,
    name: path.basename(file),
    bytes: bytes.length,
  };
}

export async function resolveNoteAsset(assetPath = "") {
  const decode = (part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  const parts = String(assetPath || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .map(decode);
  if (!parts.length) return null;
  for (const part of parts) {
    if (!segmentOk(part)) return null;
  }

  const ext = path.extname(parts[parts.length - 1]).toLowerCase();
  if (!NOTE_MEDIA_EXTENSIONS.has(ext)) return null;

  /* New layout: a real file somewhere inside data/notes. */
  const direct = path.resolve(NOTES_ROOT, ...parts);
  if (isInside(NOTES_ROOT, direct) && (await exists(direct))) return direct;

  /* Legacy layout: data/notes/.assets/<note-key>/<file>. */
  const legacy = path.resolve(ASSETS_ROOT, ...parts);
  if (isInside(ASSETS_ROOT, legacy) && (await exists(legacy))) return legacy;
  return null;
}

/* Move pictures from the old hidden asset tree into the folder that owns
   the note, rewriting the note's image URLs as it goes. This is what makes
   "import/move the whole folder" work for vaults created before the change. */
export async function migrateNoteAssets() {
  const { notes } = await walk("", 0);
  let migrated = 0;

  for (const note of notes) {
    try {
      const legacyDir = path.join(ASSETS_ROOT, assetKey(note.path));
      if (!(await exists(legacyDir))) continue;

      const destination = noteAssetsDir(note.path);
      await mkdir(destination, { recursive: true });
      const entries = await readdir(legacyDir, { withFileTypes: true }).catch(() => []);
      let raw = await readFile(path.join(NOTES_ROOT, note.path), "utf8");
      let changed = false;

      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith(".")) continue;
        const ext = path.extname(entry.name).toLowerCase();
        if (!NOTE_MEDIA_EXTENSIONS.has(ext)) continue;

        const stem = path.basename(entry.name, ext);
        let name = entry.name;
        for (let n = 2; await exists(path.join(destination, name)); n++) {
          name = `${stem}-${n}${ext}`;
        }
        await copyFile(path.join(legacyDir, entry.name), path.join(destination, name));

        const oldUrl = `/note-assets/${assetKey(note.path)}/${entry.name}`;
        if (raw.includes(oldUrl)) {
          raw = raw.split(oldUrl).join(`assets/${name}`);
          changed = true;
        }
        migrated++;
      }

      if (changed) await writeFile(path.join(NOTES_ROOT, note.path), raw);
      await rm(legacyDir, { recursive: true, force: true });
    } catch {
      /* One unreadable note must not stop the studio from starting. */
    }
  }

  return { migrated };
}

/* Older imports may still contain pasted screenshots as data: URIs. The
   pass is idempotent: notes without inline images are left untouched. */
export async function migrateEmbeddedNoteImages() {
  const { notes } = await walk("", 0);
  let migrated = 0;

  for (const note of notes) {
    if (/\.excalidraw\.md$/i.test(note.path)) continue;
    try {
      const file = path.join(NOTES_ROOT, note.path);
      const raw = await readFile(file, "utf8");
      if (!/data:image\//i.test(raw)) continue;
      const extracted = await extractEmbeddedImages(raw, noteAssetsDir(note.path));
      if (!extracted.count) continue;
      await writeFile(file, extracted.markdown);
      migrated++;
    } catch {
      /* One unreadable note must not stop the studio from starting. */
    }
  }

  return { migrated };
}
