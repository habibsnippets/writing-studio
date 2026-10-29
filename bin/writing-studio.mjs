#!/usr/bin/env node
/* ============================================================
   writing-studio — command line entry point.

   Two ways to point it at a folder:
     writing-studio                 → the current directory
     writing-studio ~/my-writing    → that folder
     writing-studio --dir ~/notes   → same thing, explicit

   The app itself (server, public assets) is read-only inside the
   installed package; the folder given here receives content/, data/
   and dist/. That separation is what makes `npm i -g` safe.
   ============================================================ */

import path from "node:path";
import { createRequire } from "node:module";

import { expandHome } from "../lib/expand-home.mjs";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const HELP = `
  writing-studio ${version}

  Usage
    writing-studio [folder] [options]

  Options
    -d, --dir <folder>   Where writing is stored (default: current folder)
    -p, --port <number>  Port to start on (default: 4321, next free one if busy)
        --light          Force the light terminal banner
        --dark           Force the dark terminal banner
    -h, --help           Show this help
    -v, --version        Print the version

  Examples
    writing-studio
    writing-studio ~/Documents/writing
    writing-studio --dir "C:\\Users\\me\\writing" --port 5000

  The folder gets:
    content/   publishable posts and images
    data/      private notes and the connected-site settings
    dist/      the generated static site (Publish)

  Open the printed http://127.0.0.1:<port> address in a browser.
`;

function fail(message) {
  process.stderr.write(`\n  ${message}\n\n  Run "writing-studio --help" for usage.\n\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { dir: "", port: null, help: false, version: false };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      options.version = true;
      continue;
    }
    if (arg === "--light" || arg === "--dark") {
      /* Consumed by the banner through argv; nothing to store here. */
      continue;
    }
    if (arg === "--dir" || arg === "-d" || arg === "--data-dir") {
      const value = argv[++i];
      if (!value) fail(`${arg} needs a folder path.`);
      options.dir = value;
      continue;
    }
    if (arg.startsWith("--dir=") || arg.startsWith("--data-dir=")) {
      options.dir = arg.split("=").slice(1).join("=");
      continue;
    }
    if (arg === "--port" || arg === "-p") {
      const value = argv[++i];
      if (!value) fail(`${arg} needs a port number.`);
      options.port = Number(value);
      continue;
    }
    if (arg.startsWith("--port=")) {
      options.port = Number(arg.split("=")[1]);
      continue;
    }
    if (arg.startsWith("-")) fail(`Unknown option: ${arg}`);
    rest.push(arg);
  }

  /* A bare `writing-studio some/folder` is the friendliest form. */
  if (!options.dir && rest.length) {
    if (rest.length > 1) fail(`Unexpected extra arguments: ${rest.slice(1).join(" ")}`);
    options.dir = rest[0];
  }
  if (options.port !== null && (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535)) {
    fail(`"${options.port}" is not a valid port.`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (options.version) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

/* expandHome is a side-effect-free module: lib/paths.mjs resolves the
   data folder on import, so the environment variable has to be set
   before that module is loaded. */
const dataDir = path.resolve(
  expandHome(options.dir || process.env.WRITING_STUDIO_HOME || process.cwd())
);
process.env.WRITING_STUDIO_HOME = dataDir;

const { startServer } = await import("../server.mjs");

/* The banner prints the folder, the URL and the version, so the CLI does
   not need to duplicate any of it. */
await startServer(options.port ?? Number(process.env.PORT) ?? 4321);
