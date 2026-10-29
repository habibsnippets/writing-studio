/* ============================================================
   Archive a connected GitHub Pages post into the studio's local
   blog, then remove it from the Pages repository.

   The order matters: the local copy is written first. Only after
   that succeeds is the Pages source deleted. The studio never runs
   Git, a build, or a push for the connected site — it returns the
   commands the user should run.
   ============================================================ */

import path from "node:path";
import { readFile, writeFile, mkdir, copyFile, stat } from "node:fs/promises";

import { getSitePost, deleteSitePost } from "./site-workspace.mjs";
import { splitFrontmatter, filenameSlug } from "./frontmatter.mjs";
import { renderMarkdown, readingMinutes, countHtmlWords, htmlFragment } from "./md.mjs";

const APP_DIR = path.resolve(import.meta.dirname, "..");
const CONTENT = path.join(APP_DIR, "content");
const POSTS_FILE = path.join(CONTENT, "posts.json");
const ASSETS_DIR = path.join(CONTENT, "assets");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const prettyDate = (iso) => {
  const [year, month, day] = String(iso).split("-");
  return `${day} ${MONTHS[Number(month) - 1] || "Jan"}, ${year}`;
};

const safeSlug = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "archived-post";

const exists = (target) =>
  stat(target).then(
    () => true,
    () => false
  );

const isInside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

const shellQuote = (value = "") => `'${String(value).replace(/'/g, `'\\''`)}'`;

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

async function localSlugFor(base, posts) {
  const taken = new Set(posts.map((post) => post.slug));
  const free = async (slug) => {
    if (taken.has(slug)) return false;
    if (await exists(path.join(CONTENT, `${slug}.md`))) return false;
    if (await exists(path.join(CONTENT, `${slug}.html`))) return false;
    return true;
  };

  const slug = safeSlug(base);
  if (await free(slug)) return slug;

  const stem = slug.slice(0, 68).replace(/-+$/g, "") || "archived-post";
  for (let n = 1; n < 500; n++) {
    const suffix = n === 1 ? "-archived" : `-archived-${n}`;
    const candidate = `${stem}${suffix}`.slice(0, 80);
    if (await free(candidate)) return candidate;
  }
  throw Object.assign(new Error("Could not find a free local slug for the archived post."), { code: 500 });
}

/* --- asset copying ---------------------------------------- */

const ASSET_EXTENSIONS =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|mp4|webm|mov|mp3|wav|ogg|json|csv|txt)$/i;

const isRemote = (url = "") => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(String(url).trim());

const cleanUrl = (url = "") => {
  let value = String(url || "").trim();
  if (value.startsWith("<") && value.endsWith(">")) value = value.slice(1, -1).trim();
  return value;
};

const urlParts = (url = "") => {
  const value = cleanUrl(url);
  const match = value.match(/^([^?#]*)([?#].*)?$/);
  return { pathname: match?.[1] || "", suffix: match?.[2] || "" };
};

function resolveSourceAsset(url, ctx) {
  const value = cleanUrl(url);
  if (!value || isRemote(value)) return null;
  const { pathname } = urlParts(value);
  if (!pathname) return null;

  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    /* keep the raw path if it is not valid percent-encoding */
  }

  const abs = decoded.startsWith("/")
    ? path.resolve(ctx.repoRoot, `.${decoded}`)
    : path.resolve(ctx.baseDir, decoded);
  if (!isInside(ctx.repoRoot, abs)) return null;
  return abs;
}

async function copyAsset(url, ctx) {
  const source = resolveSourceAsset(url, ctx);
  if (!source) return null;

  const cached = ctx.copied.get(source);
  if (cached) return cached;

  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) return null;

  const ext = path.extname(source);
  const base =
    path
      .basename(source, ext)
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "asset";

  let name = `${base}${ext}`;
  if (ctx.names.has(name)) {
    let n = 2;
    while (ctx.names.has(`${base}-${n}${ext}`)) n++;
    name = `${base}-${n}${ext}`;
  }
  ctx.names.add(name);

  await mkdir(ctx.destDir, { recursive: true });
  await copyFile(source, path.join(ctx.destDir, name));

  const result = { url: `/assets/writing/${ctx.localSlug}/${name}`, name };
  ctx.copied.set(source, result);
  return result;
}

/* Replace matches asynchronously while preserving the surrounding text. */
async function replaceAsync(source, regex, replacer) {
  const jobs = [];
  source.replace(regex, (...args) => {
    jobs.push(replacer(...args));
    return "";
  });
  const results = await Promise.all(jobs);
  let i = 0;
  return source.replace(regex, () => results[i++]);
}

function withSuffix(nextUrl, suffix) {
  return suffix ? `${nextUrl}${suffix}` : nextUrl;
}

async function rewriteMarkdownSegment(markdown, ctx) {
  let out = String(markdown);

  /* Inline images: ![alt](path "title") */
  out = await replaceAsync(
    out,
    /(!\[[^\]]*\]\()(<[^>]+>|[^)\s]+)([^)]*)(\))/g,
    async (_match, open, target, tail, close) => {
      const copied = await copyAsset(target, ctx);
      if (!copied) return `${open}${target}${tail}${close}`;
      const { suffix } = urlParts(target);
      return `${open}${withSuffix(copied.url, suffix)}${tail}${close}`;
    }
  );

  /* Images written as raw HTML inside Markdown. */
  out = await rewriteHtmlAttributes(out, ctx, { links: false });

  /* Ordinary links to local assets (PDFs, archives, downloads). */
  out = await replaceAsync(
    out,
    /(?<!!)(\[[^\]]*\]\()(<[^>]+>|[^)\s]+)([^)]*)(\))/g,
    async (_match, open, target, tail, close) => {
      const { pathname } = urlParts(target);
      if (!ASSET_EXTENSIONS.test(pathname)) return `${open}${target}${tail}${close}`;
      const copied = await copyAsset(target, ctx);
      if (!copied) return `${open}${target}${tail}${close}`;
      const { suffix } = urlParts(target);
      return `${open}${withSuffix(copied.url, suffix)}${tail}${close}`;
    }
  );

  return out;
}

async function rewriteMarkdownAssets(markdown, ctx) {
  /* Code samples must not be treated as real image references. */
  const segments = String(markdown).split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
  const out = [];
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 1) out.push(segments[i]);
    else out.push(await rewriteMarkdownSegment(segments[i], ctx));
  }
  return out.join("");
}

async function rewriteHtmlSegment(html, ctx, { links = true } = {}) {
  let out = String(html);

  /* src / poster, quoted or unquoted. */
  out = await replaceAsync(
    out,
    /\b(src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    async (match, attr, double, single, bare) => {
      const target = double ?? single ?? bare ?? "";
      const copied = await copyAsset(target, ctx);
      if (!copied) return match;
      const { suffix } = urlParts(target);
      const quote = double !== undefined ? '"' : single !== undefined ? "'" : '"';
      return `${attr}=${quote}${withSuffix(copied.url, suffix)}${quote}`;
    }
  );

  /* srcset="a.png 1x, b.png 2x" */
  out = await replaceAsync(
    out,
    /\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi,
    async (match, _whole, double, single) => {
      const value = double ?? single ?? "";
      const parts = await Promise.all(
        value.split(",").map(async (part) => {
          const bits = part.trim().split(/\s+/);
          if (!bits[0]) return part.trim();
          const copied = await copyAsset(bits[0], ctx);
          if (!copied) return part.trim();
          const { suffix } = urlParts(bits[0]);
          bits[0] = withSuffix(copied.url, suffix);
          return bits.join(" ");
        })
      );
      return `srcset="${parts.join(", ")}"`;
    }
  );

  if (links) {
    out = await replaceAsync(
      out,
      /\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi,
      async (match, _whole, double, single) => {
        const target = double ?? single ?? "";
        const { pathname } = urlParts(target);
        if (!ASSET_EXTENSIONS.test(pathname)) return match;
        const copied = await copyAsset(target, ctx);
        if (!copied) return match;
        const { suffix } = urlParts(target);
        return `href="${withSuffix(copied.url, suffix)}"`;
      }
    );
  }

  return out;
}

async function rewriteHtmlAttributes(html, ctx, opts = {}) {
  /* Scripts, styles, and code samples are content, not asset URLs. */
  const segments = String(html).split(
    /(<pre\b[\s\S]*?<\/pre>|<code\b[\s\S]*?<\/code>|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/gi
  );
  const out = [];
  for (let i = 0; i < segments.length; i++) {
    if (i % 2 === 1) out.push(segments[i]);
    else out.push(await rewriteHtmlSegment(segments[i], ctx, opts));
  }
  return out.join("");
}

/* --- build / generated-page detection ---------------------- */

async function packageManager(repoRoot) {
  if (await exists(path.join(repoRoot, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(repoRoot, "yarn.lock"))) return "yarn";
  if (await exists(path.join(repoRoot, "bun.lockb"))) return "bun";
  return "npm";
}

async function detectBuildCommand(repoRoot, generator) {
  let pkg = null;
  try {
    pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  } catch {}

  if (pkg?.scripts?.build && String(pkg.scripts.build).trim()) {
    const manager = await packageManager(repoRoot);
    const command =
      manager === "yarn"
        ? "yarn build"
        : manager === "pnpm"
          ? "pnpm run build"
          : manager === "bun"
            ? "bun run build"
            : "npm run build";
    return { command, source: "package.json → scripts.build" };
  }

  const commands = {
    hugo: "hugo",
    jekyll: (await exists(path.join(repoRoot, "Gemfile"))) ? "bundle exec jekyll build" : "jekyll build",
    mkdocs: "mkdocs build",
    eleventy: "npx @11ty/eleventy",
    astro: "npx astro build",
    vitepress: "npx vitepress build",
  };
  if (commands[generator]) return { command: commands[generator], source: `${generator} generator` };
  return { command: "", source: "" };
}

function isInsideSection(workspace, rel) {
  return workspace.sections.some((section) => {
    if (section.root === ".") return true;
    return rel === section.root || rel.startsWith(`${section.root}/`);
  });
}

async function detectBuiltOutput(workspace, meta) {
  const repoRoot = path.resolve(workspace.repoRoot);
  const candidates = [];

  if (meta.url) {
    try {
      const site = new URL(workspace.siteUrl || "https://example.invalid/");
      const base = site.pathname.replace(/\/+$/, "");
      let pathname = new URL(meta.url).pathname;
      if (base && (pathname === base || pathname.startsWith(`${base}/`))) {
        pathname = pathname.slice(base.length);
      }
      const rel = pathname.replace(/^\/+|\/+$/g, "");
      if (rel) {
        if (/\.html?$/i.test(rel)) candidates.push(rel);
        else candidates.push(`${rel}/index.html`);
      }
    } catch {}
  }

  /* Fallback for sites that have no public URL saved. */
  const section = workspace.sections.find((item) => item.id === meta.sectionId);
  if (section?.route) {
    const rel = `${section.route.replace(/^\/+|\/+$/g, "")}/${meta.slug}/index.html`;
    if (!candidates.includes(rel)) candidates.push(rel);
  }

  for (const rel of candidates) {
    const abs = path.resolve(repoRoot, rel);
    if (!isInside(repoRoot, abs)) continue;
    if (!(await exists(abs))) continue;
    if (isInsideSection(workspace, rel)) continue;
    const dir = path.posix.dirname(rel);
    return { path: dir === "." ? rel : dir, file: rel };
  }
  return null;
}

function removalCommands(workspace, { title, build, cleanup }) {
  const commands = [`cd ${shellQuote(workspace.repoRoot)}`];
  if (cleanup?.path) commands.push(`rm -rf ${shellQuote(cleanup.path)}`);
  if (build?.command) commands.push(build.command);
  commands.push("git status --short");
  commands.push("git add -A");
  commands.push(`git commit -m ${shellQuote(`Remove ${title}`)}`);
  commands.push("git push");
  return commands;
}

/* --- main flow --------------------------------------------- */

export async function archiveAndRemoveSitePost(workspace, id) {
  if (!workspace) throw Object.assign(new Error("No GitHub Pages site is connected."), { code: 404 });

  const data = await getSitePost(workspace, id);
  const meta = data.meta;
  const repoRoot = path.resolve(workspace.repoRoot);
  const sourceAbs = path.resolve(repoRoot, meta.id);
  if (!isInside(repoRoot, sourceAbs)) {
    throw Object.assign(new Error("That post is outside the connected site."), { code: 400 });
  }

  const ext = path.extname(meta.id).toLowerCase();
  const isHtml = ext === ".html" || ext === ".htm";
  const raw = await readFile(sourceAbs, "utf8");
  const parsed = splitFrontmatter(raw);

  const posts = await readPosts();
  const localSlug = await localSlugFor(meta.slug || filenameSlug(path.basename(meta.id)), posts);

  const body = isHtml ? htmlFragment(parsed.body) : data.markdown ?? parsed.body;
  const ctx = {
    repoRoot,
    baseDir: path.dirname(sourceAbs),
    destDir: path.join(ASSETS_DIR, localSlug),
    localSlug,
    copied: new Map(),
    names: new Set(),
  };

  const archivedBody = isHtml
    ? await rewriteHtmlAttributes(body, ctx, { links: true })
    : await rewriteMarkdownAssets(body, ctx);

  const words = isHtml
    ? countHtmlWords(archivedBody)
    : renderMarkdown(archivedBody, { slug: localSlug }).words;
  const dateISO = meta.dateISO || new Date().toISOString().slice(0, 10);
  const title = meta.title || "Untitled";

  const entry = {
    slug: localSlug,
    title,
    date: prettyDate(dateISO),
    dateISO,
    description: meta.description || "",
    words,
    minutes: readingMinutes(words),
    tag: "archived",
    draft: true,
    pinned: false,
    archivedFrom: {
      repo: workspace.repoName || path.basename(repoRoot),
      path: meta.id,
      url: meta.url || null,
      removedAt: new Date().toISOString(),
    },
  };

  const localPath = path.join(CONTENT, `${localSlug}${isHtml ? ".html" : ".md"}`);
  await mkdir(CONTENT, { recursive: true });
  await writeFile(localPath, archivedBody.endsWith("\n") ? archivedBody : `${archivedBody}\n`);

  posts.push(entry);
  posts.sort((a, b) => String(b.dateISO || "").localeCompare(String(a.dateISO || "")));
  await writePosts(posts);

  try {
    await deleteSitePost(workspace, meta.id);
  } catch (err) {
    err.archive = {
      slug: localSlug,
      title,
      path: `content/${localSlug}${isHtml ? ".html" : ".md"}`,
      assets: ctx.copied.size,
    };
    throw err;
  }
  const build = await detectBuildCommand(repoRoot, workspace.generator);
  const cleanup = await detectBuiltOutput(workspace, meta);
  const commands = removalCommands(workspace, { title, build, cleanup });

  return {
    ok: true,
    repoName: workspace.repoName || path.basename(repoRoot),
    removed: {
      id: meta.id,
      slug: meta.slug,
      title,
      path: meta.id,
      url: meta.url || null,
    },
    archive: {
      slug: localSlug,
      title,
      path: `content/${localSlug}${isHtml ? ".html" : ".md"}`,
      absolutePath: localPath,
      assetDir: ctx.copied.size ? `content/assets/${localSlug}` : null,
      assets: ctx.copied.size,
      format: isHtml ? "html" : "markdown",
      readOnly: isHtml,
      draft: true,
      url: `/writing/${localSlug}/`,
    },
    build,
    cleanup,
    commands,
    manualGit: true,
  };
}
