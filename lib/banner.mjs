/* ============================================================
   Startup banner for `npm start`.

   The logo is plain ASCII so it survives copy/paste and screen
   readers. When the terminal supports colour, the wordmark is
   tinted from a light/dark-aware palette. The theme is discovered
   from the terminal itself with an OSC 11 background query, with
   COLORFGBG / COLOR_SCHEME and explicit flags as fallbacks.
   ============================================================ */

const ART = [
  "██╗    ██╗██████╗ ██╗████████╗██╗███╗   ██╗ ██████╗",
  "██║    ██║██╔══██╗██║╚══██╔══╝██║████╗  ██║██╔════╝",
  "██║ █╗ ██║██████╔╝██║   ██║   ██║██╔██╗ ██║██║  ███╗",
  "██║███╗██║██╔══██╗██║   ██║   ██║██║╚██╗██║██║   ██║",
  "╚███╔███╔╝██║  ██║██║   ██║   ██║██║ ╚████║╚██████╔╝",
  " ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝╚═╝  ╚═══╝ ╚═════╝ ",
  "",
  "███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗",
  "██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗",
  "███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║",
  "╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║",
  "███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝",
  "╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ ",
];

const PALETTES = {
  dark: {
    start: [125, 211, 252],
    end: [45, 212, 191],
    accent: [251, 191, 36],
    dim: [148, 163, 184],
    faint: [100, 116, 139],
  },
  light: {
    start: [11, 79, 138],
    end: [15, 118, 110],
    accent: [180, 83, 9],
    dim: [71, 85, 105],
    faint: [100, 116, 139],
  },
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function mix(a, b, t) {
  return a.map((value, i) => Math.round(value + (b[i] - value) * t));
}

function to256([r, g, b]) {
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 24);
  }
  const q = (value) => Math.round((value / 255) * 5);
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

function foreground(rgb, { truecolor }) {
  if (truecolor) return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  return `\x1b[38;5;${to256(rgb)}m`;
}

function supportsTrueColor() {
  return (
    /truecolor|24bit/i.test(process.env.COLORTERM || "") ||
    /iTerm|WezTerm|kitty|vscode|Windows Terminal|Apple_Terminal|Hyper/i.test(process.env.TERM_PROGRAM || "") ||
    /-direct$/i.test(process.env.TERM || "")
  );
}

export function colorEnabled(stream = process.stdout) {
  if ("NO_COLOR" in process.env) return false;
  if (process.env.CLICOLOR === "0") return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.TERM === "dumb") return false;
  if (process.env.FORCE_COLOR) return true;
  return !!stream.isTTY;
}

function themeFromColorFgBg(value) {
  const parts = String(value || "").split(";").filter(Boolean);
  const background = Number(parts[parts.length - 1]);
  if (!Number.isFinite(background)) return null;
  if (background <= 6 || background === 8) return "dark";
  if (background === 7 || background >= 9) return "light";
  return null;
}

function parseBackground(value) {
  const text = String(value || "").trim();

  const rgb = text.match(/rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i);
  if (rgb) {
    const scale = (hex) => {
      const n = parseInt(hex, 16);
      return hex.length <= 2 ? n : Math.round((n / 0xffff) * 255);
    };
    return [scale(rgb[1]), scale(rgb[2]), scale(rgb[3])];
  }

  const hex = text.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i);
  if (hex) {
    let value = hex[1];
    if (value.length === 3) value = value.split("").map((ch) => ch + ch).join("");
    return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
  }

  return null;
}

function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function queryTerminalBackground({ input, output, timeout }) {
  return new Promise((resolve) => {
    if (!input?.isTTY || !output?.isTTY) return resolve(null);

    let data = "";
    let done = false;
    let timer;

    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      input.off("data", onData);
      try {
        input.setRawMode(false);
      } catch {}
      try {
        input.pause();
      } catch {}
      resolve(value);
    };

    const onData = (chunk) => {
      data += chunk.toString("utf8");
      const match = data.match(/\x1b\]11;([^\x07\x1b]+)(?:\x07|\x1b\\)/);
      if (match) finish(match[1]);
    };

    try {
      input.setRawMode(true);
      input.resume();
      input.on("data", onData);
    } catch {
      return resolve(null);
    }

    /* OSC 11 asks the terminal for its background colour. Terminals
       that do not understand it simply never answer. */
    output.write("\x1b]11;?\x07");
    timer = setTimeout(() => finish(null), timeout);
  });
}

export async function detectTerminalTheme({ input = process.stdin, output = process.stdout, timeout = 180 } = {}) {
  const forced = String(process.env.WRITING_STUDIO_THEME || process.env.WRITING_STUDIO_COLOR_SCHEME || "").toLowerCase();
  if (forced === "light" || forced === "dark") return forced;
  if (process.argv.includes("--light")) return "light";
  if (process.argv.includes("--dark")) return "dark";

  const scheme = String(process.env.COLOR_SCHEME || "").toLowerCase();
  if (scheme === "light" || scheme === "dark") return scheme;

  const background = await queryTerminalBackground({ input, output, timeout });
  const parsed = parseBackground(background);
  if (parsed) return luminance(parsed) > 0.42 ? "light" : "dark";

  const fromEnv = themeFromColorFgBg(process.env.COLORFGBG);
  if (fromEnv) return fromEnv;

  return "dark";
}

export function renderBanner({ theme = "dark", color = true, port = 4321, published = 0, drafts = 0, notes = 0, connected = "" } = {}) {
  const palette = PALETTES[theme] || PALETTES.dark;
  const truecolor = supportsTrueColor();

  const paint = (rgb, text, prefix = "") => (color ? `${prefix}${foreground(rgb, { truecolor })}${text}${RESET}` : text);
  const accent = (text) => paint(palette.accent, text);
  const dim = (text) => paint(palette.dim, text, DIM);
  const faint = (text) => paint(palette.faint, text);

  const lines = [""];
  ART.forEach((line, index) => {
    if (!line) {
      lines.push(`  ${accent("▌")}`);
      return;
    }
    const t = index / Math.max(1, ART.length - 1);
    lines.push(`  ${accent("▌")} ${paint(mix(palette.start, palette.end, t), line, BOLD)}`);
  });

  const draftLabel = `${drafts} draft${drafts === 1 ? "" : "s"}`;
  const noteLabel = `${notes} private note${notes === 1 ? "" : "s"}`;
  const status = [`${published} published`, draftLabel, noteLabel];
  if (connected) status.push(`Pages saved · ${connected}`);

  lines.push(`  ${accent("▌")}`);
  lines.push(`  ${accent("▌")}  ${dim("private notes · markdown · github pages")}`);
  lines.push(`  ${accent("▌")}  ${paint(palette.start, `http://127.0.0.1:${port}`, BOLD)}`);
  lines.push(`  ${accent("▌")}  ${faint(status.join(" · "))}`);
  lines.push(`  ${accent("▌")}`);
  lines.push(`  ${accent("▌")}  ${dim("Press Ctrl+C to stop")}`);
  lines.push("");

  return lines.join("\n");
}

export async function printBanner(options = {}) {
  const theme = await detectTerminalTheme();
  const color = colorEnabled(process.stdout);
  process.stdout.write(renderBanner({ ...options, theme, color }) + "\n");
}
