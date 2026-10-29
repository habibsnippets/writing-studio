/* ============================================================
   Build the writing archive for Standalone Writing Studio.
   Output: dist/<slug>/index.html and dist/index.html
   ============================================================ */

import { readFile, writeFile, mkdir, access, cp } from "node:fs/promises";
import path from "node:path";

import { page } from "./post-page.mjs";
import { renderMarkdown, readingMinutes, countHtmlWords, htmlFragment } from "./md.mjs";

const DIR = path.resolve(import.meta.dirname, "..");
const CONTENT = path.join(DIR, "content");
const DIST = path.join(DIR, "dist");
const POSTS_FILE = path.join(CONTENT, "posts.json");

const exists = async (p) =>
  access(p).then(
    () => true,
    () => false
  );

export async function buildSite() {
  let posts = [];
  try {
    posts = JSON.parse(await readFile(POSTS_FILE, "utf8"));
  } catch {
    return { code: 0, built: 0, out: "No posts found." };
  }

  /* Pinned articles lead the archive; the rest stay newest-first. */
  const published = posts
    .filter((p) => !p.draft)
    .sort(
      (a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        String(b.dateISO || "").localeCompare(String(a.dateISO || ""))
    );
  await mkdir(DIST, { recursive: true });

  let built = 0;
  for (let i = 0; i < published.length; i++) {
    const post = published[i];
    const mdPath = path.join(CONTENT, `${post.slug}.md`);
    const htmlPath = path.join(CONTENT, `${post.slug}.html`);

    let body = "";
    let words = post.words || 0;
    let hasMath = false;

    if (await exists(mdPath)) {
      const md = await readFile(mdPath, "utf8");
      const out = renderMarkdown(md, { slug: post.slug });
      body = out.html;
      hasMath = out.hasMath;
      words = words || out.words;
    } else if (await exists(htmlPath)) {
      /* Archived/imported HTML posts are stored as fragments. They
         are read-only in the editor but still build and preview. */
      const raw = await readFile(htmlPath, "utf8");
      body = htmlFragment(raw);
      words = words || countHtmlWords(body);
    } else {
      continue;
    }

    const minutes = post.minutes || readingMinutes(words);
    const postDir = path.join(DIST, post.slug);
    await mkdir(postDir, { recursive: true });

    // Copy post assets if they exist
    const assetSrc = path.join(CONTENT, "assets", post.slug);
    const assetDest = path.join(DIST, "assets", post.slug);
    if (await exists(assetSrc)) {
      await mkdir(path.dirname(assetDest), { recursive: true });
      await cp(assetSrc, assetDest, { recursive: true });
    }

    const prev = published[i - 1] || null;
    const next = published[i + 1] || null;
    const html = page({ ...post, minutes }, body.trim(), prev, next, { hasMath });
    await writeFile(path.join(postDir, "index.html"), html);
    built++;
  }

  // Generate archive index.html
  const archiveHtml = generateArchiveHtml(published);
  await writeFile(path.join(DIST, "index.html"), archiveHtml);

  return { code: 0, built, out: `Built ${built} post(s) to ${DIST}` };
}

function generateArchiveHtml(posts) {
  const items = posts.map((p) => `
    <li class="archive-item">
      <a class="archive-link" href="/writing/${p.slug}/">
        <div class="archive-main">
          <h2 class="archive-title">${p.pinned ? '<span class="archive-pin">Pinned</span>' : ""}${escapeHtml(p.title)}</h2>
          <p class="archive-desc">${escapeHtml(p.description || "")}</p>
        </div>
        <div class="archive-meta">
          <time datetime="${p.dateISO || ""}">${escapeHtml(p.date || "")}</time>
          <span class="sep">·</span>
          <span>${p.minutes || 1} min read</span>
        </div>
      </a>
    </li>
  `).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>All Writing — Writing Studio</title>
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="icon" type="image/png" sizes="64x64" href="/assets/favicon-dark.png" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/png" sizes="64x64" href="/assets/favicon.png" media="(prefers-color-scheme: light)">
<link rel="apple-touch-icon" href="/assets/brand-logo.png">
<link rel="preconnect" href="https://api.fontshare.com" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">
<style>
.archive-list { list-style: none; padding: 0; margin: 2rem 0; }
.archive-item { margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); padding-bottom: 1.5rem; }
.archive-link { text-decoration: none; display: block; color: inherit; }
.archive-link:hover .archive-title { color: var(--accent, #1971c2); }
.archive-title { margin: 0 0 0.5rem; font-size: 1.4rem; font-weight: 600; }
.archive-desc { margin: 0 0 0.5rem; color: var(--fg-muted, #666); font-size: 0.95rem; }
.archive-meta { font-size: 0.85rem; color: var(--fg-faint, #999); display: flex; gap: 0.5rem; }
.archive-pin { display: inline-block; margin-right: 8px; padding: 2px 7px; border-radius: 999px; background: rgba(23, 57, 92, 0.1); color: var(--brand-ink, #17395c); font-family: var(--mono); font-size: 0.6rem; letter-spacing: 0.09em; text-transform: uppercase; vertical-align: 3px; }
[data-theme="dark"] .archive-pin { background: rgba(207, 224, 245, 0.12); }
</style>
</head>
<body>
<div class="grain" aria-hidden="true"></div>
<header class="nav" id="nav">
  <div class="nav-inner">
    <a class="brand" href="/" aria-label="Writing Studio">
      <span class="brand-logo" aria-hidden="true"></span>
      <span class="brand-word">writing<em>studio</em></span>
    </a>
    <nav class="nav-links">
      <a href="/">Editor</a>
      <a href="/writing/" class="is-active">All Posts</a>
    </nav>
  </div>
</header>
<main class="post-main">
  <div class="post-page">
    <header class="post-head">
      <a class="post-back" href="/">← Back to Studio</a>
      <h1>All Published Writing</h1>
      <p class="post-meta">${posts.length} published article${posts.length === 1 ? "" : "s"}</p>
    </header>
    <ul class="archive-list">
      ${items || '<p class="archive-empty">No published posts yet. Publish one in the Studio!</p>'}
    </ul>
  </div>
</main>
<footer class="footer">
  <div class="container footer-inner">
    <p>© <span id="year">2026</span> Writing Studio</p>
    <a href="/" class="footer-top">Back to Studio ↑</a>
  </div>
</footer>
<script src="/main.js"></script>
</body>
</html>
`;
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

if (process.argv[1] === import.meta.filename) {
  buildSite().then((res) => console.log(res.out));
}
