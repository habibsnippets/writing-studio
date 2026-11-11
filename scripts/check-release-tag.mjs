#!/usr/bin/env node
/* ============================================================
   Release tag guard.

   electron-builder publishes to the GitHub release for v<version>
   taken from package.json. If the pushed tag says something else, the
   build either fails halfway through the matrix or attaches installers
   to a release nobody is looking at. Fail before any packaging starts.

     node scripts/check-release-tag.mjs v1.2.0
     GITHUB_REF_NAME=v1.2.0 node scripts/check-release-tag.mjs
   ============================================================ */

import { readFile } from "node:fs/promises";
import path from "node:path";

const tag = String(process.env.GITHUB_REF_NAME || process.argv[2] || "").trim();
const pkg = JSON.parse(await readFile(path.join(import.meta.dirname, "..", "package.json"), "utf8"));

if (!tag) {
  console.error("No release tag given. Pass it as an argument or set GITHUB_REF_NAME.");
  process.exit(1);
}

if (tag !== `v${pkg.version}`) {
  console.error(`Release tag "${tag}" does not match package.json version "${pkg.version}".`);
  console.error(`Push v${pkg.version}, or bump "version" to ${tag.replace(/^v/, "")} and commit first.`);
  process.exit(1);
}

console.log(`Release tag ${tag} matches package.json ${pkg.version}.`);
