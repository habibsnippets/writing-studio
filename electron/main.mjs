/* ============================================================
   Writing Studio — desktop launcher (Electron main process).

   The studio is already a complete application: an HTTP server on
   loopback plus the browser UI in public/. This file only gives it a
   window and a writable folder. It does not reimplement anything.

   Two details matter more than they look:

   1. WRITING_STUDIO_HOME is set BEFORE server.mjs is imported, because
      lib/paths.mjs resolves the data folder at import time. If it were
      set afterwards, the packaged app would try to write content/ and
      data/ inside its own read-only bundle.

   2. The window does not assume port 4321. startServer() moves to the
      next free port when 4321 is taken, so the launcher asks each port
      /api/ping who it is and opens the one serving this same folder.

   `npm start` and the `writing-studio` CLI never load this file, so
   their behaviour is unchanged.
   ============================================================ */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { app, BrowserWindow, dialog, shell } from "electron";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const FIRST_PORT = 4321;
const PORT_SPAN = 10;
const START_TIMEOUT_MS = 60_000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* A desktop launch from Finder/Explorer has no terminal. The server
   still prints its banner from the listen callback, so give stdout a
   sink rather than letting that write throw inside startup. */
if (!process.stdout || typeof process.stdout.write !== "function") {
  process.stdout = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

let mainWindow = null;
let studioBase = "";

/* --- Data folder ------------------------------------------ */

function desktopDataDir() {
  const configured = String(process.env.WRITING_STUDIO_HOME || "").trim();
  if (configured) return configured;
  return path.join(app.getPath("documents"), "WritingStudio");
}

/* Windows drive letters and macOS case-insensitive volumes make a plain
   string compare wrong, so compare resolved paths case-insensitively
   there. */
function sameDir(a, b) {
  const left = path.resolve(String(a || ""));
  const right = path.resolve(String(b || ""));
  return process.platform === "win32" || process.platform === "darwin"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/* --- Finding the server ----------------------------------- */

async function studioOn(port, dataDir) {
  try {
    const res = await fetch(`http://${HOST}:${port}/api/ping`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const info = await res.json();
    return info?.app === "writing-studio" && sameDir(info.dataDir, dataDir);
  } catch {
    return false;
  }
}

async function findStudio(dataDir) {
  for (let port = FIRST_PORT; port < FIRST_PORT + PORT_SPAN; port++) {
    if (await studioOn(port, dataDir)) return port;
  }
  return null;
}

/* server.mjs exits the process when it cannot prepare content/ and data/.
   That is right for a CLI, but in a windowed app it means the window
   never appears and nothing explains why. Check first so the failure can
   be reported in a dialog. */
async function assertWritableFolder(dir) {
  /* A network share or a sync placeholder can block instead of failing,
     which would leave the window closed with no explanation forever, so
     the probe is bounded. */
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Timed out after 10 seconds while checking the folder."));
    }, 10_000);
  });

  const probe = (async () => {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `.write-test-${process.pid}`);
    await writeFile(file, "");
    await rm(file, { force: true });
  })();

  try {
    await Promise.race([probe, timeout]);
  } catch (err) {
    throw new Error(
      `Writing Studio cannot write to its writing folder.\n\n${dir}\n\n${err.message}\n\n` +
        `Choose a local folder you own — on macOS and Windows, avoid a ` +
        `sync-on-demand OneDrive/iCloud placeholder.`
    );
  } finally {
    clearTimeout(timer);
  }
}

/* A studio may already be serving this folder: a previous window, or
   `npm start` in a terminal. Reuse it instead of starting a second
   server — startServer() would exit the process in that case, which in
   a windowed app looks like an instant crash. */
async function ensureStudio(dataDir) {
  const existing = await findStudio(dataDir);
  if (existing) return `http://${HOST}:${existing}`;

  await assertWritableFolder(dataDir);

  process.env.WRITING_STUDIO_HOME = dataDir;
  const { startServer } = await import("../server.mjs");

  /* startServer() handles busy ports itself and keeps trying inside the
     range. It does not resolve once listening, so poll /api/ping.
     A rejection is remembered rather than reported here, so the failure
     is shown once by the caller's catch. */
  let startupError = null;
  Promise.resolve(startServer(FIRST_PORT, PORT_SPAN)).catch((err) => {
    startupError = err;
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    const port = await findStudio(dataDir);
    if (port) return `http://${HOST}:${port}`;
    await delay(150);
  }

  throw new Error(
    `The local server did not answer on ${HOST}:${FIRST_PORT}–${FIRST_PORT + PORT_SPAN - 1}.\n\n` +
      `Another program may be holding those ports. Quit it and open Writing Studio again.`
  );
}

/* --- Window ----------------------------------------------- */

function isStudioUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.hostname === HOST || url.hostname === "localhost";
  } catch {
    return false;
  }
}

function openExternal(raw) {
  if (!/^https?:/i.test(raw)) return;
  shell.openExternal(raw).catch(() => {
    /* No default browser, or the OS refused the scheme: nothing useful
       to do, and an error dialog would interrupt writing. */
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Writing Studio",
    backgroundColor: "#faf4e6",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  /* Links in an article are real links: give them to the browser. */
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isStudioUrl(url)) openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!isStudioUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`Writing Studio could not load ${url} (${code}: ${description})`);
  });

  window.loadURL(studioBase);
  window.on("closed", () => {
    mainWindow = null;
  });

  return window;
}

function showStartupError(err) {
  const message = err?.message || String(err);
  /* Keep a copy on stdout: a windowed launch has no visible console, but
     `npm run desktop` does, and this is the first place to look. */
  console.error(`Writing Studio failed to start: ${err?.stack || message}`);
  dialog.showErrorBox(
    "Writing Studio could not start",
    `${message}\n\nYour writing folder:\n${desktopDataDir()}`
  );
  app.quit();
}

/* --- Updates ---------------------------------------------- */

/* electron-builder publishes latest*.yml beside every release, so the
   updater only needs the app to be packaged. A failed check is logged and
   ignored: writing must never be interrupted by a network problem, and an
   unsigned macOS build will refuse the download anyway. */
async function setupAutoUpdates() {
  if (!app.isPackaged) return;
  try {
    /* electron-updater is CommonJS: depending on the Node version the
       named export arrives either on the namespace or under default. */
    const mod = await import("electron-updater");
    const autoUpdater = mod.autoUpdater || mod.default?.autoUpdater;
    if (!autoUpdater) throw new Error("electron-updater did not export autoUpdater");
    autoUpdater.on("error", (err) => {
      console.error(`Writing Studio update check failed: ${err?.message || err}`);
    });
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    console.error(`Writing Studio could not start the updater: ${err?.message || err}`);
  }
}

/* --- Lifecycle -------------------------------------------- */

app.setName("Writing Studio");
if (process.platform === "win32") app.setAppUserModelId("com.habibsnippets.writingstudio");

/* One window, one server. A second launch focuses the first window
   instead of starting a duplicate studio on another port. */
const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      studioBase = await ensureStudio(desktopDataDir());
      mainWindow = createWindow();
      /* Not awaited: a slow network must not delay the window. */
      void setupAutoUpdates();
    } catch (err) {
      showStartupError(err);
    }
  });

  app.on("activate", () => {
    /* macOS keeps the process alive with no windows; reopen the studio
       that is already listening in this process. */
    if (BrowserWindow.getAllWindows().length === 0 && studioBase) {
      mainWindow = createWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

console.log(`Writing Studio desktop starting from ${APP_DIR}`);
