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
