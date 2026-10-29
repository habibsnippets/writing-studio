#!/usr/bin/env node
/* ============================================================
   Packaging check.

   Packs the app exactly as `npm publish` would, installs that tarball
   into a throwaway folder, then runs the installed CLI against another
   throwaway folder. This is the test that catches "works in the repo,
   broken when installed": missing files, a data folder written inside
   node_modules, a bin that does not start.

   Runs the same way on Linux, macOS and Windows.
   ============================================================ */

import { spawnSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, readdir, rm, stat, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const APP_DIR = path.resolve(import.meta.dirname, "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
/* npm.cmd is a batch file on Windows, which needs a shell to run. Temp
   paths on Windows have no spaces, so the quoting stays safe. */
const needsShell = process.platform === "win32";

let failures = 0;
const log = [];

function check(name, condition, detail = "") {
  log.push(`  ${condition ? "ok  " : "FAIL"} ${name}${condition || !detail ? "" : ` — ${detail}`}`);
  if (!condition) failures++;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: needsShell,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${result.stdout || ""}\n${result.stderr || ""}`);
  }
  return result;
}

const exists = (target) => stat(target).then(() => true, () => false);

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

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ws-package-"));
  const packDir = path.join(root, "pack");
  const installDir = path.join(root, "install");
  const dataDir = path.join(root, "data");
  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  let child = null;

  try {
    run(npm, ["pack", "--pack-destination", packDir], { cwd: APP_DIR });
    const tarball = (await readdir(packDir)).find((file) => file.endsWith(".tgz"));
    check("npm pack produces a tarball", !!tarball, tarball || "none");

    const { version } = JSON.parse(await readFile(path.join(APP_DIR, "package.json"), "utf8"));
    check("package is not private", !JSON.parse(await readFile(path.join(APP_DIR, "package.json"), "utf8")).private);

    run(npm, ["init", "-y"], { cwd: installDir });
    run(npm, ["install", path.join(packDir, tarball), "--no-audit", "--no-fund"], { cwd: installDir });

    const installed = path.join(installDir, "node_modules", "writing-studio");
    check("installed package appears", await exists(installed));
    for (const part of ["bin/writing-studio.mjs", "lib/paths.mjs", "public/index.html", "content.example/posts.json", "LICENSE", "README.md"]) {
      check(`installed package contains ${part}`, await exists(path.join(installed, part)));
    }
    check("personal content is not shipped", !(await exists(path.join(installed, "content"))));
    check("private notes are not shipped", !(await exists(path.join(installed, "data"))));

    const cli = path.join(installed, "bin", "writing-studio.mjs");
    const versionOut = run(process.execPath, [cli, "--version"]).stdout.trim();
    check("installed CLI reports its version", versionOut === version, `${versionOut} vs ${version}`);
    const helpOut = run(process.execPath, [cli, "--help"]).stdout;
    check("installed CLI has help", helpOut.includes("--dir") && helpOut.includes("--port"));

    const port = await freePort();
    child = spawn(process.execPath, [cli, "--dir", dataDir, "--port", String(port)], {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Installed CLI did not start.\n${output}`)), 30_000);
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(`http://127.0.0.1:${match[1]}`);
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Installed CLI exited (${code}).\n${output}`));
      });
    });

    check("installed CLI serves the studio", (await fetch(base + "/")).status === 200);
    check("installed CLI serves canvas code", (await fetch(base + "/canvas.js")).status === 200);
    const posts = await fetch(base + "/api/posts").then((res) => res.json());
    check("installed CLI seeds starter content", (posts.posts || []).some((post) => post.slug === "welcome-to-writing-studio"));

    check(
      "writing goes to the chosen folder",
      await exists(path.join(dataDir, "content", "welcome-to-writing-studio.md"))
    );
    check(
      "nothing is written inside the installed package",
      !(await exists(path.join(installed, "content"))) && !(await exists(path.join(installed, "data"))) && !(await exists(path.join(installed, "dist")))
    );
  } finally {
    if (child) {
      child.kill();
      await new Promise((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
    await rm(root, { recursive: true, force: true }).catch(() => {});
  }

  console.log(log.join("\n"));
  if (failures) {
    console.log(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${log.length} packaging checks passed.`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
