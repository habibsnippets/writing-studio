#!/usr/bin/env node
/* ============================================================
   End-to-end smoke test.

   Runs the real CLI against a throwaway data folder and checks the
   things that break in packaging: static assets, the post API, the
   static build, private notes, and connecting to a local GitHub Pages
   repository.

   No shell, no platform-specific commands: the same script runs on
   Linux, macOS and Windows, which is what CI uses.
   ============================================================ */

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { isInside } from "../lib/paths.mjs";
import { normalizeRepoRoot } from "../lib/site-scanner.mjs";

const APP_DIR = path.resolve(import.meta.dirname, "..");
const BIN = path.join(APP_DIR, "bin", "writing-studio.mjs");

let failures = 0;
const checks = [];

function check(name, condition, detail = "") {
  if (condition) {
    checks.push(`  ok   ${name}`);
    return true;
  }
  failures++;
  checks.push(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  return false;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startStudio({ dataDir, port }) {
  const child = spawn(process.execPath, [BIN, "--dir", dataDir, "--port", String(port)], {
    cwd: APP_DIR,
    env: { ...process.env, NO_COLOR: "1", WRITING_STUDIO_THEME: "dark" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk.toString(); });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Server did not start in 30s.\n${output}\n${errors}`));
    }, 30_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early (${code}).\n${output}\n${errors}`));
    });
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    });
  });

  return { child, ready, log: () => output + errors };
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  /* A space in the folder name is normal on Windows and macOS and has
     broken plenty of CLIs. Use one here. */
  const root = await mkdtemp(path.join(os.tmpdir(), "writing studio smoke "));

  /* Path guards, before anything touches a real repository. These run
     on every OS; the Windows case-insensitivity check only exists where
     that behaviour does. */
  check("a path inside the site is accepted", isInside(root, path.join(root, "content", "a.md")));
  check("a path outside the site is rejected", !isInside(root, path.join(root, "..", "escaped.md")));
  check("a sibling folder with the same prefix is rejected", !isInside(root, `${root}-other`));
  if (process.platform === "win32") {
    check(
      "Windows drive-letter case cannot escape the site",
      isInside(root, path.join(root.toLowerCase(), "content", "a.md"))
    );
  }
  check("quoted folder paths are unwrapped", normalizeRepoRoot(`"${root}"`) === path.resolve(root));
  const dataDir = path.join(root, "my writing");
  const siteDir = path.join(root, "pages site");
  await mkdir(dataDir, { recursive: true });

  const repoPost = path.join(APP_DIR, "content", "posts.json");
  const repoPostsBefore = await stat(repoPost).then((s) => `${s.size}:${s.mtimeMs}`).catch(() => "missing");

  const port = await freePort();
  const studio = startStudio({ dataDir, port });
  let base = "";

  try {
    base = await studio.ready;
    check("server starts and prints a local URL", /^http:\/\/127\.0\.0\.1:\d+$/.test(base), base);

    const get = async (route) => {
      const res = await fetch(base + route);
      const text = await res.text();
      return { status: res.status, text, type: res.headers.get("content-type") || "" };
    };

    const home = await get("/");
    check("studio page is served", home.status === 200 && home.text.includes("drawCanvas"), `status ${home.status}`);

    for (const asset of ["/studio.js", "/canvas.js", "/studio.css", "/styles.css", "/assets/favicon.svg", "/assets/brand-logo.png"]) {
      const res = await fetch(base + asset);
      check(`static asset ${asset}`, res.status === 200, `status ${res.status}`);
    }

    const pdfjs = await fetch(base + "/node_modules/pdfjs-dist/build/pdf.min.mjs");
    check("pdf.js module is reachable", pdfjs.status === 200, `status ${pdfjs.status}`);

    const posts = await get("/api/posts");
    const seeded = posts.status === 200 ? JSON.parse(posts.text).posts : [];
    check("post list API answers", posts.status === 200 && Array.isArray(seeded), `status ${posts.status}`);
    check(
      "starter content is seeded into a new folder",
      seeded.some((post) => post.slug === "welcome-to-writing-studio"),
      JSON.stringify(seeded.map((post) => post.slug))
    );

    const meta = {
      slug: "smoke-test",
      title: "Smoke Test",
      dateISO: "2026-01-02",
      description: "Written by the packaging smoke test.",
      draft: false,
    };
    const saved = await fetch(base + "/api/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meta, markdown: "# Smoke Test\n\nHello from a temporary folder.\n" }),
    });
    check("save a post", saved.status === 200, `status ${saved.status}`);

    const published = await fetch(base + "/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meta, markdown: "# Smoke Test\n\nHello from a temporary folder.\n" }),
    });
    check("publish rebuilds the site", published.status === 200, `status ${published.status}`);

    /* CON, NUL and friends are file names on Windows, so they must be
       refused before anything is written. */
    const reserved = await fetch(base + "/api/post", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meta: { ...meta, slug: "con" }, markdown: "# Nope\n" }),
    });
    check("Windows-reserved slugs are refused", reserved.status === 400, `status ${reserved.status}`);

    const worker = await fetch(base + "/node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
    check("pdf.js worker is reachable", worker.status === 200, `status ${worker.status}`);

    const article = await get("/writing/smoke-test/");
    check("published article is served", article.status === 200 && article.text.includes("Smoke Test"), `status ${article.status}`);

    const archive = await get("/writing/");
    check("archive page is served", archive.status === 200);

    check(
      "content was written to the chosen data folder",
      await stat(path.join(dataDir, "content", "smoke-test.md")).then(() => true, () => false)
    );
    check(
      "dist was written to the chosen data folder",
      await stat(path.join(dataDir, "dist", "smoke-test", "index.html")).then(() => true, () => false)
    );
    const repoPostsAfter = await stat(repoPost).then((s) => `${s.size}:${s.mtimeMs}`).catch(() => "missing");
    check("the app folder's own content was untouched", repoPostsBefore === repoPostsAfter, `${repoPostsBefore} → ${repoPostsAfter}`);

    const notes = await get("/api/notes/tree");
    check("private notes API answers", notes.status === 200);
    check(
      "notes folder was created in the data folder",
      await stat(path.join(dataDir, "data", "notes")).then(() => true, () => false)
    );

    /* --- a local GitHub Pages repository --------------------- */

    await mkdir(path.join(siteDir, "_posts"), { recursive: true });
    await mkdir(path.join(siteDir, "assets"), { recursive: true });
    await writeFile(path.join(siteDir, "_config.yml"), "title: Smoke Site\npermalink: pretty\n");
    await writeFile(path.join(siteDir, "CNAME"), "smoke.example.com\n");
    await writeFile(
      path.join(siteDir, "_posts", "2026-01-01-hello-world.md"),
      "---\ntitle: Hello World\ndate: 2026-01-01\ndescription: First post.\n---\n\n# Hello World\n\nBody text.\n"
    );
    await writeFile(path.join(siteDir, "index.md"), "# Home\n\nWelcome.\n");

    const scanRes = await fetch(base + "/api/workspace/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoRoot: siteDir }),
    });
    const scan = (await scanRes.json()).scan;
    check("Pages folder scan succeeds", scanRes.status === 200 && !!scan, JSON.stringify(scan?.warnings || []));
    check("Pages generator is detected", scan?.generator === "jekyll", scan?.generator);
    check("Pages writing section is found", !!scan?.sections?.some((s) => s.root === "_posts"), JSON.stringify(scan?.sections?.map((s) => s.root)));
    check("Pages site URL comes from CNAME", scan?.siteUrl === "https://smoke.example.com/", scan?.siteUrl);

    /* Folders dragged from Finder or copied out of a browser arrive as a
       file:// URL, which looks different on Windows (file:///C:/...). */
    const fileUrlScan = await fetch(base + "/api/workspace/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoRoot: `file://${siteDir.replace(/\\/g, "/")}` }),
    });
    const fileUrlJson = await fileUrlScan.json();
    check(
      "a file:// folder path is understood",
      fileUrlScan.status === 200 && fileUrlJson.scan?.repoRoot === siteDir,
      `${fileUrlScan.status} ${fileUrlJson.scan?.repoRoot || fileUrlJson.error || ""}`
    );

    const section = scan.sections.find((s) => s.root === "_posts");
    const connect = await fetch(base + "/api/workspace/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repoRoot: siteDir,
        generator: scan.generator,
        siteUrl: scan.siteUrl,
        sections: [section],
        frontmatter: scan.frontmatter,
        asset: scan.asset,
      }),
    });
    check("Pages folder connects", connect.status === 200, `status ${connect.status}`);

    const sitePosts = await fetch(base + "/api/workspace/posts");
    const siteList = await sitePosts.json();
    const target = (siteList.posts || []).find((p) => String(p.id).includes("hello-world"));
    check("Pages posts are listed", !!target, JSON.stringify((siteList.posts || []).map((p) => p.id)));

    if (target) {
      const siteEdit = await fetch(base + "/api/workspace/post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meta: { id: target.id, title: "Hello World", dateISO: "2026-01-01", description: "Edited by smoke test.", draft: false },
          markdown: "# Hello World\n\nBody text, edited.\n",
        }),
      });
      check("Pages post saves", siteEdit.status === 200, `status ${siteEdit.status}`);
      const edited = await readFile(path.join(siteDir, "_posts", "2026-01-01-hello-world.md"), "utf8");
      check("Pages file was updated on disk", edited.includes("Body text, edited."), edited.slice(0, 80));
    }

    const workspaceFile = path.join(dataDir, "data", "workspace.json");
    check(
      "workspace settings live in the data folder",
      await stat(workspaceFile).then(() => true, () => false)
    );
    const workspaceRaw = await readFile(workspaceFile, "utf8").catch(() => "");
    check("workspace points at the chosen site", workspaceRaw.includes(siteDir.replace(/\\/g, "\\\\")) || workspaceRaw.includes(JSON.stringify(siteDir).slice(1, -1)));

    /* --- other site layouts: Hugo (TOML), templates, non-Latin titles --- */
    const hugoDir = path.join(root, "hugo site");
    await mkdir(path.join(hugoDir, "content", "posts"), { recursive: true });
    await mkdir(path.join(hugoDir, "layouts", "partials"), { recursive: true });
    await mkdir(path.join(hugoDir, "themes", "t", "layouts"), { recursive: true });
    await writeFile(path.join(hugoDir, "hugo.toml"), "baseURL = 'https://example.org/'\n");
    const tomlPost = "+++\ntitle = 'TOML post'\ndate = 2026-02-01\ndraft = false\n\n[params]\nx = 1\n+++\n\n# TOML post\n\nBody.\n";
    await writeFile(path.join(hugoDir, "content", "posts", "toml.md"), tomlPost);
    for (const name of ["a", "b", "c"]) {
      await writeFile(path.join(hugoDir, "layouts", "partials", `${name}.html`), "<p></p>");
      await writeFile(path.join(hugoDir, "themes", "t", "layouts", `${name}.html`), "<p></p>");
    }

    const post = (route, payload) =>
      fetch(base + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

    const hugoScan = (await (await post("/api/workspace/scan", { repoRoot: hugoDir })).json()).scan;
    check("Hugo site is detected", hugoScan?.generator === "hugo", hugoScan?.generator);
    check(
      "templates and themes are not offered as writing",
      !!hugoScan && hugoScan.sections.every((sec) => sec.root === "content/posts"),
      JSON.stringify(hugoScan?.sections?.map((sec) => sec.root))
    );
    check("Hugo images go to static/", hugoScan?.asset?.dir === "static", JSON.stringify(hugoScan?.asset));

    await post("/api/workspace/connect", { ...hugoScan, sections: hugoScan.sections });
    const tomlList = await (await fetch(base + "/api/workspace/posts")).json();
    const tomlMeta = (tomlList.posts || []).find((p) => p.id.endsWith("toml.md"));
    check("TOML frontmatter title is read", tomlMeta?.title === "TOML post", tomlMeta?.title);

    await post("/api/workspace/post", {
      meta: { id: tomlMeta.id, title: "TOML post", dateISO: "2026-02-01", draft: false },
      markdown: "\n# TOML post\n\nBody.\n",
    });
    const tomlAfter = await readFile(path.join(hugoDir, "content", "posts", "toml.md"), "utf8");
    check("saving a TOML post leaves its frontmatter alone", tomlAfter === tomlPost, JSON.stringify(tomlAfter.slice(0, 60)));

    const arabic = await (
      await post("/api/workspace/post", {
        meta: { title: "مقالة جديدة", dateISO: "2026-03-01", sectionId: hugoScan.sections[0].id, draft: false },
        markdown: "نص\n",
      })
    ).json();
    check("a non-Latin title keeps a readable filename", /مقالة/.test(arabic.meta?.path || ""), arabic.meta?.path || arabic.error);

    const gone = await fetch(base + "/api/workspace/post?id=" + encodeURIComponent("content/posts/missing.md"));
    check("a file deleted outside the studio is a clean 404", gone.status === 404, `status ${gone.status}`);

    /* --- bundles, descriptions, newlines, image names, folder-style HTML --- */
    await mkdir(path.join(hugoDir, "content", "posts", "my-bundle"), { recursive: true });
    await writeFile(path.join(hugoDir, "content", "posts", "my-bundle", "index.md"), "---\ntitle: Bundle\n---\n\nBundle body.\n");
    await writeFile(path.join(hugoDir, "content", "posts", "no-newline.md"), "# No newline\n\nlast line");
    await post("/api/workspace/connect", { ...hugoScan, sections: hugoScan.sections });
    const hugoPosts = (await (await fetch(base + "/api/workspace/posts")).json()).posts || [];
    check(
      "a page bundle is named after its folder",
      hugoPosts.find((p) => p.id.endsWith("my-bundle/index.md"))?.slug === "my-bundle",
      JSON.stringify(hugoPosts.map((p) => p.slug))
    );

    await post("/api/workspace/post", {
      meta: { id: "content/posts/no-newline.md", title: "No newline", dateISO: "", description: "Typed by hand" },
      markdown: "# No newline\n\nlast line edited",
    });
    const noNl = await readFile(path.join(hugoDir, "content", "posts", "no-newline.md"), "utf8");
    check("a file without a trailing newline does not gain one", noNl.endsWith("edited"), JSON.stringify(noNl.slice(-20)));
    check("a typed description is written even if no sample file had one", /description: Typed by hand/.test(noNl), noNl);

    const upload = async (filename) => {
      const res = await fetch(base + "/api/workspace/upload?id=" + encodeURIComponent("content/posts/no-newline.md"), {
        method: "POST",
        headers: { "x-filename": encodeURIComponent(filename) },
        body: Buffer.from("png"),
      });
      return res.json();
    };
    check("a Cyrillic image name is kept", (await upload("фото.png")).name === "фото.png");
    check("an upper-case extension is normalised", (await upload("Photo One.PNG")).name === "photo-one.png");

    const htmlDir = path.join(root, "html blog");
    await mkdir(path.join(htmlDir, "blog", "first-post"), { recursive: true });
    await mkdir(path.join(htmlDir, "blog", "second-post"), { recursive: true });
    await writeFile(path.join(htmlDir, "blog", "index.html"), "<html><h1>Blog</h1></html>");
    await writeFile(path.join(htmlDir, "blog", "first-post", "index.html"), "<html><h1>First post</h1><p>Body</p></html>");
    await writeFile(path.join(htmlDir, "blog", "second-post", "index.html"), "<html><h1>Second post</h1></html>");
    const htmlScan = (await (await post("/api/workspace/scan", { repoRoot: htmlDir })).json()).scan;
    const htmlSection = htmlScan?.sections?.find((sec) => sec.root === "blog");
    check(
      "folder-style HTML posts are offered but not ticked",
      !!htmlSection && htmlSection.nestedHtml && !htmlSection.defaultInclude && htmlSection.count === 2,
      JSON.stringify(htmlScan?.sections)
    );
    await post("/api/workspace/connect", { ...htmlScan, sections: [htmlSection] });
    const htmlPosts = (await (await fetch(base + "/api/workspace/posts")).json()).posts || [];
    check(
      "folder-style HTML posts list by folder name, not the blog index",
      htmlPosts.length === 2 && htmlPosts.some((p) => p.slug === "first-post" && p.title === "First post"),
      JSON.stringify(htmlPosts.map((p) => [p.path, p.slug])) 
    );

    const lostDir = path.join(root, "unrecognised");
    await mkdir(path.join(lostDir, "stuff"), { recursive: true });
    await writeFile(path.join(lostDir, "stuff", "a.md"), "# A");
    const lost = (await (await post("/api/workspace/scan", { repoRoot: lostDir })).json()).scan;
    check(
      "an empty scan explains itself",
      lost?.sections?.length === 0 && lost.warnings.some((w) => /Add folder/.test(w)),
      JSON.stringify(lost?.warnings)
    );

    const hugoRoutes = hugoScan.sections.find((sec) => sec.kind === "pages");
    check("a wrapper folder has no /content/ route", !hugoRoutes || hugoRoutes.route === "", hugoRoutes?.route);

    /* --- a site whose posts are written in LaTeX ------------- */
    const texDir = path.join(root, "latex site");
    await mkdir(path.join(texDir, "posts"), { recursive: true });
    const texPath = path.join(texDir, "posts", "2026-02-03-on-limits.tex");
    const texOriginal = [
      "\\documentclass{article}",
      "\\usepackage{amsmath} % math",
      "% \\title{commented out}",
      "\\title{On \\textbf{Limits}}",
      "\\date{February 3, 2026}",
      "\\begin{document}",
      "\\maketitle",
      "",
      "A limit describes where a sequence is heading, and this paragraph is long enough to count.",
      "",
      "$$\\lim_{n\\to\\infty} 1/n = 0$$",
      "\\end{document}",
      "",
    ].join("\n");
    await writeFile(texPath, texOriginal);
    await writeFile(path.join(texDir, "posts", "second.tex"), "\\begin{document}\nJust a fragment of text without a preamble.\n\\end{document}\n");
    const texScan = (await (await post("/api/workspace/scan", { repoRoot: texDir })).json()).scan;
    const texSection = texScan?.sections?.find((sec) => sec.root === "posts");
    check(
      "LaTeX posts are discovered as a ticked section",
      !!texSection && texSection.count === 2 && texSection.format === ".tex" && texSection.defaultInclude,
      JSON.stringify(texScan?.sections)
    );
    await post("/api/workspace/connect", { ...texScan, sections: [texSection] });
    const texPosts = (await (await fetch(base + "/api/workspace/posts")).json()).posts || [];
    const limits = texPosts.find((p) => p.path === "posts/2026-02-03-on-limits.tex");
    check(
      "LaTeX title and date come from \\title and \\date, not comments",
      limits?.title === "On Limits" && limits.dateISO === "2026-02-03",
      JSON.stringify(limits)
    );
    check("a LaTeX file without \\title falls back to its filename", texPosts.some((p) => p.path === "posts/second.tex" && p.title === "Second"));
    const texGet = await (await fetch(base + "/api/workspace/post?id=" + encodeURIComponent("posts/2026-02-03-on-limits.tex"))).json();
    check(
      "the editor gets only the text inside the document",
      texGet.markdown?.startsWith("\\maketitle") && !texGet.markdown.includes("documentclass") && !texGet.markdown.includes("end{document}"),
      JSON.stringify(texGet.markdown)
    );
    const unchanged = await (
      await post("/api/workspace/post", { meta: { id: texGet.meta.id, title: texGet.meta.title, dateISO: texGet.meta.dateISO, description: texGet.meta.description }, markdown: texGet.markdown })
    ).json();
    check("saving a LaTeX post unchanged leaves the file byte-identical", (await readFile(texPath, "utf8")) === texOriginal && !unchanged.error, unchanged.error);
    const edited = await (
      await post("/api/workspace/post", {
        meta: { id: texGet.meta.id, title: "Limits & Bounds", dateISO: "2026-03-04", description: texGet.meta.description },
        markdown: texGet.markdown.replace("heading", "going"),
      })
    ).json();
    const texAfter = await readFile(texPath, "utf8");
    check(
      "editing a LaTeX post changes only title, date and body",
      !edited.error &&
        texAfter.includes("\\title{Limits \\& Bounds}") &&
        texAfter.includes("\\date{2026-03-04}") &&
        texAfter.includes("% \\title{commented out}") &&
        texAfter.includes("\\usepackage{amsmath} % math") &&
        texAfter.includes("is going") &&
        texAfter.endsWith("\\end{document}\n"),
      edited.error || texAfter
    );
    const texNew = await (
      await post("/api/workspace/post", { meta: { title: "Fresh Idea", dateISO: "2026-05-06", sectionId: texSection.id, draft: false }, markdown: "Some words.\n" })
    ).json();
    const texNewText = await readFile(path.join(texDir, texNew.meta?.path || "missing"), "utf8").catch(() => "");
    check(
      "a new post in a LaTeX section is a complete .tex file",
      texNew.meta?.path === "posts/2026-05-06-fresh-idea.tex" && texNewText.includes("\\begin{document}") && texNewText.includes("\\title{Fresh Idea}") && texNewText.includes("Some words."),
      texNew.meta?.path || texNew.error
    );
    const texPreview = await (await post("/api/workspace/preview", { meta: { slug: "x", title: "T" }, markdown: "a < b & \\alpha", tex: true })).json();
    check("the LaTeX preview shows escaped source", texPreview.html?.includes("a &lt; b &amp; \\alpha"), texPreview.error);
    const texRemoved = await post("/api/workspace/remove", { id: "posts/second.tex" });
    check("a LaTeX post can be removed", texRemoved.status === 200 && !(await stat(path.join(texDir, "posts", "second.tex")).then(() => true, () => false)));

    /* A repo that is plainly a LaTeX project must not hijack a Markdown site. */
    check(
      "Markdown sites are unaffected by the LaTeX scanner",
      hugoScan.sections.every((sec) => !(sec.formats || []).includes(".tex"))
    );

    /* --- a brand-new site: folders that exist but are still empty --- */
    const newDir = path.join(root, "new site");
    for (const name of ["blogs", "notes", "articles"]) await mkdir(path.join(newDir, name), { recursive: true });
    const fresh = (await (await post("/api/workspace/scan", { repoRoot: newDir })).json()).scan;
    check(
      "empty blogs / notes / articles folders are offered",
      ["articles", "blogs", "notes"].every((name) => fresh?.sections?.some((sec) => sec.root === name && sec.defaultInclude && sec.count === 0)),
      JSON.stringify(fresh?.sections?.map((sec) => sec.root))
    );
    const typed = (await (await post("/api/workspace/inspect", { repoRoot: newDir, folder: "journal/2026" })).json()).section;
    check("a folder that does not exist yet can be added", typed?.willCreate === true && typed.root === "journal/2026", JSON.stringify(typed));
    const outside = await post("/api/workspace/inspect", { repoRoot: newDir, folder: "../escape" });
    check("a new folder cannot leave the site", outside.status === 400);

    await post("/api/workspace/connect", { ...fresh, sections: [...fresh.sections, typed] });
    check("connecting creates the typed folder", await stat(path.join(newDir, "journal", "2026")).then((i) => i.isDirectory(), () => false));
    const firstPost = await (
      await post("/api/workspace/post", {
        meta: { title: "First note", dateISO: "2026-04-01", sectionId: fresh.sections.find((sec) => sec.root === "notes").id, draft: false },
        markdown: "Hello.\n",
      })
    ).json();
    check("the first post is written into the empty folder", firstPost.meta?.path === "notes/first-note.md", firstPost.meta?.path || firstPost.error);
    const afterFirst = (await (await fetch(base + "/api/workspace/posts")).json()).sections || [];
    check("empty sections stay listed alongside filled ones", afterFirst.length === 4, JSON.stringify(afterFirst.map((sec) => [sec.root, sec.count])));

    /* The removal commands are printed for people to paste. Windows uses
       PowerShell syntax; the platform is switched in-process to check it. */
    const { removalCommands } = await import("../lib/site-archive.mjs");
    const realPlatform = process.platform;
    const sample = { repoRoot: "C:\\Users\\O'Brien\\my site" };
    const args = { title: "It's a post", build: { command: "npm run build" }, cleanup: { path: "writing/it-s" } };
    let winCommands;
    let posixCommands;
    try {
      Object.defineProperty(process, "platform", { value: "win32" });
      winCommands = removalCommands(sample, args);
      Object.defineProperty(process, "platform", { value: "linux" });
      posixCommands = removalCommands(sample, args);
    } finally {
      Object.defineProperty(process, "platform", { value: realPlatform });
    }
    check(
      "Windows removal commands use PowerShell syntax",
      winCommands[0] === "Set-Location 'C:\\Users\\O''Brien\\my site'" &&
        winCommands[1].startsWith("Remove-Item -Recurse -Force") &&
        !winCommands.some((c) => c.includes("rm -rf")) &&
        winCommands.includes("git commit -m 'Remove It''s a post'"),
      JSON.stringify(winCommands)
    );
    check("POSIX removal commands still use sh syntax", posixCommands[0].startsWith("cd '") && posixCommands[1].startsWith("rm -rf"));

    /* The CLI must start with no --port at all (the PORT variable is the
       only other input), which is how `npx writing-studio` runs. */
    const bare = spawn(process.execPath, [BIN, "--dir", dataDir], {
      cwd: APP_DIR,
      env: { ...process.env, NO_COLOR: "1", PORT: String(await freePort()) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const bareOut = await new Promise((resolve) => {
      let text = "";
      const done = () => resolve(text);
      bare.stdout.on("data", (c) => { text += c; if (/127\.0\.0\.1:\d+/.test(text)) done(); });
      bare.stderr.on("data", (c) => { text += c; });
      bare.once("exit", done);
      setTimeout(done, 15_000);
    });
    bare.kill();
    check("the CLI starts without --port", /127\.0\.0\.1:\d+/.test(bareOut), bareOut.slice(0, 200));
  } finally {
    studio.child.kill();
    await new Promise((resolve) => {
      if (studio.child.exitCode !== null) resolve();
      else studio.child.once("exit", resolve);
      setTimeout(resolve, 3000);
    });
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }

  console.log(checks.join("\n"));
  if (failures) {
    console.log(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} checks passed.`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
