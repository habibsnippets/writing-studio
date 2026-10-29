/* ============================================================
   Writing studio — client.

   Plain DOM, no framework. The server owns every fact: the list,
   the files, the build. This file only collects keystrokes and
   shows what came back.
   ============================================================ */

import { mountCanvas } from "./canvas.js";

const $ = (id) => document.getElementById(id);

const el = {
  app: document.querySelector(".app"),
  toggleRail: $("toggleRail"),
  newPost: $("newPost"),
  search: $("search"),
  list: $("list"),
  gitState: $("gitState"),
  copyPush: $("copyPush"),
  title: $("title"),
  statusChip: $("statusChip"),
  metaLine: $("metaLine"),
  scopeStrip: $("scopeStrip"),
  scopeBadge: $("scopeBadge"),
  scopeText: $("scopeText"),
  metaRow: document.querySelector(".meta-row"),
  saveBtn: $("saveBtn"),
  publishBtn: $("publishBtn"),
  menuBtn: $("menuBtn"),
  menu: $("menu"),
  openPost: $("openPost"),
  pinBtn: $("pinBtn"),
  unpublishBtn: $("unpublishBtn"),
  deleteBtn: $("deleteBtn"),
  removeModal: $("removeModal"),
  removeTitle: $("removeTitle"),
  removeSummary: $("removeSummary"),
  removeArchiveTitle: $("removeArchiveTitle"),
  removeArchivePath: $("removeArchivePath"),
  removeArchiveNote: $("removeArchiveNote"),
  removeCommands: $("removeCommands"),
  removeNote: $("removeNote"),
  removeCopyBtn: $("removeCopyBtn"),
  removeOpenBtn: $("removeOpenBtn"),
  removeDoneBtn: $("removeDoneBtn"),
  removeClose: $("removeClose"),
  slug: $("slug"),
  date: $("date"),
  desc: $("desc"),
  banner: $("banner"),
  panes: $("panes"),
  writePane: $("writePane"),
  modeWrite: $("modeWrite"),
  modeDraw: $("modeDraw"),
  modeSplit: $("modeSplit"),
  paneHint: $("paneHint"),
  focusModeBtn: $("focusModeBtn"),
  focusModeLabel: $("focusModeLabel"),
  writeSurface: $("writeSurface"),
  drawSurface: $("drawSurface"),
  toolbar: $("toolbar"),
  editor: $("editor"),
  linkSuggest: $("linkSuggest"),
  linkSuggestKicker: $("linkSuggestKicker"),
  linkSuggestUrl: $("linkSuggestUrl"),
  linkSuggestAdd: $("linkSuggestAdd"),
  linkSuggestKeep: $("linkSuggestKeep"),
  stats: $("stats"),
  savedState: $("savedState"),
  autosave: $("autosaveToggle"),
  preview: $("preview"),
  previewState: $("previewState"),
  recompileBtn: $("recompileBtn"),
  toggleSplit: $("toggleSplit"),
  themeToggle: $("themeToggle"),
  fileInput: $("fileInput"),
  toast: $("toast"),
  connectSite: $("connectSite"),
  connectSiteLabel: $("connectSiteLabel"),
  connectDot: $("connectDot"),
  siteModal: $("siteModal"),
  siteModalClose: $("siteModalClose"),
  siteModalKicker: $("siteModalKicker"),
  siteModalTitle: $("siteModalTitle"),
  siteProgress: $("siteProgress"),
  siteWizard: $("siteWizard"),
  siteManage: $("siteManage"),
  siteRepoPath: $("siteRepoPath"),
  siteGenerator: $("siteGenerator"),
  sitePublicUrl: $("sitePublicUrl"),
  siteResume: $("siteResume"),
  siteResumeName: $("siteResumeName"),
  siteResumePath: $("siteResumePath"),
  siteResumeNote: $("siteResumeNote"),
  siteResumeBtn: $("siteResumeBtn"),
  siteResumeOr: $("siteResumeOr"),
  siteScanSummary: $("siteScanSummary"),
  siteScanWarnings: $("siteScanWarnings"),
  siteSectionCount: $("siteSectionCount"),
  siteSectionList: $("siteSectionList"),
  siteManualFolder: $("siteManualFolder"),
  siteAddFolderBtn: $("siteAddFolderBtn"),
  siteReviewSummary: $("siteReviewSummary"),
  siteNewDraft: $("siteNewDraft"),
  siteDraftHint: $("siteDraftHint"),
  siteConventions: $("siteConventions"),
  siteError: $("siteError"),
  siteWizardFoot: $("siteWizardFoot"),
  siteManageFoot: $("siteManageFoot"),
  siteBackBtn: $("siteBackBtn"),
  siteNextBtn: $("siteNextBtn"),
  siteFootNote: $("siteFootNote"),
  siteEditBtn: $("siteEditBtn"),
  siteDisconnectBtn: $("siteDisconnectBtn"),
  siteManageClose: $("siteManageClose"),
  siteManageName: $("siteManageName"),
  siteManagePath: $("siteManagePath"),
  siteManageGenerator: $("siteManageGenerator"),
  siteManageUrl: $("siteManageUrl"),
  siteManageSections: $("siteManageSections"),
  noteModal: $("noteModal"),
  noteModalClose: $("noteModalClose"),
  noteModalTitle: $("noteModalTitle"),
  noteCreateFields: $("noteCreateFields"),
  folderCreateFields: $("folderCreateFields"),
  noteTitle: $("noteTitle"),
  noteFolder: $("noteFolder"),
  noteFolderNew: $("noteFolderNew"),
  noteFolderPath: $("noteFolderPath"),
  noteFolderInline: $("noteFolderInline"),
  noteFolderName: $("noteFolderName"),
  noteFolderCreate: $("noteFolderCreate"),
  noteFolderCancel: $("noteFolderCancel"),
  noteFolderInlineHint: $("noteFolderInlineHint"),
  folderName: $("folderName"),
  folderParent: $("folderParent"),
  noteCreateBtn: $("noteCreateBtn"),
  noteModalCancel: $("noteModalCancel"),
  noteError: $("noteError"),
  sectionModal: $("sectionModal"),
  sectionChoices: $("sectionChoices"),
  sectionModalClose: $("sectionModalClose"),
  sectionModalCancel: $("sectionModalCancel"),
  aiModal: $("aiModal"),
};

const state = {
  notes: { folders: [], notes: [], counts: { notes: 0, folders: 0 } },
  localPosts: [],
  sitePosts: [],
  git: null,
  workspace: null,
  savedWorkspace: null,
  siteSections: [],
  siteStep: 1,
  siteScan: null,
  siteSelected: new Set(),
  siteMode: "wizard",
  siteBusy: false,
  targetSection: null,
  source: null, // "note" | "local" | "site"
  meta: null, // saved metadata for the open document, null for a brand-new one
  removal: null,
  legacy: false,
  tex: false,
  dirty: false,
  saving: false,
  slugLocked: false,
  previewOn: true,
  previewStale: false,
  railOn: true,
  focusOn: false,
  focusReturn: null, // { railOn, previewOn } captured when focus mode starts
  mode: "write", // write | draw | split
  words: 0,
  minutes: 1,
  noteModalMode: "note",
  noteDraftFolder: "",
  collapsedFolders: new Set(),
};

/* The diagram canvas owns its own scene. It asks us for a document key,
   calls save() when an export needs a note/post to live under, and hands
   the finished markdown back for insertion. */
const canvasStudio = mountCanvas({
  root: el.drawSurface,
  getSlug: () => state.meta ? (state.meta.path || state.meta.id || state.meta.slug) : null,
  ensureSlug: async () => {
    if (state.meta) return state.meta.path || state.meta.id || state.meta.slug;
    await save({ silent: true });
    return state.meta ? (state.meta.path || state.meta.id || state.meta.slug) : null;
  },
  uploadImage: uploadImageBlob,
  insertMarkdown: (markdown) => {
    /* Keep the split view open when inserting an export into the post. */
    if (state.mode !== "split") setMode("write");
    insert(markdown);
  },
  notify: toast,
  getAiConfig,
  openAiSettings: openAiModal,
});

/* --- tiny helpers ----------------------------------------- */

const escapeHtml = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const todayISO = () => new Date().toISOString().slice(0, 10);

const slugify = (s = "") =>
  String(s)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const WORD = /\s+/;

const countWords = (text = "") =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .split(WORD)
    .filter(Boolean).length;

async function api(path, opts) {
  const res = await fetch(path, opts);
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw || `HTTP ${res.status}` };
  }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.output = data.output;
    err.data = data;
    throw err;
  }
  return data;
}

const postJson = (path, payload) =>
  api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

let toastTimer;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 2600);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("Copied");
}

/* --- write / draw ------------------------------------------ */

function setMode(mode) {
  const split = mode === "split";
  const drawing = mode === "draw";
  if ((drawing || split) && (state.legacy || el.modeDraw.disabled || el.modeSplit.disabled)) return;
  if (mode === state.mode) return;

  const cameFromDraw = state.mode === "draw";
  state.mode = split ? "split" : drawing ? "draw" : "write";

  el.writePane.classList.toggle("is-split", split);
  el.writeSurface.hidden = split ? false : drawing;
  el.drawSurface.hidden = split ? false : !drawing;
  el.modeWrite.classList.toggle("is-active", !drawing && !split);
  el.modeDraw.classList.toggle("is-active", drawing);
  el.modeSplit.classList.toggle("is-active", split);
  el.modeWrite.setAttribute("aria-selected", String(!drawing && !split));
  el.modeDraw.setAttribute("aria-selected", String(drawing));
  el.modeSplit.setAttribute("aria-selected", String(split));
  el.paneHint.textContent = split ? "write + draw" : drawing ? "diagram · png" : "markdown";

  if (split) {
    /* Both surfaces are visible: open the canvas without pulling focus
       away from whichever side the user was last using. */
    el.editor.blur();
    canvasStudio.open({ focus: cameFromDraw });
    if (!cameFromDraw) el.editor.focus({ preventScroll: true });
  } else if (drawing) {
    el.editor.blur();
    canvasStudio.open();
  } else {
    canvasStudio.close();
    el.editor.focus({ preventScroll: true });
  }
}

el.modeWrite.addEventListener("click", () => setMode("write"));
el.modeDraw.addEventListener("click", () => setMode("draw"));
el.modeSplit.addEventListener("click", () => setMode(state.mode === "split" ? "write" : "split"));

/* --- list -------------------------------------------------- */

async function refreshList() {
  const [notes, local] = await Promise.all([api("/api/notes/tree"), api("/api/posts")]);
  state.notes = notes || { folders: [], notes: [], counts: { notes: 0, folders: 0 } };
  state.localPosts = local.posts || [];
  state.git = local.git;

  if (state.workspace) {
    try {
      const data = await api("/api/workspace/posts");
      state.sitePosts = data.posts || [];
      state.siteSections = data.sections || state.workspace.sections || [];
      if (data.workspace) state.workspace = data.workspace;
    } catch (err) {
      state.sitePosts = [];
      state.siteSections = state.workspace.sections || [];
      showBanner("error", `<strong>The connected site could not be read.</strong> ${escapeHtml(err.message)}`);
    }
  } else {
    state.sitePosts = [];
    state.siteSections = [];
  }

  applyWorkspaceChrome();
  renderList();
  renderGit();
}

const ICON = {
  lock: `<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.7" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`,
  folder: `<svg class="tree-folder-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.8 4.3h4l1.3 1.5h7.1v6.4a1.5 1.5 0 0 1-1.5 1.5H3.3a1.5 1.5 0 0 1-1.5-1.5V4.3Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M1.8 6.2h12.4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
  file: `<svg class="tree-file-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.8h5l3.5 3.5v8.9H4V1.8Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 1.8v3.7h3.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
  chevron: `<svg class="tree-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pencil: `<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="m3 13 1-3.5L11.8 1.7a1.6 1.6 0 0 1 2.3 2.3L6.3 11.8 3 13Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="m10.8 2.8 2.4 2.4" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>`,
  pages: `<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 5.2v5.6M5.2 8h5.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  plus: `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  notePlus: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M3.5 1.8h5.2l3.8 3.8v8.6H3.5V1.8Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8.5 1.9v3.9h3.9M8 7.5v5M5.5 10h5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  folderPlus: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M1.8 4.3h4l1.3 1.5h7.1v6.4a1.5 1.5 0 0 1-1.5 1.5H3.3a1.5 1.5 0 0 1-1.5-1.5V4.3Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 8v4M6 10h4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  trash: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.3 4.5V2.8h3.4v1.7M4.4 4.5l.6 9h6l.6-9M6.7 7v4M9.3 7v4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

function groupHead(label, icon, actions = []) {
  const buttons = actions
    .map(
      ({ action, label: actionLabel, icon: actionIcon = ICON.plus }) => `
        <button class="group-action" type="button" data-action="${escapeHtml(action)}" title="${escapeHtml(actionLabel)}" aria-label="${escapeHtml(actionLabel)}">${actionIcon}</button>`
    )
    .join("");
  return `
    <div class="group group-head">
      <span class="group-name">${icon}${escapeHtml(label)}</span>
      ${buttons ? `<span class="group-actions">${buttons}</span>` : ""}
    </div>`;
}

function noteMatches(note, q) {
  if (!q) return true;
  return (
    String(note.title || "").toLowerCase().includes(q) ||
    String(note.path || "").toLowerCase().includes(q) ||
    String(note.folder || "").toLowerCase().includes(q)
  );
}

function buildNoteTree(folders = [], notes = []) {
  const root = { path: "", name: "", children: [], notes: [] };
  const map = new Map([["", root]]);
  for (const folder of folders) {
    const node = { ...folder, children: [], notes: [] };
    map.set(folder.path, node);
    const parent = map.get(folder.parent) || root;
    parent.children.push(node);
  }
  for (const note of notes) {
    const parent = map.get(note.folder) || root;
    parent.notes.push(note);
  }
  const sortNode = (node) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    node.notes.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    node.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

function countTreeNotes(node) {
  return node.notes.length + node.children.reduce((sum, child) => sum + countTreeNotes(child), 0);
}

function nodeMatches(node, q) {
  if (!q) return true;
  if (String(node.name || "").toLowerCase().includes(q)) return true;
  return node.notes.some((note) => noteMatches(note, q)) || node.children.some((child) => nodeMatches(child, q));
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function renderNoteRow(note, depth, q) {
  if (!noteMatches(note, q)) return "";
  const active = state.source === "note" && state.meta?.path === note.path;
  return `
    <div class="tree-row note-row" style="--depth:${depth}">
      <button class="tree-main" type="button" data-source="note" data-key="${escapeHtml(note.path)}" aria-current="${active ? "true" : "false"}">
        ${ICON.file}
        <span class="tree-copy">
          <span class="item-title">${escapeHtml(note.title)}</span>
          <span class="item-meta">${escapeHtml(note.folder || "private notes")} · edited ${escapeHtml(shortDate(note.updated))}</span>
        </span>
      </button>
      <span class="tree-actions">
        <button class="tree-action danger" type="button" data-action="delete-note" data-path="${escapeHtml(note.path)}" title="Delete note" aria-label="Delete ${escapeHtml(note.title)}">${ICON.trash}</button>
      </span>
    </div>`;
}

function renderNoteTree(node, depth = 0, q = "") {
  let html = "";
  for (const child of node.children) {
    if (!nodeMatches(child, q)) continue;
    const collapsed = !q && state.collapsedFolders.has(child.path);
    const children = renderNoteTree(child, depth + 1, q);
    const count = countTreeNotes(child);
    html += `
      <div class="tree-row folder-row" style="--depth:${depth}">
        <button class="tree-main" type="button" data-action="toggle-folder" data-folder="${escapeHtml(child.path)}" aria-expanded="${collapsed ? "false" : "true"}">
          ${ICON.chevron}
          ${ICON.folder}
          <span class="tree-name">${escapeHtml(child.name)}</span>
          <span class="tree-count">${count}</span>
        </button>
        <span class="tree-actions">
          <button class="tree-action" type="button" data-action="new-note" data-folder="${escapeHtml(child.path)}" title="New note in ${escapeHtml(child.name)}" aria-label="New note in ${escapeHtml(child.name)}">${ICON.notePlus}</button>
          <button class="tree-action" type="button" data-action="new-subfolder" data-folder="${escapeHtml(child.path)}" title="New subfolder in ${escapeHtml(child.name)}" aria-label="New subfolder in ${escapeHtml(child.name)}">${ICON.folderPlus}</button>
          <button class="tree-action danger" type="button" data-action="delete-folder" data-folder="${escapeHtml(child.path)}" title="Delete folder" aria-label="Delete folder ${escapeHtml(child.name)}">${ICON.trash}</button>
        </span>
      </div>
      <div class="tree-children"${collapsed ? " hidden" : ""}>${children}</div>`;
  }
  for (const note of node.notes) html += renderNoteRow(note, depth, q);
  return html;
}

function renderLocalItem(post, q) {
  const match = !q || String(post.title || "").toLowerCase().includes(q) || String(post.slug || "").toLowerCase().includes(q);
  if (!match) return "";
  const pinMark = `<svg class="pin-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.4 2.2 13.8 5.6l-1.6.6-3.1 3.1.4 3.4-5.2-5.2 3.4.4 3.1-3.1Z"/><path d="m5.7 10.3-2.9 2.9"/></svg>`;
  const active = state.source === "local" && state.meta?.slug === post.slug;
  const archived = post.archivedFrom ? "archived · " : "";
  return `
    <button class="item" type="button" data-source="local" data-key="${escapeHtml(post.slug)}" aria-current="${active ? "true" : "false"}">
      <span class="item-title">${post.pinned ? pinMark : ""}${escapeHtml(post.title)}</span>
      <span class="item-meta">${archived}${post.pinned ? "pinned · " : ""}${post.draft ? "draft · " : ""}${escapeHtml(post.date || "")} · ${post.minutes || 1} min${post.hasBody ? "" : " · no file"}</span>
    </button>`;
}

function renderSiteItem(post, q) {
  const match =
    !q ||
    String(post.title || "").toLowerCase().includes(q) ||
    String(post.slug || "").toLowerCase().includes(q) ||
    String(post.path || "").toLowerCase().includes(q);
  if (!match) return "";
  const active = state.source === "site" && state.meta?.id === post.id;
  return `
    <button class="item" type="button" data-source="site" data-key="${escapeHtml(post.id)}" aria-current="${active ? "true" : "false"}">
      <span class="item-title">${escapeHtml(post.title)}</span>
      <span class="item-meta">${post.readOnly ? "imported · " : ""}${post.draft ? "draft · " : ""}${escapeHtml(post.date || "no date")} · ${post.minutes || 1} min</span>
    </button>`;
}

function renderList() {
  const q = el.search.value.trim().toLowerCase();
  const groups = [];

  const noteCount = state.notes?.counts?.notes ?? state.notes?.notes?.length ?? 0;
  groups.push(
    groupHead(`Private notes · ${noteCount}`, ICON.lock, [
      { action: "new-note", label: "New private note", icon: ICON.notePlus },
      { action: "new-folder", label: "New private folder", icon: ICON.folderPlus },
    ])
  );

  const tree = buildNoteTree(state.notes?.folders || [], state.notes?.notes || []);
  const treeHtml = renderNoteTree(tree, 0, q);
  if (treeHtml) {
    groups.push(`<div class="note-tree">${treeHtml}</div>`);
  } else {
    groups.push(
      `<div class="tree-empty">${
        q
          ? "No private notes match that filter."
          : `<strong>Your private vault is empty.</strong>
             <span>Create a folder to group notes, or start a note at the root. Everything stays under <code>data/notes</code>.</span>
             <span class="tree-empty-actions">
               <button class="btn" type="button" data-action="new-folder">${ICON.folderPlus} New folder</button>
               <button class="btn btn-primary" type="button" data-action="new-note">${ICON.notePlus} New note</button>
             </span>`
      }</div>`
    );
  }

  groups.push(
    groupHead(`Local blog · ${state.localPosts.length}`, ICON.pencil, [
      { action: "new-local-post", label: "New local blog post" },
    ])
  );
  const local = [...state.localPosts].sort(
    (a, b) =>
      Number(!!b.pinned) - Number(!!a.pinned) ||
      String(b.dateISO || "").localeCompare(String(a.dateISO || ""))
  );
  const localHtml = local.map((post) => renderLocalItem(post, q)).join("");
  groups.push(localHtml || `<p class="tree-empty">${q ? "No local blog posts match." : "No local blog posts yet. Use the + to start one."}</p>`);

  if (state.workspace) {
    groups.push(
      groupHead(
        `GitHub Pages · ${state.workspace.repoName}`,
        ICON.pages,
        [{ action: "new-site-post", label: "New GitHub Pages post" }]
      )
    );
    const sections = state.siteSections.length ? state.siteSections : state.workspace.sections || [];
    let siteHtml = "";
    for (const section of sections) {
      const posts = state.sitePosts.filter((post) => post.sectionId === section.id);
      const matching = posts.filter(
        (post) =>
          !q ||
          String(post.title || "").toLowerCase().includes(q) ||
          String(post.slug || "").toLowerCase().includes(q) ||
          String(post.path || "").toLowerCase().includes(q)
      );
      /* An empty section still shows, so a new site's blog / notes /
         articles folders appear in the sidebar before the first post. */
      if (!matching.length && (q || posts.length)) continue;
      siteHtml += `<div class="group group-sub">${escapeHtml(section.name)} · ${matching.length}</div>`;
      siteHtml += matching.map((post) => renderSiteItem(post, "")).join("");
    }
    groups.push(siteHtml || `<p class="tree-empty">${q ? "No Pages writing matches." : "No writing found in the connected site."}</p>`);
  }

  el.list.innerHTML = groups.join("");
}

function renderGit() {
  if (state.workspace) {
    el.gitState.textContent = `Pages · ${state.workspace.repoName}`;
    el.gitState.title = `${state.workspace.repoRoot} — private notes stay in data/notes and are never pushed.`;
    el.copyPush.hidden = true;
    el.copyPush.title = "";
    return;
  }
  el.gitState.title = "";
  el.copyPush.hidden = false;
  if (!state.git) return;
  el.gitState.textContent = state.git.clean
    ? `clean · ${state.git.branch}`
    : `${state.git.changed} uncommitted · ${state.git.branch}`;
}

const COLLAPSE_KEY = "writing-studio:collapsed-folders";

function persistCollapsed() {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...state.collapsedFolders]));
  } catch {}
}

async function handleListAction(button) {
  const action = button.dataset.action;
  if (action === "toggle-folder") {
    const folder = button.dataset.folder;
    if (state.collapsedFolders.has(folder)) state.collapsedFolders.delete(folder);
    else state.collapsedFolders.add(folder);
    persistCollapsed();
    renderList();
    return;
  }
  if (action === "new-note") {
    startNewNote(button.dataset.folder || "");
    return;
  }
  if (action === "new-folder") {
    openNoteModal({ mode: "folder" });
    return;
  }
  if (action === "new-subfolder") {
    openNoteModal({ mode: "folder", folder: button.dataset.folder || "" });
    return;
  }
  if (action === "new-local-post") {
    startNewLocalPost();
    return;
  }
  if (action === "new-site-post") {
    startNewSitePost();
    return;
  }
  if (action === "delete-note") {
    await removeNote(button.dataset.path);
    return;
  }
  if (action === "delete-folder") {
    await removeFolder(button.dataset.folder);
  }
}

el.list.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]");
  if (action) {
    handleListAction(action);
    return;
  }
  const item = event.target.closest("[data-source]");
  if (item) openPost(item.dataset.key, item.dataset.source);
});

el.search.addEventListener("input", renderList);

/* --- opening ----------------------------------------------- */

async function openPost(key, source = "local") {
  await flushDirty();

  let data;
  if (source === "note") {
    data = await api(`/api/notes/note?path=${encodeURIComponent(key)}`);
  } else if (source === "site") {
    data = await api(`/api/workspace/post?id=${encodeURIComponent(key)}`);
  } else {
    data = await api(`/api/post?slug=${encodeURIComponent(key)}`);
  }

  state.source = source;
  state.meta = data.meta;
  state.legacy = source === "note" ? false : data.readOnly === true || (data.markdown === null && !!data.legacyHtml);
  state.tex = source === "site" && data.meta.format === ".tex";
  state.slugLocked = true;
  state.dirty = false;
  state.targetSection = data.meta.sectionId || state.targetSection;
  clearLinkSuggestion();

  el.title.value = data.meta.title;
  el.slug.value = data.meta.slug || data.meta.filename || "";
  el.date.value = data.meta.dateISO || "";
  el.desc.value = data.meta.description || "";
  el.editor.value = data.markdown ?? data.legacyHtml ?? "";
  el.editor.disabled = state.legacy;
  el.toolbar.hidden = state.legacy || state.tex;
  el.saveBtn.disabled = state.legacy;
  el.publishBtn.disabled = state.legacy;

  state.words = data.meta.words || countWords(el.editor.value);
  state.minutes = data.meta.minutes || 1;

  hideBanner();
  state.previewStale = false;
  updatePreviewChrome();
  if (state.legacy) {
    if (source === "site") {
      /* The connected site's HTML fragment is previewed through the
         server so its images can be routed through /site-assets/. */
      el.preview.removeAttribute("src");
      renderPreview();
    } else {
      el.preview.removeAttribute("srcdoc");
      el.preview.src = `/writing/${key}/`;
    }
    const filePath = data.meta.path || (source === "local" ? `content/${key}.html` : key);
    showBanner(
      "note",
      `<strong>${data.meta.archivedFrom ? "Archived HTML post" : "Imported HTML post"}.</strong> This one is stored as raw HTML, so the studio can preview it but not edit it — change <code>${escapeHtml(filePath)}</code> in your editor instead.`
    );
  } else {
    el.preview.removeAttribute("src");
    renderPreview();
    if (state.tex) {
      showBanner(
        "note",
        "<strong>LaTeX post.</strong> You are editing the text between <code>\\begin{document}</code> and <code>\\end{document}</code>. Title and date are saved to <code>\\title</code> and <code>\\date</code>; the preview shows the source, so build the PDF or page with your usual LaTeX workflow."
      );
    }
  }

  /* Each document gets its own local diagram scene. */
  el.modeDraw.disabled = state.legacy;
  el.modeDraw.title = state.legacy
    ? "Imported HTML posts are read-only"
    : "Draw diagrams — the editable scene stays in this browser";
  el.modeSplit.disabled = state.legacy;
  el.modeSplit.title = state.legacy
    ? "Imported HTML posts are read-only"
    : "Split write and draw side by side";
  if (state.legacy) setMode("write");
  canvasStudio.setSlug(state.meta.path || state.meta.id || key);

  updateChrome();
  markClean();
  renderList();
}

function applyWorkspaceChrome() {
  const connected = !!state.workspace;
  el.connectSite.classList.toggle("is-connected", connected);
  el.connectSiteLabel.textContent = connected ? "Connected" : "Connect to Pages";
  el.connectSite.title = connected
    ? `Connected to ${state.workspace.repoName} — manage GitHub Pages`
    : state.savedWorkspace
      ? `Reconnect to ${state.savedWorkspace.repoName} — GitHub Pages`
      : "Connect to GitHub Pages";
  el.connectDot.hidden = !connected;
}

/* The sidebar and top bar mix three deliberately separate scopes:
   private local notes, the studio's own local blog, and a connected
   GitHub Pages site. These controls follow whichever is open. */
function applySourceChrome() {
  const source = state.source;
  const isNote = source === "note";
  const isSite = source === "site";
  const isLocal = source === "local";

  el.metaRow.hidden = isNote;
  el.publishBtn.hidden = !isLocal;
  el.pinBtn.hidden = !isLocal;
  el.unpublishBtn.hidden = !isLocal;
  el.deleteBtn.hidden = !source || (isSite && !state.meta);
  el.openPost.hidden = isNote || !source;
  el.menuBtn.hidden = !source || (isSite && !state.meta);
  el.saveBtn.textContent = isNote ? "Save note" : "Save";
  el.deleteBtn.textContent = isNote ? "Delete note…" : isSite ? "Remove from Pages…" : "Delete post…";
  el.publishBtn.textContent = state.meta?.draft ? "Publish" : "Update";
  el.pinBtn.textContent = state.meta?.pinned ? "Unpin from top" : "Pin to top";

  el.slug.disabled = isNote || (isSite && !!state.meta) || state.legacy;
  el.date.disabled = el.desc.disabled = isNote || state.legacy;
  el.pinBtn.disabled = !isLocal || !state.meta;
  el.unpublishBtn.disabled = !isLocal || !state.meta || !state.meta.draft;
  el.deleteBtn.disabled = !state.meta;

  if (el.menuBtn.hidden) closeMenu();
}

function showScope(scope, html) {
  if (!scope) {
    el.scopeStrip.hidden = true;
    el.scopeStrip.removeAttribute("data-scope");
    el.scopeText.innerHTML = "";
    return;
  }
  el.scopeStrip.hidden = false;
  el.scopeStrip.dataset.scope = scope;
  el.scopeBadge.textContent = scope === "note" ? "Private" : scope === "site" ? "GitHub Pages" : "Local blog";
  el.scopeText.innerHTML = html;
}

function updateChrome() {
  syncAutosaveToggle();
  const meta = state.meta;
  const source = state.source;
  const draft = meta ? !!meta.draft : true;

  applySourceChrome();

  if (source === "note") {
    el.statusChip.textContent = meta ? "Private" : "New note";
    el.statusChip.dataset.state = "private";
    el.metaLine.textContent = meta
      ? `${meta.folder || "Private notes"} · ${meta.filename || meta.path}`
      : "stored in data/notes · never published";
    el.openPost.href = "#";
    el.openPost.setAttribute("aria-disabled", "true");
    el.openPost.title = "Private notes have no public URL";
    showScope(
      "note",
      `<strong>Private local note.</strong> Stored in <code>data/notes</code> — never built, pushed, or mixed with GitHub Pages writing.`
    );
  } else if (source === "site") {
    const sections = state.siteSections.length ? state.siteSections : state.workspace?.sections || [];
    const section = sections.find((candidate) => candidate.id === meta?.sectionId)
      || sections.find((candidate) => candidate.id === state.targetSection);
    el.statusChip.textContent = meta ? (draft ? "Draft" : "On site") : "New";
    el.statusChip.dataset.state = draft ? "draft" : "published";
    el.metaLine.textContent = meta
      ? `${section?.name || meta.sectionName || "Writing"} · ${meta.path}`
      : `${section?.name || "Writing"} · not saved yet`;

    el.openPost.href = meta?.url || "#";
    el.openPost.setAttribute("aria-disabled", meta?.url ? "false" : "true");
    el.openPost.title = meta?.url ? "Open the live page" : "No public URL is known for this post";
    showScope(
      "site",
      `<strong>GitHub Pages.</strong> Saving writes into <code>${escapeHtml(state.workspace?.repoRoot || "")}</code>; Git stays manual.`
    );
  } else if (source === "local") {
    el.statusChip.textContent = meta ? (draft ? "Draft" : "Published") : "New";
    el.statusChip.dataset.state = draft ? "draft" : "published";
    el.metaLine.textContent = meta
      ? meta.archivedFrom
        ? `archived from ${meta.archivedFrom.repo || "GitHub Pages"} · ${meta.draft ? "draft" : "local copy"}`
        : `/writing/${meta.slug}/`
      : "not saved yet";
    el.openPost.href = meta ? `/writing/${meta.slug}/` : "#";
    el.openPost.setAttribute("aria-disabled", meta ? "false" : "true");
    el.openPost.title = meta?.archivedFrom ? "Open the archived local copy" : "";
    showScope(
      "local",
      meta?.archivedFrom
        ? `<strong>Archived from GitHub Pages.</strong> The original source was removed from <code>${escapeHtml(meta.archivedFrom.path || "")}</code> and saved here as a local draft.`
        : `<strong>Local blog.</strong> This is the studio's own publishable archive — separate from private notes and GitHub Pages.`
    );
  } else {
    el.statusChip.textContent = "New";
    el.statusChip.dataset.state = "draft";
    el.metaLine.textContent = "nothing open";
    el.openPost.href = "#";
    el.openPost.setAttribute("aria-disabled", "true");
    el.openPost.title = "";
    showScope(null);
  }

  const words = state.words || countWords(el.editor.value);
  const minutes = Math.max(1, Math.round(words / 210));
  el.stats.textContent = `${words} word${words === 1 ? "" : "s"} · ~${minutes} min`;
  applyWorkspaceChrome();
}

/* Autosave is remembered per kind of writing. Local posts and private
   notes live in the studio's own folder, so it defaults on. A connected
   Pages site is the person's real repository: it defaults off, and they
   opt in. */
function autosaveKey() {
  return state.source === "site" ? "autosave:site" : "autosave:local";
}

function autosaveOn() {
  let stored = null;
  try { stored = localStorage.getItem(autosaveKey()); } catch (e) {}
  if (stored === "1") return true;
  if (stored === "0") return false;
  return state.source !== "site";
}

function syncAutosaveToggle() {
  if (el.autosave) el.autosave.checked = autosaveOn();
}

/* Moving away from unsaved edits: save them when autosave is on, ask
   when it is off, so a manual-save repo never changes behind the back. */
async function flushDirty() {
  if (!state.dirty) return true;
  if (autosaveOn() || state.source !== "site") {
    return !!(await save({ silent: true }));
  }
  const name = state.meta?.title || el.title.value || "this post";
  if (confirm(`Save your changes to “${name}” in your site before leaving?\n\nOK saves them. Cancel discards them.`)) {
    return !!(await save({ silent: true }));
  }
  state.dirty = false;
  return true;
}

el.autosave?.addEventListener("change", () => {
  try { localStorage.setItem(autosaveKey(), el.autosave.checked ? "1" : "0"); } catch (e) {}
  if (el.autosave.checked && state.dirty) scheduleSave();
  else if (state.dirty) markDirty();
});

function markDirty() {
  state.dirty = true;
  el.savedState.textContent = autosaveOn() ? "unsaved changes" : "unsaved — press Ctrl/Cmd+S to save";
  el.savedState.dataset.state = "dirty";
}

function markClean(at) {
  el.savedState.textContent = at ? `saved ${new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "saved";
  el.savedState.dataset.state = "saved";
}

/* --- banner ------------------------------------------------ */

function showBanner(kind, html) {
  el.banner.hidden = false;
  el.banner.dataset.kind = kind;
  el.banner.innerHTML = html;
}

function hideBanner() {
  el.banner.hidden = true;
  el.banner.innerHTML = "";
}

el.banner.addEventListener("click", (event) => {
  const copyBtn = event.target.closest("[data-copy]");
  if (copyBtn) copy(copyBtn.dataset.copy);
  if (event.target.closest("[data-removal-open]") && state.removal) showRemoveResult(state.removal);
  if (event.target.closest("[data-dismiss]")) hideBanner();
});

/* --- saving ------------------------------------------------ */

function collectMeta() {
  const sectionId = state.meta?.sectionId || state.targetSection || state.workspace?.sections?.[0]?.id;
  const meta = {
    slug: el.slug.value.trim(),
    title: el.title.value,
    dateISO: el.date.value || (state.meta ? state.meta.dateISO || "" : todayISO()),
    description: el.desc.value,
    draft: state.meta ? !!state.meta.draft : defaultDraftFor(sectionId),
  };
  if (state.source === "site") {
    if (state.meta?.id) meta.id = state.meta.id;
    meta.sectionId = sectionId;
  }
  return meta;
}

/* A new post's draft state depends on what the site can actually
   express. A Jekyll-style draft folder only marks files inside it as
   drafts; a new note in `notes/` is a normal page. */
function defaultDraftFor(sectionId) {
  if (state.source !== "site" || !state.workspace) return true;
  const sections = state.siteSections.length ? state.siteSections : state.workspace.sections || [];
  const section = sections.find((candidate) => candidate.id === sectionId);
  if (section?.kind === "drafts") return true;
  const fm = state.workspace.frontmatter || {};
  if (fm.draft || fm.published) return !!state.workspace.defaultDraft;
  return false;
}

function uniqueSlug(base) {
  const root = base || "untitled";
  if (!state.localPosts.some((post) => post.slug === root)) return root;
  let n = 2;
  while (state.localPosts.some((post) => post.slug === `${root}-${n}`)) n++;
  return `${root}-${n}`;
}

async function save({ silent = false } = {}) {
  if (state.legacy || state.saving || !state.source) return state.meta;
  if (state.source === "note" && !state.meta?.path) return null;

  if (state.source !== "note" && !state.meta) {
    if (!el.slug.value.trim()) el.slug.value = uniqueSlug(slugify(el.title.value) || slugify(todayISO()));
    if (!el.title.value.trim() && !el.editor.value.trim()) return null;
    if (!el.title.value.trim()) el.title.value = "Untitled";
  }

  state.saving = true;
  el.savedState.textContent = "saving…";
  el.savedState.dataset.state = "";

  try {
    let data;
    if (state.source === "note") {
      data = await postJson("/api/notes/note", {
        path: state.meta.path,
        title: el.title.value,
        markdown: el.editor.value,
      });
    } else {
      const meta = collectMeta();
      if (!meta.slug) return null;
      const endpoint = state.source === "site" ? "/api/workspace/post" : "/api/post";
      data = await postJson(endpoint, { meta, markdown: el.editor.value });
    }

    const wasNew = !state.meta;
    state.meta = data.meta;
    state.targetSection = data.meta.sectionId || state.targetSection;
    state.dirty = false;
    markClean(data.savedAt);
    updateChrome();
    if (wasNew) {
      el.slug.value = data.meta.slug || data.meta.filename || "";
      /* The scene was created under the scratch key; carry it over. */
      canvasStudio.setSlug(data.meta.path || data.meta.id || data.meta.slug, { migrate: true });
    }
    await refreshList();
    if (!silent) {
      toast(
        state.source === "note"
          ? "Saved privately"
          : state.source === "site"
            ? "Saved to your site"
            : "Saved"
      );
    }
    return data.meta;
  } catch (err) {
    el.savedState.textContent = err.message;
    el.savedState.dataset.state = "error";
    if (!silent) showBanner("error", `<strong>Could not save.</strong> ${escapeHtml(err.message)}`);
    return null;
  } finally {
    state.saving = false;
  }
}

let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  if (!autosaveOn()) return;
  saveTimer = setTimeout(() => {
    if (state.dirty) save({ silent: true });
  }, 1400);
}

/* --- preview ----------------------------------------------- */

/* Overleaf-style: the preview rebuilds only when asked for, so the
   right pane never jumps around while a paragraph is half-typed. */
function markPreviewStale() {
  if (state.legacy || !state.previewOn) return;
  state.previewStale = true;
  updatePreviewChrome();
}

function updatePreviewChrome({ compiling = false } = {}) {
  if (el.previewState) el.previewState.hidden = !state.previewStale;
  if (el.recompileBtn) {
    el.recompileBtn.classList.toggle("is-stale", state.previewStale && !compiling);
    el.recompileBtn.disabled = compiling;
  }
}

el.recompileBtn?.addEventListener("click", () => renderPreview());

async function renderPreview() {
  if (!state.previewOn || !state.source) return;
  /* Local imported HTML is served from the built page instead. A
     connected site's HTML is rendered by the server preview. */
  if (state.legacy && state.source !== "site") return;
  updatePreviewChrome({ compiling: true });
  let scroll = 0;
  try {
    scroll = el.preview.contentWindow?.scrollY || 0;
  } catch {
    /* cross-origin during the first paint */
  }

  el.preview.onload = () => {
    try {
      el.preview.contentWindow?.scrollTo(0, scroll);
      const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
      el.preview.contentDocument?.documentElement.setAttribute("data-theme", currentTheme);
    } catch {}
    el.preview.onload = null;
  };

  try {
    let endpoint;
    let payload;
    if (state.source === "note") {
      endpoint = "/api/notes/preview";
      payload = {
        path: state.meta?.path || "",
        title: el.title.value,
        markdown: el.editor.value,
      };
    } else {
      endpoint = state.source === "site" ? "/api/workspace/preview" : "/api/preview";
      payload = { meta: collectMeta() };
      if (state.tex) payload.tex = true;
      if (state.legacy) payload.legacyHtml = el.editor.value;
      else payload.markdown = el.editor.value;
    }
    const data = await postJson(endpoint, payload);
    el.preview.srcdoc = data.html;
    state.words = data.words;
    state.minutes = data.minutes;
    state.previewStale = false;
    updateChrome();
  } catch (err) {
    showBanner("error", `<strong>Preview failed.</strong> ${escapeHtml(err.message)}`);
  } finally {
    updatePreviewChrome();
  }
}

/* --- writing surface --------------------------------------- */

el.title.addEventListener("input", () => {
  if (!state.slugLocked) el.slug.value = slugify(el.title.value);
  markDirty();
  scheduleSave();
  markPreviewStale();
});

el.slug.addEventListener("input", () => {
  state.slugLocked = el.slug.value.trim().length > 0;
  el.slug.value = slugify(el.slug.value);
  markDirty();
  scheduleSave();
});

for (const field of [el.date, el.desc]) {
  field.addEventListener("input", () => {
    markDirty();
    scheduleSave();
    markPreviewStale();
  });
}

el.editor.addEventListener("input", () => {
  markDirty();
  state.words = countWords(el.editor.value);
  updateChrome();
  scheduleSave();
  markPreviewStale();
});

/* Tab indents instead of leaving the field. */
el.editor.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  event.preventDefault();
  const { selectionStart: start, selectionEnd: end } = el.editor;
  el.editor.setRangeText("  ", start, end, "end");
  el.editor.dispatchEvent(new Event("input"));
});

/* --- pasted links ------------------------------------------ */

let pendingLink = null;

function clearLinkSuggestion() {
  pendingLink = null;
  if (el.linkSuggest) el.linkSuggest.hidden = true;
}

/* "link" turns the pasted URL into [text](url); "plain" keeps it as text. */
function resolvePendingLink(mode = "plain") {
  if (!pendingLink) return;
  const { url, start, end, selected } = pendingLink;
  pendingLink = null;
  el.linkSuggest.hidden = true;

  const label = String(selected || "").trim();
  const text = mode === "link" ? `[${label || url}](${url})` : url;
  el.editor.setRangeText(text, start, end, "end");
  el.editor.focus();
  el.editor.dispatchEvent(new Event("input"));
}

function offerLinkPaste(url, start, end, selected) {
  pendingLink = { url, start, end, selected };
  el.linkSuggestKicker.textContent = String(selected || "").trim()
    ? "Link the selected text"
    : "Turn this into a link";
  el.linkSuggestUrl.textContent = url;
  el.linkSuggest.hidden = false;
}

el.linkSuggestAdd?.addEventListener("click", () => resolvePendingLink("link"));
el.linkSuggestKeep?.addEventListener("click", () => resolvePendingLink("plain"));

/* Any click elsewhere — or any key — keeps the URL as plain text so a paste
   is never silently lost. */
document.addEventListener("click", (event) => {
  if (!pendingLink) return;
  if (event.target.closest?.("#linkSuggest")) return;
  resolvePendingLink("plain");
});

/* --- selection helpers ------------------------------------- */

function insert(text, selectFrom, selectTo) {
  const start = el.editor.selectionStart;
  const end = el.editor.selectionEnd;
  el.editor.setRangeText(text, start, end, "end");
  if (typeof selectFrom === "number") {
    el.editor.selectionStart = start + selectFrom;
    el.editor.selectionEnd = start + (selectTo ?? selectFrom);
  }
  el.editor.focus();
  el.editor.dispatchEvent(new Event("input"));
}

function surround(before, after, placeholder = "") {
  const start = el.editor.selectionStart;
  const end = el.editor.selectionEnd;
  const selected = el.editor.value.slice(start, end) || placeholder;
  insert(before + selected + after, before.length, before.length + selected.length);
}

function prefixLine(prefix) {
  const start = el.editor.selectionStart;
  const lineStart = el.editor.value.lastIndexOf("\n", start - 1) + 1;
  el.editor.setRangeText(prefix, lineStart, lineStart, "end");
  el.editor.focus();
  el.editor.dispatchEvent(new Event("input"));
}

function block(text, caret) {
  const start = el.editor.selectionStart;
  const atLineStart = start === 0 || el.editor.value[start - 1] === "\n";
  const pad = atLineStart ? "" : "\n";
  insert(pad + text + "\n", pad.length + (caret ?? text.length), pad.length + (caret ?? text.length));
}

const commands = {
  h2: () => prefixLine("## "),
  bold: () => surround("**", "**", "bold text"),
  italic: () => surround("*", "*", "italic"),
  strike: () => surround("~~", "~~", "text"),
  code: () => surround("`", "`", "code"),
  link: () => {
    const { selectionStart: s, selectionEnd: e, value } = el.editor;
    const selected = value.slice(s, e);
    if (/^https?:\/\//.test(selected)) insert(`[](${selected})`, 1, 1);
    else surround("[", "](https://)", "link text");
  },
  image: () => el.fileInput.click(),
  math: () => surround("$", "$", "E = mc^2"),
  mathblock: () => block("$$\n\\frac{a}{b} = c\n$$", 3),
  ul: () => prefixLine("- "),
  ol: () => prefixLine("1. "),
  quote: () => prefixLine("> "),
  codeblock: () => block("```python\n\n```", 12),
  table: () => block("| Column | Column |\n| --- | --- |\n| cell | cell |", 30),
  hr: () => block("---"),
};

el.toolbar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-cmd]");
  if (!button) return;
  commands[button.dataset.cmd]?.();
});

/* --- images ------------------------------------------------ */

async function uploadBlob(blob, filename = "image.png") {
  if (!state.source) throw new Error("Open a note or post first");
  if (state.legacy) throw new Error("Imported HTML posts are read-only");
  if (!state.meta || state.dirty) {
    const saved = await save({ silent: true });
    if (!saved) throw new Error(state.source === "note" ? "Give the note a title first" : "Add a title first");
  }

  let uploadUrl;
  if (state.source === "note") {
    uploadUrl = `/api/notes/upload?path=${encodeURIComponent(state.meta.path)}`;
  } else if (state.source === "site") {
    if (!state.meta.id) throw new Error("Save the post before adding media");
    uploadUrl = `/api/workspace/upload?id=${encodeURIComponent(state.meta.id)}`;
  } else {
    uploadUrl = `/api/upload?slug=${encodeURIComponent(state.meta.slug)}`;
  }

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "content-type": blob.type || "application/octet-stream",
      "x-filename": encodeURIComponent(filename || "image.png"),
    },
    body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "upload failed");
  return data;
}

async function insertImage(file) {
  if (!file.type.startsWith("image/")) return toast("That is not an image");

  try {
    el.savedState.textContent = "uploading image…";
    const data = await uploadBlob(file, file.name || "image.png");

    const alt =
      (file.name || "image")
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/[-_]+/g, " ")
        .trim() || "image";
    block(`![${alt}](${data.path})`);
    toast(`Added ${data.name} · ${Math.round(data.bytes / 1024)} KB`);
  } catch (err) {
    showBanner("error", `<strong>Image upload failed.</strong> ${escapeHtml(err.message)}`);
  }
}

/* The diagram canvas saves PNGs through this so they land beside a
   private note, a local post, or a connected Pages post — whichever is
   actually open — instead of always using the studio's own uploads. */
async function uploadImageBlob(blob, filename = "image.png") {
  return uploadBlob(blob, filename);
}

el.fileInput.addEventListener("change", () => {
  const file = el.fileInput.files?.[0];
  el.fileInput.value = "";
  if (file) insertImage(file);
});

el.editor.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  el.editor.style.background = "rgba(11, 98, 196, 0.04)";
});

el.editor.addEventListener("dragleave", () => {
  el.editor.style.background = "";
});

el.editor.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  event.preventDefault();
  el.editor.style.background = "";
  insertImage(file);
});

el.editor.addEventListener("paste", (event) => {
  const file = Array.from(event.clipboardData?.files || []).find((f) => f.type.startsWith("image/"));
  if (file) {
    event.preventDefault();
    insertImage(file);
    return;
  }

  /* The canvas copies a full ![diagram](path) snippet, but if only a
     bare image path is on the clipboard, wrap it automatically.
     Relative names keep working — the build resolves them against
     the post's asset folder. */
  const text = event.clipboardData?.getData("text/plain")?.trim() || "";
  if (text && !text.includes("](")) {
    if (/^(?:https?:\/\/|\/|\.\/)?[^\s]+\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(text)) {
      event.preventDefault();
      insert(`![diagram](${text})`);
      return;
    }
    /* A bare link is offered as markdown, the way Gmail offers to link
       text you just pasted a URL over. */
    if (/^(?:https?:\/\/|www\.)[^\s]+$/i.test(text)) {
      event.preventDefault();
      const start = el.editor.selectionStart;
      const end = el.editor.selectionEnd;
      offerLinkPaste(text, start, end, el.editor.value.slice(start, end));
    }
  }
});

/* --- publish ----------------------------------------------- */

/* "built 23 post pages + writing/posts.js …" -> "23 pages rebuilt" */
const builtLine = (output = "") => {
  const n = (output.match(/built (\d+) post/) || [])[1];
  return n ? `${n} pages rebuilt` : "the archive was rebuilt";
};

async function publish() {
  if (state.legacy || state.source !== "local") return;

  if (!state.meta) {
    const saved = await save({ silent: true });
    if (!saved) return toast("Add a title first");
  }
  await flushDirty();

  el.publishBtn.disabled = true;
  el.publishBtn.textContent = "Building…";

  try {
    const data = await postJson("/api/publish", { meta: collectMeta(), markdown: el.editor.value });
    state.meta = { ...state.meta, draft: false };
    state.dirty = false;
    updateChrome();
    await refreshList();

    showBanner(
      "ok",
      `<strong>Published locally.</strong> ${builtLine(data.output)} — your site is still the old one until you push:
       <div class="banner-row">
         <code>${escapeHtml(data.git.command)}</code>
         <button class="linkish" type="button" data-copy="${escapeHtml(data.git.command)}">copy</button>
         <button class="linkish" type="button" data-dismiss>dismiss</button>
       </div>`
    );
    toast("Published locally — now push");
  } catch (err) {
    showBanner(
      "error",
      `<strong>Publish failed.</strong> ${escapeHtml(err.message)}${err.output ? `<code>${escapeHtml(err.output)}</code>` : ""}`
    );
    updateChrome();
  } finally {
    el.publishBtn.disabled = false;
    el.publishBtn.textContent = state.meta?.draft ? "Publish" : "Update";
  }
}

async function togglePin() {
  closeMenu();
  if (!state.meta || state.source !== "local") return;
  const next = !state.meta.pinned;

  try {
    const data = await postJson("/api/post", {
      meta: { ...collectMeta(), pinned: next },
      markdown: el.editor.value,
    });
    state.meta = data.meta;
    state.dirty = false;
    updateChrome();
    await refreshList();
    toast(next ? "Pinned to the top" : "Unpinned");
  } catch (err) {
    showBanner("error", `<strong>Could not update the pin.</strong> ${escapeHtml(err.message)}`);
  }
}

el.pinBtn.addEventListener("click", togglePin);

async function unpublish() {
  closeMenu();
  if (!state.meta || state.source !== "local") return;
  try {
    const data = await postJson("/api/unpublish", { meta: collectMeta(), markdown: el.editor.value });
    state.meta = { ...state.meta, draft: true };
    updateChrome();
    await refreshList();
    showBanner("note", `<strong>Back in drafts.</strong> ${builtLine(data.output)} — push to remove it from the live site.`);
  } catch (err) {
    showBanner("error", `<strong>Could not unpublish.</strong> ${escapeHtml(err.message)}`);
  }
}

async function remove() {
  closeMenu();
  if (!state.meta || state.source !== "local") return;
  const ok = confirm(`Delete “${state.meta.title}”?\n\nThis removes the markdown, its images and the built page from the repo.`);
  if (!ok) return;

  try {
    const data = await postJson("/api/delete", { slug: state.meta.slug });
    resetEditor(null, "local");
    await refreshList();
    showBanner("note", `<strong>Deleted.</strong> ${builtLine(data.output)} — the files are gone; push to finish.`);
  } catch (err) {
    showBanner("error", `<strong>Could not delete.</strong> ${escapeHtml(err.message)}`);
  }
}

/* --- remove a published Pages post ------------------------- */

function showRemoveResult(data) {
  state.removal = data;
  const removed = data.removed || {};
  const archive = data.archive || {};

  el.removeSummary.innerHTML =
    `<strong>${escapeHtml(removed.title || archive.title || "The post")}</strong> was archived to your Local blog, ` +
    `then removed from <code>${escapeHtml(data.repoName || "the Pages repo")}</code>.`;

  el.removeArchiveTitle.textContent = archive.title || removed.title || "Local copy";
  el.removeArchivePath.textContent = archive.path || "";
  const bits = [archive.readOnly ? "HTML · read-only preview" : "Markdown"];
  bits.push("draft");
  if (archive.assets) bits.push(`${archive.assets} image${archive.assets === 1 ? "" : "s"} copied`);
  el.removeArchiveNote.textContent = bits.join(" · ");

  el.removeCommands.textContent = (data.commands || []).join("\n");
  el.removeOpenBtn.disabled = !archive.slug;

  const notes = [];
  if (data.cleanup?.path) {
    notes.push(`The stale built page at ${data.cleanup.path} is removed by the commands above.`);
  }
  if (data.build?.command) {
    notes.push(`Build detected: ${data.build.command}.`);
  } else {
    notes.push("No build command was detected — add your site's usual build step before committing.");
  }
  if (archive.assets) {
    notes.push("The original images stay in the Pages repo; the local archive has its own copies.");
  }
  el.removeNote.textContent = notes.join(" ");
  el.removeModal.hidden = false;
}

function closeRemoveModal() {
  el.removeModal.hidden = true;
  /* A local HTML archive previews through an iframe. If the result
     dialog opened before that iframe painted, nudge it once the
     overlay is gone. */
  if (state.source === "local" && state.legacy) {
    const src = el.preview.getAttribute("src");
    if (src) el.preview.src = src;
  }
}

async function openRemovalCopy() {
  const slug = state.removal?.archive?.slug;
  if (!slug) return;
  closeRemoveModal();
  if (state.source === "local" && state.meta?.slug === slug) return;
  try {
    await openPost(slug, "local");
    if (state.removal) showRemovalBanner();
  } catch (err) {
    showBanner("error", `<strong>Could not open the local copy.</strong> ${escapeHtml(err.message)}`);
  }
}

function showRemovalBanner() {
  showBanner(
    "note",
    `<strong>Archived to the Local blog.</strong> The Pages source is gone. ` +
      `<button class="linkish" type="button" data-removal-open>Show removal commands</button>`
  );
}

async function removeSitePost() {
  closeMenu();
  if (!state.meta || state.source !== "site") return;

  const title = state.meta.title || "this post";
  const ok = confirm(
    `Remove “${title}” from GitHub Pages?\n\n` +
      "It will be archived to your Local blog first, then deleted from the Pages repo and its posts.json index.\n\n" +
      "The studio will show the Git commands to publish the removal. It will not run Git or a build."
  );
  if (!ok) return;

  if (!(await flushDirty())) return;

  try {
    const data = await postJson("/api/workspace/remove", { id: state.meta.id });
    await refreshList();

    if (data.archive?.slug) {
      try {
        await openPost(data.archive.slug, "local");
      } catch (err) {
        showBanner("error", `<strong>Archived, but the local copy could not be opened.</strong> ${escapeHtml(err.message)}`);
      }
    }
    showRemoveResult(data);
    showRemovalBanner();
    toast("Archived to the Local blog");
  } catch (err) {
    await refreshList().catch(() => {});
    if (err.data?.archive) {
      showBanner(
        "error",
        `<strong>Archived locally, but not removed from Pages.</strong> ${escapeHtml(err.message)} The copy is in the Local blog.`
      );
    } else {
      showBanner("error", `<strong>Could not remove the post.</strong> ${escapeHtml(err.message)}`);
    }
  }
}

/* --- private note deletion --------------------------------- */

async function removeNote(notePath) {
  const note = state.notes.notes.find((candidate) => candidate.path === notePath);
  const label = note?.title || notePath;
  const ok = confirm(`Delete “${label}”?\n\nThis permanently removes the Markdown file from data/notes.`);
  if (!ok) return;

  try {
    await postJson("/api/notes/delete", { path: notePath });
    const wasOpen = state.source === "note" && state.meta?.path === notePath;
    if (wasOpen) resetEditor(null, null);
    await refreshList();
    toast("Private note deleted");
  } catch (err) {
    showBanner("error", `<strong>Could not delete the note.</strong> ${escapeHtml(err.message)}`);
  }
}

async function removeFolder(folder) {
  const prefix = `${folder}/`;
  const count = state.notes.notes.filter(
    (note) => note.path === folder || note.path.startsWith(prefix)
  ).length;
  const name = folder.split("/").filter(Boolean).pop() || folder;
  const ok = confirm(
    `Delete the folder “${name}”${count ? ` and its ${count} note${count === 1 ? "" : "s"}` : ""}?\n\nThis permanently removes them from data/notes.`
  );
  if (!ok) return;

  try {
    await postJson("/api/notes/folder/delete", { folder });
    const wasOpen =
      state.source === "note" &&
      (state.meta?.path === folder || state.meta?.path?.startsWith(prefix));
    if (wasOpen) resetEditor(null, null);
    state.collapsedFolders.delete(folder);
    persistCollapsed();
    await refreshList();
    toast("Folder deleted");
  } catch (err) {
    showBanner("error", `<strong>Could not delete the folder.</strong> ${escapeHtml(err.message)}`);
  }
}

async function removeOpenNote() {
  if (state.source === "note" && state.meta?.path) await removeNote(state.meta.path);
}

/* --- chrome ------------------------------------------------ */

function resetEditor(sectionId = null, source = state.source || null) {
  state.source = source;
  state.meta = null;
  state.legacy = false;
  state.tex = false;
  state.dirty = false;
  state.slugLocked = false;
  state.words = 0;
  state.minutes = 1;

  if (source === "site" && state.workspace) {
    state.targetSection =
      sectionId ||
      state.targetSection ||
      state.siteSections[0]?.id ||
      state.workspace.sections?.[0]?.id ||
      null;
  } else if (source !== "site") {
    state.targetSection = null;
  }

  el.title.value = "";
  el.slug.value = "";
  el.slug.disabled = false;
  el.slugLocked = false;
  el.date.value = todayISO();
  el.date.disabled = false;
  el.desc.value = "";
  el.desc.disabled = false;
  el.editor.value = "";
  el.editor.disabled = false;
  el.toolbar.hidden = false;
  el.saveBtn.disabled = false;
  el.publishBtn.disabled = false;
  el.preview.removeAttribute("src");
  el.preview.removeAttribute("srcdoc");
  state.previewStale = false;
  updatePreviewChrome();
  clearLinkSuggestion();

  hideBanner();
  el.modeDraw.disabled = false;
  el.modeDraw.title = "Draw diagrams — the editable scene stays in this browser";
  el.modeSplit.disabled = false;
  el.modeSplit.title = "Split write and draw side by side";
  canvasStudio.setSlug(null, { reset: true });
  if (state.mode !== "write") setMode("write");

  updateChrome();
  markClean();
  renderList();
  el.title.focus({ preventScroll: true });
}

async function startNewNote(folder = "") {
  await flushDirty();
  openNoteModal({ mode: "note", folder });
}

async function startNewLocalPost() {
  await flushDirty();
  resetEditor(null, "local");
}

async function startNewSitePost() {
  await flushDirty();
  if (!state.workspace) return toast("Connect a GitHub Pages site first");
  const sections = state.siteSections.length ? state.siteSections : state.workspace.sections || [];
  if (!sections.length) return toast("No writing sections are connected");
  if (sections.length > 1) {
    openSectionPicker();
    return;
  }
  resetEditor(sections[0].id, "site");
}

el.newPost.addEventListener("click", () => startNewNote(""));

el.saveBtn.addEventListener("click", () => save());

el.publishBtn.addEventListener("click", publish);

el.unpublishBtn.addEventListener("click", unpublish);

el.deleteBtn.addEventListener("click", () => {
  if (state.source === "note") removeOpenNote();
  else if (state.source === "site") removeSitePost();
  else remove();
});

el.removeClose.addEventListener("click", closeRemoveModal);
el.removeDoneBtn.addEventListener("click", closeRemoveModal);
el.removeCopyBtn.addEventListener("click", () => copy((state.removal?.commands || []).join("\n")));
el.removeOpenBtn.addEventListener("click", openRemovalCopy);
el.removeModal.addEventListener("click", (event) => {
  if (event.target === el.removeModal) closeRemoveModal();
});

function openMenu() {
  el.menu.hidden = false;
  el.menuBtn.setAttribute("aria-expanded", "true");
}
function closeMenu() {
  el.menu.hidden = true;
  el.menuBtn.setAttribute("aria-expanded", "false");
}
el.menuBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  el.menu.hidden ? openMenu() : closeMenu();
});
document.addEventListener("click", (event) => {
  if (!el.menu.contains(event.target) && event.target !== el.menuBtn) closeMenu();
});

function setPreview(on, { render = true } = {}) {
  /* Preview belongs to the normal workspace layout. Asking for it while
     focused exits fullscreen and restores the saved rail/preview state. */
  if (on && state.focusOn) exitFocusMode();

  /* Splitting only makes sense with the preview out of the way; opening
     the preview collapses back to the editor. */
  if (on && state.mode === "split") setMode("write");
  state.previewOn = on;
  el.panes.classList.toggle("no-preview", !on);
  el.modeSplit.hidden = on;
  el.toggleSplit.classList.toggle("is-on", on);
  el.toggleSplit.setAttribute("aria-pressed", String(on));
  const label = on ? "Hide preview" : "Show preview";
  el.toggleSplit.title = label;
  el.toggleSplit.setAttribute("aria-label", label);
  if (on && render) renderPreview();
}

el.toggleSplit.addEventListener("click", () => setPreview(!state.previewOn));

const RAIL_KEY = "writing-studio:rail-hidden";

function setRail(on, { persist = true } = {}) {
  state.railOn = on;
  el.app.classList.toggle("rail-hidden", !on);
  el.toggleRail.setAttribute("aria-expanded", String(on));
  const label = on ? "Hide sidebar" : "Show sidebar";
  el.toggleRail.title = label;
  el.toggleRail.setAttribute("aria-label", label);
  if (!persist) return;
  try {
    localStorage.setItem(RAIL_KEY, on ? "0" : "1");
  } catch {}
}

el.toggleRail.addEventListener("click", () => setRail(!state.railOn));

/* --- fullscreen / focus mode ------------------------------- */

function syncFocusChrome() {
  const on = state.focusOn;
  el.focusModeBtn.setAttribute("aria-pressed", String(on));
  el.focusModeBtn.setAttribute("aria-label", on ? "Exit fullscreen" : "Enter fullscreen");
  el.focusModeBtn.title = on
    ? "Exit fullscreen"
    : "Fullscreen — hide the sidebar, preview and top bar";
  el.focusModeLabel.textContent = on ? "Exit full" : "Fullscreen";
}

function enterFocusMode() {
  if (state.focusOn) return;

  /* Remember the workspace the user had before fullscreen. */
  state.focusReturn = { railOn: state.railOn, previewOn: state.previewOn };
  state.focusOn = true;

  /* Fullscreen is for writing or drawing: put both panels away without
     changing the saved rail preference. */
  setRail(false, { persist: false });
  if (state.previewOn) setPreview(false, { render: false });

  el.app.classList.add("focus-mode");
  syncFocusChrome();
}

function exitFocusMode() {
  if (!state.focusOn) return;

  const saved = state.focusReturn;
  state.focusOn = false;
  state.focusReturn = null;
  el.app.classList.remove("focus-mode");
  syncFocusChrome();

  /* Restore the exact layout the user had before entering fullscreen.
     A split view deliberately has no preview, so keep it intact if the
     user switched to Split while focused. */
  if (saved) {
    setRail(saved.railOn, { persist: false });
    if (saved.previewOn && state.mode !== "split") setPreview(true, { render: false });
  }
}

el.focusModeBtn.addEventListener("click", () => {
  state.focusOn ? exitFocusMode() : enterFocusMode();
});

window.addEventListener("resize", () => {
  if (state.mode === "split" && window.innerWidth <= 760) setMode("write");
});

el.copyPush.addEventListener("click", () => {
  if (state.workspace) return;
  copy(`git add -A && git commit -m "writing update" && git push origin ${state.git?.branch || "main"}`);
});

document.addEventListener("keydown", (event) => {
  /* Typing (or saving) while the link prompt is up keeps the pasted URL. */
  if (pendingLink) resolvePendingLink("plain");

  const mod = event.metaKey || event.ctrlKey;
  if (mod && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
  }
  /* Overleaf's compile shortcut. */
  if (mod && event.key === "Enter") {
    event.preventDefault();
    if (!state.previewOn) setPreview(true, { render: false });
    renderPreview();
  }
  if (event.key === "Escape") {
    closeMenu();
    if (!el.noteModal.hidden) closeNoteModal();
    else if (!el.sectionModal.hidden) closeSectionPicker();
    else if (!el.siteModal.hidden) closeSiteModal();
    else if (!el.removeModal.hidden) closeRemoveModal();
    else if (!el.aiModal.hidden) closeAiModal();
  }
  if (!mod || document.activeElement !== el.editor) return;
  const key = event.key.toLowerCase();
  if (key === "b" || key === "i" || key === "k") {
    event.preventDefault();
    commands[{ b: "bold", i: "italic", k: "link" }[key]]();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

/* --- theme ------------------------------------------------- */

function applyTheme(name, persist = true) {
  document.documentElement.setAttribute("data-theme", name);
  if (persist) {
    try { localStorage.setItem("theme", name); } catch (e) {}
  }
  try {
    if (el.preview?.contentDocument) {
      el.preview.contentDocument.documentElement.setAttribute("data-theme", name);
    }
  } catch (e) {}
  window.dispatchEvent(new CustomEvent("themechange", { detail: name }));
}

function initTheme() {
  let saved = "light";
  try {
    saved = localStorage.getItem("theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch (e) {}
  applyTheme(saved, false);

  if (el.themeToggle) {
    el.themeToggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next, true);
    });
  }
}

/* --- AI Assistant Configuration --------------------------- */

const AI_CONFIG_KEY = "writing-studio:ai-config";

const AI_PROVIDERS = {
  google: {
    name: "Google AI Studio",
    models: [
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (Latest, Recommended)" },
      { id: "gemini-3.8-pro", name: "Gemini 3.8 Pro (Latest Deep Reasoning)" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
    ],
    hint: 'Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio ↗</a>',
    placeholder: "AIzaSy…",
    isFreeTier: true,
  },
  openrouter: {
    name: "OpenRouter",
    models: [
      { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash (Latest)" },
      { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet (Latest)" },
      { id: "meta-llama/llama-3.3-70b-instruct:free", name: "Llama 3.3 70B (Free)" },
      { id: "deepseek/deepseek-chat:free", name: "DeepSeek V3 (Free)" },
      { id: "qwen/qwen-2.5-72b-instruct:free", name: "Qwen 2.5 72B (Free)" },
      { id: "openai/gpt-4o", name: "GPT-4o" },
    ],
    hint: 'Free community models & top paid models at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">OpenRouter ↗</a>',
    placeholder: "sk-or-v1-…",
    isFreeTier: true,
  },
  groq: {
    name: "Groq",
    models: [
      { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B (Vision, Preview)" },
      { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Fast & Strong)" },
      { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B (Fastest)" },
    ],
    hint: 'Free API key from <a href="https://console.groq.com/keys" target="_blank" rel="noopener">Groq Console ↗</a>',
    placeholder: "gsk_…",
    isFreeTier: true,
  },
  openai: {
    name: "OpenAI",
    models: [
      { id: "gpt-4o-mini", name: "GPT-4o Mini (Fast & Cheap)" },
      { id: "gpt-4o", name: "GPT-4o (High Accuracy Multimodal)" },
      { id: "o3-mini", name: "o3-mini (Reasoning)" },
      { id: "o1", name: "o1 (Full Reasoning)" },
    ],
    hint: 'Paid API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI ↗</a>',
    placeholder: "sk-proj-…",
    isFreeTier: false,
  },
  anthropic: {
    name: "Anthropic",
    models: [
      { id: "claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet (Latest)" },
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku (Fast & Clean)" },
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet" },
    ],
    hint: 'Paid API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic ↗</a>',
    placeholder: "sk-ant-…",
    isFreeTier: false,
  },
};

function getAiConfig() {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      // Automatically migrate deprecated 2.0 models to 3.8 flash
      if (cfg.provider === "google" && (!cfg.model || cfg.model.startsWith("gemini-2.0"))) {
        cfg.model = "gemini-3.8-flash";
        saveAiConfig(cfg);
      }
      return cfg;
    }
  } catch {}
  return { provider: "google", apiKey: "", model: "gemini-3.8-flash", baseUrl: "" };
}

function saveAiConfig(cfg) {
  try {
    localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(cfg));
  } catch {}
  updateAiStatus();
}

function updateAiStatus() {
  const cfg = getAiConfig();
  const indicator = $("aiStatusIndicator");
  const hasKey = !!cfg.apiKey?.trim();
  if (indicator) {
    indicator.classList.toggle("is-configured", hasKey);
    indicator.title = hasKey
      ? `AI active (${AI_PROVIDERS[cfg.provider]?.name || cfg.provider} · ${cfg.model})`
      : "AI not configured";
  }
}

function openAiModal() {
  const modal = $("aiModal");
  if (!modal) return;
  modal.hidden = false;

  const cfg = getAiConfig();
  const providerCards = document.querySelectorAll(".ai-provider-card");
  const radio = document.querySelector(`input[name="aiProvider"][value="${cfg.provider}"]`);
  if (radio) radio.checked = true;

  providerCards.forEach((c) => {
    c.classList.toggle("is-selected", c.dataset.provider === cfg.provider);
  });

  updateModelOptions(cfg.provider, cfg.model);

  const keyInput = $("aiApiKey");
  if (keyInput) keyInput.value = cfg.apiKey || "";

  const baseUrlInput = $("aiBaseUrl");
  if (baseUrlInput) baseUrlInput.value = cfg.baseUrl || "";

  const resultBox = $("aiTestResult");
  if (resultBox) {
    resultBox.hidden = true;
    resultBox.textContent = "";
  }
}

function closeAiModal() {
  const modal = $("aiModal");
  if (modal) modal.hidden = true;
}

function updateModelOptions(providerKey, selectedModel) {
  const provider = AI_PROVIDERS[providerKey] || AI_PROVIDERS.google;
  const select = $("aiModelSelect");
  const customInput = $("aiCustomModelInput");
  const hint = $("aiKeyHint");
  const keyInput = $("aiApiKey");

  if (select) {
    const isKnown = provider.models.some((m) => m.id === selectedModel);
    let options = provider.models
      .map((m) => `<option value="${m.id}" ${m.id === selectedModel ? "selected" : ""}>${m.name}</option>`)
      .join("");

    if (selectedModel && !isKnown && selectedModel !== "__custom__") {
      options += `<option value="${escapeHtml(selectedModel)}" selected>${escapeHtml(selectedModel)} (Custom)</option>`;
    }
    options += `<option value="__custom__">+ Enter custom model ID…</option>`;
    select.innerHTML = options;

    if (customInput) {
      if (selectedModel && !isKnown) {
        customInput.hidden = false;
        customInput.value = selectedModel;
      } else {
        customInput.hidden = select.value !== "__custom__";
        if (select.value === "__custom__") customInput.value = "";
      }
    }
  }
  if (hint) hint.innerHTML = provider.hint;
  if (keyInput) keyInput.placeholder = provider.placeholder;
}

function getSelectedAiModel() {
  const select = $("aiModelSelect");
  const customInput = $("aiCustomModelInput");
  const custom = customInput?.value?.trim();
  /* A previously saved custom model is shown as its own option with the
     custom input visible, so an edit there must win over the select value. */
  if (custom && (!customInput.hidden || select?.value === "__custom__")) return custom;
  if (select?.value === "__custom__") return "gemini-3.8-flash";
  return select?.value || "gemini-3.8-flash";
}

function initAiSettings() {
  const aiBtn = $("aiBtn");
  const closeBtn = $("aiModalClose");
  const testBtn = $("aiTestBtn");
  const saveBtn = $("aiSaveBtn");
  const keyVisBtn = $("aiToggleKeyVis");
  const providerCards = document.querySelectorAll(".ai-provider-card");
  const modelSelect = $("aiModelSelect");
  const customModelInput = $("aiCustomModelInput");

  updateAiStatus();

  if (aiBtn) aiBtn.addEventListener("click", openAiModal);
  if (closeBtn) closeBtn.addEventListener("click", closeAiModal);

  const modal = $("aiModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeAiModal();
    });
  }

  if (modelSelect) {
    modelSelect.addEventListener("change", () => {
      if (customModelInput) {
        customModelInput.hidden = modelSelect.value !== "__custom__";
        if (modelSelect.value === "__custom__") customModelInput.focus();
      }
    });
  }

  providerCards.forEach((card) => {
    card.addEventListener("click", () => {
      providerCards.forEach((c) => c.classList.remove("is-selected"));
      card.classList.add("is-selected");
      const provider = card.dataset.provider;
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      updateModelOptions(provider);
    });
  });

  if (keyVisBtn) {
    keyVisBtn.addEventListener("click", () => {
      const input = $("aiApiKey");
      if (input) input.type = input.type === "password" ? "text" : "password";
    });
  }

  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      const provider = document.querySelector('input[name="aiProvider"]:checked')?.value || "google";
      const model = getSelectedAiModel();
      const apiKey = $("aiApiKey")?.value?.trim() || "";
      const baseUrl = $("aiBaseUrl")?.value?.trim() || "";
      const resultBox = $("aiTestResult");

      if (!apiKey) {
        if (resultBox) {
          resultBox.hidden = false;
          resultBox.className = "ai-test-result is-error";
          resultBox.textContent = "Please enter an API key first.";
        }
        return;
      }

      testBtn.disabled = true;
      testBtn.textContent = "Testing…";
      if (resultBox) resultBox.hidden = true;

      try {
        const res = await fetch("/api/ai/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, model, apiKey, baseUrl }),
        });
        const data = await res.json();
        testBtn.disabled = false;
        testBtn.textContent = "Test connection";

        if (resultBox) {
          resultBox.hidden = false;
          if (res.ok && data.ok) {
            resultBox.className = "ai-test-result is-success";
            resultBox.textContent = `✓ Connected to ${AI_PROVIDERS[provider]?.name || provider} (${data.model}) successfully!`;
          } else {
            resultBox.className = "ai-test-result is-error";
            resultBox.textContent = `✕ Connection failed: ${data.error || "Unknown error"}`;
          }
        }
      } catch (err) {
        testBtn.disabled = false;
        testBtn.textContent = "Test connection";
        if (resultBox) {
          resultBox.hidden = false;
          resultBox.className = "ai-test-result is-error";
          resultBox.textContent = `✕ Connection error: ${err.message}`;
        }
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const provider = document.querySelector('input[name="aiProvider"]:checked')?.value || "google";
      const model = getSelectedAiModel();
      const apiKey = $("aiApiKey")?.value?.trim() || "";
      const baseUrl = $("aiBaseUrl")?.value?.trim() || "";

      saveAiConfig({ provider, model, apiKey, baseUrl });
      toast(apiKey ? `AI configured with ${AI_PROVIDERS[provider]?.name || provider} (${model})` : "AI settings updated");
      closeAiModal();
    });
  }
}

/* --- private notes ----------------------------------------- */

function noteError(message = "") {
  el.noteError.hidden = !message;
  el.noteError.textContent = message;
}

function folderOptions(selected = "") {
  const folders = [...(state.notes.folders || [])].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { sensitivity: "base" })
  );
  const options = [`<option value="">Private notes (root)</option>`];
  for (const folder of folders) {
    const depth = folder.path.split("/").filter(Boolean).length - 1;
    const indent = "\u00a0\u00a0".repeat(Math.max(0, depth));
    options.push(
      `<option value="${escapeHtml(folder.path)}"${folder.path === selected ? " selected" : ""}>${indent}${escapeHtml(folder.name)}</option>`
    );
  }
  return options.join("");
}

function folderDiskPath(folder = "") {
  return folder ? `data/notes/${folder}` : "data/notes";
}

function updateNoteFolderLabels() {
  const folder = el.noteFolder.value;
  el.noteFolderPath.textContent = folderDiskPath(folder);
  el.noteFolderInlineHint.textContent = `Inside ${folderDiskPath(folder)}`;
  el.noteFolderNew.textContent = folder ? "New subfolder" : "New folder";
  el.noteFolderNew.title = folder
    ? `Create a subfolder inside ${folderDiskPath(folder)}`
    : "Create a folder in data/notes";
}

function resetInlineFolder() {
  el.noteFolderInline.hidden = true;
  el.noteFolderName.value = "";
}

function showInlineFolder() {
  el.noteFolderInline.hidden = false;
  noteError("");
  updateNoteFolderLabels();
  el.noteFolderName.focus();
}

async function createInlineFolder() {
  const name = el.noteFolderName.value.trim();
  if (!name) {
    noteError("Give the folder a name.");
    el.noteFolderName.focus();
    return;
  }

  const parent = el.noteFolder.value;
  el.noteFolderCreate.disabled = true;
  noteError("");
  try {
    const data = await postJson("/api/notes/folder", { parent, name });
    if (data.parent && state.collapsedFolders.has(data.parent)) {
      state.collapsedFolders.delete(data.parent);
      persistCollapsed();
    }
    await refreshList();
    el.noteFolder.innerHTML = folderOptions(data.path);
    el.noteFolder.value = data.path;
    resetInlineFolder();
    updateNoteFolderLabels();
    el.noteTitle.focus();
    toast(`Private folder “${data.name}” created`);
  } catch (err) {
    noteError(err.message);
  } finally {
    el.noteFolderCreate.disabled = false;
  }
}

function openNoteModal({ mode = "note", folder = "" } = {}) {
  state.noteModalMode = mode === "folder" ? "folder" : "note";
  state.noteDraftFolder = folder || "";
  const isNote = state.noteModalMode === "note";

  el.noteCreateFields.hidden = !isNote;
  el.folderCreateFields.hidden = isNote;
  el.noteModalTitle.textContent = isNote ? "New private note" : "New folder";
  el.noteCreateBtn.textContent = isNote ? "Create note" : "Create folder";
  el.noteCreateBtn.disabled = false;
  el.noteTitle.value = "";
  el.folderName.value = "";
  resetInlineFolder();
  el.noteFolder.innerHTML = folderOptions(state.noteDraftFolder);
  el.folderParent.innerHTML = folderOptions(state.noteDraftFolder);
  el.noteFolder.value = state.noteDraftFolder;
  el.folderParent.value = state.noteDraftFolder;
  updateNoteFolderLabels();
  noteError("");
  el.noteModal.hidden = false;
  setTimeout(() => (isNote ? el.noteTitle : el.folderName).focus(), 40);
}

function closeNoteModal() {
  el.noteModal.hidden = true;
  resetInlineFolder();
  noteError("");
}

async function createNoteFromModal() {
  if (state.noteModalMode === "folder") return createFolderFromModal();

  el.noteCreateBtn.disabled = true;
  noteError("");
  try {
    const data = await postJson("/api/notes/create", {
      folder: el.noteFolder.value,
      title: el.noteTitle.value.trim(),
    });
    await refreshList();
    await openPost(data.meta.path, "note");
    closeNoteModal();
    toast("Private note created");
  } catch (err) {
    noteError(err.message);
  } finally {
    el.noteCreateBtn.disabled = false;
  }
}

async function createFolderFromModal() {
  const name = el.folderName.value.trim();
  if (!name) {
    noteError("Give the folder a name.");
    el.folderName.focus();
    return;
  }

  el.noteCreateBtn.disabled = true;
  noteError("");
  try {
    const data = await postJson("/api/notes/folder", {
      parent: el.folderParent.value,
      name,
    });
    if (data.parent && state.collapsedFolders.has(data.parent)) {
      state.collapsedFolders.delete(data.parent);
      persistCollapsed();
    }
    await refreshList();
    closeNoteModal();
    toast(`Folder “${data.name}” created`);
  } catch (err) {
    noteError(err.message);
  } finally {
    el.noteCreateBtn.disabled = false;
  }
}

function initNoteModal() {
  el.noteModalClose.addEventListener("click", closeNoteModal);
  el.noteModalCancel.addEventListener("click", closeNoteModal);
  el.noteCreateBtn.addEventListener("click", createNoteFromModal);
  el.noteFolder.addEventListener("change", updateNoteFolderLabels);
  el.noteFolderNew.addEventListener("click", showInlineFolder);
  el.noteFolderCreate.addEventListener("click", createInlineFolder);
  el.noteFolderCancel.addEventListener("click", () => {
    resetInlineFolder();
    noteError("");
    el.noteFolderNew.focus();
  });
  el.noteFolderName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createInlineFolder();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      resetInlineFolder();
      noteError("");
      el.noteFolderNew.focus();
    }
  });
  el.noteModal.addEventListener("click", (event) => {
    if (event.target === el.noteModal) closeNoteModal();
  });
  for (const input of [el.noteTitle, el.folderName]) {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      createNoteFromModal();
    });
  }
}

/* --- GitHub Pages connection ------------------------------- */

function siteError(message = "") {
  el.siteError.hidden = !message;
  el.siteError.textContent = message;
}

function setSiteBusy(busy, label = "") {
  state.siteBusy = busy;
  el.siteNextBtn.disabled = busy;
  el.siteBackBtn.disabled = busy;
  el.siteAddFolderBtn.disabled = busy;
  el.siteResumeBtn.disabled = busy || state.savedWorkspace?.repoExists === false;
  if (busy) el.siteNextBtn.textContent = label || "Working…";
  else syncSiteFooter();
}

function syncSiteFooter() {
  if (state.siteMode !== "wizard") return;
  const step = state.siteStep;
  el.siteBackBtn.hidden = step === 1;
  el.siteNextBtn.textContent = step === 1 ? "Scan repository" : step === 2 ? "Review & connect" : "Connect this site";
  el.siteFootNote.textContent = step === 1
    ? "Nothing is written until you connect."
    : step === 2
      ? "Only checked folders become writing sections."
      : "Git stays manual — the studio only saves files.";
}

function showSiteStep(step) {
  state.siteStep = step;
  document.querySelectorAll("[data-site-step]").forEach((panel) => {
    panel.hidden = Number(panel.dataset.siteStep) !== step;
  });
  document.querySelectorAll("[data-site-dot]").forEach((dot) => {
    const n = Number(dot.dataset.siteDot);
    dot.classList.toggle("is-active", n === step);
    dot.classList.toggle("is-done", n < step);
  });
  syncSiteFooter();
}

function openSiteWizard({ prefill = false, resume = true } = {}) {
  state.siteMode = "wizard";
  state.siteStep = 1;
  state.siteScan = null;
  state.siteSelected = new Set();
  el.siteWizard.hidden = false;
  el.siteManage.hidden = true;
  el.siteProgress.hidden = false;
  el.siteWizardFoot.hidden = false;
  el.siteManageFoot.hidden = true;
  el.siteModalKicker.textContent = "Local writing";
  el.siteModalTitle.textContent = "Connect to GitHub Pages";
  el.siteModal.hidden = false;
  siteError("");

  const saved = state.workspace || state.savedWorkspace;
  const showResume = resume && !state.workspace && !!state.savedWorkspace;
  el.siteResume.hidden = !showResume;
  el.siteResumeOr.hidden = !showResume;
  if (showResume) {
    const missing = state.savedWorkspace.repoExists === false;
    el.siteResumeName.textContent = state.savedWorkspace.repoName || "Saved site";
    el.siteResumePath.textContent = state.savedWorkspace.repoRoot || "";
    el.siteResumeNote.textContent = missing
      ? "That folder is missing. Update the path below, or scan another site."
      : "";
    el.siteResumeBtn.disabled = missing;
    el.siteResumeBtn.title = missing
      ? "The saved site folder no longer exists"
      : "Reconnect without scanning again";
  } else {
    el.siteResumeBtn.disabled = false;
    el.siteResumeNote.textContent = "";
  }

  if (saved && (prefill || showResume)) {
    el.siteRepoPath.value = saved.repoRoot || "";
    el.siteGenerator.value = saved.generator || "auto";
    el.sitePublicUrl.value = saved.siteUrl || "";
  }
  el.siteSectionList.innerHTML = "";
  showSiteStep(1);
  setTimeout(() => el.siteRepoPath.focus(), 40);
}

function closeSiteModal() {
  if (state.siteBusy) return;
  el.siteModal.hidden = true;
  siteError("");
}

function openSectionPicker() {
  const sections = state.siteSections.length ? state.siteSections : state.workspace?.sections || [];
  if (!sections.length) return;
  el.sectionChoices.innerHTML = sections
    .map((section) => {
      const count = state.sitePosts.filter((post) => post.sectionId === section.id).length;
      return `
        <button class="section-choice" type="button" data-section-id="${escapeHtml(section.id)}">
          <span>
            <strong>${escapeHtml(section.name)}</strong>
            <small>${escapeHtml(section.root === "." ? "top-level pages" : section.root)}</small>
          </span>
          <em>${count} existing</em>
        </button>`;
    })
    .join("");
  el.sectionModal.hidden = false;
}

function closeSectionPicker() {
  el.sectionModal.hidden = true;
}

function renderSiteScan() {
  const scan = state.siteScan;
  if (!scan) return;

  const warnings = scan.warnings || [];
  el.siteScanWarnings.hidden = !warnings.length;
  el.siteScanWarnings.innerHTML = warnings
    .map((warning) => `<p>${escapeHtml(warning)}</p>`)
    .join("");

  el.siteScanSummary.innerHTML = `
    <div class="site-summary-top">
      <div>
        <strong>${escapeHtml(scan.repoName)}</strong>
        <span title="${escapeHtml(scan.repoRoot)}">${escapeHtml(scan.repoRoot)}</span>
      </div>
      <span class="site-pill">${escapeHtml(scan.generatorLabel)}</span>
    </div>
    <div class="site-summary-stats">
      <span>${scan.filesScanned} writing files scanned</span>
      <span>${scan.sections.length} writing folder${scan.sections.length === 1 ? "" : "s"} found</span>
      ${scan.siteUrl ? `<span>${escapeHtml(scan.siteUrl)}</span>` : "<span>No public URL detected</span>"}
    </div>`;

  renderSiteSections();
}

function renderSiteSections() {
  const scan = state.siteScan;
  if (!scan) return;
  const selected = state.siteSelected || new Set();

  el.siteSectionList.innerHTML = scan.sections
    .map((section) => {
      const checked = selected.has(section.id);
      const samples = (section.samples || []).slice(0, 2).map((sample) => `“${sample.title}”`).join(" · ");
      const kind = section.kind === "pages" ? "site pages" : section.kind === "drafts" ? "drafts" : "writing";
      const formats = (section.formats?.length ? section.formats : [section.format])
        .map((ext) => ext.replace(".", "").toUpperCase())
        .join(" + ");
      return `
        <div class="site-section ${checked ? "" : "is-off"}" data-site-id="${escapeHtml(section.id)}">
          <input class="site-section-check" type="checkbox" data-site-check ${checked ? "checked" : ""} aria-label="Include ${escapeHtml(section.name)}">
          <div class="site-section-main">
            <div class="site-section-title-row">
              <input class="site-section-name" data-site-name value="${escapeHtml(section.name)}" aria-label="Section name" spellcheck="false">
              <span class="site-section-kind">${kind}</span>
              <span class="site-section-badge">${escapeHtml(formats)}</span>
            </div>
            <span class="site-section-path">${escapeHtml(section.root === "." ? "site root — top-level pages" : section.root)}</span>
            <span class="site-section-reason">${escapeHtml(section.reason || "")}</span>
            ${samples ? `<span class="site-section-samples">${escapeHtml(samples)}</span>` : ""}
          </div>
        </div>`;
    })
    .join("");

  updateSiteSectionCount();
}

function updateSiteSectionCount() {
  const n = state.siteSelected?.size || 0;
  el.siteSectionCount.textContent = `${n} selected`;
}

function selectedSiteSections() {
  if (!state.siteScan) return [];
  return state.siteScan.sections
    .filter((section) => state.siteSelected.has(section.id))
    .map((section) => ({
      id: section.id,
      name: String(section.name || "").trim() || "Writing",
      root: section.root,
      kind: section.kind,
      format: section.format,
      formats: section.formats,
      defaultInclude: section.defaultInclude,
      directOnly: section.directOnly,
      nestedHtml: section.nestedHtml,
      datePrefix: section.datePrefix,
      route: section.route,
    }));
}

async function scanSiteFromWizard() {
  const repoRoot = el.siteRepoPath.value.trim();
  if (!repoRoot) {
    siteError("Enter the folder where your GitHub Pages site lives.");
    el.siteRepoPath.focus();
    return;
  }
  siteError("");
  setSiteBusy(true, "Scanning…");
  try {
    const data = await postJson("/api/workspace/scan", {
      repoRoot,
      generator: el.siteGenerator.value,
      siteUrl: el.sitePublicUrl.value.trim(),
    });
    state.siteScan = data.scan;
    if (!el.sitePublicUrl.value.trim() && data.scan.siteUrl) {
      el.sitePublicUrl.value = data.scan.siteUrl;
    }
    state.siteSelected = new Set(
      data.scan.sections.filter((section) => section.defaultInclude).map((section) => section.id)
    );
    if (!state.siteSelected.size && data.scan.sections.length) {
      state.siteSelected.add(data.scan.sections[0].id);
    }
    renderSiteScan();
    showSiteStep(2);
  } catch (err) {
    siteError(err.message);
  } finally {
    setSiteBusy(false);
  }
}

function renderSiteReview() {
  const scan = state.siteScan;
  const sections = selectedSiteSections();
  const files = sections.reduce((sum, section) => {
    const original = scan.sections.find((candidate) => candidate.id === section.id);
    return sum + (original?.count || 0);
  }, 0);
  const fm = scan.frontmatter || {};

  el.siteReviewSummary.innerHTML = `
    <div class="site-review-cell"><span>Site</span><strong>${escapeHtml(scan.repoName)}</strong></div>
    <div class="site-review-cell"><span>Generator</span><strong>${escapeHtml(scan.generatorLabel)}</strong></div>
    <div class="site-review-cell"><span>Writing sections</span><strong>${sections.length}</strong></div>
    <div class="site-review-cell"><span>Writing files</span><strong>${files}</strong></div>
    <div class="site-review-cell"><span>Public URL</span><strong>${escapeHtml(el.sitePublicUrl.value.trim() || "Not set")}</strong></div>
    <div class="site-review-cell"><span>Images</span><strong>${escapeHtml(scan.asset?.url || "/")}</strong></div>`;

  const supportsDraft = !!(fm.draft || fm.published || scan.draftFolder);
  const hasIndex = scan.sections.some((section) => section.indexed);
  el.siteNewDraft.disabled = !supportsDraft;
  el.siteNewDraft.value = scan.defaultDraft ? "draft" : "published";
  el.siteDraftHint.textContent = supportsDraft
    ? fm.draft
      ? `New drafts will use \`${fm.draft}: true\` in the frontmatter.`
      : fm.published
        ? `New drafts will use \`${fm.published}: false\` in the frontmatter.`
        : `New drafts will be placed in \`${scan.draftFolder}\`.`
    : hasIndex
      ? "New posts are added to the section's posts.json index as published. Set `draft: true` there to hide one."
      : "This site has no detected draft convention. New posts will be saved as ordinary files.";

  const conventionBits = [];
  conventionBits.push(`<p>Title from <code>${escapeHtml(fm.title || "title")}</code> · date from <code>${escapeHtml(fm.date || "date")}</code>.</p>`);
  if (fm.description) conventionBits.push(`<p>Description from <code>${escapeHtml(fm.description)}</code>.</p>`);
  if (fm.draft) conventionBits.push(`<p>Draft field: <code>${escapeHtml(fm.draft)}: true</code>.</p>`);
  else if (fm.published) conventionBits.push(`<p>Published field: <code>${escapeHtml(fm.published)}: false</code> for drafts.</p>`);
  if (scan.draftFolder) conventionBits.push(`<p>Draft folder detected: <code>${escapeHtml(scan.draftFolder)}</code>.</p>`);
  conventionBits.push(`<p>New images go under <code>${escapeHtml(scan.asset?.dir || "assets")}/writing-studio/</code> and use <code>${escapeHtml(scan.asset?.url || "/")}</code>.</p>`);
  el.siteConventions.innerHTML = conventionBits.join("");
}

async function connectSiteFromWizard() {
  const scan = state.siteScan;
  const sections = selectedSiteSections();
  if (!scan) return;
  if (!sections.length) {
    siteError("Select at least one writing section.");
    return;
  }

  if (!(await flushDirty())) return;

  siteError("");
  setSiteBusy(true, "Connecting…");
  try {
    const supportsDraft = !!(scan.frontmatter?.draft || scan.frontmatter?.published || scan.draftFolder);
    const data = await postJson("/api/workspace/connect", {
      repoRoot: scan.repoRoot,
      repoName: scan.repoName,
      generator: scan.generator,
      siteUrl: el.sitePublicUrl.value.trim(),
      sections,
      frontmatter: scan.frontmatter,
      draftFolder: scan.draftFolder,
      defaultDraftMode: scan.defaultDraftMode,
      defaultDraft: supportsDraft ? el.siteNewDraft.value === "draft" : false,
      asset: scan.asset,
      permalink: scan.permalink,
    });
    await enterWorkspace(data.workspace);
    state.siteBusy = false;
    el.siteNextBtn.disabled = false;
    closeSiteModal();
    toast(`Connected to ${data.workspace.repoName}`);
  } catch (err) {
    siteError(err.message);
  } finally {
    setSiteBusy(false);
  }
}

async function resumeSavedWorkspace() {
  if (!state.savedWorkspace) return;
  if (state.savedWorkspace.repoExists === false) {
    siteError("That site folder is missing. Update the path below and scan again.");
    return;
  }

  if (!(await flushDirty())) return;

  siteError("");
  setSiteBusy(true, "Reconnecting…");
  try {
    const data = await api("/api/workspace");
    if (!data.workspace) throw new Error("The saved site is no longer available. Scan the folder again.");
    if (data.workspace.repoExists === false) {
      throw new Error("That site folder is missing. Update the path below and scan again.");
    }
    await enterWorkspace(data.workspace);
    state.siteBusy = false;
    el.siteNextBtn.disabled = false;
    closeSiteModal();
    toast(`Reconnected to ${data.workspace.repoName}`);
  } catch (err) {
    siteError(err.message);
  } finally {
    setSiteBusy(false);
  }
}

async function enterWorkspace(workspace) {
  state.workspace = workspace;
  state.savedWorkspace = workspace;
  state.siteSections = workspace.sections || [];
  state.targetSection = workspace.sections?.[0]?.id || null;
  state.sitePosts = [];
  state.meta = null;
  state.legacy = false;
  state.tex = false;
  state.dirty = false;
  el.search.value = "";
  hideBanner();
  applyWorkspaceChrome();
  await refreshList();
  if (state.sitePosts.length) await openPost(state.sitePosts[0].id, "site");
  else resetEditor(state.targetSection, "site");
}

function showSiteManage() {
  if (!state.workspace) return;
  state.siteMode = "manage";
  el.siteWizard.hidden = true;
  el.siteManage.hidden = false;
  el.siteProgress.hidden = true;
  el.siteWizardFoot.hidden = true;
  el.siteManageFoot.hidden = false;
  el.siteModalKicker.textContent = "Connected site";
  el.siteModalTitle.textContent = "GitHub Pages";
  el.siteModal.hidden = false;

  el.siteManageName.textContent = state.workspace.repoName;
  el.siteManagePath.textContent = state.workspace.repoRoot;
  el.siteManageGenerator.textContent = state.workspace.generatorLabel || state.workspace.generator;
  el.siteManageUrl.textContent = state.workspace.siteUrl || "Not set";
  el.siteManageUrl.title = state.workspace.siteUrl || "";
  el.siteManageSections.innerHTML = state.workspace.sections
    .map(
      (section) => `
        <div class="site-manage-section">
          <strong>${escapeHtml(section.name)}</strong>
          <span>${escapeHtml(section.root === "." ? "site root" : section.root)}</span>
        </div>`
    )
    .join("");
}

async function disconnectSite() {
  if (!state.workspace) return;
  const ok = confirm(
    `Disconnect ${state.workspace.repoName}?\n\nYour writing files will stay exactly where they are. The studio will simply stop showing this site.`
  );
  if (!ok) return;
  if (!(await flushDirty())) return;
  try {
    await postJson("/api/workspace/disconnect", {});
    closeSiteModal();
    const wasSite = state.source === "site";
    state.workspace = null;
    state.savedWorkspace = null;
    state.siteSections = [];
    state.sitePosts = [];
    if (wasSite) {
      state.targetSection = null;
      state.meta = null;
      state.legacy = false;
      state.tex = false;
      state.dirty = false;
    }
    el.search.value = "";
    applyWorkspaceChrome();
    await refreshList();
    if (wasSite) {
      if (state.notes.notes[0]) await openPost(state.notes.notes[0].path, "note");
      else if (state.localPosts[0]) await openPost(state.localPosts[0].slug, "local");
      else resetEditor(null, null);
    }
    toast("Disconnected from GitHub Pages");
  } catch (err) {
    showBanner("error", `<strong>Could not disconnect.</strong> ${escapeHtml(err.message)}`);
  }
}

async function loadSavedWorkspace() {
  const data = await api("/api/workspace");
  state.savedWorkspace = data.workspace || null;
  /* A saved site is not an active connection. Every fresh studio session
     starts disconnected; the Connect dialog offers a one-click resume. */
  state.workspace = null;
  state.siteSections = [];
  state.sitePosts = [];
  state.targetSection = null;
  applyWorkspaceChrome();
}

function initSiteConnect() {
  el.connectSite.addEventListener("click", () => {
    if (state.workspace) showSiteManage();
    else openSiteWizard();
  });

  el.siteModalClose.addEventListener("click", closeSiteModal);
  el.siteManageClose.addEventListener("click", closeSiteModal);
  el.siteResumeBtn.addEventListener("click", resumeSavedWorkspace);
  el.siteBackBtn.addEventListener("click", () => {
    if (state.siteStep > 1) showSiteStep(state.siteStep - 1);
  });

  el.siteNextBtn.addEventListener("click", () => {
    if (state.siteBusy) return;
    if (state.siteStep === 1) scanSiteFromWizard();
    else if (state.siteStep === 2) {
      if (!selectedSiteSections().length) {
        siteError("Select at least one writing section.");
        return;
      }
      siteError("");
      renderSiteReview();
      showSiteStep(3);
    } else connectSiteFromWizard();
  });

  el.siteSectionList.addEventListener("change", (event) => {
    const check = event.target.closest("[data-site-check]");
    if (!check) return;
    const card = check.closest("[data-site-id]");
    const id = card?.dataset.siteId;
    if (!id) return;
    if (check.checked) state.siteSelected.add(id);
    else state.siteSelected.delete(id);
    card.classList.toggle("is-off", !check.checked);
    updateSiteSectionCount();
    siteError("");
  });

  el.siteSectionList.addEventListener("input", (event) => {
    const input = event.target.closest("[data-site-name]");
    if (!input) return;
    const card = input.closest("[data-site-id]");
    const section = state.siteScan?.sections.find((candidate) => candidate.id === card?.dataset.siteId);
    if (section) section.name = input.value;
  });

  el.siteAddFolderBtn.addEventListener("click", async () => {
    const folder = el.siteManualFolder.value.trim();
    if (!folder || !state.siteScan) return;
    setSiteBusy(true, "Adding…");
    siteError("");
    try {
      const data = await postJson("/api/workspace/inspect", {
        repoRoot: state.siteScan.repoRoot,
        folder,
      });
      const exists = state.siteScan.sections.some((section) => section.root === data.section.root);
      if (exists) {
        toast("That folder is already in the list");
      } else {
        let id = data.section.id;
        let n = 2;
        while (state.siteScan.sections.some((section) => section.id === id)) id = `${data.section.id}-${n++}`;
        data.section.id = id;
        state.siteScan.sections.push(data.section);
        state.siteSelected.add(id);
        renderSiteSections();
        el.siteManualFolder.value = "";
        toast("Writing folder added");
      }
    } catch (err) {
      siteError(err.message);
    } finally {
      setSiteBusy(false);
    }
  });

  el.siteManualFolder.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      el.siteAddFolderBtn.click();
    }
  });

  el.siteEditBtn.addEventListener("click", async () => {
    openSiteWizard({ prefill: true, resume: false });
    await scanSiteFromWizard();
  });

  el.siteDisconnectBtn.addEventListener("click", disconnectSite);

  el.siteModal.addEventListener("click", (event) => {
    if (event.target === el.siteModal) closeSiteModal();
  });

  el.sectionChoices.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-section-id]");
    if (!choice) return;
    closeSectionPicker();
    resetEditor(choice.dataset.sectionId, "site");
  });
  el.sectionModalClose.addEventListener("click", closeSectionPicker);
  el.sectionModalCancel.addEventListener("click", closeSectionPicker);
  el.sectionModal.addEventListener("click", (event) => {
    if (event.target === el.sectionModal) closeSectionPicker();
  });

  /* A disabled “Open live page” should not jump to the top of the page. */
  el.openPost.addEventListener("click", (event) => {
    if (el.openPost.getAttribute("aria-disabled") === "true") event.preventDefault();
  });
}

/* --- boot -------------------------------------------------- */

(async function boot() {
  initTheme();
  initAiSettings();
  initSiteConnect();
  initNoteModal();
  try {
    setRail(localStorage.getItem(RAIL_KEY) !== "1", { persist: false });
  } catch {
    setRail(true, { persist: false });
  }
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]");
    if (Array.isArray(saved)) {
      state.collapsedFolders = new Set(saved.filter((value) => typeof value === "string"));
    }
  } catch {}

  /* below 900px the panes stack, so start on the editor and let the
     toggle switch to the preview instead of the other way round */
  setPreview(window.innerWidth > 900, { render: false });

  try {
    await loadSavedWorkspace();
    await refreshList();
    const firstNote = state.notes.notes[0];
    const firstLocal = state.localPosts[0];
    if (firstNote) await openPost(firstNote.path, "note");
    else if (firstLocal) await openPost(firstLocal.slug, "local");
    else resetEditor(null, null);
  } catch (err) {
    showBanner("error", `<strong>The studio could not reach its server.</strong> ${escapeHtml(err.message)}`);
  }
})();
