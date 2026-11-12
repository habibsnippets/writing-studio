/* Shared escaping helpers. Kept in one place so the Markdown renderer,
   the Obsidian vault resolver and the drawing renderers all agree. */

export const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const escapeAttr = (s = "") => escapeHtml(s).replace(/'/g, "&#39;");
