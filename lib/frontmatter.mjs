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
/* Hugo's default frontmatter is TOML between +++ fences. */
const TOML_FRONTMATTER_RE = /^\+\+\+[ \t]*\r?\n([\s\S]*?)\r?\n\+\+\+[ \t]*(?:\r?\n|$)/;

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

/** Top-level TOML keys only; anything under a [table] header is ignored. */
export function parseTomlFields(toml = "") {
  const data = {};
  for (const line of String(toml).split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (!match) continue;
    data[match[1]] = parseScalar(match[2]);
  }
  return data;
}

export function splitFrontmatter(text = "") {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const toml = source.match(TOML_FRONTMATTER_RE);
  if (toml) {
    return {
      has: true,
      kind: "toml",
      yaml: toml[1],
      data: parseTomlFields(toml[1]),
      body: source.slice(toml[0].length),
      source,
      eol: source.includes("\r\n") ? "\r\n" : "\n",
    };
  }
  const match = source.match(FRONTMATTER_RE);
  if (!match) {
    return {
      has: false,
      kind: "yaml",
      yaml: "",
      data: {},
      body: source,
      source,
      eol: source.includes("\r\n") ? "\r\n" : "\n",
    };
  }

  return {
    has: true,
    kind: "yaml",
    yaml: match[1],
    data: parseYamlFields(match[1]),
    body: source.slice(match[0].length),
    source,
    eol: source.includes("\r\n") ? "\r\n" : "\n",
  };
}

const SAFE_PLAIN = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,'’/&()!?+–—-]*$/u;

/* True when a frontmatter value already says what we are about to write. */
function sameValue(existing, next) {
  if (typeof next === "boolean") return existing === next || String(existing).toLowerCase() === String(next);
  const a = String(existing ?? "").trim();
  const b = String(next ?? "").trim();
  if (a === b) return true;
  /* A date that already falls on the same day keeps its time and zone. */
  return /^\d{4}-\d{2}-\d{2}$/.test(b) && normalizeDate(a) === b;
}

function serialize(value, oldRaw = "", toml = false) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (value === null || value === undefined) return "";

  const str = String(value);
  const quotedOld = /^\s*['"]/.test(String(oldRaw));
  if (toml) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(str) && !quotedOld) return str;
    if (String(oldRaw).trim().startsWith("'")) return `'${str.replace(/'/g, "''")}'`;
    return JSON.stringify(str);
  }
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
  const toml = parsed.kind === "toml";
  const fence = toml ? "+++" : "---";
  const assign = toml ? "=" : ":";
  const keyLine = (key) => new RegExp(`^${escapeRegExp(key)}\\s*${assign}`);
  const keyMatch = toml ? /^([A-Za-z0-9_.-]+\s*=\s*)(.*)$/ : /^([A-Za-z0-9_.-]+\s*:\s*)(.*)$/;
  let lines = parsed.has ? parsed.yaml.split(/\r?\n/) : [];
  const original = [...lines];
  /* In TOML, anything after the first [table] header belongs to that
     table, so a top-level key must be looked up and inserted before it. */
  const tableStart = () => {
    const i = lines.findIndex((line) => /^\s*\[/.test(line));
    return i === -1 ? lines.length : i;
  };

  for (const change of changes) {
    if (!change?.key) continue;
    const key = String(change.key);
    if (!/^[A-Za-z0-9_.-]+$/.test(key)) continue;

    /* Writing back the value that is already there would only churn the
       person's diff (quote style, a time-of-day on the date, …). */
    if (parsed.data[key] !== undefined && sameValue(parsed.data[key], change.value)) continue;

    const limit = toml ? tableStart() : lines.length;
    const index = lines.slice(0, limit).findIndex((line) => keyLine(key).test(line));
    if (index === -1) {
      const entry = toml ? `${key} = ${serialize(change.value, "", true)}` : `${key}: ${serialize(change.value)}`;
      if (toml) lines.splice(limit, 0, entry);
      else lines.push(entry);
      continue;
    }

    const line = lines[index];
    const match = line.match(keyMatch);
    if (!match) continue;

    const rawValue = match[2];
    /* A block scalar owns the indented lines below it. Replacing the
       header without dropping that block would leave invalid YAML. */
    if (!toml && /^[|>][+-]?\s*(?:#.*)?$/.test(rawValue.trim())) {
      let end = index + 1;
      while (end < lines.length && (/^\s/.test(lines[end]) || !lines[end].trim())) end++;
      lines.splice(index, end - index, `${match[1]}${serialize(change.value, rawValue, toml)}`);
    } else {
      lines[index] = `${match[1]}${serialize(change.value, rawValue, toml)}`;
    }
  }

  /* Do not add a pointless empty frontmatter block to a file that never
     had one. */
  if (!parsed.has && lines.length === 0) return parsed.body;
  if (parsed.has && lines.join("\n") === original.join("\n")) return source;

  const body = parsed.body;
  const block = `${fence}${eol}${lines.join(eol)}${eol}${fence}${eol}`;
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
  /* Browsers hand back textarea text with bare \n. In a CRLF file that
     would leave the body and the frontmatter with different endings. */
  if (parsed.eol === "\r\n") next = next.replace(/\r?\n/g, "\r\n");
  if (ensureTrailingNewline && next && !next.endsWith("\n")) next += parsed.eol;
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
