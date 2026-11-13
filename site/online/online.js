/* ============================================================
   Writing Studio — online studio
   A scratch pad for notes and diagrams. Everything lives in this
   tab: no localStorage, no IndexedDB, no server, no cookies. The
   canvas engine is the same one the local app uses.
   ============================================================ */

import { mountCanvas } from "./canvas.js";

/* --- dom ---------------------------------------------------- */

const $ = (id) => document.getElementById(id);
const app = $("app");
const rail = $("rail");
const noteList = $("noteList");
const noteCount = $("noteCount");
const newNoteBtn = $("newNoteBtn");
const railToggle = $("railToggle");
const titleInput = $("noteTitle");
const modeTabs = $("modeTabs");
const previewBtn = $("previewBtn");
const downloadBtn = $("downloadBtn");
const themeBtn = $("themeBtn");
const writePane = $("writePane");
const drawPane = $("drawPane");
const drawSurface = $("drawSurface");
const noteBody = $("noteBody");
const preview = $("notePreview");
const wordCount = $("wordCount");
const footHint = $("footHint");
const toastEl = $("toast");
const drawCount = $("drawCount");

/* --- state -------------------------------------------------- */

/** @type {{id: string, title: string, body: string, mode: "write"|"draw", drew: boolean}[]} */
const notes = [];
let activeId = null;
let previewOn = window.innerWidth >= 1000;
let canvasApi = null;
let toastTimer = 0;

const uid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const activeNote = () => notes.find((note) => note.id === activeId) || null;

/* --- helpers ------------------------------------------------ */

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  requestAnimationFrame(() => toastEl.classList.add("is-on"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove("is-on");
    setTimeout(() => { if (!toastEl.classList.contains("is-on")) toastEl.hidden = true; }, 220);
  }, 2600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

/* Only links that cannot run script. Relative paths are fine too. */
function safeUrl(raw) {
  const url = String(raw || "").trim();
  if (/^(?:https?:|mailto:|data:image\/)/i.test(url)) return escapeHtml(url);
  if (/^[./#]/.test(url) && !/^\/\//.test(url)) return escapeHtml(url);
  return "#";
}

/* --- markdown ----------------------------------------------- */

function inlineMd(raw) {
  const codes = [];
  let text = escapeHtml(raw).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_, alt, url) => `<img src="${safeUrl(url)}" alt="${escapeHtml(alt)}">`);
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
  text = text.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
  text = text.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${escapeHtml(codes[Number(index)])}</code>`);
  return text;
}

const LIST_UL = /^\s*[-*+]\s+(.*)$/;
const LIST_OL = /^\s*(\d+)[.)]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line) {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim());
}

function renderMarkdown(source) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    const fence = line.match(/^\s*```+\s*([\w-]*)\s*$/);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) code.push(lines[i++]);
      i += 1;
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMd(heading[2].replace(/\s+#+\s*$/, ""))}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }

    /* Pipe tables: header row plus a |---|---| separator. */
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      out.push(
        `<table><thead><tr>${head.map((cell) => `<th>${inlineMd(cell)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMd(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      );
      continue;
    }

    if (LIST_UL.test(line) || LIST_OL.test(line)) {
      const ordered = LIST_OL.test(line);
      const items = [];
      while (i < lines.length) {
        const match = ordered ? lines[i].match(LIST_OL) : lines[i].match(LIST_UL);
        if (!match) break;
        items.push(inlineMd(ordered ? match[2] : match[1]));
        i += 1;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|```|[-*+]\s|\d+[.)]\s)/.test(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${paragraph.map(inlineMd).join("<br>")}</p>`);
  }

  return out.join("");
}

/* --- notes --------------------------------------------------- */

function titleOf(note) {
  const explicit = note.title.trim();
  if (explicit) return explicit;
  const firstLine = note.body
    .split("\n")
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, "").trim())
    .find(Boolean);
  if (!firstLine) return "Untitled note";
  return firstLine.length > 60 ? `${firstLine.slice(0, 60).trim()}…` : firstLine;
}

function wordsIn(note) {
  const text = note.body.trim();
  return text ? text.split(/\s+/).length : 0;
}

function touch(note) {
  if (!note) return;
  note.updated = Date.now();
}

function createNote({ focus = true } = {}) {
  const note = { id: uid(), title: "", body: "", mode: "write", drew: false, updated: Date.now() };
  notes.unshift(note);
  activeId = note.id;
  syncAll({ focus });
  return note;
}

function selectNote(id) {
  if (id === activeId) return;
  const note = notes.find((item) => item.id === id);
  if (!note) return;
  commitDrawCount();
  activeId = id;
  syncAll({ focus: false });
  /* On a phone the rail covers the whole workspace; get out of the way. */
  if (window.innerWidth <= 820) setRail(false);
}

function setRail(on) {
  app.classList.toggle("rail-hidden", !on);
  railToggle.setAttribute("aria-expanded", String(on));
  railToggle.setAttribute("aria-label", on ? "Hide notes" : "Show notes");
}

function removeNote(id) {
  const index = notes.findIndex((note) => note.id === id);
  if (index === -1) return;
  notes.splice(index, 1);
  if (activeId === id) {
    activeId = notes[0]?.id || null;
    if (!activeId) createNote({ focus: false });
  }
  syncAll({ focus: false });
  toast("Note deleted");
}

/* The canvas reports its element count in its own footer; use it to know
   whether a note holds a drawing worth warning about. */
function commitDrawCount() {
  const note = activeNote();
  if (!note || note.mode !== "draw") return;
  const count = Number.parseInt((drawCount?.textContent || "").replace(/\D+/g, ""), 10);
  note.drew = note.drew || (Number.isFinite(count) && count > 0);
}

/* --- rendering ----------------------------------------------- */

function renderList() {
  noteList.textContent = "";
  for (const note of notes) {
    const item = document.createElement("li");

    const button = document.createElement("button");
    button.type = "button";
    button.className = `note-item${note.id === activeId ? " is-active" : ""}`;
    button.setAttribute("aria-current", note.id === activeId ? "true" : "false");

    const body = document.createElement("span");
    body.className = "note-item-body";

    const title = document.createElement("span");
    title.className = "note-item-title";
    title.textContent = titleOf(note);

    const meta = document.createElement("span");
    meta.className = "note-item-meta";
    const words = wordsIn(note);
    meta.textContent = note.mode === "draw"
      ? "Drawing"
      : `${words} word${words === 1 ? "" : "s"}`;

    body.append(title, meta);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "note-del";
    del.textContent = "×";
    del.title = "Delete note";
    del.setAttribute("aria-label", `Delete ${titleOf(note)}`);
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      removeNote(note.id);
    });

    button.append(body, del);
    button.addEventListener("click", () => selectNote(note.id));

    item.appendChild(button);
    noteList.appendChild(item);
  }

  noteCount.textContent = String(notes.length);
  document.title = `${titleOf(activeNote())} — Writing Studio online`;
}

function renderPreview() {
  const note = activeNote();
  const html = note ? renderMarkdown(note.body) : "";
  preview.innerHTML = html;
}

function renderWords() {
  const words = activeNote() ? wordsIn(activeNote()) : 0;
  wordCount.textContent = `${words} word${words === 1 ? "" : "s"}`;
}

function setPreview(on) {
  previewOn = on;
  document.getElementById("writePane").querySelector(".write-body").classList.toggle("no-preview", !on);
  previewBtn.setAttribute("aria-pressed", String(on));
  previewBtn.title = on ? "Hide the markdown preview" : "Show the markdown preview";
  if (on) renderPreview();
}

function setMode(mode) {
  const note = activeNote();
  if (!note) return;
  if (note.mode === "draw" && mode === "write") commitDrawCount();
  note.mode = mode;

  for (const tab of modeTabs.querySelectorAll(".mode-tab")) {
    const on = tab.dataset.mode === mode;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", String(on));
  }

  downloadBtn.hidden = mode === "draw";
  renderList();

  if (mode === "draw") {
    writePane.hidden = true;
    drawPane.hidden = false;
    ensureCanvas();
    canvasApi.setSlug(note.id);
    canvasApi.open();
    footHint.textContent = "Held in this tab";
  } else {
    canvasApi?.close();
    drawPane.hidden = true;
    writePane.hidden = false;
    footHint.textContent = "Kept in this tab only";
  }
}

function syncAll({ focus = false } = {}) {
  const note = activeNote();
  if (!note) return;

  if (titleInput.value !== note.title) titleInput.value = note.title;
  titleInput.placeholder = titleOf(note);
  if (noteBody.value !== note.body) noteBody.value = note.body;

  renderList();
  renderWords();
  renderPreview();
  setMode(note.mode);

  if (focus) {
    if (note.mode === "write") noteBody.focus();
    else titleInput.focus();
  }
}

/* --- canvas -------------------------------------------------- */

function ensureCanvas() {
  if (canvasApi) return canvasApi;

  canvasApi = mountCanvas({
    root: drawSurface,
    getSlug: () => activeNote()?.id || null,
    ensureSlug: async () => activeNote()?.id || null,

    notify: toast,

    /* There is no post to write into here, so an export snippet goes to the
       clipboard instead of a file on a server. */
    insertMarkdown: async (markdown) => {
      const copied = await copyText(markdown);
      toast(copied ? "Markdown copied" : "Copy the snippet from the panel");
    },

    uploadImage: async () => {
      throw new Error("Use Download or Copy image in this tab");
    },

    /* The AI explainer needs a key and a local proxy; neither exists online. */
    getAiConfig: () => null,
    openAiSettings: () => toast("AI is not available in the online studio"),
  });

  return canvasApi;
}

/* --- events -------------------------------------------------- */

newNoteBtn.addEventListener("click", () => {
  commitDrawCount();
  createNote({ focus: true });
  if (window.innerWidth <= 820) setRail(false);
});

railToggle.addEventListener("click", () => {
  setRail(app.classList.contains("rail-hidden"));
});

titleInput.addEventListener("input", () => {
  const note = activeNote();
  if (!note) return;
  note.title = titleInput.value;
  touch(note);
  renderList();
  renderWords();
});

noteBody.addEventListener("input", () => {
  const note = activeNote();
  if (!note) return;
  note.body = noteBody.value;
  touch(note);
  renderWords();
  renderPreview();
  renderList();
});

modeTabs.addEventListener("click", (event) => {
  const tab = event.target.closest(".mode-tab");
  if (!tab) return;
  setMode(tab.dataset.mode);
  if (tab.dataset.mode === "write") noteBody.focus();
});

previewBtn.addEventListener("click", () => setPreview(!previewOn));

downloadBtn.addEventListener("click", () => {
  const note = activeNote();
  if (!note) return;
  const heading = note.title.trim();
  const body = note.body;
  const text = heading && !new RegExp(`^#\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(body)
    ? `# ${heading}\n\n${body}`
    : body;
  const name = (heading || "note")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "note";

  const url = URL.createObjectURL(new Blob([text || " "], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Downloaded as markdown");
});

themeBtn.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  window.dispatchEvent(new Event("themechange"));
});

document.addEventListener("keydown", (event) => {
  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    if (activeNote()?.mode === "write") downloadBtn.click();
    else toast("Use Export area → Download for the diagram");
  }
});

/* The tab is the whole store: ask before a reload or close throws it away. */
window.addEventListener("beforeunload", (event) => {
  commitDrawCount();
  const atRisk = notes.some((note) => note.body.trim().length > 0 || note.drew);
  if (!atRisk) return;
  event.preventDefault();
  event.returnValue = "";
});

window.addEventListener("resize", () => {
  if (window.innerWidth < 620 && previewOn) setPreview(false);
});

/* --- boot ---------------------------------------------------- */

document.documentElement.dataset.theme =
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/* A phone opens straight into the editor, not a full-screen note list. */
setRail(window.innerWidth > 820);
setPreview(previewOn);
createNote({ focus: true });
noteBody.focus();
