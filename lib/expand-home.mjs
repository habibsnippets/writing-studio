/* ============================================================
   Turning what a person pastes into a real path.

   Folders arrive in every shape: "~/site", "~\\site", quoted paths
   copied from a file manager, and on Windows "%USERPROFILE%\\site"
   from cmd.exe. This module has no side effects, so the CLI can use
   it before the data folder is resolved.
   ============================================================ */

import path from "node:path";
import os from "node:os";

export function expandHome(input = "") {
  let value = String(input ?? "").trim();
  if (!value) return value;

  /* Quotes are part of a copied path, not of the folder name. */
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  /* cmd.exe expands %USERPROFILE% itself; PowerShell does not, so a
     pasted %VAR% survives and is expanded here. Unknown names stay as
     typed rather than turning into an empty path. */
  if (process.platform === "win32" || value.includes("%")) {
    value = value.replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, (match, name) =>
      process.env[name] !== undefined ? process.env[name] : match
    );
  }

  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}
