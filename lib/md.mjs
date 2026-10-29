/* ============================================================
   Markdown -> HTML for the writing archive.

   Shared by tools/build-writing.mjs (real pages) and
   tools/studio.mjs (live preview), so the preview is never a
   different renderer from the published page.

   Bearblog-compatible subset:
     ## headings        **bold** *italic* ~~strike~~ `code`
     ```fenced code```  - lists  1. lists  > quote  --- rule
     | tables |        [links](url)  ![images](path)
     $inline math$     $$display math$$   \(inline\)  \[display\]

   Math is rendered by KaTeX at build time into plain HTML, so a
   reader downloads no maths JavaScript and sees no flash of raw $.
   ============================================================ */

import { Marked } from "marked";
import katex from "katex";

export const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const slugify = (s = "") =>
  String(s)
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";

/* Wide tables get their own horizontal scroller so a table can
   never push the article past the viewport on a phone. */
export function wrapTables(html) {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (t) => `<div class="table-wrap">\n${t}\n</div>`);
}

/* --- inline renderers ------------------------------------- */

const usedIds = () => {
  const seen = new Map();
  return (base) => {
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
};

function external(href = "") {
  return /^https?:\/\//i.test(href);
}

const marked = new Marked({ gfm: true, breaks: false });

/* rendering is synchronous, so per-document state can live here */
let nextHeadingId = usedIds();
let assetBase = "";
let assetRootPrefix = "";

marked.use({
  renderer: {
    heading(token) {
      /* the page owns the <h1>, so a stray "#" in a post body is demoted */
      const depth = Math.min(Math.max(token.depth, 1) + (token.depth === 1 ? 1 : 0), 6);
      const text = this.parser.parseInline(token.tokens);
      const id = nextHeadingId(slugify(text));
      return `<h${depth} id="${id}">${text}</h${depth}>\n`;
    },

    link(token) {
      const text = this.parser.parseInline(token.tokens);
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      const href = escapeHtml(token.href);
      if (!external(token.href)) return `<a href="${href}"${title}>${text}</a>`;
      return `<a href="${href}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },

    image(token) {
      const alt = escapeHtml(token.text || "");
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
      let src = token.href || "";
      /* A connected site gets its absolute asset paths routed through
         the studio so the preview can show the real images. */
      if (assetRootPrefix && src.startsWith("/") && !src.startsWith("//")) {
        src = `${assetRootPrefix}${src}`;
      } else if (!/^(https?:|\/|data:|#)/i.test(src)) {
        /* a plain filename means "the image I dropped next to this post" */
        src = `${assetBase}${src.replace(/^\.\//, "")}`;
      }
      return `<img src="${escapeHtml(src)}" alt="${alt}"${title} loading="lazy" decoding="async">`;
    },
  },
});

/* --- maths ------------------------------------------------ */

const C = "\u0000"; // never appears in prose; marked passes it through untouched

function renderTex(tex, display) {
  try {
    return katex.renderToString(tex.trim(), {
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      /* keep KaTeX's MathML so screen readers get the formula, not glyph soup */
      output: "htmlAndMathml",
      trust: false,
    });
  } catch (err) {
    return `<code class="math-error" title="${escapeHtml(err.message)}">${escapeHtml(tex)}</code>`;
  }
}

function extractMath(text, store) {
  const push = (tex, display) => {
    store.push({ tex, display });
    return `${C}m${store.length - 1}${C}`;
  };

  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => push(tex, true));
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => push(tex, true));
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => push(tex, false));

  /* $...$: skip escaped dollars, require no space inside the delimiters,
     and refuse a closing $ followed by a digit so "$5 and $6" stays money */
  text = text.replace(
    /(^|[^\\$])\$(?![\s$])([^\n$]+?)(?<![\s\\])\$(?![\d$])/g,
    (_, pre, tex) => pre + push(tex, false)
  );

  return text;
}

function restoreMath(html, store) {
  if (!store.length) return html;

  /* display maths alone in its paragraph becomes a real block element */
  html = html.replace(
    new RegExp(`<p>\\s*${C}m(\\d+)${C}\\s*</p>`, "g"),
    (_, i) => `<div class="math-block">${renderTex(store[+i].tex, true)}</div>`
  );

  return html.replace(new RegExp(`${C}m(\\d+)${C}`, "g"), (_, i) => {
    const { tex, display } = store[+i];
    if (!display) return renderTex(tex, false);
    return `<span class="math-block math-block-inline">${renderTex(tex, true)}</span>`;
  });
}

/* --- entry point ------------------------------------------ */

/**
 * @param {string} markdown
 * @param {{slug?: string}} [opts]  slug is only used to resolve bare image filenames
 * @returns {{html: string, hasMath: boolean, words: number}}
 */
export function renderMarkdown(markdown, opts = {}) {
  const slug = opts.slug || "";
  const store = [];

  /* Fenced blocks and inline code must not be scanned for $...$ */
  const segments = String(markdown).replace(/\r\n/g, "\n").split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
  const source = segments
    .map((seg, i) => (i % 2 === 1 ? seg : extractMath(seg, store)))
    .join("");

  nextHeadingId = usedIds();
  assetBase = opts.assetBase !== undefined ? String(opts.assetBase || "") : slug ? `/assets/writing/${slug}/` : "";
  assetRootPrefix = String(opts.assetRootPrefix || "");

  let html = marked.parse(source);
  html = restoreMath(html, store);
  html = wrapTables(html);

  const words = String(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;

  return { html, hasMath: store.length > 0, words };
}

/** reading time at ~210 wpm, the pace the imported posts were measured at */
export const readingMinutes = (words) => Math.max(1, Math.round(words / 210));

/** Pull the body out of a full HTML document, or return the fragment. */
export function htmlFragment(html = "") {
  const source = String(html);
  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  return (body ? body[1] : source).trim();
}

/** Count readable words in an HTML fragment (imported Bearblog posts). */
export function countHtmlWords(html = "") {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Rewrite root-relative asset URLs in an HTML fragment so the connected
 * site's preview can serve them through `/site-assets/`.
 */
export function rewriteHtmlAssets(html = "", rootPrefix = "") {
  const prefix = String(rootPrefix || "").replace(/\/+$/, "");
  if (!prefix) return String(html);

  const rewrite = (url) => {
    const value = String(url || "").trim();
    return value.startsWith("/") && !value.startsWith("//") ? `${prefix}${value}` : value;
  };

  return String(html)
    .replace(/\b(src|poster)=("|')([^"']*)\2/gi, (_, attr, quote, url) => `${attr}=${quote}${rewrite(url)}${quote}`)
    .replace(/\bsrcset=("|')([^"']*)\1/gi, (_, quote, value) => {
      const next = value
        .split(",")
        .map((part) => {
          const bits = part.trim().split(/\s+/);
          if (!bits[0]) return part;
          bits[0] = rewrite(bits[0]);
          return bits.join(" ");
        })
        .join(", ");
      return `srcset=${quote}${next}${quote}`;
    })
    .replace(/url\((\s*['"]?)(\/(?!\/)[^)'"\s]+)\1\)/gi, (_, quote, url) => `url(${quote}${prefix}${url}${quote})`);
}
