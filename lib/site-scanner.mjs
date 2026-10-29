/* ============================================================
   Read-only GitHub Pages site scanner.

   The scanner never writes to the site repo. It fingerprints the
   generator, walks the likely writing folders, and returns section
   candidates for the person to confirm in the studio.
   ============================================================ */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, readdir, stat } from "node:fs/promises";

import {
  SITE_TEXT_EXTENSIONS,
  HTML_EXTENSIONS,
  splitFrontmatter,
  normalizeDate,
  filenameTitle,
  filenameSlug,
  titleFromBody,
} from "./frontmatter.mjs";
import { expandHome, isInside, toPosix } from "./paths.mjs";

const POST_SLUG = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}._-]*$/u;
const MAX_FILES = 6000;
const MAX_DEPTH = 12;

const SKIP_DIRS = new Set([
  ".git",
  ".github",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".vercel",
  ".netlify",
  ".cache",
  ".parcel-cache",
  ".idea",
  ".vscode",
  "node_modules",
  "_site",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "public",
  /* Templates, themes and build helpers hold Markdown/HTML that is never
     the person's own writing. */
  "themes",
  "layouts",
  "_layouts",
  "_includes",
  "_sass",
  "_plugins",
  "archetypes",
  "components",
  "partials",
]);

const ANCHOR_NAMES = new Set([
  "posts",
  "post",
  "blog",
  "blogs",
  "articles",
  "article",
  "notes",
  "note",
  "writing",
  "writings",
  "essays",
  "essay",
  "journal",
  "journals",
  "docs",
  "documentation",
  "guides",
  "guide",
  "recipes",
  "recipe",
  "news",
  "updates",
  "projects",
  "project",
  "til",
  "snippets",
  "stories",
  "story",
  "chapters",
  "book",
  "books",
  "resources",
  "reading",
  "papers",
  "research",
  "archive",
  "archives",
  "blog-posts",
  "articles-and-notes",
  "musings",
  "thoughts",
  "field-notes",
  "pages",
  "page",
]);

const PAGE_NAMES = new Set([
  "pages",
  "page",
  "_pages",
  "src/pages",
  "app",
  "src/app",
]);

const DRAFT_NAMES = new Set(["_drafts", "drafts", "draft"]);

const GENERATOR_LABELS = {
  jekyll: "Jekyll",
  hugo: "Hugo",
  astro: "Astro",
  eleventy: "Eleventy",
  nextjs: "Next.js",
  nuxt: "Nuxt",
  gatsby: "Gatsby",
  docusaurus: "Docusaurus",
  vitepress: "VitePress",
  mkdocs: "MkDocs",
  plain: "Static / other",
};

const FIELD_KEYS = {
  title: ["title", "name", "headline"],
  date: ["date", "published", "pubDate", "publishDate", "publish_date", "created", "createdAt"],
  description: ["description", "summary", "excerpt", "intro", "subtitle"],
  draft: ["draft"],
  published: ["published", "publish"],
  slug: ["slug"],
  permalink: ["permalink", "url", "path"],
};

export function cleanSiteUrl(value = "") {
  let url = String(value || "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}/`;
  } catch {
    return "";
  }
}

export function normalizeRepoRoot(input = "") {
  let value = String(input || "").trim();
  if (!value) throw new Error("Enter the folder where your GitHub Pages site lives.");
  /* A folder dragged from Finder or copied out of a browser can arrive
     as a file:// URL. fileURLToPath knows the platform rules: file:///C:/
     on Windows, file:///Users/... on macOS, file:///home/... on Linux. */
  if (/^file:\/\//i.test(value)) {
    try {
      value = fileURLToPath(value);
    } catch {
      value = decodeURIComponent(value.replace(/^file:\/\/+/i, ""));
    }
  }
  value = expandHome(value);
  return path.resolve(value);
}

export async function requireDirectory(input) {
  const repoRoot = normalizeRepoRoot(input);
  let info;
  try {
    info = await stat(repoRoot);
  } catch {
    throw new Error(`That folder does not exist: ${repoRoot}`);
  }
  if (!info.isDirectory()) throw new Error(`That is not a folder: ${repoRoot}`);
  return repoRoot;
}

async function safeRead(file, limit = 2 * 1024 * 1024) {
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > limit) return "";
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

/* Some static sites keep post metadata in a `posts.json` index next to
   the writing files. When it exists, it is a better source of truth than
   the folder contents: it knows which files are posts, and it carries
   titles, dates, descriptions and word counts. */
async function readPostsIndex(dirAbs) {
  const raw = await safeRead(path.join(dirAbs, "posts.json"), 4 * 1024 * 1024);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    const entries = data.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        POST_SLUG.test(String(entry.slug || "")) &&
        !String(entry.slug).includes("..")
    );
    return entries.length ? entries : null;
  } catch {
    return null;
  }
}

async function applyPostsIndex(repoRoot, section) {
  const dirAbs = path.resolve(repoRoot, section.root);
  const entries = await readPostsIndex(dirAbs);
  if (!entries) return;

  const formats = new Set(section.formats || [section.format]);
  let htmlCount = 0;
  let mdCount = 0;
  const samples = [];

  for (const entry of entries.slice(0, 50)) {
    let foundExt = "";
    for (const ext of [".html", ".htm", ".md", ".markdown", ".mdx"]) {
      try {
        const info = await stat(path.join(dirAbs, `${entry.slug}${ext}`));
        if (info.isFile()) {
          foundExt = ext;
          break;
        }
      } catch {}
    }
    if (foundExt) formats.add(foundExt);
    if (HTML_EXTENSIONS.has(foundExt)) htmlCount++;
    else if (foundExt) mdCount++;
    if (samples.length < 5) {
      samples.push({
        title: String(entry.title || filenameTitle(entry.slug)),
        path: section.root === "." ? `${entry.slug}${foundExt}` : `${section.root}/${entry.slug}${foundExt}`,
      });
    }
  }

  section.indexed = true;
  section.indexName = "posts.json";
  section.count = entries.length;
  section.samples = samples;
  section.formats = [...formats];
  if (htmlCount && htmlCount >= mdCount) section.format = ".html";
  else if (mdCount) section.format = ".md";
}

async function collectTextFiles(repoRoot) {
  const files = [];
  let truncated = false;

  async function visit(dir, relDir, depth) {
    if (truncated || depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        await visit(path.join(dir, entry.name), relDir ? `${relDir}/${entry.name}` : entry.name, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SITE_TEXT_EXTENSIONS.has(ext)) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      files.push({ abs: path.join(dir, entry.name), rel, dir: relDir || ".", ext, name: entry.name });
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
    }
  }

  await visit(repoRoot, "", 0);
  return { files, truncated };
}

async function packageInfo(repoRoot) {
  const raw = await safeRead(path.join(repoRoot, "package.json"));
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function detectGenerator(repoRoot) {
  const pkg = await packageInfo(repoRoot);
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const has = async (name) => {
    try {
      await stat(path.join(repoRoot, name));
      return true;
    } catch {
      return false;
    }
  };

  if ((await has("astro.config.mjs")) || (await has("astro.config.ts")) || (await has("astro.config.js")) || deps.astro) {
    return "astro";
  }
  if ((await has("hugo.toml")) || (await has("hugo.yaml")) || (await has("hugo.yml")) || (await has("config.toml"))) {
    return "hugo";
  }
  if ((await has("_config.yml")) || (await has("_config.yaml"))) return "jekyll";
  if ((await has(".eleventy.js")) || (await has("eleventy.config.js")) || (await has("eleventy.config.cjs")) || deps["@11ty/eleventy"]) {
    return "eleventy";
  }
  if ((await has("next.config.js")) || (await has("next.config.mjs")) || (await has("next.config.ts")) || deps.next) {
    return "nextjs";
  }
  if ((await has("nuxt.config.js")) || (await has("nuxt.config.ts")) || deps.nuxt) return "nuxt";
  if ((await has("gatsby-config.js")) || (await has("gatsby-config.ts")) || deps.gatsby) return "gatsby";
  if ((await has("docusaurus.config.js")) || (await has("docusaurus.config.ts")) || deps["@docusaurus/core"]) {
    return "docusaurus";
  }
  if ((await has(".vitepress")) || deps.vitepress) return "vitepress";
  if ((await has("mkdocs.yml")) || (await has("mkdocs.yaml"))) return "mkdocs";

  /* A _posts folder is a very strong Jekyll signal even without config. */
  if (await has("_posts")) return "jekyll";
  return "plain";
}

async function detectSiteUrl(repoRoot, pkg) {
  const cname = (await safeRead(path.join(repoRoot, "CNAME"))).trim().split(/\r?\n/)[0];
  if (cname && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(cname)) {
    return `https://${cname.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}/`;
  }

  const gitConfig = await safeRead(path.join(repoRoot, ".git", "config"));
  const originBlock = gitConfig.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/);
  const originUrl = originBlock?.[1]?.match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim();
  if (originUrl) {
    const github = originUrl.match(/github\.com[:/]+([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    if (github) {
      const user = github[1];
      const repo = github[2].replace(/\.git$/i, "");
      if (/^[^/]+\.github\.io$/i.test(repo)) return `https://${repo.toLowerCase()}/`;
      return `https://${user.toLowerCase()}.github.io/${repo.toLowerCase()}/`;
    }
  }

  if (pkg.homepage && /^https?:\/\//.test(pkg.homepage)) return cleanSiteUrl(pkg.homepage);
  return "";
}

/* Where a generator copies static files to the site root. Hugo and
   Docusaurus use static/, where public/ is build output (Hugo) or absent.
   Astro, Next.js, Nuxt and VitePress use public/. */
const STATIC_DIR = {
  hugo: "static",
  docusaurus: "static",
  astro: "public",
  nextjs: "public",
  nuxt: "public",
  vitepress: "public",
};

async function detectAssets(repoRoot, generator = "plain") {
  const candidates = [
    { dir: "public", url: "" },
    { dir: "static", url: "" },
    { dir: "assets", url: "/assets" },
    { dir: "images", url: "/images" },
    { dir: "src/assets", url: "/assets" },
  ];
  /* The generator's own folder is right even before it exists. */
  if (STATIC_DIR[generator]) return { dir: STATIC_DIR[generator], url: "" };
  for (const candidate of candidates) {
    try {
      const info = await stat(path.join(repoRoot, candidate.dir));
      if (info.isDirectory()) return candidate;
    } catch {}
  }
  return { dir: "assets", url: "/assets" };
}

/* Jekyll's default post URL is `/:categories/:year/:month/:day/:title.html`.
   A site can override it with `permalink: pretty` or a custom pattern.
   Reading it here keeps “Open live page” honest for the common case. */
async function detectPermalink(repoRoot, generator) {
  if (generator !== "jekyll") return "";
  const raw =
    (await safeRead(path.join(repoRoot, "_config.yml"))) ||
    (await safeRead(path.join(repoRoot, "_config.yaml")));
  const match = raw.match(/^permalink\s*:\s*(.+)$/m);
  let value = match?.[1]?.trim() || "";
  value = value.replace(/\s+#.*$/, "").replace(/^['"]|['"]$/g, "").trim();

  if (!value || value === "date") return "/:categories/:year/:month/:day/:title:output_ext";
  if (value === "pretty") return "/:categories/:year/:month/:day/:title/";
  if (value.startsWith("/")) return value;
  return "";
}

function dirsFor(files) {
  const dirs = new Set();
  for (const file of files) {
    let dir = file.dir;
    while (dir && dir !== ".") {
      dirs.add(dir);
      dir = path.posix.dirname(dir);
      if (dir === ".") break;
    }
  }
  return dirs;
}

function isAnchor(rel, generator) {
  if (!rel || rel === ".") return false;
  const base = path.posix.basename(rel).toLowerCase();
  if (PAGE_NAMES.has(rel) || PAGE_NAMES.has(base)) return true;
  if (DRAFT_NAMES.has(base)) return true;
  if (ANCHOR_NAMES.has(base)) return true;
  if (base.startsWith("_") && rel.split("/").length === 1 && !["_layouts", "_includes", "_data", "_sass", "_site"].includes(base)) {
    return true;
  }

  if (generator === "hugo") {
    if (rel === "content" || rel.startsWith("content/")) {
      return rel.split("/").length <= 2;
    }
  }
  if (generator === "astro" || generator === "nextjs" || generator === "nuxt") {
    if (rel === "src/content" || rel.startsWith("src/content/")) {
      return rel.split("/").length === 2;
    }
    if (rel === "src/pages" || rel.startsWith("src/pages/")) return rel.split("/").length === 2;
  }
  if (generator === "eleventy") {
    if (rel === "src" || rel.startsWith("src/")) return rel.split("/").length === 2;
  }

  /* Custom collections under a content directory. The immediate child is
     a section; leaf bundles and year folders below it are not. */
  if (rel.startsWith("content/") && rel.split("/").length === 2) return true;
  if (rel.startsWith("src/content/") && rel.split("/").length === 3) return true;

  return false;
}

function prettyName(rel) {
  const base = path.posix.basename(rel);
  const clean = base.replace(/^_+/, "").replace(/[-_]+/g, " ").trim();
  if (!clean) return "Writing";
  return clean.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function idFor(rel, seen) {
  let base = String(rel === "." ? "root-pages" : rel)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
  let id = base;
  let n = 2;
  while (seen.has(id)) id = `${base}-${n++}`;
  seen.add(id);
  return id;
}

function routeFor(root, generator) {
  let rel = root;
  if (rel === ".") return "";
  /* Wrapper folders hold loose pages at the site root, not under /content/. */
  if (rel === "content" || rel === "src/content") return "";
  if (generator === "eleventy" && rel === "src") return "";
  if (PAGE_NAMES.has(rel) || PAGE_NAMES.has(path.posix.basename(rel))) return "";
  if (DRAFT_NAMES.has(path.posix.basename(rel))) return "";

  if (generator === "hugo" && rel.startsWith("content/")) rel = rel.slice("content/".length);
  else if (rel.startsWith("src/content/")) rel = rel.slice("src/content/".length);
  else if (rel.startsWith("content/")) rel = rel.slice("content/".length);
  else if (rel === "_posts" || rel === "posts" || rel === "src/posts") rel = "";
  else if (rel.startsWith("src/posts/")) rel = rel.slice("src/posts/".length);

  const base = path.posix.basename(rel);
  if (!rel) return "";
  if (root === "_posts" || root === "_drafts" || root === "posts") return "";
  if (base === "posts" || base === "blog" || base === "articles" || base === "notes" || base === "writing") {
    return `/${base}/`;
  }
  return `/${rel.replace(/^_+/, "").replace(/\/+$/, "")}/`;
}

function sampleFirst(files, count = 5) {
  const preferred = files.filter((file) => !/^(index|_index|readme)\./i.test(file.name));
  return (preferred.length ? preferred : files).slice(0, count);
}

function keyFor(records, keys) {
  const counts = new Map();
  for (const record of records) {
    for (const key of keys) {
      const value = record.data?.[key];
      if (value !== undefined && value !== null && value !== "") {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  let best = null;
  let bestCount = 0;
  for (const key of keys) {
    const n = counts.get(key) || 0;
    if (n > bestCount) {
      best = key;
      bestCount = n;
    }
  }
  return { key: best, count: bestCount };
}

function detectMapping(records) {
  const mapping = {};
  for (const field of ["title", "date", "description", "draft", "published", "slug", "permalink"]) {
    mapping[field] = keyFor(records, FIELD_KEYS[field]).key;
  }
  mapping.title ||= "title";
  mapping.date ||= "date";
  /* Every generator reads `description`; the studio only writes it when
     the person actually typed one, so a default never adds noise. */
  mapping.description ||= "description";
  return mapping;
}

function isDraft(data, rel, draftFolder) {
  const base = path.posix.basename(path.posix.dirname(rel));
  if (draftFolder && (rel === draftFolder || rel.startsWith(`${draftFolder}/`) || base === draftFolder)) return true;
  if (data?.draft === true || String(data?.draft).toLowerCase() === "true") return true;
  if (data?.published === false || String(data?.published).toLowerCase() === "false") return true;
  if (String(data?.status || "").toLowerCase() === "draft") return true;
  return false;
}

async function readRecords(files, limit = 4) {
  const records = [];
  for (const file of sampleFirst(files, limit)) {
    const text = await safeRead(file.abs);
    if (!text) continue;
    const parsed = splitFrontmatter(text);
    records.push({
      file,
      data: parsed.data,
      hasFrontmatter: parsed.has,
      title: String(parsed.data.title || parsed.data.name || titleFromBody(parsed.body) || filenameTitle(file.name)),
      date: normalizeDate(parsed.data.date || parsed.data.pubDate || parsed.data.published),
      draft: isDraft(parsed.data, file.rel, ""),
    });
  }
  return records;
}

function candidateFor(root, allFiles, { generator, seenIds, directOnly = false, kindHint = "" }) {
  const prefix = root === "." ? "" : `${root}/`;
  let files = allFiles.filter((file) => {
    if (root === ".") return file.dir === ".";
    return file.rel.startsWith(prefix);
  });

  if (directOnly) {
    files = files.filter((file) => file.dir === root || (root === "." && file.dir === "."));
    if (root === ".") files = files.filter((file) => !/^(index|_index|readme)\./i.test(file.name));
  }

  const base = path.posix.basename(root);
  const isPages = kindHint === "pages" || PAGE_NAMES.has(root) || PAGE_NAMES.has(base);
  const isDrafts = kindHint === "draft" || DRAFT_NAMES.has(base);
  const kind = isPages ? "pages" : isDrafts ? "drafts" : "collection";

  /* Generated Pages output is full of `<slug>/index.html` files. Those
     are build artefacts, not source posts. Keep nested HTML posts, but
     never treat an index, 404 or README page as writing. */
  let nestedHtml = false;
  if (!isPages) {
    const folderPosts = files.filter(
      (file) =>
        HTML_EXTENSIONS.has(file.ext) &&
        /^index\.html?$/i.test(file.name) &&
        root !== "." &&
        path.posix.dirname(file.dir) === root
    );
    files = files.filter((file) => {
      if (!HTML_EXTENSIONS.has(file.ext)) return true;
      return !/^(index|404|readme)\.html?$/i.test(file.name);
    });
    /* A folder whose only content is `<post>/index.html` pages is either
       a built site or a blog written as folder-style HTML. Offer it, but
       let the person decide: it is not ticked by default. */
    if (!files.length && folderPosts.length) {
      files = folderPosts;
      nestedHtml = true;
    }
  }
  if (!files.length) return null;

  const extCounts = new Map();
  for (const file of files) extCounts.set(file.ext, (extCounts.get(file.ext) || 0) + 1);
  const formats = [...extCounts.entries()].sort((a, b) => b[1] - a[1]).map(([ext]) => ext);
  const format = formats[0] || ".md";
  const datePrefix = files.filter((file) => /^\d{4}-\d{2}-\d{2}[-_]/.test(file.name)).length > 0;
  const name = isPages && root === "." ? "Site pages" : prettyName(root);

  return {
    id: idFor(root, seenIds),
    name,
    root,
    kind,
    format,
    formats,
    count: files.length,
    defaultInclude: !isPages && !nestedHtml,
    nestedHtml,
    directOnly,
    datePrefix,
    route: routeFor(root, generator),
    files,
  };
}

function mergeNestedSections(sections) {
  /* If the same directory was found by several heuristics, keep the
     most useful one. */
  const byRoot = new Map();
  for (const section of sections) {
    const current = byRoot.get(section.root);
    if (!current || (!section.directOnly && current.directOnly)) byRoot.set(section.root, section);
  }
  return [...byRoot.values()];
}

function labelSections(sections) {
  const counts = new Map();
  for (const section of sections) counts.set(section.name, (counts.get(section.name) || 0) + 1);
  for (const section of sections) {
    if ((counts.get(section.name) || 0) > 1 && section.root !== ".") {
      const parent = path.posix.basename(path.posix.dirname(section.root));
      if (parent && parent !== ".") section.name = `${section.name} · ${parent}`;
    }
  }
}

export async function scanSite(input, options = {}) {
  const repoRoot = await requireDirectory(input);
  const [{ files, truncated }, detectedGenerator, pkg] = await Promise.all([
    collectTextFiles(repoRoot),
    detectGenerator(repoRoot),
    packageInfo(repoRoot),
  ]);

  const requestedGenerator = String(options.generator || "").trim().toLowerCase();
  const generator = requestedGenerator && requestedGenerator !== "auto" && GENERATOR_LABELS[requestedGenerator]
    ? requestedGenerator
    : detectedGenerator;

  const [siteUrlGuess, asset, permalink] = await Promise.all([
    detectSiteUrl(repoRoot, pkg),
    detectAssets(repoRoot, generator),
    detectPermalink(repoRoot, generator),
  ]);
  const siteUrl = cleanSiteUrl(options.siteUrl) || siteUrlGuess;

  const allDirs = dirsFor(files);
  const directCounts = new Map();
  for (const file of files) directCounts.set(file.dir, (directCounts.get(file.dir) || 0) + 1);
  const seenIds = new Set();
  const sections = [];
  const containerRoots = new Set(["content", "src/content"]);
  if (generator === "eleventy") containerRoots.add("src");

  for (const dir of allDirs) {
    if (containerRoots.has(dir)) {
      /* `content/` is usually just a wrapper. Its child folders are the
         real sections. If it holds loose pages of its own, keep only
         those loose files visible. */
      if ((directCounts.get(dir) || 0) > 0) {
        const pages = candidateFor(dir, files, { generator, seenIds, directOnly: true, kindHint: "pages" });
        if (pages) {
          pages.name = "Content pages";
          sections.push(pages);
        }
      }
      continue;
    }
    if (isAnchor(dir, generator)) {
      const section = candidateFor(dir, files, { generator, seenIds });
      if (section) sections.push(section);
    }
  }

  /* Root-level writing is usually About / Contact / a homepage. Keep it
     visible but off by default. */
  if (files.some((file) => file.dir === "." && !/^(index|_index|readme)\./i.test(file.name))) {
    const pages = candidateFor(".", files, { generator, seenIds, directOnly: true, kindHint: "pages" });
    if (pages) sections.push(pages);
  }

  /* A directory with no recognised name can still be a writing folder.
     Accept it when it has a meaningful number of Markdown files. */
  for (const [dir, count] of directCounts) {
    if (dir === "." || containerRoots.has(dir) || sections.some((section) => section.root === dir)) continue;
    if (count < 3) continue;
    const section = candidateFor(dir, files, { generator, seenIds });
    if (section) {
      /* A folder chosen only because it holds several files, and holding
         nothing but HTML, is more likely templates or built output than a
         blog. Offer it, but leave it unticked. */
      if (section.formats.every((ext) => HTML_EXTENSIONS.has(ext))) section.defaultInclude = false;
      sections.push(section);
    }
  }

  const deduped = mergeNestedSections(sections);

  /* Read a few files from each section to describe its metadata accurately. */
  const allRecords = [];
  for (const section of deduped) {
    const records = await readRecords(section.files, 5);
    section._records = records;
    section.samples = records.map((record) => ({
      title: record.title,
      path: record.file.rel,
    }));
    section.hasFrontmatter = records.some((record) => record.hasFrontmatter);
    section.draftCount = records.filter((record) => record.draft).length;
    allRecords.push(...records);
    await applyPostsIndex(repoRoot, section);
  }

  const mapping = detectMapping(allRecords);
  /* Hugo understands `draft: true` natively even if no sample file uses it yet. */
  if (generator === "hugo" && !mapping.draft && !mapping.published) mapping.draft = "draft";
  const draftFolder = files.some((file) => file.rel.startsWith("_drafts/"))
    ? "_drafts"
    : files.some((file) => file.rel.startsWith("drafts/"))
      ? "drafts"
      : "";

  for (const section of deduped) {
    const records = section._records || [];
    const bits = [];
    const formats = (section.formats || [section.format])
      .map((ext) => ext.replace(".", "").toUpperCase())
      .join(" + ");
    const unit = section.indexed ? "post" : "file";
    bits.push(`${section.count} ${formats} ${unit}${section.count === 1 ? "" : "s"}`);
    if (section.kind === "drafts") bits.push("draft folder");
    else if (section.kind === "pages") bits.push("site pages");
    if (section.indexed) bits.push(`${section.indexName} index`);
    if (section.hasFrontmatter) {
      const keys = [];
      if (records.some((record) => record.data?.title !== undefined)) keys.push("title");
      if (records.some((record) => normalizeDate(record.data?.date))) keys.push("date");
      if (keys.length) bits.push(`${keys.join(" + ")} frontmatter`);
    }
    if (section.datePrefix) bits.push("date-prefixed names");
    if (section.nestedHtml) {
      bits.push("folder-style HTML pages (<name>/index.html) — may be built output; tick only if you write these by hand");
    }
    section.reason = bits.join(" · ");
    delete section.files;
    delete section._records;
  }

  labelSections(deduped);
  deduped.sort((a, b) => {
    if (a.root === ".") return 1;
    if (b.root === ".") return -1;
    return a.name.localeCompare(b.name);
  });

  const warnings = [];
  if (truncated) warnings.push(`The scan stopped after ${MAX_FILES} writing files. Some sections may be missing.`);
  if (!(await stat(path.join(repoRoot, ".git")).then(() => true).catch(() => false))) {
    warnings.push("No .git folder was found here. Writing still works; the studio just won't show repository details.");
  }
  if (!deduped.length) {
    const folderPages = files.filter((file) => HTML_EXTENSIONS.has(file.ext) && /^index\.html?$/i.test(file.name) && file.dir !== ".");
    warnings.push(
      folderPages.length
        ? `No writing folders were recognised. ${folderPages.length} folder-style HTML page${folderPages.length === 1 ? "" : "s"} (for example ${folderPages[0].rel}) look like built site output, which the studio skips so it never edits generated files. If you write them by hand, use “Add folder” and enter their parent folder.`
        : files.length
          ? "No writing folders were recognised: no folder has a familiar name (posts, blog, notes…) or several Markdown/HTML files. Use “Add folder” to point at the one you write in."
          : "No Markdown or HTML files were found in this folder. Check that this is the root of your Pages repository, or use “Add folder” to choose a subfolder."
    );
  }
  if (!siteUrl) warnings.push("No public URL was detected. You can add it now to enable “Open live page”.");

  return {
    repoRoot,
    repoName: path.basename(repoRoot) || repoRoot,
    generator,
    generatorLabel: GENERATOR_LABELS[generator] || "Static / other",
    detectedGenerator,
    siteUrl,
    siteUrlGuess,
    asset,
    permalink,
    draftFolder,
    frontmatter: mapping,
    defaultDraftMode: mapping.draft ? "draft" : mapping.published ? "published" : draftFolder ? "folder" : "none",
    defaultDraft: true,
    filesScanned: files.length,
    truncated,
    sections: deduped,
    warnings,
  };
}

export async function inspectFolder(input, folder = "") {
  const repoRoot = await requireDirectory(input);
  const rel = toPosix(String(folder || "").trim()).replace(/^\/+|\/+$/g, "");
  if (!rel) throw new Error("Enter a folder name, for example content/notes.");
  const abs = path.resolve(repoRoot, rel);
  if (!isInside(repoRoot, abs)) {
    throw new Error("That folder is outside the site.");
  }

  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new Error(`Folder not found: ${rel}`);
  }
  if (!info.isDirectory()) throw new Error(`That is not a folder: ${rel}`);

  const [{ files }, generator] = await Promise.all([
    collectTextFiles(abs),
    detectGenerator(repoRoot),
  ]);
  if (!files.length) throw new Error(`No writing files were found in ${rel}.`);

  /* collectTextFiles was pointed at the subfolder, so its paths are
     relative to that folder. Rewrite them relative to the repo before
     the shared candidate builder filters by section root. */
  for (const file of files) {
    file.rel = `${rel}/${file.rel}`;
    file.dir = file.dir === "." ? rel : `${rel}/${file.dir}`;
  }

  const section = candidateFor(rel, files, { generator, seenIds: new Set() });
  if (!section) throw new Error(`No writing files were found in ${rel}.`);

  const records = await readRecords(section.files, 3);
  await applyPostsIndex(repoRoot, section);
  const formats = (section.formats || [section.format])
    .map((ext) => ext.replace(".", "").toUpperCase())
    .join(" + ");
  const unit = section.indexed ? "post" : "file";
  const bits = [`${section.count} ${formats} ${unit}${section.count === 1 ? "" : "s"}`];
  if (section.indexed) bits.push(`${section.indexName} index`);
  if (records.some((record) => record.hasFrontmatter)) bits.push("frontmatter");
  if (section.datePrefix) bits.push("date-prefixed names");
  section.reason = bits.join(" · ");
  if (!section.indexed) {
    section.samples = records.map((record) => ({ title: record.title, path: record.file.rel }));
  }
  delete section.files;
  return section;
}

export { GENERATOR_LABELS };
