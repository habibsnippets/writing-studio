/* ============================================================
   Moving writing between the two private storefronts.

     private note  ↔  local blog

   Both destinations are real folders now, so a move copies the body and
   every picture it references. Markdown links are rewritten to the
   destination's asset scheme; the source is removed only after the new
   copy has been written.
   ============================================================ */

import path from "node:path";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import { splitFrontmatter, createFrontmatter, filenameSlug, descriptionFromBody, normalizeDate } from "./frontmatter.mjs";
import { renderMarkdown, readingMinutes } from "./md.mjs";
import {
  NOTES_ROOT,
  CONTENT,
  DIST,
  isInside,
} from "./paths.mjs";
import {
  NOTE_MEDIA_EXTENSIONS,
  allocateNotePath,
  deleteNote,
  getNote,
  noteAssetBase,
} from "./notes.mjs";
import {
  ensureLocalPostDir,
  findLocalBody,
  localAssetsDir,
  localLegacyAssetsDir,
  localPostDir,
  localSlugOk,
  prettyPostDate,
  readLocalPosts,
  removeLocalPostFiles,
  writeLocalPosts,
} from "./local-blog.mjs";

const exists = (target) =>
  stat(target).then(
    () => true,
    () => false
  );

const isRemote = (ref = "") => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(String(ref).trim());

function splitRefToken(raw = "") {
  const token = String(raw || "").trim();
  const wrapped = token.startsWith("<") && token.endsWith(">");
  const value = wrapped ? token.slice(1, -1).trim() : token;
  const match = value.match(/^([^?#]*)([?#].*)?$/);
  return { wrapped, pathname: match?.[1] || "", suffix: match?.[2] || "" };
}

function decodePath(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeRelative(value = "") {
  return String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

async function firstFile(candidates) {
  for (const candidate of candidates) {
    if (!candidate || !isInside(candidate.root, candidate.file)) continue;
    if (await exists(candidate.file)) return candidate.file;
  }
  return null;
}

/* --- reference discovery and rewriting -------------------- */

const MD_REF_RE = /(!?\[[^\]]*\]\(\s*)([^)\s]+)/g;
const HTML_REF_RE = /(<(?:img|a)\b[^>]*\b(?:src|href)\s*=\s*["'])([^"']+)/gi;

function collectRefs(markdown = "") {
  const refs = new Set();
  const scan = (regex) => {
    String(markdown).replace(regex, (_, _prefix, raw) => {
      refs.add(raw);
      return _;
    });
  };
  scan(MD_REF_RE);
  scan(HTML_REF_RE);
  return [...refs];
}

function rewriteRefs(markdown = "", replacements) {
  if (!replacements.size) return String(markdown);
  const swap = (raw) => replacements.get(raw) || raw;
  return String(markdown)
    .replace(MD_REF_RE, (_, prefix, raw) => `${prefix}${swap(raw)}`)
    .replace(HTML_REF_RE, (_, prefix, raw) => `${prefix}${swap(raw)}`);
}

function formatRef(wrapped, value) {
  return wrapped ? `<${value}>` : value;
}

async function uniqueName(dir, preferred) {
  const ext = path.extname(preferred);
  const stem = path.basename(preferred, ext) || "asset";
  let name = `${stem}${ext}`;
  for (let n = 2; await exists(path.join(dir, name)); n++) name = `${stem}-${n}${ext}`;
  return name;
}

/* Copy one referenced file under `assetsRoot`, trying to preserve its
   topic-relative folder. Returns the path relative to `assetsRoot`. */
async function copyReferencedFile(source, assetsRoot, relativeHint = "") {
  const hint = safeRelative(relativeHint) || path.basename(source);
  const dir = path.join(assetsRoot, path.dirname(hint));
  await mkdir(dir, { recursive: true });
  const name = await uniqueName(dir, path.basename(hint));
  const relative = safeRelative(path.join(path.dirname(hint), name));
  const target = path.join(assetsRoot, relative);
  if (!isInside(assetsRoot, target)) throw new Error("An asset path escaped the destination folder.");
  await copyFile(source, target);
  return relative;
}

async function copyDirectoryInto(source, destination) {
  if (!(await exists(source))) return;
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: false, errorOnExist: false });
}

/* --- note -> local blog ------------------------------------ */

async function resolveNoteRef(ref, noteFolderAbs) {
  const { pathname, suffix } = splitRefToken(ref);
  if (!pathname || isRemote(pathname)) return null;
  const decoded = decodePath(pathname);

  if (decoded.startsWith("/note-assets/")) {
    const rel = decoded.slice("/note-assets/".length);
    const parts = safeRelative(rel);
    return firstFile([
      { root: NOTES_ROOT, file: path.resolve(NOTES_ROOT, ...parts.split("/")) },
      { root: path.join(NOTES_ROOT, ".assets"), file: path.resolve(NOTES_ROOT, ".assets", ...parts.split("/")) },
    ]);
  }
  if (decoded.startsWith("/")) return null;

  const file = path.resolve(noteFolderAbs, decoded);
  if (isInside(NOTES_ROOT, file) && (await exists(file))) return file;
  return null;
}

export async function moveNoteToLocal(notePath) {
  const note = await getNote(notePath);
  const title = note.meta.title || "Untitled note";
  const dateISO = normalizeDate(note.meta.dateISO) || new Date().toISOString().slice(0, 10);
  const body = String(note.markdown ?? "");
  const noteFolderAbs = note.meta.folder
    ? path.join(NOTES_ROOT, ...note.meta.folder.split("/"))
    : NOTES_ROOT;

  const posts = await readLocalPosts();
  const taken = new Set(posts.map((post) => post.slug));
  const base = filenameSlug(title) || filenameSlug(note.meta.filename) || "note";
  let slug = base;
  for (let n = 2; taken.has(slug) || (await findLocalBody(slug)); n++) slug = `${base}-${n}`;
  if (!localSlugOk(slug)) throw Object.assign(new Error("The note's title does not make a valid local URL."), { code: 400 });

  const assetsRoot = localAssetsDir(slug);
  await ensureLocalPostDir(slug);

  const replacements = new Map();
  const copied = new Map();
  for (const raw of collectRefs(body)) {
    if (isRemote(raw)) continue;
    const source = await resolveNoteRef(raw, noteFolderAbs);
    if (!source) continue;
    const ext = path.extname(source).toLowerCase();
    if (!NOTE_MEDIA_EXTENSIONS.has(ext)) continue;

    let relative = copied.get(source);
    if (!relative) {
      let hint = path.basename(source);
      if (isInside(noteFolderAbs, source)) {
        hint = safeRelative(path.relative(noteFolderAbs, source).split(path.sep).join("/"));
        hint = hint.replace(/^assets\//, "");
      }
      relative = await copyReferencedFile(source, assetsRoot, hint);
      copied.set(source, relative);
    }
    const { wrapped } = splitRefToken(raw);
    /* Relative to the article, so the whole folder can be imported,
       moved back to notes, or copied somewhere else as one unit. */
    replacements.set(raw, formatRef(wrapped, `assets/${relative}`));
  }

  /* Pick up pictures that were stored beside the note but not linked from
     the body, so a move never leaves part of a topic behind. */
  await copyDirectoryInto(path.join(noteFolderAbs, "assets"), assetsRoot);

  const markdown = rewriteRefs(body, replacements);
  const withNewline = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  const target = path.join(localPostDir(slug), `${slug}.md`);
  await writeFile(target, withNewline);

  const words = (await renderMarkdown(withNewline, { slug })).words;
  const entry = {
    slug,
    title,
    date: prettyPostDate(dateISO),
    dateISO,
    description: descriptionFromBody(markdown) || title,
    words,
    minutes: readingMinutes(words),
    tag: "general",
    draft: true,
    pinned: false,
    movedFrom: { type: "note", path: note.meta.path },
  };

  posts.push(entry);
  posts.sort((a, b) => String(b.dateISO || "").localeCompare(String(a.dateISO || "")));
  await writeLocalPosts(posts);

  await deleteNote(note.meta.path);

  return {
    from: { type: "note", path: note.meta.path, folder: noteAssetBase(note.meta.path) },
    to: { type: "local", slug, title, path: `content/${slug}/${slug}.md` },
    meta: entry,
    assets: copied.size,
  };
}

/* --- local blog -> note ------------------------------------ */

async function resolveLocalRef(ref, slug) {
  const { pathname, suffix } = splitRefToken(ref);
  if (!pathname || isRemote(pathname)) return null;
  const decoded = decodePath(pathname);

  const postDir = localPostDir(slug);
  const assetsDir = localAssetsDir(slug);
  const legacyDir = localLegacyAssetsDir(slug);
  const fromRoot = (prefix) => {
    if (!decoded.startsWith(prefix)) return null;
    const rel = safeRelative(decoded.slice(prefix.length));
    return rel;
  };

  let rel =
    fromRoot(`/assets/writing/${slug}/`) ??
    fromRoot(`/assets/${slug}/`) ??
    fromRoot(`/content/assets/${slug}/`);
  if (rel !== null) {
    return firstFile([
      { root: assetsDir, file: path.resolve(assetsDir, ...rel.split("/")) },
      { root: postDir, file: path.resolve(postDir, ...rel.split("/")) },
      { root: legacyDir, file: path.resolve(legacyDir, ...rel.split("/")) },
    ]);
  }
  if (decoded.startsWith("/")) return null;

  return firstFile([
    { root: postDir, file: path.resolve(postDir, decoded) },
    { root: assetsDir, file: path.resolve(assetsDir, decoded) },
    { root: legacyDir, file: path.resolve(legacyDir, decoded) },
  ]);
}

export async function moveLocalToNote(slug, folder = "") {
  if (!localSlugOk(slug)) throw Object.assign(new Error("That post does not exist."), { code: 404 });
  const posts = await readLocalPosts();
  const entry = posts.find((post) => post.slug === slug);
  if (!entry) throw Object.assign(new Error("That post is not in the local blog."), { code: 404 });

  const bodyFile = await findLocalBody(slug);
  if (!bodyFile) throw Object.assign(new Error("The post's Markdown file is missing."), { code: 404 });
  if (!/\.md$/i.test(bodyFile)) {
    throw Object.assign(new Error("Imported HTML posts are read-only and cannot be moved to notes."), { code: 400 });
  }

  const raw = await readFile(bodyFile, "utf8");
  const parsed = splitFrontmatter(raw);
  const title = entry.title || parsed.data?.title || "Untitled";
  const dateISO =
    normalizeDate(entry.dateISO) ||
    normalizeDate(parsed.data?.date) ||
    new Date().toISOString().slice(0, 10);

  const destination = await allocateNotePath({ folder, title });
  await mkdir(destination.assetsDir, { recursive: true });

  const postDir = localPostDir(slug);
  const assetsDir = localAssetsDir(slug);
  const legacyDir = localLegacyAssetsDir(slug);

  const replacements = new Map();
  const copied = new Map();
  for (const ref of collectRefs(parsed.body)) {
    if (isRemote(ref)) continue;
    const source = await resolveLocalRef(ref, slug);
    if (!source) continue;
    const ext = path.extname(source).toLowerCase();
    if (!NOTE_MEDIA_EXTENSIONS.has(ext)) continue;

    let relative = copied.get(source);
    if (!relative) {
      let hint = path.basename(source);
      if (isInside(assetsDir, source)) {
        hint = safeRelative(path.relative(assetsDir, source).split(path.sep).join("/"));
      } else if (isInside(postDir, source)) {
        hint = safeRelative(path.relative(postDir, source).split(path.sep).join("/")).replace(/^assets\//, "");
      }
      relative = await copyReferencedFile(source, destination.assetsDir, hint);
      copied.set(source, relative);
    }
    const { wrapped } = splitRefToken(ref);
    replacements.set(ref, formatRef(wrapped, `assets/${relative}`));
  }

  await copyDirectoryInto(assetsDir, destination.assetsDir);
  await copyDirectoryInto(legacyDir, destination.assetsDir);

  const markdown = rewriteRefs(parsed.body, replacements);
  const now = new Date().toISOString();
  const created = `${dateISO}T00:00:00.000Z`;
  const noteRaw =
    createFrontmatter({ title, created, updated: now }) +
    "\n" +
    markdown.replace(/\s+$/, "") +
    "\n";
  await writeFile(destination.absolute, noteRaw);

  const remaining = posts.filter((post) => post.slug !== slug);
  await writeLocalPosts(remaining);
  await removeLocalPostFiles(slug);
  await rm(path.join(DIST, slug), { recursive: true, force: true });

  return {
    from: { type: "local", slug, path: `content/${slug}` },
    to: { type: "note", path: destination.path, title, folder: destination.folder },
    note: { path: destination.path, title },
    meta: entry,
    assets: copied.size,
  };
}
