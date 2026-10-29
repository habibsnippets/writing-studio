/* ============================================================
   LaTeX posts.

   A `.tex` post keeps its metadata in the preamble (\title, \date)
   and its writing between \begin{document} and \end{document}.
   The studio reads those two commands, edits only them, and carries
   everything else — packages, macros, comments, the closing lines —
   through byte for byte.
   ============================================================ */

export const TEX_EXTENSIONS = new Set([".tex"]);

const BEGIN_DOC = /\\begin\{document\}[ \t]*\r?\n?/;
const END_DOC = /\\end\{document\}/;

/* Blank out `% comments` without moving anything, so offsets found in
   the masked text are valid in the real text. */
function maskComments(text) {
  return text.replace(/(^|[^\\])%[^\n]*/g, (match, lead) => lead + " ".repeat(match.length - lead.length));
}

/** Find `\name{...}` (optionally `\name[short]{...}`) with balanced braces. */
function findCommand(text, masked, name) {
  const re = new RegExp(`\\\\${name}\\*?(?:\\s*\\[[^\\]]*\\])?\\s*\\{`, "g");
  const match = re.exec(masked);
  if (!match) return null;
  const open = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      return { start: match.index, from: open + 1, to: i, end: i + 1, raw: text.slice(open + 1, i) };
    }
  }
  return null;
}

/** Turn a LaTeX fragment into readable plain text. */
export function texToText(src = "") {
  return String(src)
    .replace(/(^|[^\\])%[^\n]*/g, "$1")
    .replace(/\\(?:begin|end)\{[^}]*\}/g, " ")
    .replace(/\\(?:\\|newline)\*?/g, " ")
    .replace(/\\(?:label|ref|eqref|cite[a-z]*|vspace|hspace)\*?(?:\[[^\]]*\])?\{[^}]*\}/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]*\$/g, " ")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/\\([&%$#_{}])/g, "$1")
    .replace(/[{}~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const two = (n) => String(n).padStart(2, "0");

/** `2026-04-01`, `April 1, 2026`, `1 April 2026`… to ISO. `\today` and anything else gives "". */
export function texDateISO(raw = "") {
  const text = texToText(raw);
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const named =
    text.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/) ||
    text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (!named) return "";
  const [a, b, c] = named.slice(1);
  const monthWord = /^\d/.test(a) ? b : a;
  const day = /^\d/.test(a) ? a : b;
  const month = MONTHS.indexOf(monthWord.slice(0, 3).toLowerCase());
  if (month === -1) return "";
  return `${c}-${two(month + 1)}-${two(Number(day))}`;
}

function docBounds(text) {
  const masked = maskComments(text);
  const begin = BEGIN_DOC.exec(masked);
  const end = END_DOC.exec(masked);
  if (!begin) return { masked, begin: null, end: null };
  const bodyStart = begin.index + begin[0].length;
  const bodyEnd = end && end.index >= bodyStart ? end.index : text.length;
  return { masked, begin, bodyStart, bodyEnd };
}

/**
 * Read a .tex file. `body` is what the writer edits: the text inside
 * \begin{document}…\end{document}, or the whole file when it is only a
 * fragment meant to be \input into something else.
 */
export function parseTex(input = "") {
  const text = String(input ?? "").replace(/^﻿/, "");
  const bounds = docBounds(text);
  const { masked } = bounds;
  const titleCmd = findCommand(text, masked, "title");
  const dateCmd = findCommand(text, masked, "date");
  const abstract = /\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/.exec(masked);

  const body = bounds.begin ? text.slice(bounds.bodyStart, bounds.bodyEnd) : text;
  return {
    source: text,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    hasDocument: !!bounds.begin,
    hasMeta: !!(titleCmd || dateCmd),
    title: titleCmd ? texToText(titleCmd.raw) : "",
    dateISO: dateCmd ? texDateISO(dateCmd.raw) : "",
    hasDate: !!dateCmd && !!texDateISO(dateCmd.raw),
    abstract: abstract ? texToText(abstract[1]) : "",
    body,
    bodyStart: bounds.begin ? bounds.bodyStart : 0,
    bodyEnd: bounds.begin ? bounds.bodyEnd : text.length,
  };
}

export function descriptionFromTex(parsed, max = 180) {
  const plain =
    parsed.abstract ||
    texToText(
      parsed.body
        .replace(/\\maketitle/g, " ")
        .replace(/\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/g, " ")
        .split(/\n\s*\n/)
        .map((part) => part.trim())
        .find((part) => texToText(part).length > 40) || ""
    );
  return plain.length > max ? plain.slice(0, max - 1).replace(/[,;:.\s]+\S*$/, "") + "…" : plain;
}

export function titleFromTexBody(body = "") {
  const heading = findCommand(body, maskComments(body), "section");
  return heading ? texToText(heading.raw) : "";
}

const escapeTex = (value) => String(value).replace(/(^|[^\\])([&%#_])/g, "$1\\$2").replace(/(^|[^\\])([&%#_])/g, "$1\\$2");

/**
 * Change \title / \date / the abstract and leave the rest alone.
 * changes: { title?, dateISO?, description? }
 */
export function updateTex(input, changes = {}) {
  let text = String(input ?? "").replace(/^﻿/, "");
  const apply = (name, value, wrap) => {
    const masked = maskComments(text);
    const found = findCommand(text, masked, name);
    if (found) {
      text = text.slice(0, found.from) + value + text.slice(found.to);
      return;
    }
    /* No such command yet: add it just before the document begins. */
    const begin = BEGIN_DOC.exec(masked);
    if (!begin) return;
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    text = text.slice(0, begin.index) + wrap(value) + eol + text.slice(begin.index);
  };

  const current = parseTex(text);
  if (changes.title !== undefined && changes.title !== current.title) {
    apply("title", escapeTex(changes.title), (v) => `\\title{${v}}`);
  }
  if (changes.dateISO && changes.dateISO !== current.dateISO) {
    apply("date", changes.dateISO, (v) => `\\date{${v}}`);
  }
  if (changes.description !== undefined && changes.description !== current.abstract) {
    const masked = maskComments(text);
    const abstract = /(\\begin\{abstract\}[ \t]*\r?\n?)([\s\S]*?)(\r?\n?[ \t]*\\end\{abstract\})/.exec(masked);
    if (abstract && changes.description) {
      const from = abstract.index + abstract[1].length;
      text = text.slice(0, from) + escapeTex(changes.description) + text.slice(from + abstract[2].length);
    }
  }
  return text;
}

/** Swap the editable body, keeping the preamble and everything after \end{document}. */
export function replaceTexBody(input, body) {
  const parsed = parseTex(input);
  let next = String(body ?? "");
  if (parsed.eol === "\r\n") next = next.replace(/\r?\n/g, "\r\n");
  if (!parsed.hasDocument) return next;
  if (next && !/\r?\n$/.test(next)) next += parsed.eol;
  return parsed.source.slice(0, parsed.bodyStart) + next + parsed.source.slice(parsed.bodyEnd);
}

/** A starter file for a new post in a LaTeX section. */
export function createTex({ title = "Untitled", dateISO = "", body = "" } = {}) {
  const lines = [
    "\\documentclass{article}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage{amsmath}",
    "",
    `\\title{${escapeTex(title)}}`,
  ];
  if (dateISO) lines.push(`\\date{${dateISO}}`);
  lines.push("", "\\begin{document}", "\\maketitle", "");
  const text = String(body ?? "");
  return `${lines.join("\n")}\n${text}${text && !text.endsWith("\n") ? "\n" : ""}\n\\end{document}\n`;
}
