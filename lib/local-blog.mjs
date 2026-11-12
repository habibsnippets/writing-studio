/* ============================================================
   The local blog's on-disk shape.

   An article owns a folder, not a loose file:

     content/<slug>/
       <slug>.md        (or <slug>.html for archived HTML posts)
       assets/          images, diagrams and downloads that belong to it

   Older studios stored `content/<slug>.md` and put images in
   `content/assets/<slug>/`. Both layouts are still read, and
   `migrateLocalLibrary()` upgrades the old one on first launch.

   Keeping the body and its media together means a topic folder can be
   copied, imported, moved to private notes, or backed up as one unit.
   ============================================================ */

import path from "node:path";
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import { CONTENT, ASSETS_DIR, POSTS_FILE, isInside } from "./paths.mjs";

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export const localSlugOk = (slug) =>
  /^[a-z0-9][a-z0-9-]{0,80}$/.test(slug || "") &&
  slug !== "assets" &&
  !WINDOWS_RESERVED.test(slug || "");

const exists = (target) =>
  stat(target).then(
    () => true,
    () => false
  );

export const localPostDir = (slug) => path.join(CONTENT, slug);
export const localAssetsDir = (slug) => path.join(CONTENT, slug, "assets");
export const localLegacyAssetsDir = (slug) => path.join(ASSETS_DIR, slug);

/* The canonical body first, then layouts a person may have made by hand
   or that older studio versions wrote. */
export function localBodyCandidates(slug) {
  return [
    path.join(CONTENT, slug, `${slug}.md`),
    path.join(CONTENT, slug, "index.md"),
    path.join(CONTENT, `${slug}.md`),
    path.join(CONTENT, slug, `${slug}.html`),
    path.join(CONTENT, slug, "index.html"),
    path.join(CONTENT, `${slug}.html`),
  ];
}

export async function findLocalBody(slug) {
  if (!localSlugOk(slug)) return null;
  for (const candidate of localBodyCandidates(slug)) {
    if (await exists(candidate)) return candidate;
  }

  /* A hand-made topic folder may use a different Markdown filename.
     Accept it as long as it is the only Markdown file in the folder. */
  const dir = localPostDir(slug);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const markdown = entries.filter(
    (entry) => entry.isFile() && /\.md$/i.test(entry.name) && !entry.name.startsWith(".")
  );
  if (markdown.length === 1) return path.join(dir, markdown[0].name);
  return null;
}

/* Media URL -> file, without ever leaving the article's own folder. */
export async function resolveLocalAsset(slug, relative = "") {
  if (!localSlugOk(slug)) return null;
  const clean = String(relative || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");
  if (!clean.length) return null;
  const rel = clean.join("/");
  if (!rel) return null;

  const candidates = [
    path.join(localAssetsDir(slug), rel),
    path.join(localPostDir(slug), rel),
    path.join(localLegacyAssetsDir(slug), rel),
  ];
  for (const candidate of candidates) {
    if (!isInside(CONTENT, candidate)) continue;
    if (!isInside(path.join(CONTENT, slug), candidate) && !isInside(localLegacyAssetsDir(slug), candidate)) {
      continue;
    }
    if (await exists(candidate)) return candidate;
  }
  return null;
}

export async function ensureLocalPostDir(slug) {
  await mkdir(localAssetsDir(slug), { recursive: true });
  return localPostDir(slug);
}

/* Remove every form of an article, including the old loose-file layout. */
export async function removeLocalPostFiles(slug) {
  if (!localSlugOk(slug)) return;
  await rm(localPostDir(slug), { recursive: true, force: true });
  await rm(path.join(CONTENT, `${slug}.md`), { force: true });
  await rm(path.join(CONTENT, `${slug}.html`), { force: true });
  await rm(localLegacyAssetsDir(slug), { recursive: true, force: true });
}

async function moveIntoPlace(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await rename(source, target);
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
    await copyFile(source, target);
    await rm(source, { force: true });
  }
}

/* One quiet pass at startup. It never overwrites a newer nested body, so
   running it repeatedly is harmless. */
export async function migrateLocalLibrary() {
  await mkdir(CONTENT, { recursive: true });
  await mkdir(ASSETS_DIR, { recursive: true });

  let migrated = 0;
  const entries = await readdir(CONTENT, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".")) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== ".md" && ext !== ".html") continue;
    const slug = path.basename(entry.name, ext);
    if (!localSlugOk(slug)) continue;

    const dir = localPostDir(slug);
    const target = path.join(dir, `${slug}${ext}`);
    if (!(await exists(target))) {
      await moveIntoPlace(path.join(CONTENT, entry.name), target);
      migrated++;
    }
  }

  /* Old per-article asset folders move under the article that owns them. */
  const assetEntries = await readdir(ASSETS_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of assetEntries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (!localSlugOk(entry.name)) continue;
    const target = localAssetsDir(entry.name);
    if (await exists(target)) {
      /* Both layouts exist: merge files, keeping the newer nested copy. */
      await cp(path.join(ASSETS_DIR, entry.name), target, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
      await rm(path.join(ASSETS_DIR, entry.name), { recursive: true, force: true });
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      try {
        await rename(path.join(ASSETS_DIR, entry.name), target);
      } catch (err) {
        if (err.code !== "EXDEV") throw err;
        await cp(path.join(ASSETS_DIR, entry.name), target, { recursive: true });
        await rm(path.join(ASSETS_DIR, entry.name), { recursive: true, force: true });
      }
    }
  }

  return { migrated };
}

export async function readLocalPosts() {
  try {
    return JSON.parse(await readFile(POSTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

export async function writeLocalPosts(posts) {
  await mkdir(CONTENT, { recursive: true });
  await writeFile(POSTS_FILE, JSON.stringify(posts, null, 2) + "\n");
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const prettyPostDate = (iso) => {
  const [year, month, day] = String(iso).split("-");
  return `${day} ${MONTHS[Number(month) - 1] || "Jan"}, ${year}`;
};

/* Small helper used by the transfer layer. */
export const fileExists = exists;
