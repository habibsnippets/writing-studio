/* ============================================================
   Where things live.

   The app (this package) is read-only: server, lib, public assets and
   the starter content. The writing is the user's: content/, data/ and
   dist/ live in a separate data folder so a global npm install never
   writes into node_modules, and so a clone behaves exactly as before.

   The data folder is chosen once, before any module reads it:
     WRITING_STUDIO_HOME   explicit override (set by the CLI --dir flag)
     otherwise             the current working directory

   Everything is resolved with path.join from these two roots, which is
   what keeps the same code running on Linux, macOS and Windows.
   ============================================================ */

import path from "node:path";
import os from "node:os";

import { expandHome } from "./expand-home.mjs";

export { expandHome };

/* The package folder: <root>/lib/paths.mjs → <root>. */
export const APP_DIR = path.resolve(import.meta.dirname, "..");

export const PUBLIC_DIR = path.join(APP_DIR, "public");
export const SEED_DIR = path.join(APP_DIR, "content.example");

function resolveDataDir() {
  const configured = String(process.env.WRITING_STUDIO_HOME || "").trim();
  const base = configured || process.cwd();
  return path.resolve(expandHome(base));
}

export const DATA_DIR = resolveDataDir();

/* Publishable local blog. */
export const CONTENT = path.join(DATA_DIR, "content");
export const POSTS_FILE = path.join(CONTENT, "posts.json");
export const ASSETS_DIR = path.join(CONTENT, "assets");
export const DIST = path.join(DATA_DIR, "dist");

/* Private notes and the connected-site workspace file. */
export const STUDIO_DATA = path.join(DATA_DIR, "data");
export const NOTES_ROOT = path.join(STUDIO_DATA, "notes");
export const WORKSPACE_FILE = path.join(STUDIO_DATA, "workspace.json");

/* True when `target` is `root` itself or sits inside it. path.relative is
   used instead of a string prefix so Windows' case-insensitive drives
   (C:\Site vs c:\site), trailing separators and drive roots behave. */
export function isInside(root, target) {
  if (!root || !target) return false;
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (!rel) return true;
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/* Relative keys inside a repo are always stored with forward slashes,
   which is what the Markdown, URLs and the workspace file expect. */
export function toPosix(value = "") {
  return String(value).replace(/\\/g, "/");
}

/* Where a path should be displayed in the UI: the home folder is
   abbreviated so long /Users/... and C:\Users\... paths stay readable. */
export function displayPath(target) {
  const home = os.homedir();
  const abs = path.resolve(target);
  const rel = path.relative(home, abs);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    return `~${path.sep}${rel}`;
  }
  return abs;
}

export function pathSummary() {
  return {
    appDir: APP_DIR,
    dataDir: DATA_DIR,
    contentDir: CONTENT,
    notesDir: NOTES_ROOT,
    distDir: DIST,
  };
}
