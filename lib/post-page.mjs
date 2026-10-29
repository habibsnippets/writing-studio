/* ============================================================
   The article shell for Standalone Writing Studio.
   Renders both live preview in the Studio iframe and
   published static pages.
   ============================================================ */

import { escapeHtml as esc } from "./md.mjs";

export const KATEX_CSS = "https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css";

const NAV = `<header class="nav" id="nav">
  <div class="nav-inner">
    <a class="brand" href="/" aria-label="Writing Studio">
      <span class="brand-logo" aria-hidden="true"></span>
      <span class="brand-word">writing<em>studio</em></span>
    </a>

    <nav class="nav-links" aria-label="Sections">
      <a href="/">Editor</a>
      <a href="/writing/">All Posts</a>
    </nav>

    <button class="theme-toggle" id="themeToggle" type="button" aria-label="Switch to light theme" aria-pressed="false">
      <svg class="icon-moon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <svg class="icon-sun" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M19.1 4.9l-1.6 1.6M6.5 17.5l-1.6 1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
    </button>
  </div>
</header>`;

const FOOTER = `<footer class="footer">
  <div class="container footer-inner">
    <p>© <span id="year">2026</span> Writing Studio</p>
    <p class="footer-meta">Standalone local writing studio · Markdown, Canvas &amp; PDF Annotations</p>
    <a href="/" class="footer-top">Back to Studio ↑</a>
  </div>
</footer>`;

const PAGER = (prev, next) => {
  const parts = [];
  if (prev) {
    parts.push(`<a class="pager-link pager-prev" href="/writing/${prev.slug}/">
        <span class="pager-dir">← Newer</span>
        <span class="pager-title">${esc(prev.title)}</span>
      </a>`);
  }
  if (next) {
    parts.push(`<a class="pager-link pager-next" href="/writing/${next.slug}/">
        <span class="pager-dir">Older →</span>
        <span class="pager-title">${esc(next.title)}</span>
      </a>`);
  }
  return parts.length
    ? `<nav class="post-pager" aria-label="More writing">\n      ${parts.join("\n      ")}\n    </nav>`
    : "";
};

/**
 * @param {object} post  { slug, title, date, dateISO, description, minutes }
 * @param {string} body  rendered article HTML
 * @param {object|null} prev  newer post
 * @param {object|null} next  older post
 * @param {{hasMath?: boolean, preview?: boolean}} opts
 */
export function page(post, body, prev, next, opts = {}) {
  const { hasMath = false, preview = false } = opts;
  const title = `<title>${esc(post.title)} — Writing Studio</title>`;
  const description = preview ? "" : `\n<meta name="description" content="${esc(post.description || "")}">`;

  const themeBlock = `<meta name="theme-color" content="#faf4e6">
<meta name="color-scheme" content="light dark">
<script>
  (function () {
    var t = "light";
    try { t = localStorage.getItem("theme") === "dark" ? "dark" : "light"; } catch (e) {}
    document.documentElement.setAttribute("data-theme", t);
  })();
</script>`;

  const mathCss = hasMath
    ? `\n<link rel="stylesheet" href="${KATEX_CSS}" crossorigin="anonymous">`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${title}${description}
${themeBlock}

<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="icon" type="image/png" sizes="64x64" href="/assets/favicon-dark.png" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/png" sizes="64x64" href="/assets/favicon.png" media="(prefers-color-scheme: light)">
<link rel="apple-touch-icon" href="/assets/brand-logo.png">
<link rel="preconnect" href="https://api.fontshare.com" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/styles.css">${mathCss}
</head>
<body class="${preview ? "is-preview" : ""}">

<div class="grain" aria-hidden="true"></div>
${preview ? "" : '<div class="progress" aria-hidden="true"><span id="progressBar"></span></div>'}

${preview ? "" : NAV}

<main class="post-main">
  <article class="post-page">
    <header class="post-head">
      ${preview ? "" : '<a class="post-back" href="/">← Back to Studio</a>'}
      <h1>${esc(post.title)}</h1>
      <p class="post-meta">
        <time datetime="${post.dateISO || ""}">${esc(post.date || "")}</time>
        <span class="sep" aria-hidden="true">·</span>
        <span>${post.minutes || 1} min read</span>
      </p>
    </header>

    <div class="prose">
${body}
    </div>

    ${PAGER(prev, next)}
  </article>
</main>

${preview ? "" : FOOTER}

<script src="/main.js"></script>
</body>
</html>
`;
}
