/* ============================================================
   A connected GitHub Pages site.

   The workspace file lives in the studio's own data folder, never
   inside the site repo. All reads and writes are restricted to the
   confirmed section folders.
   ============================================================ */

import path from "node:path";
import { readFile, writeFile, mkdir, readdir, stat, unlink } from "node:fs/promises";

import {
  SITE_TEXT_EXTENSIONS,
  HTML_EXTENSIONS,
  splitFrontmatter,
  updateFrontmatter,
  replaceBody,
  createFrontmatter,
  normalizeDate,
  filenameTitle,
  filenameSlug,
  titleFromBody,
  descriptionFromBody,
} from "./frontmatter.mjs";
import { cleanSiteUrl, requireDirectory, GENERATOR_LABELS } from "./site-scanner.mjs";
import { STUDIO_DATA, WORKSPACE_FILE, isInside, toPosix } from "./paths.mjs";
const MAX_FILES = 6000;

const SKIP_DIRS = new Set([
  ".git",
  ".github",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".vercel",
  ".netlify",
  ".cache",
  ".idea",
  ".vscode",
  "node_modules",
  "_site",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const prettyDate = (iso) => {
  if (!iso) return "";
  const [year, month, day] = String(iso).split("-");
  return `${day} ${MONTHS[Number(month) - 1] || "Jan"}, ${year}`;
};

const safeKey = (value, fallback = "") => {
  const key = String(value || "").trim();
  return /^[A-Za-z0-9_.-]+$/.test(key) ? key : fallback;
};

const safeRelative = (value, fallback = "") => {
  let rel = String(value || "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!rel || rel === ".") return fallback;
  const normalized = path.posix.normalize(rel);
  if (normalized === ".." || normalized.startsWith("../") || path.isAbsolute(normalized)) return fallback;
  return normalized;
};

const safeSlug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";

const dateFromFilename = (name = "") => {
  const match = String(name).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${match[1]}-${match[2]}-${match[3]}`;
};

const countWords = (text = "") =>
  String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;

const readingMinutes = (words) => Math.max(1, Math.round(words / 210));

const INDEX_EXTENSIONS = [".html", ".htm", ".md", ".markdown", ".mdx"];
const NON_POST_FILE = /^(readme|index|_index|bearblog-canonical)\.(?:md|markdown|mdx|html?)$/i;

function stripHtml(html = "") {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromHtml(html = "") {
  const heading = String(html).match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
  if (heading) {
    const text = stripHtml(heading[1]);
    if (text) return text;
  }
  const title = String(html).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return title ? stripHtml(title[1]) : "";
}

function descriptionFromHtml(html = "", max = 180) {
  const paragraphs = String(html).match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) || [];
  const line = paragraphs.map((paragraph) => stripHtml(paragraph)).find((text) => text.length > 40) || "";
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).replace(/[,;:.\s]+\S*$/, "") + "…" : flat;
}

async function readPostsIndex(dirAbs) {
  let raw;
  try {
    const info = await stat(path.join(dirAbs, "posts.json"));
    if (!info.isFile() || info.size > 4 * 1024 * 1024) return null;
    raw = await readFile(path.join(dirAbs, "posts.json"), "utf8");
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    const entries = data.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(entry.slug || "")) &&
        !String(entry.slug).includes("..")
    );
    return entries.length ? entries : null;
  } catch {
    return null;
  }
}

async function indexForSection(repoRoot, section) {
  const dirAbs = resolveInside(repoRoot, section.root);
  const entries = await readPostsIndex(dirAbs);
  if (!entries) return null;

  const files = new Map();
  for (const entry of entries) {
    const slug = String(entry.slug || "");
    for (const ext of INDEX_EXTENSIONS) {
      const rel = safeRelative(section.root === "." ? `${slug}${ext}` : `${section.root}/${slug}${ext}`, "");
      if (!rel) continue;
      try {
        const info = await stat(resolveInside(repoRoot, rel));
        if (info.isFile()) {
          files.set(rel, { entry, ext });
          break;
        }
      } catch {}
    }
  }
  return { entries, files };
}

async function readPostsIndexFile(dirAbs) {
  const file = path.join(dirAbs, "posts.json");
  try {
    const raw = await readFile(file, "utf8");
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return null;
    const valid = entries.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(entry.slug || "")) &&
        !String(entry.slug).includes("..")
    );
    return valid ? { file, entries, raw } : null;
  } catch {
    return null;
  }
}

/* Sites that keep a `posts.json` index need a matching entry before
   their build will publish a new Markdown file. Keep the index in step
   without touching any of its other fields. */
async function syncPostsIndex(workspace, section, meta, draft = meta.draft) {
  const dirAbs = resolveInside(workspace.repoRoot, section.root);
  const index = await readPostsIndexFile(dirAbs);
  if (!index) return;

  const entry = {
    slug: meta.slug,
    title: meta.title,
    date: meta.date || prettyDate(meta.dateISO),
    dateISO: meta.dateISO,
    description: meta.description || "",
    words: meta.words || 0,
    minutes: meta.minutes || 1,
    draft: !!draft,
  };

  const i = index.entries.findIndex((item) => item && item.slug === meta.slug);
  if (i >= 0) index.entries[i] = { ...index.entries[i], ...entry };
  else index.entries.unshift(entry);

  const next = JSON.stringify(index.entries, null, 2) + "\n";
  if (next !== index.raw) await writeFile(index.file, next);
}

async function removeFromPostsIndex(workspace, section, slug) {
  const dirAbs = resolveInside(workspace.repoRoot, section.root);
  const index = await readPostsIndexFile(dirAbs);
  if (!index) return;
  const entries = index.entries.filter((item) => !item || item.slug !== slug);
  if (entries.length === index.entries.length) return;
  await writeFile(index.file, JSON.stringify(entries, null, 2) + "\n");
}

function metaFromIndex(workspace, section, rel, entry, ext) {
  const dateISO = normalizeDate(entry.dateISO || entry.date) || dateFromFilename(path.posix.basename(rel));
  const rawWords = Number(entry.words);
  const words = Number.isFinite(rawWords) && rawWords > 0 ? Math.round(rawWords) : 0;
  const rawMinutes = Number(entry.minutes);
  const minutes = Number.isFinite(rawMinutes) && rawMinutes > 0 ? Math.round(rawMinutes) : readingMinutes(words);
  const legacy = HTML_EXTENSIONS.has(ext);
  const meta = {
    id: rel,
    path: rel,
    sectionId: section.id,
    sectionName: section.name,
    slug: safeSlug(entry.slug || filenameSlug(path.posix.basename(rel))),
    title: String(entry.title || "").trim() || filenameTitle(path.posix.basename(rel)),
    dateISO,
    date: String(entry.date || "").trim() || prettyDate(dateISO),
    description: String(entry.description || "").trim(),
    draft: entry.draft === true || String(entry.draft).toLowerCase() === "true",
    words,
    minutes,
    format: ext,
    indexed: true,
    legacyHtml: legacy,
    readOnly: legacy,
    hasFrontmatter: false,
    data: {},
  };
  if (entry.permalink && String(entry.permalink).startsWith("/")) {
    meta.url = siteJoin(workspace.siteUrl, entry.permalink);
  } else {
    meta.url = postUrl(workspace, section, meta, rel);
  }
  return meta;
}

function resolveInside(root, rel) {
  const abs = path.resolve(root, toPosix(rel || "."));
  if (!isInside(root, abs)) {
    throw Object.assign(new Error("That file is outside the connected site."), { code: 400 });
  }
  return abs;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function readWorkspace() {
  try {
    const raw = JSON.parse(await readFile(WORKSPACE_FILE, "utf8"));
    if (!raw || typeof raw !== "object" || !raw.repoRoot || !Array.isArray(raw.sections)) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function clearWorkspace() {
  try {
    await unlink(WORKSPACE_FILE);
  } catch {}
}

export function normalizeWorkspaceConfig(input = {}) {
  const repoRoot = String(input.repoRoot || "").trim();
  if (!repoRoot) throw Object.assign(new Error("Missing site folder."), { code: 400 });

  const generator = String(input.generator || "plain").toLowerCase();
  const seenIds = new Set();
  const seenRoots = new Set();
  const sections = [];

  for (const raw of Array.isArray(input.sections) ? input.sections : []) {
    const rawRoot = String(raw.root || "").trim().replace(/\\/g, "/");
    const root = rawRoot === "." ? "." : safeRelative(rawRoot, "");
    if (!root) continue;
    if (seenRoots.has(root)) continue;
    seenRoots.add(root);

    let idBase = safeSlug(raw.id || raw.name || root);
    let id = idBase;
    let n = 2;
    while (seenIds.has(id)) id = `${idBase}-${n++}`;
    seenIds.add(id);

    const format = SITE_TEXT_EXTENSIONS.has(raw.format) ? raw.format : ".md";
    const formats = (Array.isArray(raw.formats) ? raw.formats : [format])
      .filter((ext) => SITE_TEXT_EXTENSIONS.has(ext));
    sections.push({
      id,
      name: String(raw.name || id).trim().slice(0, 80) || id,
      root,
      kind: ["collection", "pages", "drafts"].includes(raw.kind) ? raw.kind : "collection",
      format,
      formats: [...new Set([format, ...formats])],
      defaultInclude: raw.defaultInclude !== false,
      directOnly: !!raw.directOnly,
      datePrefix: !!raw.datePrefix,
      route: typeof raw.route === "string" ? raw.route : "",
    });
  }

  if (!sections.length) throw Object.assign(new Error("Choose at least one writing section."), { code: 400 });

  const fm = input.frontmatter || {};
  const frontmatter = {
    title: safeKey(fm.title, "title"),
    date: safeKey(fm.date, "date"),
    description: safeKey(fm.description, "") || null,
    draft: safeKey(fm.draft, "") || null,
    published: safeKey(fm.published, "") || null,
    slug: safeKey(fm.slug, "") || null,
    permalink: safeKey(fm.permalink, "") || null,
  };

  const assetDir = safeRelative(input.asset?.dir, "assets");
  let assetUrl = String(input.asset?.url || "").trim();
  if (assetUrl && !assetUrl.startsWith("/")) assetUrl = `/${assetUrl}`;
  assetUrl = assetUrl.replace(/\/+$/, "");

  return {
    version: 1,
    repoRoot,
    repoName: String(input.repoName || path.basename(repoRoot)).trim() || path.basename(repoRoot),
    generator: GENERATOR_LABELS[generator] ? generator : "plain",
    generatorLabel: GENERATOR_LABELS[generator] || GENERATOR_LABELS.plain,
    siteUrl: cleanSiteUrl(input.siteUrl),
    connectedAt: input.connectedAt || new Date().toISOString(),
    sections,
    frontmatter,
    draftFolder: safeRelative(input.draftFolder, ""),
    defaultDraftMode: ["draft", "published", "folder", "none"].includes(input.defaultDraftMode)
      ? input.defaultDraftMode
      : "none",
    defaultDraft: input.defaultDraft !== false,
    asset: { dir: assetDir, url: assetUrl },
    permalink: String(input.permalink || "").trim(),
  };
}

export async function connectWorkspace(input = {}) {
  const repoRoot = await requireDirectory(input.repoRoot);
  const config = normalizeWorkspaceConfig({ ...input, repoRoot });

  /* Every confirmed section must still exist and contain writing. This
     prevents a stale client payload from granting write access to an
     arbitrary path. */
  for (const section of config.sections) {
    const abs = resolveInside(repoRoot, section.root);
    let info;
    try {
      info = await stat(abs);
    } catch {
      throw Object.assign(new Error(`Section folder no longer exists: ${section.root}`), { code: 400 });
    }
    if (!info.isDirectory()) {
      throw Object.assign(new Error(`Not a folder: ${section.root}`), { code: 400 });
    }
  }

  await mkdir(STUDIO_DATA, { recursive: true });
  await writeFile(WORKSPACE_FILE, JSON.stringify(config, null, 2) + "\n");
  return config;
}

function sectionDepth(section) {
  return section.root === "." ? 0 : section.root.split("/").length;
}

function matchSection(workspace, rel) {
  const sections = [...workspace.sections].sort((a, b) => sectionDepth(b) - sectionDepth(a));
  for (const section of sections) {
    if (section.root === ".") {
      if (section.directOnly && path.posix.dirname(rel) !== ".") continue;
      return section;
    }
    if (rel === section.root || rel.startsWith(`${section.root}/`)) {
      if (section.directOnly && path.posix.dirname(rel) !== section.root) continue;
      return section;
    }
  }
  return null;
}

function requiresExplicitDraft(section, workspace) {
  return section.kind === "drafts";
}

function isDraft(data, rel, section, workspace) {
  if (requiresExplicitDraft(section, workspace)) return true;
  if (workspace.draftFolder && (rel === workspace.draftFolder || rel.startsWith(`${workspace.draftFolder}/`))) return true;
  const fm = workspace.frontmatter;
  if (fm.draft && data?.[fm.draft] === true) return true;
  if (fm.draft && String(data?.[fm.draft]).toLowerCase() === "true") return true;
  if (fm.published && (data?.[fm.published] === false || String(data?.[fm.published]).toLowerCase() === "false")) return true;
  if (String(data?.status || "").toLowerCase() === "draft") return true;
  return false;
}

function siteJoin(siteUrl, rel = "") {
  if (!siteUrl) return null;
  return `${siteUrl.replace(/\/+$/, "")}/${String(rel).replace(/^\/+/, "")}`;
}

export function postUrl(workspace, section, meta, rel) {
  if (!workspace.siteUrl) return null;
  const fm = workspace.frontmatter;
  const permalink = fm.permalink ? meta.data?.[fm.permalink] : "";
  if (permalink && String(permalink).startsWith("/")) {
    return siteJoin(workspace.siteUrl, permalink);
  }

  if (section.kind === "drafts") return null;

  if (section.kind === "pages") {
    let route = rel.replace(/\.(?:md|markdown|mdx)$/i, "");
    if (/(^|\/)index$/.test(route)) route = route.replace(/(^|\/)index$/, "");
    return siteJoin(workspace.siteUrl, route);
  }

  if (section.route) {
    return siteJoin(workspace.siteUrl, `${section.route.replace(/^\/+|\/+$/g, "")}/${meta.slug}/`);
  }

  /* Jekyll's default post permalink, or the pattern detected in
     _config.yml. A per-post permalink above still wins. */
  if (section.root === "_posts" && meta.dateISO) {
    return siteJoin(workspace.siteUrl, jekyllPostPath(workspace, meta));
  }

  return null;
}

function jekyllPostPath(workspace, meta) {
  const pattern = workspace.permalink || "/:categories/:year/:month/:day/:title:output_ext";
  const [year, month, day] = String(meta.dateISO).split("-");
  const values = {
    ":categories": "",
    ":year": year,
    ":month": month,
    ":day": day,
    ":title": meta.slug,
    ":slug": meta.slug,
    ":output_ext": ".html",
  };
  let out = pattern;
  for (const [key, value] of Object.entries(values)) out = out.split(key).join(value);
  out = out.replace(/\/{2,}/g, "/");
  if (!out.startsWith("/")) out = `/${out}`;
  return out;
}

function metaFromText(workspace, section, rel, text) {
  const parsed = splitFrontmatter(text);
  const fm = workspace.frontmatter;
  const data = parsed.data || {};
  const ext = path.extname(rel).toLowerCase();
  const legacy = HTML_EXTENSIONS.has(ext);
  const title =
    String(data[fm.title] ?? "").trim() ||
    (legacy ? titleFromHtml(parsed.body) : titleFromBody(parsed.body)) ||
    filenameTitle(path.posix.basename(rel));
  const dateISO = normalizeDate(data[fm.date]) || dateFromFilename(path.posix.basename(rel));
  const description =
    String((fm.description && data[fm.description]) || "").trim() ||
    (legacy ? descriptionFromHtml(parsed.body) : descriptionFromBody(parsed.body));
  const slug = safeSlug((fm.slug && data[fm.slug]) || filenameSlug(path.posix.basename(rel)));
  const draft = isDraft(data, rel, section, workspace);
  const words = countWords(legacy ? stripHtml(parsed.body) : parsed.body);

  const meta = {
    id: rel,
    path: rel,
    sectionId: section.id,
    sectionName: section.name,
    slug,
    title,
    dateISO,
    date: prettyDate(dateISO),
    description,
    draft,
    words,
    minutes: readingMinutes(words),
    format: ext,
    legacyHtml: legacy,
    readOnly: legacy,
    hasFrontmatter: parsed.has,
    data,
  };
  meta.url = postUrl(workspace, section, meta, rel);
  return { meta, parsed };
}

async function walkTextFiles(root, relRoot, { directOnly = false, limit = MAX_FILES } = {}) {
  const found = [];

  async function visit(dir, relDir, depth) {
    if (found.length >= limit || depth > 12) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (directOnly) continue;
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        await visit(path.join(dir, entry.name), relDir ? `${relDir}/${entry.name}` : entry.name, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SITE_TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      found.push({ abs: path.join(dir, entry.name), rel, dir: relDir || "." });
    }
  }

  await visit(root, relRoot === "." ? "" : relRoot, 0);
  return found;
}

function sectionAllowsFile(section, rel, ext) {
  if (!HTML_EXTENSIONS.has(ext)) return true;
  if (section.kind === "pages") return true;
  return !/^(index|404|readme)\.html?$/i.test(path.posix.basename(rel));
}

export async function listSitePosts(workspace) {
  if (!workspace) throw Object.assign(new Error("No GitHub Pages site is connected."), { code: 404 });
  const repoRoot = path.resolve(workspace.repoRoot);
  const assignments = new Map();

  /* Walk every selected section. A deeper selected folder wins when
     candidates overlap, so nothing appears twice. */
  for (const section of workspace.sections) {
    const index = await indexForSection(repoRoot, section);
    if (index) {
      /* The index knows which files are posts. Files such as README.md
         or a migration note stay out of the sidebar. Unindexed Markdown
         is still shown so a newly saved post does not disappear before
         its metadata entry is added. */
      for (const [rel, info] of index.files) {
        const matched = matchSection(workspace, rel);
        if (!matched) continue;
        const current = assignments.get(rel);
        if (!current || sectionDepth(matched) > sectionDepth(current.section)) {
          assignments.set(rel, { section: matched, entry: info.entry, ext: info.ext });
        }
      }

      const abs = resolveInside(repoRoot, section.root);
      const files = await walkTextFiles(abs, section.root, { directOnly: section.directOnly });
      for (const file of files) {
        const rel = file.rel;
        const ext = path.extname(rel).toLowerCase();
        if (HTML_EXTENSIONS.has(ext) || index.files.has(rel)) continue;
        if (NON_POST_FILE.test(path.posix.basename(rel))) continue;
        if (!sectionAllowsFile(section, rel, ext)) continue;
        const matched = matchSection(workspace, rel);
        if (!matched) continue;
        const current = assignments.get(rel);
        if (!current || sectionDepth(matched) > sectionDepth(current.section)) {
          assignments.set(rel, { section: matched, entry: null, ext });
        }
      }
      continue;
    }

    const abs = resolveInside(repoRoot, section.root);
    const files = await walkTextFiles(abs, section.root, { directOnly: section.directOnly });
    for (const file of files) {
      const rel = file.rel;
      const ext = path.extname(rel).toLowerCase();
      if (!sectionAllowsFile(section, rel, ext)) continue;
      if (section.kind === "pages" && section.directOnly && /^(index|_index|readme)\./i.test(path.posix.basename(rel))) {
        continue;
      }
      const matched = matchSection(workspace, rel);
      if (!matched) continue;
      const current = assignments.get(rel);
      if (!current || sectionDepth(matched) > sectionDepth(current.section)) {
        assignments.set(rel, { section: matched, entry: null, ext });
      }
    }
  }

  const jobs = [...assignments.entries()].map(([rel, assignment]) => async () => {
    try {
      const abs = resolveInside(repoRoot, rel);
      const info = await stat(abs);
      if (!info.isFile() || info.size > 4 * 1024 * 1024) return null;
      const { section, entry, ext } = assignment;
      if (entry) {
        const meta = metaFromIndex(workspace, section, rel, entry, ext);
        delete meta.data;
        return meta;
      }
      const text = await readFile(abs, "utf8");
      const { meta } = metaFromText(workspace, section, rel, text);
      delete meta.data;
      return meta;
    } catch {
      return null;
    }
  });

  const posts = [];
  const concurrency = 12;
  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = await Promise.all(jobs.slice(i, i + concurrency).map((job) => job()));
    posts.push(...batch.filter(Boolean));
  }

  posts.sort((a, b) => String(b.dateISO || "").localeCompare(String(a.dateISO || "")) || a.title.localeCompare(b.title));
  const sectionCounts = new Map();
  for (const post of posts) sectionCounts.set(post.sectionId, (sectionCounts.get(post.sectionId) || 0) + 1);

  return {
    posts,
    sections: workspace.sections.map((section) => ({
      ...section,
      count: sectionCounts.get(section.id) || 0,
    })),
    counts: {
      total: posts.length,
      drafts: posts.filter((post) => post.draft).length,
    },
  };
}

export async function getSitePost(workspace, id) {
  if (!workspace) throw Object.assign(new Error("No GitHub Pages site is connected."), { code: 404 });
  const rel = safeRelative(id, "");
  if (!rel) throw Object.assign(new Error("Missing post id."), { code: 400 });
  const section = matchSection(workspace, rel);
  if (!section) throw Object.assign(new Error("That post is outside the confirmed writing sections."), { code: 403 });

  const repoRoot = path.resolve(workspace.repoRoot);
  const abs = resolveInside(repoRoot, rel);
  const text = await readFile(abs, "utf8");
  const parsed = splitFrontmatter(text);
  const ext = path.extname(rel).toLowerCase();
  const legacy = HTML_EXTENSIONS.has(ext);
  const index = await indexForSection(repoRoot, section);
  const indexed = index?.files.get(rel);
  const meta = indexed
    ? metaFromIndex(workspace, section, rel, indexed.entry, indexed.ext)
    : metaFromText(workspace, section, rel, text).meta;
  meta.hasFrontmatter = parsed.has;
  delete meta.data;

  return {
    meta,
    markdown: legacy ? null : parsed.body,
    legacyHtml: legacy ? text : null,
    readOnly: legacy,
    hasFrontmatter: parsed.has,
  };
}

async function nextAvailableFile(rootAbs, base, ext) {
  let file = path.join(rootAbs, `${base}${ext}`);
  let n = 2;
  while (await exists(file)) file = path.join(rootAbs, `${base}-${n++}${ext}`);
  return file;
}

export async function saveSitePost(workspace, meta = {}, markdown = "") {
  if (!workspace) throw Object.assign(new Error("No GitHub Pages site is connected."), { code: 404 });
  const repoRoot = path.resolve(workspace.repoRoot);
  const body = String(markdown ?? "");
  const fm = workspace.frontmatter;
  const requestedDate = normalizeDate(meta.dateISO);
  const dateISO = requestedDate || (meta.id ? "" : new Date().toISOString().slice(0, 10));
  const title = String(meta.title || "").trim() || "Untitled";

  if (meta.id) {
    const rel = safeRelative(meta.id, "");
    const section = rel ? matchSection(workspace, rel) : null;
    if (!section) throw Object.assign(new Error("That post is outside the confirmed writing sections."), { code: 403 });
    if (HTML_EXTENSIONS.has(path.extname(rel).toLowerCase())) {
      throw Object.assign(
        new Error("Imported HTML posts are read-only. Edit the HTML file directly in your editor."),
        { code: 400 }
      );
    }
    const abs = resolveInside(repoRoot, rel);
    const previous = await readFile(abs, "utf8");
    const parsed = splitFrontmatter(previous);

    const changes = [];
    const hadTitle = parsed.data[fm.title] !== undefined;
    const derivedTitle = titleFromBody(parsed.body) || filenameTitle(path.posix.basename(rel));
    if (fm.title && (hadTitle || title !== derivedTitle)) {
      changes.push({ key: fm.title, value: title });
    }
    if (fm.date && requestedDate) changes.push({ key: fm.date, value: requestedDate });
    if (fm.description && meta.description !== undefined) {
      const nextDescription = String(meta.description || "").trim();
      const hadDescription = parsed.data[fm.description] !== undefined;
      const derivedDescription = descriptionFromBody(parsed.body);
      if (hadDescription || (nextDescription && nextDescription !== derivedDescription)) {
        changes.push({ key: fm.description, value: nextDescription });
      }
    }
    if (meta.draft !== undefined) {
      if (fm.draft) changes.push({ key: fm.draft, value: !!meta.draft });
      else if (fm.published) changes.push({ key: fm.published, value: !meta.draft });
    }

    const next = replaceBody(updateFrontmatter(previous, changes, { create: true }), body);
    await writeFile(abs, next);
    const after = metaFromText(workspace, section, rel, next);
    delete after.meta.data;
    await syncPostsIndex(workspace, section, after.meta, meta.draft !== undefined ? !!meta.draft : after.meta.draft);
    return after.meta;
  }

  const requestedSection = String(meta.sectionId || "").trim();
  const section = requestedSection
    ? workspace.sections.find((candidate) => candidate.id === requestedSection)
    : workspace.sections[0];
  if (!section) {
    throw Object.assign(
      new Error(requestedSection ? "That writing section is no longer connected." : "Choose a writing section first."),
      { code: 400 }
    );
  }
  const draft = meta.draft !== undefined ? !!meta.draft : !!workspace.defaultDraft;

  const rootAbs = resolveInside(repoRoot, section.root);
  const slug = safeSlug(meta.slug || title);
  const ext = [".md", ".markdown", ".mdx"].includes(section.format) ? section.format : ".md";
  const datePrefix = section.kind !== "drafts" && (section.datePrefix || section.root === "_posts");
  const base = datePrefix ? `${dateISO}-${slug}` : slug;
  const fileAbs = await nextAvailableFile(rootAbs, base, ext);
  const rel = path.relative(repoRoot, fileAbs).split(path.sep).join("/");
  if (!matchSection(workspace, rel)) {
    throw Object.assign(new Error("Could not place that post inside the selected section."), { code: 400 });
  }

  const fields = {};
  if (fm.title) fields[fm.title] = title;
  if (fm.date) fields[fm.date] = dateISO;
  if (fm.description && String(meta.description || "").trim()) {
    fields[fm.description] = String(meta.description).trim();
  }
  if (fm.draft) fields[fm.draft] = draft;
  else if (fm.published && draft) fields[fm.published] = false;

  const text = `${createFrontmatter(fields)}${body}${body.endsWith("\n") ? "" : "\n"}`;
  await writeFile(fileAbs, text);
  const after = metaFromText(workspace, section, rel, text);
  delete after.meta.data;
  await syncPostsIndex(workspace, section, after.meta, draft);
  return after.meta;
}

export async function deleteSitePost(workspace, id) {
  if (!workspace) throw Object.assign(new Error("No GitHub Pages site is connected."), { code: 404 });
  const rel = safeRelative(id, "");
  const section = rel ? matchSection(workspace, rel) : null;
  if (!section) throw Object.assign(new Error("That post is outside the confirmed writing sections."), { code: 403 });
  const abs = resolveInside(workspace.repoRoot, rel);
  const text = await readFile(abs, "utf8");
  const index = await indexForSection(workspace.repoRoot, section);
  const indexed = index?.files.get(rel);
  /* posts.json is the source of truth for indexed posts: its slug can
     differ from the filename or frontmatter. Remove exactly that entry. */
  const slug = indexed?.entry?.slug
    ? safeSlug(indexed.entry.slug)
    : metaFromText(workspace, section, rel, text).meta.slug;
  await unlink(abs);
  await removeFromPostsIndex(workspace, section, slug);
  return { ok: true, id: rel, slug };
}

export async function uploadSiteAsset(workspace, id, filename, bytes) {
  if (!workspace) throw Object.assign(new Error("No GitHub Pages site is connected."), { code: 404 });
  const rel = safeRelative(id, "");
  const section = rel ? matchSection(workspace, rel) : null;
  if (!section) throw Object.assign(new Error("Save the post before adding media."), { code: 400 });
  if (HTML_EXTENSIONS.has(path.extname(rel).toLowerCase())) {
    throw Object.assign(new Error("Imported HTML posts are read-only."), { code: 400 });
  }

  const postSlug = safeSlug(filenameSlug(path.posix.basename(rel)));
  const ext = path.extname(filename || "").toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"].includes(ext)) {
    throw Object.assign(new Error(`Unsupported image type "${ext || "none"}".`), { code: 400 });
  }

  let base =
    path
      .basename(filename, ext)
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "image";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base += "-file";

  const assetDir = workspace.asset?.dir || "assets";
  const dirAbs = resolveInside(workspace.repoRoot, path.posix.join(assetDir, "writing-studio", postSlug));
  await mkdir(dirAbs, { recursive: true });
  const fileAbs = await nextAvailableFile(dirAbs, base, ext);
  await writeFile(fileAbs, bytes);

  const assetRel = path.relative(workspace.repoRoot, fileAbs).split(path.sep).join("/");
  const prefix = workspace.asset?.url ? `${workspace.asset.url.replace(/\/+$/, "")}/` : "/";
  const url = `${prefix}${path.posix.relative(assetDir, assetRel)}`;
  return { path: url, name: path.basename(fileAbs), bytes: bytes.length, repoPath: assetRel };
}

export async function sitePreviewInfo(workspace, meta = {}) {
  if (!workspace) return { assetBase: "", assetRootPrefix: "" };
  const rel = safeRelative(meta.id, "");
  const dir = rel ? path.posix.dirname(rel) : "";
  return {
    assetBase: `/site-assets/${dir && dir !== "." ? `${dir}/` : ""}`,
    assetRootPrefix: "/site-assets",
  };
}

export function resolveSiteAsset(workspace, requestPath) {
  if (!workspace) return null;
  let rel = String(requestPath || "").replace(/^\/+/, "");
  try {
    rel = decodeURIComponent(rel);
  } catch {}
  const normalized = path.posix.normalize(rel);
  if (!normalized || normalized === "." || normalized.startsWith("..") || normalized.startsWith(".git/")) return null;
  const abs = path.resolve(workspace.repoRoot, normalized);
  if (!isInside(workspace.repoRoot, abs)) return null;
  const ext = path.extname(abs).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".pdf", ".woff2", ".woff", ".ttf", ".otf"].includes(ext)) {
    return null;
  }
  return abs;
}

export async function workspaceSummary(workspace) {
  if (!workspace) return null;
  return {
    ...workspace,
    repoExists: await exists(workspace.repoRoot),
  };
}
