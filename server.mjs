#!/usr/bin/env node
/* ============================================================
   Writing Studio (Standalone) — Local Server

   A unified, independent platform to write blogs, draw diagrams,
   and read/annotate PDFs locally.

     npm run writing-studio    →   http://127.0.0.1:4321
   ============================================================ */

import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, unlink, access, rm, stat, readdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { renderMarkdown, readingMinutes, countHtmlWords, rewriteHtmlAssets, htmlFragment } from "./lib/md.mjs";
import { page } from "./lib/post-page.mjs";
import { normalizeDate } from "./lib/frontmatter.mjs";
import { buildSite } from "./lib/builder.mjs";
import { scanSite, inspectFolder } from "./lib/site-scanner.mjs";
import {
  readWorkspace,
  clearWorkspace,
  connectWorkspace,
  listSitePosts,
  getSitePost,
  saveSitePost,
  uploadSiteAsset,
  sitePreviewInfo,
  resolveSiteAsset,
  workspaceSummary,
} from "./lib/site-workspace.mjs";
import { archiveAndRemoveSitePost } from "./lib/site-archive.mjs";
import {
  listNotes,
  getNote,
  createNote,
  importNote,
  parseImport,
  saveNote,
  deleteNote,
  createFolder,
  deleteFolder,
  uploadNoteAsset,
  noteAssetBase,
  resolveNoteAsset,
} from "./lib/notes.mjs";
import { printBanner } from "./lib/banner.mjs";
import {
  APP_DIR,
  PUBLIC_DIR,
  CONTENT,
  POSTS_FILE,
  ASSETS_DIR,
  DIST,
  SEED_DIR,
  DATA_DIR,
  STUDIO_DATA,
  NOTES_ROOT,
  isInside,
  displayPath,
} from "./lib/paths.mjs";

/* Node 20.11 is the floor: import.meta.dirname/filename and the modern
   fs, AbortSignal and fetch APIs all need it. Checked here so a stale
   Node install gets a sentence instead of a stack trace. */
const NODE_VERSION = process.versions.node;
const [nodeMajor, nodeMinor] = NODE_VERSION.split(".").map(Number);
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 11)) {
  console.error(
    `\n  Writing Studio needs Node.js 20.11 or newer — this is Node ${NODE_VERSION}.\n` +
      `  Install the current LTS from https://nodejs.org and run npm start again.\n`
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
const run = promisify(execFile);

const PUBLIC = PUBLIC_DIR;

const DEFAULT_PORT = Number(process.env.PORT) || 4321;
const HOST = "127.0.0.1";

/* --- Find pdfjs-dist location ----------------------------- */

let pdfjsDistDir = null;
try {
  const pkgPath = require.resolve("pdfjs-dist/package.json", { paths: [APP_DIR, path.resolve(APP_DIR, "..")] });
  pdfjsDistDir = path.dirname(pkgPath);
} catch {
  const local = path.join(APP_DIR, "node_modules/pdfjs-dist");
  const parent = path.join(APP_DIR, "../node_modules/pdfjs-dist");
  pdfjsDistDir = (await access(local).then(() => true, () => false)) ? local : parent;
}

/* --- Helpers ---------------------------------------------- */

/* CON, NUL and friends are filenames on Windows, not files. */
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const slugOk = (s) =>
  /^[a-z0-9][a-z0-9-]{0,80}$/.test(s || "") && !WINDOWS_RESERVED.test(s || "");
const exists = (p) => access(p).then(() => true, () => false);

async function readPosts() {
  try {
    return JSON.parse(await readFile(POSTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

async function writePosts(posts) {
  await mkdir(CONTENT, { recursive: true });
  await writeFile(POSTS_FILE, JSON.stringify(posts, null, 2) + "\n");
}

/* A fresh clone has no content/ or data/ folders: both are gitignored
   because they hold personal writing. Create the local store on first
   run and seed a single welcome article from content.example/. */
async function ensureLocalStore() {
  await mkdir(CONTENT, { recursive: true });
  await mkdir(ASSETS_DIR, { recursive: true });
  await mkdir(path.join(NOTES_ROOT, ".assets"), { recursive: true });

  if (await exists(POSTS_FILE)) return;

  const entries = await readdir(CONTENT, { withFileTypes: true }).catch(() => []);
  const hasPosts = entries.some(
    (entry) => entry.isFile() && /\.(?:md|markdown|mdx|html?)$/i.test(entry.name)
  );

  /* If posts already exist, never replace them with seed content. */
  if (hasPosts) {
    await writePosts([]);
    return;
  }

  if (!(await exists(SEED_DIR))) {
    await writePosts([]);
    return;
  }

  const seed = await readdir(SEED_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of seed) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const target = path.join(CONTENT, entry.name);
    if (!(await exists(target))) {
      await copyFile(path.join(SEED_DIR, entry.name), target);
    }
  }

  if (!(await exists(POSTS_FILE))) await writePosts([]);
}

function sortPosts(posts) {
  return posts.sort((a, b) => String(b.dateISO || "").localeCompare(String(a.dateISO || "")));
}

async function bodyPath(slug) {
  for (const ext of [".md", ".html"]) {
    const p = path.join(CONTENT, slug + ext);
    if (await exists(p)) return p;
  }
  return null;
}

function autoDescription(markdown, max = 180) {
  const line =
    markdown
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\$\$([\s\S]*?)\$\$/g, " ")
      .replace(/\$([^$\n]+)\$/g, "$1")
      .split(/\n\s*\n/)
      .map((p) => p.replace(/^#+\s+/gm, "").replace(/[*_`>#]/g, "").trim())
      .find((p) => p.length > 40) || "";
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).replace(/[,;:.\s]+\S*$/, "") + "…" : flat;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const prettyDate = (iso) => {
  const [year, month, day] = String(iso).split("-");
  return `${day} ${MONTHS[Number(month) - 1] || "Jan"}, ${year}`;
};

function send(res, code, body, type = "application/json") {
  /* Node errors carry string codes such as "ENOENT"; those are not HTTP
     statuses. A file that vanished from disk is a 404, anything else 500. */
  if (!Number.isInteger(code) || code < 100 || code > 599) {
    code = code === "ENOENT" || code === "ENOTDIR" ? 404 : 500;
    if (body && typeof body === "object" && code === 404 && body.error) {
      body = { ...body, error: "That file no longer exists on disk. Refresh the list." };
    }
  }
  const payload = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(code, {
    "content-type": type,
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function body(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      req.destroy();
      throw new Error("Payload too large (limit 25 MB)");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const json = async (req) => JSON.parse((await body(req)).toString("utf8") || "{}");

async function gitState() {
  try {
    /* The writing folder is the user's own repository when they run the
       studio against it, so git status is read from there. */
    const searchDir = DATA_DIR;
    const [{ stdout: status }, { stdout: branch }] = await Promise.all([
      run("git", ["status", "--porcelain"], { cwd: searchDir }),
      run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: searchDir }),
    ]);
    const changed = status.split("\n").filter(Boolean);
    return { branch: branch.trim(), changed: changed.length, clean: changed.length === 0 };
  } catch {
    return { branch: "main", changed: 0, clean: true, unavailable: true };
  }
}

function gitCommand(message, branch) {
  const safe = message.replace(/["\\$`]/g, "");
  return `git add -A && git commit -m "${safe}" && git push origin ${branch || "main"}`;
}

/* --- Save Post -------------------------------------------- */

async function savePost(meta, markdown) {
  if (!slugOk(meta.slug)) {
    throw Object.assign(new Error("Slug must contain lowercase letters, numbers, and dashes only"), { code: 400 });
  }
  if (await exists(path.join(CONTENT, `${meta.slug}.html`))) {
    throw Object.assign(
      new Error("HTML posts are read-only in the studio. Edit the .html file directly in your editor."),
      { code: 400 }
    );
  }

  await mkdir(CONTENT, { recursive: true });
  const posts = await readPosts();
  const i = posts.findIndex((p) => p.slug === meta.slug);
  const previous = i >= 0 ? posts[i] : null;

  const text = String(markdown ?? "");
  const words = renderMarkdown(text, { slug: meta.slug }).words;
  const today = new Date().toISOString().slice(0, 10);

  const entry = {
    ...(previous || {}),
    slug: meta.slug,
    title: (meta.title || "").trim() || "Untitled",
    date: prettyDate(meta.dateISO || today),
    dateISO: meta.dateISO || today,
    description: (meta.description || "").trim() || autoDescription(text) || (meta.title || "Untitled"),
    words,
    minutes: readingMinutes(words),
    tag: meta.tag || previous?.tag || "general",
    draft: meta.draft !== false,
    /* Pinning survives ordinary saves; only an explicit flag changes it. */
    pinned: meta.pinned === undefined ? !!previous?.pinned : !!meta.pinned,
  };

  if (i < 0 && (await bodyPath(meta.slug))) {
    throw Object.assign(new Error(`"${meta.slug}" already belongs to another post — choose a different slug`), { code: 409 });
  }

  await writeFile(path.join(CONTENT, `${meta.slug}.md`), text);
  if (i >= 0) posts[i] = entry;
  else posts.push(entry);
  sortPosts(posts);
  await writePosts(posts);

  const saved = (await readPosts()).find((p) => p.slug === meta.slug);
  return { ...saved, draft: !!saved.draft };
}

/* --- API Handler ------------------------------------------ */

async function api(req, res, url) {
  const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");

  /* --- Connected GitHub Pages workspace ------------------- */

  if (req.method === "GET" && route === "workspace") {
    const workspace = await readWorkspace();
    return send(res, 200, { workspace: await workspaceSummary(workspace) });
  }

  if (req.method === "POST" && route === "workspace/scan") {
    try {
      const { repoRoot, generator = "auto", siteUrl = "" } = await json(req);
      const scan = await scanSite(repoRoot, { generator, siteUrl });
      return send(res, 200, { scan });
    } catch (err) {
      return send(res, err.code || 400, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "workspace/inspect") {
    try {
      const { repoRoot, folder } = await json(req);
      const section = await inspectFolder(repoRoot, folder);
      return send(res, 200, { section });
    } catch (err) {
      return send(res, err.code || 400, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "workspace/connect") {
    try {
      const payload = await json(req);
      const workspace = await connectWorkspace(payload);
      return send(res, 200, { workspace: await workspaceSummary(workspace) });
    } catch (err) {
      return send(res, err.code || 400, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "workspace/disconnect") {
    await clearWorkspace();
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && route === "workspace/posts") {
    try {
      const workspace = await readWorkspace();
      if (!workspace) return send(res, 404, { error: "No GitHub Pages site is connected." });
      const data = await listSitePosts(workspace);
      return send(res, 200, { ...data, workspace: await workspaceSummary(workspace) });
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  if (req.method === "GET" && route === "workspace/post") {
    try {
      const workspace = await readWorkspace();
      const id = url.searchParams.get("id") || "";
      const data = await getSitePost(workspace, id);
      return send(res, 200, data);
    } catch (err) {
      return send(res, err.code || 404, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "workspace/post") {
    try {
      const workspace = await readWorkspace();
      const { meta = {}, markdown = "" } = await json(req);
      const saved = await saveSitePost(workspace, meta, markdown);
      return send(res, 200, { meta: saved, savedAt: new Date().toISOString() });
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  if (req.method === "POST" && (route === "workspace/remove" || route === "workspace/delete")) {
    try {
      const workspace = await readWorkspace();
      const { id } = await json(req);
      const data = await archiveAndRemoveSitePost(workspace, id);
      return send(res, 200, data);
    } catch (err) {
      return send(res, err.code || 500, { error: err.message, archive: err.archive || null });
    }
  }

  if (req.method === "POST" && route === "workspace/preview") {
    try {
      const workspace = await readWorkspace();
      if (!workspace) return send(res, 404, { error: "No GitHub Pages site is connected." });
      const { meta = {}, markdown = "", legacyHtml = null, tex = false } = await json(req);
      const assetInfo = await sitePreviewInfo(workspace, meta);

      let body;
      let words;
      let hasMath = false;
      if (tex) {
        /* The studio does not compile LaTeX. Show the source so the
           preview pane is honest about what it is. */
        const source = String(markdown).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);
        body = `<pre class="tex-source" style="white-space:pre-wrap;font:14px/1.6 ui-monospace,monospace">${source}</pre>`;
        words = source.split(/\s+/).filter(Boolean).length;
      } else if (legacyHtml !== null && legacyHtml !== undefined) {
        /* Imported Bearblog posts are stored as raw HTML fragments.
           Route their root-relative images through the studio's
           read-only asset server before dropping them into the shell. */
        body = rewriteHtmlAssets(String(legacyHtml), assetInfo.assetRootPrefix);
        words = countHtmlWords(body);
      } else {
        const out = renderMarkdown(String(markdown), {
          slug: meta.slug || "",
          assetBase: assetInfo.assetBase,
          assetRootPrefix: assetInfo.assetRootPrefix,
        });
        body = out.html;
        words = out.words;
        hasMath = out.hasMath;
      }

      const post = {
        slug: meta.slug || "draft",
        title: meta.title || "Untitled",
        dateISO: meta.dateISO || new Date().toISOString().slice(0, 10),
        date: prettyDate(meta.dateISO || new Date().toISOString().slice(0, 10)),
        description: meta.description || "",
        minutes: readingMinutes(words),
      };
      return send(res, 200, {
        html: page(post, body, null, null, { hasMath, preview: true }),
        words,
        minutes: post.minutes,
      });
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "workspace/upload") {
    try {
      const workspace = await readWorkspace();
      const id = url.searchParams.get("id") || "";
      const filename = decodeURIComponent(req.headers["x-filename"] || "image.png");
      const bytes = await body(req, 25 * 1024 * 1024);
      if (!bytes.length) return send(res, 400, { error: "Empty file" });
      const uploaded = await uploadSiteAsset(workspace, id, filename, bytes);
      return send(res, 200, uploaded);
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  /* --- Private local notes -------------------------------- */

  if (req.method === "GET" && route === "notes/tree") {
    try {
      return send(res, 200, await listNotes());
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  if (req.method === "GET" && route === "notes/note") {
    try {
      const notePath = url.searchParams.get("path") || "";
      return send(res, 200, await getNote(notePath));
    } catch (err) {
      return send(res, err.code || 404, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "notes/create") {
    try {
      const { folder = "", title = "" } = await json(req);
      return send(res, 200, await createNote({ folder, title }));
    } catch (err) {
      return send(res, err.code || 400, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "notes/note") {
    try {
      const { path: notePath = "", title = "", markdown = "" } = await json(req);
      const saved = await saveNote({ path: notePath, title, markdown });
      return send(res, 200, { meta: saved.meta, savedAt: new Date().toISOString() });
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "notes/delete") {
    try {
      const { path: notePath } = await json(req);
      return send(res, 200, await deleteNote(notePath));
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "notes/folder") {
    try {
      const { parent = "", name = "" } = await json(req);
      return send(res, 200, await createFolder({ parent, name }));
    } catch (err) {
      return send(res, err.code || 400, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "notes/folder/delete") {
    try {
      const { folder } = await json(req);
      return send(res, 200, await deleteFolder(folder));
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "notes/preview") {
    try {
      const { path: notePath = "", title = "", markdown = "" } = await json(req);
      const assetBase = notePath ? noteAssetBase(notePath) : "";
      const out = renderMarkdown(String(markdown), { assetBase });
      const words = out.words;
      const dateISO = new Date().toISOString().slice(0, 10);
      const post = {
        slug: notePath || "note",
        title: title || "Untitled note",
        dateISO,
        date: prettyDate(dateISO),
        description: "",
        minutes: readingMinutes(words),
      };
      return send(res, 200, {
        html: page(post, out.html, null, null, { hasMath: out.hasMath, preview: true }),
        words,
        minutes: post.minutes,
      });
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "notes/upload") {
    try {
      const notePath = url.searchParams.get("path") || "";
      const filename = decodeURIComponent(req.headers["x-filename"] || "image.png");
      const bytes = await body(req, 25 * 1024 * 1024);
      return send(res, 200, await uploadNoteAsset(notePath, filename, bytes));
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  /* Import a text file the user picked or dropped. The target says
     where it lands: a private folder, the local blog, or a Pages section. */
  if (req.method === "POST" && route === "import") {
    try {
      const filename = decodeURIComponent(req.headers["x-filename"] || "");
      const kind = url.searchParams.get("kind") || "note";
      const bytes = await body(req, 10 * 1024 * 1024);
      const text = bytes.toString("utf8");

      if (kind === "note") {
        const note = await importNote({ folder: url.searchParams.get("folder") || "", filename, text });
        return send(res, 200, { kind, id: note.meta.path, title: note.meta.title });
      }

      const { title, body: content, slug, parsed } = parseImport(filename, text);
      const dateISO = normalizeDate(parsed.data?.date) || undefined;
      if (kind === "local") {
        const posts = await readPosts();
        let unique = slug;
        for (let n = 2; posts.some((p) => p.slug === unique) || (await bodyPath(unique)); n++) unique = `${slug}-${n}`;
        const saved = await savePost({ slug: unique, title, dateISO, description: parsed.data?.description, draft: true }, content);
        return send(res, 200, { kind, id: saved.slug, title: saved.title });
      }
      if (kind === "site") {
        const workspace = await readWorkspace();
        const saved = await saveSitePost(
          workspace,
          { sectionId: url.searchParams.get("section") || "", slug, title, dateISO, description: parsed.data?.description },
          content
        );
        return send(res, 200, { kind, id: saved.id, title: saved.title });
      }
      return send(res, 400, { error: "Unknown import destination" });
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  /* --- Studio's own local content ------------------------- */

  if (req.method === "GET" && route === "posts") {
    const posts = await readPosts();
    const withFlags = await Promise.all(
      posts.map(async (p) => ({
        ...p,
        draft: !!p.draft,
        pinned: !!p.pinned,
        hasBody: !!(await bodyPath(p.slug)),
      }))
    );
    return send(res, 200, {
      posts: withFlags,
      git: await gitState(),
      counts: {
        published: withFlags.filter((p) => !p.draft).length,
        drafts: withFlags.filter((p) => p.draft).length,
      },
    });
  }

  if (req.method === "GET" && route === "post") {
    const slug = url.searchParams.get("slug") || "";
    const meta = (await readPosts()).find((p) => p.slug === slug);
    if (!meta) return send(res, 404, { error: "Post not found" });
    const file = await bodyPath(slug);
    const raw = file ? await readFile(file, "utf8") : "";
    return send(res, 200, {
      meta: { ...meta, draft: !!meta.draft },
      markdown: file?.endsWith(".md") ? raw : null,
      legacyHtml: file?.endsWith(".html") ? raw : null,
    });
  }

  if (req.method === "GET" && route === "export") {
    const slug = url.searchParams.get("slug") || "";
    const file = await bodyPath(slug);
    if (!file) return send(res, 404, { error: "Post not found" });
    const raw = await readFile(file, "utf8");
    res.writeHead(200, {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${slug}.md"`,
      "content-length": Buffer.byteLength(raw),
    });
    return res.end(raw);
  }

  if (req.method === "POST" && route === "post") {
    const { meta = {}, markdown = "" } = await json(req);
    try {
      const saved = await savePost(meta, markdown);
      return send(res, 200, { meta: saved, savedAt: new Date().toISOString() });
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }
  }

  if (req.method === "POST" && route === "upload") {
    const slug = url.searchParams.get("slug") || "";
    if (!slugOk(slug)) return send(res, 400, { error: "Save the post first before adding media" });

    let name = decodeURIComponent(req.headers["x-filename"] || "image.png");
    const ext = path.extname(name).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"].includes(ext)) {
      return send(res, 400, { error: `Unsupported image type "${ext || "none"}"` });
    }

    let base =
      path
        .basename(name, ext)
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "image";
    /* Windows refuses to create CON.png, NUL.png and the like. */
    if (WINDOWS_RESERVED.test(base)) base += "-file";

    const dir = path.join(ASSETS_DIR, slug);
    await mkdir(dir, { recursive: true });

    let file = path.join(dir, base + ext);
    for (let n = 2; await exists(file); n++) file = path.join(dir, `${base}-${n}${ext}`);

    const bytes = await body(req, 25 * 1024 * 1024);
    if (!bytes.length) return send(res, 400, { error: "Empty file" });
    await writeFile(file, bytes);

    const rel = `/assets/writing/${slug}/${path.basename(file)}`;
    return send(res, 200, { path: rel, name: path.basename(file), bytes: bytes.length });
  }

  if (req.method === "POST" && route === "preview") {
    const { meta = {}, markdown = "" } = await json(req);
    const slug = slugOk(meta.slug) ? meta.slug : "draft";
    const out = renderMarkdown(String(markdown), { slug });
    const words = out.words;
    const post = {
      slug: meta.slug || "draft",
      title: meta.title || "Untitled",
      dateISO: meta.dateISO || new Date().toISOString().slice(0, 10),
      date: prettyDate(meta.dateISO || new Date().toISOString().slice(0, 10)),
      description: meta.description || "",
      minutes: readingMinutes(words),
    };
    return send(res, 200, {
      html: page(post, out.html, null, null, { hasMath: out.hasMath, preview: true }),
      words,
      minutes: post.minutes,
    });
  }

  if (req.method === "POST" && (route === "publish" || route === "unpublish")) {
    const { meta = {}, markdown = "" } = await json(req);
    if (!slugOk(meta.slug)) return send(res, 400, { error: "Invalid slug" });

    let saved;
    try {
      saved = await savePost(meta, markdown);
    } catch (err) {
      return send(res, err.code || 500, { error: err.message });
    }

    const posts = await readPosts();
    const i = posts.findIndex((p) => p.slug === saved.slug);
    if (i >= 0) posts[i].draft = route === "unpublish";
    await writePosts(posts);

    const buildResult = await buildSite();
    const git = await gitState();

    return send(res, 200, {
      ok: true,
      draft: route === "unpublish",
      output: buildResult.out,
      git: { ...git, command: gitCommand(`${saved.title} post`, git.branch) },
    });
  }

  if (req.method === "POST" && route === "delete") {
    const { slug } = await json(req);
    if (!slugOk(slug)) return send(res, 400, { error: "Invalid slug" });

    const posts = (await readPosts()).filter((p) => p.slug !== slug);
    await writePosts(posts);

    for (const ext of [".md", ".html"]) await unlink(path.join(CONTENT, slug + ext)).catch(() => {});
    await rm(path.join(ASSETS_DIR, slug), { recursive: true, force: true });
    await rm(path.join(DIST, slug), { recursive: true, force: true });

    const buildResult = await buildSite();
    return send(res, 200, { ok: true, output: buildResult.out, git: await gitState() });
  }

  if (route === "proxy-pdf") {
    let target = "";
    if (req.method === "GET") {
      target = url.searchParams.get("url") || "";
    } else if (req.method === "POST") {
      try {
        const payload = await json(req);
        target = payload.url || "";
      } catch {
        return send(res, 400, { error: "Invalid JSON body" });
      }
    } else {
      return send(res, 405, { error: "Method not allowed" });
    }

    target = String(target).trim();
    if (!target) return send(res, 400, { error: "Missing 'url' parameter" });

    // Normalize arXiv links
    if (!/^https?:\/\//i.test(target)) {
      target = "https://" + target;
    }
    target = target
      .replace(/arxiv\.org\/abs\/([0-9.]+)(?:v\d+)?(?:\.pdf)?/i, "arxiv.org/pdf/$1.pdf")
      .replace(/arxiv\.org\/pdf\/([0-9.]+)(?:v\d+)?(?!\.pdf)$/i, "arxiv.org/pdf/$1.pdf");

    try {
      new URL(target);
    } catch {
      return send(res, 400, { error: `Invalid URL: "${target}"` });
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);

      const upstream = await fetch(target, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 WritingStudio/1.0",
          "Accept": "application/pdf,application/octet-stream,*/*",
        },
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!upstream.ok) {
        return send(res, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, {
          error: `Could not download PDF from remote server (HTTP ${upstream.status}: ${upstream.statusText || "Error"})`,
        });
      }

      const MAX_PDF_BYTES = 50 * 1024 * 1024;
      const contentLengthHeader = upstream.headers.get("content-length");
      if (contentLengthHeader && Number(contentLengthHeader) > MAX_PDF_BYTES) {
        return send(res, 413, { error: "PDF exceeds maximum allowed size of 50 MB" });
      }

      const arrayBuffer = await upstream.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);

      if (buf.length > MAX_PDF_BYTES) {
        return send(res, 413, { error: "PDF exceeds maximum allowed size of 50 MB" });
      }

      const magic = buf.slice(0, 5).toString("utf8");
      if (!magic.startsWith("%PDF")) {
        const preview = buf.slice(0, 200).toString("utf8");
        if (/<!doctype|<html/i.test(preview)) {
          return send(res, 422, {
            error: "The link returned an HTML webpage instead of a PDF document. Please make sure the link points directly to a PDF paper.",
          });
        }
        return send(res, 422, {
          error: "The downloaded file does not appear to be a valid PDF (missing %PDF header).",
        });
      }

      let filename = "";
      const disp = upstream.headers.get("content-disposition") || "";
      const fnMatch = disp.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
      if (fnMatch) {
        try {
          filename = decodeURIComponent(fnMatch[1]);
        } catch {
          filename = fnMatch[1];
        }
      }
      if (!filename) {
        try {
          const finalUrl = new URL(upstream.url || target);
          filename = path.basename(finalUrl.pathname) || "";
        } catch {}
      }
      if (!filename || filename === "/" || filename === ".") {
        filename = "paper.pdf";
      }
      if (!/\.pdf$/i.test(filename)) {
        filename += ".pdf";
      }

      res.writeHead(200, {
        "content-type": "application/pdf",
        "content-length": buf.length,
        "x-filename": encodeURIComponent(filename),
        "access-control-expose-headers": "x-filename, content-disposition",
        "cache-control": "no-store",
      });
      return res.end(buf);
    } catch (err) {
      if (err.name === "AbortError") {
        return send(res, 504, { error: "Download timed out after 45 seconds" });
      }
      return send(res, 502, { error: `Failed to fetch PDF: ${err.message}` });
    }
  }

  /* --- AI Assistant Endpoints ----------------------------- */

  if (route === "ai/test" && req.method === "POST") {
    try {
      const { provider, apiKey, model, baseUrl } = await json(req);
      const result = await callAiProvider({
        provider,
        apiKey,
        model,
        baseUrl,
        text: "Please reply with 'Connection successful.' to verify the API key.",
        question: "Connection test",
      });
      return send(res, 200, { ok: true, message: result.explanation, model: result.model });
    } catch (err) {
      return send(res, 400, { ok: false, error: err.message });
    }
  }

  if (route === "ai/explain" && req.method === "POST") {
    try {
      const payload = await json(req);
      let result;
      try {
        result = await callAiProvider(payload);
      } catch (err) {
        /* Text-only models (common on Groq/OpenRouter) reject the visual
           excerpt; retry with the extracted passage alone. Leave the Google
           path untouched so its existing error behavior is preserved. */
        const canRetryWithoutImage = ["openai", "openrouter", "groq"].includes(payload.provider);
        const rejectedImage = canRetryWithoutImage
          && payload.imageBase64
          && /image|vision|multimodal|modality|media/i.test(err.message || "");
        if (!rejectedImage) throw err;
        result = await callAiProvider({ ...payload, imageBase64: null });
      }
      return send(res, 200, { ok: true, explanation: result.explanation, model: result.model });
    } catch (err) {
      return send(res, 400, { ok: false, error: err.message });
    }
  }

  return send(res, 404, { error: "Endpoint not found" });
}

/* --- Multi-Provider AI Caller ----------------------------- */

async function callAiProvider({ provider = "google", apiKey, model, baseUrl, text, imageBase64, question, paperTitle }) {
  if (!apiKey || !String(apiKey).trim()) throw new Error("API key is required");

  const cleanImage = imageBase64 ? imageBase64.replace(/^data:image\/[a-z]+;base64,/, "") : null;

  const systemPrompt = `You are an expert research and academic assistant in Writing Studio.
The user has highlighted a specific passage or equation from a research paper or PDF document.
Document context: ${paperTitle || "Academic Paper"}.

Guidelines:
- Explain the highlighted content clearly, intuitively, and concisely.
- If it contains mathematics or formulas, explain what each variable represents and the conceptual intuition.
- If it contains domain jargon, define it simply.
- If the user asks a specific follow-up question, answer that directly using the passage and visual excerpt.
- Use clear Markdown formatting with KaTeX ($math$ or $$display math$$) where appropriate.`;

  const userPrompt = question
    ? `Highlighted excerpt:\n"${text || "(See attached visual excerpt)"}"\n\nUser Question:\n${question}`
    : `Please explain the following highlighted passage from the paper in clear, accessible terms:\n\n"${text || "(See attached visual excerpt)"}"`;

  const timeout = 60000;

  if (provider === "google") {
    const selectedModel = (model && !model.startsWith("gemini-2.0") ? model : "gemini-3.8-flash");
    const endpoint = baseUrl
      ? `${baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`
      : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const parts = [{ text: `${systemPrompt}\n\n${userPrompt}` }];
    if (cleanImage) {
      parts.push({
        inlineData: {
          mimeType: "image/png",
          data: cleanImage,
        },
      });
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
      }),
      signal: AbortSignal.timeout(timeout),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error?.message || `Google AI Studio error (HTTP ${res.status})`;
      throw new Error(msg);
    }

    const candidate = data.candidates?.[0];
    const reply = candidate?.content?.parts?.map((p) => p.text).join("") || "";
    if (!reply) throw new Error("No response generated by the model");
    return { explanation: reply, model: selectedModel };
  }

  if (provider === "openai" || provider === "openrouter" || provider === "groq") {
    const isOR = provider === "openrouter";
    const isGroq = provider === "groq";
    const selectedModel = model || (isOR
      ? "google/gemini-3.8-flash"
      : isGroq
        ? "qwen/qwen3.8-27b"
        : "gpt-4o-mini");
    const endpoint = baseUrl || (isOR
      ? "https://openrouter.ai/api/v1/chat/completions"
      : isGroq
        ? "https://api.groq.com/openai/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions");

    const content = [{ type: "text", text: userPrompt }];
    if (cleanImage) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${cleanImage}` },
      });
    }

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
    if (isOR) {
      headers["HTTP-Referer"] = "http://127.0.0.1:4321";
      headers["X-Title"] = "Writing Studio";
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content },
        ],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(timeout),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error?.message || `${provider} error (HTTP ${res.status})`;
      throw new Error(msg);
    }

    const reply = data.choices?.[0]?.message?.content || "";
    if (!reply) throw new Error("No response generated by the model");
    return { explanation: reply, model: selectedModel };
  }

  if (provider === "anthropic") {
    const selectedModel = model || "claude-3-5-haiku-latest";
    const endpoint = baseUrl || "https://api.anthropic.com/v1/messages";

    const content = [];
    if (cleanImage) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: cleanImage,
        },
      });
    }
    content.push({ type: "text", text: userPrompt });

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(timeout),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error?.message || `Anthropic error (HTTP ${res.status})`;
      throw new Error(msg);
    }

    const reply = data.content?.map((c) => c.text).join("") || "";
    if (!reply) throw new Error("No response generated by the model");
    return { explanation: reply, model: selectedModel };
  }

  throw new Error(`Unsupported AI provider: "${provider}"`);
}

/* --- Static File Handling --------------------------------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
  ".cmap": "application/octet-stream",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

async function serveFile(res, filePath) {
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      return serveFile(res, path.join(filePath, "index.html"));
    }
    const data = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "cache-control": "no-store",
      "content-length": data.length,
    });
    res.end(data);
  } catch {
    send(res, 404, { error: "File not found" });
  }
}

async function serveStatic(res, url) {
  let pathname = decodeURIComponent(url.pathname);

  // 1. Root studio interface
  if (pathname === "/" || pathname === "/index.html") {
    return serveFile(res, path.join(PUBLIC, "index.html"));
  }

  // 2. Compatibility alias for /tools/studio/*
  if (pathname.startsWith("/tools/studio/")) {
    const sub = pathname.replace(/^\/tools\/studio\//, "");
    return serveFile(res, path.join(PUBLIC, sub));
  }

  // 3. PDF.js assets from node_modules
  if (pathname.startsWith("/node_modules/pdfjs-dist/")) {
    if (!pdfjsDistDir) return send(res, 404, { error: "pdfjs-dist not found" });
    const sub = pathname.replace(/^\/node_modules\/pdfjs-dist\//, "");
    const target = path.resolve(pdfjsDistDir, sub);
    if (!target.startsWith(pdfjsDistDir)) return send(res, 403, { error: "Access denied" });
    return serveFile(res, target);
  }

  // 4. Images and other allowed media from a connected GitHub Pages repo.
  if (pathname.startsWith("/site-assets/")) {
    const workspace = await readWorkspace();
    const target = resolveSiteAsset(workspace, pathname.slice("/site-assets/".length));
    if (!target) return send(res, 404, { error: "Asset not found" });
    return serveFile(res, target);
  }

  // 4b. Private note images. These live under data/notes/.assets and
  // are never part of content/, dist/, or a connected Pages repo.
  if (pathname.startsWith("/note-assets/")) {
    const target = resolveNoteAsset(pathname.slice("/note-assets/".length));
    if (!target) return send(res, 404, { error: "Asset not found" });
    return serveFile(res, target);
  }

  // 5. Post assets / diagrams (/assets/writing/<slug>/<file> or /content/assets/...)
  const mediaMatch = pathname.match(/^\/(?:assets\/writing|assets|content\/assets)\/([a-z0-9-]+)\/([^/]+)$/i);
  if (mediaMatch) {
    const [, slug, filename] = mediaMatch;
    const mediaFile = path.join(ASSETS_DIR, slug, filename);
    if (await exists(mediaFile)) {
      return serveFile(res, mediaFile);
    }
  }

  // 6. Published posts and archive (/writing/ or /writing/<slug>/ or /posts/<slug>/)
  if (pathname === "/writing" || pathname === "/writing/") {
    return serveFile(res, path.join(DIST, "index.html"));
  }
  const postMatch = pathname.match(/^\/(?:writing|posts)\/([a-z0-9-]+)\/?$/i);
  if (postMatch) {
    const slug = postMatch[1];
    const distHtml = path.join(DIST, slug, "index.html");
    if (await exists(distHtml)) {
      return serveFile(res, distHtml);
    }
    // Dynamic preview fallback if not built yet
    const posts = await readPosts();
    const meta = posts.find((p) => p.slug === slug);
    const bodyFile = await bodyPath(slug);
    if (meta && bodyFile) {
      const raw = await readFile(bodyFile, "utf8");
      if (bodyFile.endsWith(".html")) {
        const html = page(meta, htmlFragment(raw), null, null, {});
        return send(res, 200, html, "text/html; charset=utf-8");
      }
      const out = renderMarkdown(raw, { slug });
      const html = page(meta, out.html, null, null, { hasMath: out.hasMath });
      return send(res, 200, html, "text/html; charset=utf-8");
    }
  }

  // 7. Public static files
  const rel = pathname.replace(/^\/+/, "");
  const publicTarget = path.resolve(PUBLIC, rel);
  if (isInside(PUBLIC, publicTarget) && (await exists(publicTarget))) {
    return serveFile(res, publicTarget);
  }

  // 404
  send(res, 404, { error: "Not found" });
}

/* --- Server Bootstrap with Port Conflict Handling --------- */

export async function startServer(port = DEFAULT_PORT, attempts = 10) {
  try {
    await ensureLocalStore();
  } catch (err) {
    console.error(`Could not prepare the local writing folders: ${err.message}`);
    process.exit(1);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${HOST}:${port}`);
      if (url.pathname.startsWith("/api/")) await api(req, res, url);
      else await serveStatic(res, url);
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });

  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && attempts > 1) {
      console.log(`  Port ${port} in use, trying http://${HOST}:${port + 1}...`);
      startServer(port + 1, attempts - 1);
    } else {
      console.error(`Failed to start server: ${err.message}`);
      process.exit(1);
    }
  });

  server.listen(port, HOST, async () => {
    const [posts, notes, workspace] = await Promise.all([readPosts(), listNotes(), readWorkspace()]);
    const drafts = posts.filter((p) => p.draft).length;
    await printBanner({
      port,
      published: posts.length - drafts,
      drafts,
      notes: notes.counts.notes,
      connected: workspace?.repoName || "",
      folder: displayPath(DATA_DIR),
    });
  });
}

/* Started directly (`node server.mjs` / `npm start`) rather than imported
   by the CLI, which passes its own port and data folder. Windows paths
   are compared without case so a drive letter cannot stop the server. */
function isMainModule() {
  try {
    const self = fileURLToPath(import.meta.url);
    const entry = path.resolve(process.argv[1]);
    return process.platform === "win32"
      ? self.toLowerCase() === entry.toLowerCase()
      : self === entry;
  } catch {
    return false;
  }
}

if (isMainModule()) startServer();
