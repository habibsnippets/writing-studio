/* ============================================================
   Frontmatter helpers for writing that already lives in a
   GitHub Pages repo.

   The studio only edits the fields it understands. Everything
   else in the file — unknown frontmatter keys, comments, nested
   YAML, body formatting — is carried through untouched.
   ============================================================ */

export const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
export const HTML_EXTENSIONS = new Set([".html", ".htm"]);
export const SITE_TEXT_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...HTML_EXTENSIONS]);

const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

const stripInlineComment = (value) => {
  let quote = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if ((ch === '"' || ch === "'") && value[i - 1] !== "\\") {
      quote = quote === ch ? "" : quote || ch;
    }
    if (ch === "#" && !quote && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value;
};

function parseScalar(raw = "") {
  let value = stripInlineComment(String(raw).trim());
  if (!value) return "";

  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (/^(true|True|TRUE)$/.test(value)) return true;
  if (/^(false|False|FALSE)$/.test(value)) return false;
  if (/^(null|Null|NULL|~)$/.test(value)) return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((part) => parseScalar(part))
      .filter((part) => part !== "");
  }
  return value;
}

/** Parse only top-level YAML keys. That is all the studio needs. */
export function parseYamlFields(yaml = "") {
  const data = {};
  for (const line of String(yaml).split(/\r?\n/)) {
    if (!line || /^\s/.test(line) || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = parseScalar(match[2]);
  }
  return data;
}

export function splitFrontmatter(text = "") {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const match = source.match(FRONTMATTER_RE);
  if (!match) {
    return {
      has: false,
      yaml: "",
      data: {},
      body: source,
      source,
      eol: source.includes("\r\n") ? "\r\n" : "\n",
    };
  }

  return {
    has: true,
    yaml: match[1],
    data: parseYamlFields(match[1]),
    body: source.slice(match[0].length),
    source,
    eol: source.includes("\r\n") ? "\r\n" : "\n",
  };
}

const SAFE_PLAIN = /^[A-Za-z0-9][A-Za-z0-9 .,'’/&()!?+–—-]*$/;

function serialize(value, oldRaw = "") {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (value === null || value === undefined) return "";

  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  const trimmedOld = String(oldRaw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str) && /^\d{4}-\d{2}-\d{2}/.test(trimmedOld)) return str;

  if (trimmedOld.startsWith("'")) return `'${str.replace(/'/g, "''")}'`;
  if (trimmedOld.startsWith('"')) return JSON.stringify(str);
  if (!str) return '""';
  if (SAFE_PLAIN.test(str) && !/:\s|^[-?:,[\]{}#&*!|>'"%@`]/.test(str)) return str;
  return JSON.stringify(str);
}

/**
 * Replace the values of known top-level keys while keeping every
 * other byte of frontmatter and body intact.
 *
 * changes: [{ key, value }]
 */
export function updateFrontmatter(text, changes = [], { create = false } = {}) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const parsed = splitFrontmatter(source);
  if (!parsed.has && !create) return source;

  const eol = parsed.eol;
  let lines = parsed.has ? parsed.yaml.split(/\r?\n/) : [];
  const original = [...lines];

  for (const change of changes) {
    if (!change?.key) continue;
    const key = String(change.key);
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) continue;

    const index = lines.findIndex((line) => new RegExp(`^${escapeRegExp(key)}\\s*:`).test(line));
    if (index === -1) {
      lines.push(`${key}: ${serialize(change.value)}`);
      continue;
    }

    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_.-]+\s*:\s*)(.*)$/);
    if (!match) continue;

    const rawValue = match[2];
    /* A block scalar owns the indented lines below it. Replacing the
       header without dropping that block would leave invalid YAML. */
    if (/^[|>][+-]?\s*(?:#.*)?$/.test(rawValue.trim())) {
      let end = index + 1;
      while (end < lines.length && (/^\s/.test(lines[end]) || !lines[end].trim())) end++;
      lines.splice(index, end - index, `${match[1]}${serialize(change.value, rawValue)}`);
    } else {
      lines[index] = `${match[1]}${serialize(change.value, rawValue)}`;
    }
  }

  /* Do not add a pointless empty frontmatter block to a file that never
     had one. */
  if (!parsed.has && lines.length === 0) return parsed.body;
  if (parsed.has && lines.join("\n") === original.join("\n")) return source;

  const body = parsed.body;
  const block = `---${eol}${lines.join(eol)}${eol}---${eol}`;
  return block + body;
}

/** Create a new frontmatter block for a brand new post. */
export function createFrontmatter(fields = {}) {
  const lines = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${serialize(value)}`);
  }
  return `---\n${lines.join("\n")}\n---\n`;
}

/**
 * Replace the body of a Markdown document while keeping its
 * frontmatter block byte-for-byte intact.
 */
export function replaceBody(text, body, { ensureTrailingNewline = true } = {}) {
  const parsed = splitFrontmatter(text);
  const prefix = parsed.has ? parsed.source.slice(0, parsed.source.length - parsed.body.length) : "";
  let next = String(body ?? "");
  if (ensureTrailingNewline && next && !next.endsWith("\n")) next += "\n";
  return prefix + next;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeDate(value) {
  if (!value) return "";
  const str = String(value).trim();
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

export function filenameTitle(filename = "") {
  return String(filename)
    .replace(/\.(?:md|markdown|mdx|html?)$/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}[-_]?/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase()) || "Untitled";
}

export function filenameSlug(filename = "") {
  return String(filename)
    .replace(/\.(?:md|markdown|mdx|html?)$/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}[-_]?/, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

export function titleFromBody(body = "") {
  const heading = String(body).match(/^\s*#\s+(.+?)\s*$/m);
  return heading ? heading[1].replace(/[*_`]/g, "").trim() : "";
}

export function descriptionFromBody(body = "", max = 180) {
  const line =
    String(body)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\$\$([\s\S]*?)\$\$/g, " ")
      .replace(/\$([^$\n]+)\$/g, "$1")
      .split(/\n\s*\n/)
      .map((part) => part.replace(/^#+\s+/gm, "").replace(/[*_`>#]/g, "").trim())
      .find((part) => part.length > 40) || "";
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1).replace(/[,;:.\s]+\S*$/, "") + "…" : flat;
}

export const fieldValue = (data, key) => (key ? data?.[key] : undefined);
