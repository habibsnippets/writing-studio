<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme-hero-dark.png">
    <img src="docs/readme-hero-light.png" alt="Writing Studio — Write, Draw, Annotate, Publish" width="760">
  </picture>
</p>

<p align="center">
  <img alt="Node.js 20.11 or newer" src="https://img.shields.io/badge/Node.js-%E2%89%A520.11-339933?logo=node.js&logoColor=white">
  <img alt="Local-first" src="https://img.shields.io/badge/local--first-100%25-0f766e">
  <img alt="No telemetry" src="https://img.shields.io/badge/telemetry-none-17395c">
  <img alt="Linux, macOS, Windows" src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-555">
</p>

**Writing Studio** is a local-first writing environment for people who think in Markdown, diagrams, and annotated papers. Write an article, sketch the architecture beside it, mark up a PDF, keep private notes in a real folder tree, and publish a static blog — all from one calm interface.

There is no account, no cloud, no database, and no telemetry. Your writing stays as plain files on your disk. The only network calls are the ones you explicitly make: an AI provider you configure with your own key, and the CDN-hosted fonts used by built article pages.

---

## Table of contents

- [Why Writing Studio](#why-writing-studio)
- [Quick start](#quick-start)
- [First run](#first-run)
- [Feature guide](#feature-guide)
  - [Local blog and Markdown editor](#local-blog-and-markdown-editor)
  - [Diagram canvas](#diagram-canvas)
  - [Fullscreen focus mode](#fullscreen-focus-mode)
  - [PDF reading and annotation](#pdf-reading-and-annotation)
  - [Private notes](#private-notes)
  - [AI assistant with your own key](#ai-assistant-with-your-own-key)
  - [GitHub Pages connection](#github-pages-connection)
  - [Removing a published Pages post](#removing-a-published-pages-post)
  - [Themes and terminal logo](#themes-and-terminal-logo)
- [Your data and privacy](#your-data-and-privacy)
- [How publishing works](#how-publishing-works)
- [Project structure](#project-structure)
- [How it works](#how-it-works)
- [API reference](#api-reference)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Credits](#credits)
- [License](#license)

---

## Why Writing Studio

| You want to… | Writing Studio gives you… |
|---|---|
| Write long-form Markdown | A distraction-free editor, GFM, tables, code blocks, KaTeX math, word counts, and reading time |
| Explain an architecture | A hand-drawn canvas with shapes, connectors, rounded corners, patterns, and PNG export |
| Use the whole screen | A Fullscreen focus mode that hides the surrounding chrome and remembers your layout |
| Read a paper closely | PDF.js rendering, page-range import, highlights, pen, arrows, text, and crop-to-post |
| Keep a private notebook | An Obsidian-style folder vault under `data/notes/`, separate from everything publishable |
| Publish a blog | A local static site builder plus a manual Git workflow you control |
| Work on an existing Pages site | Read-only scanning, section confirmation, safe source edits, and archive-before-delete removal |
| Use AI without a subscription | Bring your own key for Google AI Studio, OpenRouter, Groq, OpenAI, or Anthropic |
| Keep control | Plain files, `127.0.0.1` only, no telemetry, no Git automation, and a `.gitignore` that keeps your writing out of this repository |

---

## Quick start

### Requirements

- **Node.js 20.11 or newer** — Node 22 LTS is recommended. `.nvmrc` is included, so `nvm use` selects it.
- **npm** — installed with Node.
- A modern browser: Chrome, Edge, Firefox, or Safari.
- Optional: Git, for the footer status indicator.
- Optional: a local GitHub Pages repository, if you want to write into an existing site.

Check your versions:

```bash
node -v
npm -v
```

### Install and run

```bash
git clone https://github.com/habibsnippets/writing-studio.git
cd writing-studio
npm install
npm start
```

Open **http://127.0.0.1:4321**.

`npm install` is needed once per clone. `npm start` is the everyday command. If port `4321` is busy, the server automatically tries `4322`, `4323`, and so on, then prints the URL it settled on.

Choose a different starting port:

```bash
# macOS / Linux
PORT=5000 npm start

# Windows PowerShell
$env:PORT=5000; npm start
```

The server binds to `127.0.0.1` only. It is not reachable from other machines on your network by default.

### First run

The first `npm start` creates the local store automatically:

```text
content/                 ← your publishable local blog
content/assets/          ← images and diagrams for local posts
data/notes/              ← your private note vault
data/notes/.assets/      ← private note images
dist/                    ← generated static pages
```

It also seeds a generic **Welcome to Writing Studio** article from `content.example/` so the studio opens with something to read. You can edit or delete it immediately. The seed runs only when `content/posts.json` is missing and no post files already exist; it never overwrites your work.

> **A fresh clone has no personal writing.** `content/`, `data/`, and `dist/` are intentionally ignored by Git. See [Your data and privacy](#your-data-and-privacy).

---

## Feature guide

### Local blog and Markdown editor

The **Local blog** is the studio's own publishable archive. It is separate from private notes and separate from any connected GitHub Pages site.

- Write Markdown with GitHub-Flavored Markdown: headings, lists, tables, blockquotes, task lists, fenced code, links, and images.
- Inline math: `$f(x) = \frac{1}{1 + e^{-x}}$`.
- Display math:

  ```markdown
  $$
  \mathcal{L}(\theta) = \frac{1}{N}\sum_{i=1}^{N} \ell(y_i, f(x_i; \theta))
  $$
  ```

- Press **Preview**, then **Recompile** (or `Ctrl/⌘ + Enter`) to refresh the rendered article on demand.
- Word count and reading time are calculated for each post.
- Code blocks get copy buttons; tables scroll horizontally when they are wide.
- Upload images by dragging them into the editor. They are stored in `content/assets/<slug>/` and referenced automatically.
- **Publish** marks the post live and rebuilds `dist/`; **Move back to drafts** marks it as a draft.
- **Pin from top** keeps an article at the top of the archive.
- **Download Markdown** exports the source file.
- **Open live page** opens the generated local article at `/writing/<slug>/`.

Shortcuts:

| Shortcut | Action |
|---|---|
| `Ctrl/⌘ + S` | Save |
| `Ctrl/⌘ + B` | Bold |
| `Ctrl/⌘ + I` | Italic |
| `Ctrl/⌘ + K` | Insert link |
| `Ctrl/⌘ + Enter` | Recompile preview |
| `Esc` | Exit Fullscreen focus mode |

### Diagram canvas

Open the **Draw** tab above the editor. The canvas is built for technical sketches, not polished illustrations.

- Shapes: rectangle, diamond, ellipse, line, arrow, freehand pen, highlighter, and text.
- Connectors snap to eight anchors on each shape — four corners and four edge midpoints.
- Shapes and connectors stay linked when you move or resize them.
- **Edges** can be sharp or rounded; rounded corners survive hand-drawn strokes, fills, and PNG export.
- Fills support solid, hachure, and cross-hatch styles.
- Typography options include Virgil (the hand-drawn font), Sans, Mono, and Serif.
- **Export area** crops a region; **Save to post** inserts the PNG into the active article.
- Editable canvas scenes are kept in your browser's local storage per post, so the scene is not written into the Markdown file.

Canvas shortcuts:

| Key | Tool |
|---|---|
| `V` | Select / move / resize |
| `H` or `Space` | Pan |
| `R` | Rectangle |
| `D` | Diamond |
| `O` | Ellipse |
| `L` | Line |
| `A` | Arrow |
| `P` | Pen |
| `Shift + H` | Highlighter |
| `T` | Text |

### Fullscreen focus mode

The **Fullscreen** button sits in the pane header, directly above the **Export area** control in Draw mode. It gives the current writing or drawing surface the entire browser viewport without entering the browser's own fullscreen mode, so tabs, notifications, and normal window controls stay available.

- Works in **Write**, **Draw**, and **Split**.
- Automatically closes the sidebar and preview if either is open.
- Hides the title bar, scope strip, metadata fields, action buttons, and banners.
- Keeps the pane header, mode tabs, formatting toolbar, drawing tools, and Fullscreen control visible.
- Leaves the canvas at the full viewport size, so diagrams get the maximum drawing area too.
- Click **Exit full** (or press `Esc`) to leave. Your previous sidebar and preview layout is restored.
- If you switch to Split while focused, leaving Fullscreen keeps the Split view rather than forcing the preview back open.
- Requesting the preview with `Ctrl/⌘ + Enter` while focused exits Fullscreen first, then opens the preview.

| Shortcut | Action |
|---|---|
| Click **Fullscreen** | Enter focus mode |
| Click **Exit full** or press `Esc` | Leave focus mode and restore the previous layout |

### PDF reading and annotation

PDFs are rendered locally with PDF.js — no upload service, no conversion server.

1. Open the **Draw** tab.
2. Click **PDF**, paste a PDF or arXiv URL, or drag a `.pdf` file onto the canvas.
3. Choose **All pages** or a range such as `1-3, 5`.
4. Annotate with the **Highlighter**, **Pen**, **Arrow**, and **Text** tools.
5. Use **Export area** to crop the annotated region, then **Save to post**.

Remote PDFs are streamed through `/api/proxy-pdf` so the browser can read them without CORS problems. The file is not stored on disk.

### Private notes

The **Private notes** group in the sidebar is a real folder vault under `data/notes/`.

- **New note** creates a Markdown file and opens it immediately.
- **+** beside the Private notes header creates a folder.
- **+** beside a folder creates a note inside it.
- Folders are real directories and can be nested as deep as you like.
- Note images are stored in `data/notes/.assets/<note-key>/` and served through `/note-assets/`.
- Notes use frontmatter for `title`, `created`, and `updated`; the body is ordinary Markdown.
- The status chip says **Private**, and Publish / Pin / Unpublish are not offered.
- Deleting a note or folder is permanent; the confirmation dialog tells you how many notes will be removed.

Private notes never enter `content/posts.json`, `dist/`, the local blog list, a connected Pages scan, or a Pages preview.

### AI assistant with your own key

Writing Studio has an **AI Line Explainer** for PDF pages and canvas diagrams. It uses your own provider key — there is no shared key and no subscription.

1. Open **AI Assistant Settings** from the top bar.
2. Choose a provider.
3. Pick a model, or enter a custom model ID.
4. Paste your API key.
5. Press **Test connection**, then **Save Settings**.

Supported providers:

| Provider | Notes |
|---|---|
| **Google AI Studio** | Gemini models, including a free tier |
| **OpenRouter** | Free community models and paid models |
| **Groq** | Fast inference and a free tier |
| **OpenAI** | GPT-4o and GPT-4o Mini |
| **Anthropic** | Claude models |

The key is stored in your browser's `localStorage` under `writing-studio:ai-config`. Requests go to the local server, which forwards them to the provider you chose. The key is **not** written to `content/`, `data/`, the repository, or a server log. Because browser storage is not encrypted, use a dedicated browser profile on a shared computer, and remove the key in Settings when you are done.

### GitHub Pages connection

Writing Studio can write directly into an existing GitHub Pages site on your computer. It is designed for people who already keep a blog, notes, or docs in a Pages repository and publish with Git themselves.

1. Click the GitHub button in the top-right corner (**Connect to Pages**).
2. Enter the local folder of your Pages repository, for example `~/username.github.io`.
3. The studio performs a **read-only scan**. It detects the generator and finds writing folders such as `_posts`, `_drafts`, `notes`, `blog`, `content/articles`, or `src/content/posts`.
4. Confirm which folders are writing sections. You can rename them, uncheck anything that is not writing, or add a folder manually.
5. Click **Connect this site**.

The studio starts disconnected every time it opens, even if a site is already saved. Click **Connect to Pages** and use **Reconnect** to resume the last site in one click, or scan a different folder. Nothing is read from the Pages repository until you connect.

Once connected:

- The sidebar lists writing grouped by section. Open a file, edit it, and press **Save** — the source file is written in place.
- New posts follow the site's existing conventions. Jekyll-style `_drafts` is supported: choose the **Drafts** section to create a draft there.
- Images are saved under the site's detected asset folder (for example `assets/writing-studio/<post>/`) and inserted with the correct public path.
- If a section has a `posts.json` index, the studio uses it for titles, dates, descriptions, and word counts, and hides known non-post files such as `README.md` or migration notes. Saving a Markdown post keeps its `posts.json` entry in step.
- Imported `.html` posts (for example a Bearblog archive) are listed and previewable, but they are **read-only**. Edit those files directly in your editor; the studio will not rewrite them. They can still be removed with **Remove from Pages…**, which archives the raw HTML locally.
- Generated output such as `writing/<slug>/index.html` is ignored during scanning. Only source files in the confirmed sections are read or written.
- The studio **never runs Git, a build, a commit, or a push** for the connected site. Publish, Pin, and Unpublish are hidden in connected mode; the menu's delete action becomes **Remove from Pages…**.
- Private notes stay in `data/notes/` and remain in their own sidebar group. They are never listed as connected-site writing, never scanned from the Pages repo, and never written into it.
- Existing frontmatter and body content are preserved. Only the fields the studio understands (title, date, description, draft state) are updated.

The connection is stored in `data/workspace.json`, outside the Pages repository and ignored by Git. The scanner understands Jekyll / GitHub Pages, Hugo, Astro, Eleventy, Next.js, Nuxt, Gatsby, Docusaurus, VitePress, MkDocs, and plain static sites.

### Removing a published Pages post

Open a connected-site post and choose **⋯ → Remove from Pages…**. The studio:

1. **Archives first** — copies the post to the **Local blog** as a draft. Markdown stays Markdown; imported HTML stays HTML.
2. Copies referenced local images and downloads into `content/assets/<slug>/`, rewriting the paths for the local copy. Code blocks are left untouched.
3. Deletes the source file from the Pages repo and removes its `posts.json` entry when the site keeps one.
4. Opens the archived copy as a local draft so you can edit a Markdown copy, preview an HTML copy, publish the local draft, or copy it back into the Pages site later.
5. Shows the exact commands needed to publish the removal, including a stale built page when one is detected and the site's own build command.

The studio never runs those commands. Review them, then run them in your terminal. A typical removal looks like this:

```bash
cd '/path/to/your-site'
rm -rf 'writing/<slug>'
npm run build
git status --short
git add -A
git commit -m 'Remove <title>'
git push
```

The original images stay in the Pages repo; the local archive has its own copies. HTML archives are read-only previews, just like other imported HTML posts, but they can be deleted from the Local blog whenever you want.

If the Pages source cannot be deleted after the archive is written, the local copy remains and the error tells you what happened. Nothing is silently lost.

### Themes and terminal logo

- The top-bar theme button switches the studio between light and dark.
- Built article pages follow the saved theme and the operating system preference.
- `npm start` draws a Writing Studio wordmark in the terminal. Its palette adapts to a light or dark terminal using an OSC 11 background query, with `COLORFGBG` / `COLOR_SCHEME` fallbacks.
- Color is skipped for non-TTY output, `NO_COLOR`, `CLICOLOR=0`, `FORCE_COLOR=0`, and `TERM=dumb`; the logo still prints as plain ASCII.

Force a terminal theme when needed:

```bash
WRITING_STUDIO_THEME=light npm start
WRITING_STUDIO_THEME=dark npm start
npm start -- --light
npm start -- --dark
```

---

## Your data and privacy

### Where everything lives

| Path | Contents | In Git? |
|---|---|---|
| `content/posts.json` | Local blog index: titles, dates, tags, draft and pinned flags | **No** |
| `content/<slug>.md` | Local blog articles | **No** |
| `content/<slug>.html` | Archived or imported HTML articles | **No** |
| `content/assets/<slug>/` | Local post images and exported diagrams | **No** |
| `data/notes/` | Private notes, in real folders | **No** |
| `data/notes/.assets/` | Private note images | **No** |
| `data/workspace.json` | Saved GitHub Pages path and confirmed sections | **No** |
| `dist/` | Generated static pages | **No** |
| `node_modules/` | Installed dependencies | **No** |
| `content.example/` | Safe first-run starter article | Yes |
| `public/` | Studio UI, logos, fonts, and article styles | Yes |
| `lib/` | Server-side modules | Yes |
| `server.mjs` | Local HTTP server | Yes |
| `package.json`, `package-lock.json` | Dependencies and scripts | Yes |

### What the `.gitignore` protects

The repository is configured so a normal `git add .` never publishes your writing or local configuration. It ignores:

- `content/` — your blog posts and their images.
- `data/` — private notes and the saved Pages connection.
- `dist/` — generated article pages.
- `node_modules/` — installed dependencies.
- `.env`, `.env.*`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `*.crt`, `secrets/`, `credentials/`.
- Local databases, caches, temporary uploads, backups, editor settings, and OS clutter.

`content.example/` is deliberately tracked so a fresh clone has a safe first-run article. It contains no personal writing.

### API keys

- AI provider keys are entered in the UI and stored only in your browser's local storage.
- The local server forwards requests to the provider you choose; it does not persist the key.
- No key belongs in a repository file. The `.gitignore` excludes `.env` files and common key formats as a safety net.
- If you ever commit a key by accident, revoke it with the provider immediately. Removing the file in a later commit is not enough — Git history keeps it.

### Backup and moving

Copy `content/` and `data/notes/` to keep your writing. Copy `data/workspace.json` only if you want to keep the connected-site configuration on the new machine.

To move the app:

1. Copy the project folder, excluding `node_modules/`.
2. Run `npm install` on the new machine.
3. Put `content/` and `data/` back if you brought them.
4. Run `npm start`.

The local blog, private notes, and connected Pages site use ordinary files, so they remain readable even without Writing Studio.

### Network surface

- The server listens on `127.0.0.1` only.
- There is no authentication because there is no remote access. Do not expose the port to the public internet or a shared network without putting an authenticated proxy in front of it.
- AI requests and remote PDF fetches are the only outbound calls the server makes on your behalf.
- Built article pages load KaTeX CSS and web fonts from public CDNs. Offline they fall back to system fonts and plain math layout.

---

## How publishing works

### Local blog

**Publish** writes the post metadata to `content/posts.json` and rebuilds `dist/`:

- `dist/index.html` — the archive of published articles.
- `dist/<slug>/index.html` — each published article.
- `dist/assets/<slug>/` — copied post images.

Drafts are skipped during the build, so unfinished work never appears on the local site. The local site is for previewing and for keeping a portable static archive; it is not pushed anywhere automatically.

### GitHub Pages

The studio writes **source files only** into the connected repository. It never runs Git, a build, a commit, or a push for that repository.

When you are ready, publish from your own terminal:

```bash
cd /path/to/your-site
git add .
git commit -m "new writing"
git push
```

If your Pages site has a build step, run it before committing, exactly as you normally would. The removal dialog detects common build commands and includes the appropriate one in its suggested commands.

---

## Project structure

```text
writing-studio/
├── content.example/           # Safe starter article copied on first run
│   ├── posts.json
│   └── welcome-to-writing-studio.md
├── content/                   # Your local blog (gitignored)
│   ├── posts.json
│   ├── <slug>.md
│   ├── <slug>.html
│   └── assets/<slug>/
├── data/                      # Private local state (gitignored)
│   ├── notes/
│   │   └── .assets/
│   └── workspace.json
├── dist/                      # Generated static site (gitignored)
├── docs/                      # README hero images
├── lib/
│   ├── banner.mjs             # Terminal wordmark and theme detection
│   ├── builder.mjs            # Static site builder
│   ├── frontmatter.mjs        # Safe frontmatter parsing and updates
│   ├── md.mjs                 # Markdown, HTML, and KaTeX rendering
│   ├── notes.mjs              # Private note vault
│   ├── post-page.mjs          # Article HTML shell
│   ├── site-archive.mjs       # Archive a Pages post locally, then remove it
│   ├── site-scanner.mjs       # Read-only Pages repository discovery
│   └── site-workspace.mjs     # Connected-site reads, writes, and safety
├── public/
│   ├── assets/                # Logo, favicon, and brand images
│   ├── fonts/                 # Virgil hand-drawn font and license
│   ├── canvas.css
│   ├── canvas.js              # Diagram and PDF annotation engine
│   ├── index.html             # Studio shell
│   ├── main.js                # Article runtime
│   ├── studio.css
│   ├── studio.js              # Studio client logic
│   └── styles.css             # Article typography
├── .gitattributes
├── .gitignore
├── .nvmrc
├── package.json
├── package-lock.json
├── README.md
└── server.mjs
```

---

## How it works

Writing Studio is a small Node.js HTTP server plus a browser application. There is no framework, bundler, database, or background service.

```text
Browser (127.0.0.1:4321)
   │
   ├── public/index.html + studio.js + canvas.js
   │
   ▼
Node HTTP server (server.mjs)
   │
   ├── content/         local blog source and images
   ├── data/notes/      private note vault
   ├── data/workspace.json
   ├── dist/            generated static pages
   └── lib/             Markdown, builder, scanner, archive, notes
```

- Markdown is rendered with `marked`; math is rendered at build time with KaTeX.
- PDF pages are rendered in the browser with PDF.js and kept on the canvas.
- The diagram canvas is client-side; exported PNGs are written into the post's asset folder.
- The connected-site scanner opens the repository read-only first and writes only inside the sections you confirm.
- Removal is archive-first: the local copy is written before the Pages source is deleted.
- The open HTML posts are previewed through a read-only iframe; the studio never rewrites them.

---

## API reference

The API is local to `127.0.0.1` and is used by the studio UI. It is documented here for debugging and automation.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/posts` | List local posts, counts, and optional Git status |
| `GET` | `/api/post?slug=<slug>` | Read one local post |
| `POST` | `/api/post` | Save a local post and its metadata |
| `POST` | `/api/upload?slug=<slug>` | Upload an image or diagram into a local post |
| `POST` | `/api/preview` | Render a local Markdown preview |
| `POST` | `/api/publish` | Mark a local post published and rebuild `dist/` |
| `POST` | `/api/unpublish` | Move a local post back to drafts |
| `POST` | `/api/delete` | Delete a local post and its assets |
| `GET` | `/api/export?slug=<slug>` | Download a post's Markdown source |
| `GET` | `/api/notes/tree` | List private notes, folders, and counts |
| `GET` | `/api/notes/note?path=<path>` | Read one private note |
| `POST` | `/api/notes/create` | Create a private note |
| `POST` | `/api/notes/note` | Save a private note |
| `POST` | `/api/notes/delete` | Delete a private note and its images |
| `POST` | `/api/notes/folder` | Create a private folder |
| `POST` | `/api/notes/folder/delete` | Delete a private folder and everything inside |
| `POST` | `/api/notes/preview` | Render a private note preview |
| `POST` | `/api/notes/upload?path=<path>` | Upload a private note image |
| `GET` | `/note-assets/<path>` | Serve private note images |
| `GET` | `/api/workspace` | Read the saved Pages connection |
| `POST` | `/api/workspace/scan` | Read-only scan of a Pages repository |
| `POST` | `/api/workspace/inspect` | Inspect one additional writing folder |
| `POST` | `/api/workspace/connect` | Save the confirmed site and sections |
| `POST` | `/api/workspace/disconnect` | Forget the saved connection |
| `GET` | `/api/workspace/posts` | List writing from the connected site |
| `GET` | `/api/workspace/post?id=<path>` | Read one connected-site Markdown or HTML file |
| `POST` | `/api/workspace/post` | Save a connected-site Markdown file |
| `POST` | `/api/workspace/preview` | Render a connected-site preview |
| `POST` | `/api/workspace/upload?id=<path>` | Upload an image into the connected site |
| `POST` | `/api/workspace/remove` | Archive a post locally, then remove it from Pages |
| `POST` | `/api/workspace/delete` | Alias for `/api/workspace/remove` |
| `GET` | `/site-assets/<path>` | Serve images referenced by connected-site previews |
| `POST` | `/api/ai/test` | Test an AI provider key |
| `POST` | `/api/ai/explain` | Explain a PDF region or diagram |
| `GET, POST` | `/api/proxy-pdf` | Stream a remote PDF, such as an arXiv paper |
| `GET` | `/writing/` | Local blog archive |
| `GET` | `/writing/<slug>/` | One local article |
| `GET` | `/node_modules/pdfjs-dist/*` | PDF.js worker and assets |

---

## Development

Writing Studio intentionally has no build step. The browser loads `public/` directly, and Node runs `server.mjs` directly.

```bash
npm install
npm run check     # syntax-check the server and main browser scripts
npm start
npm run build     # rebuild the local static site without starting the server
```

Useful places to start:

- `server.mjs` — routes, static serving, local post storage, AI proxy.
- `public/studio.js` — editor, sidebar, local blog, private notes, connected-site UI.
- `public/canvas.js` — diagram engine, PDF.js integration, AI line explainer.
- `lib/site-scanner.mjs` — read-only Pages repository discovery.
- `lib/site-workspace.mjs` — connected-site reads, writes, and section safety.
- `lib/site-archive.mjs` — archive-before-remove flow.
- `lib/builder.mjs` — static site output.

The project uses plain ES modules and vanilla CSS/JavaScript. Keep changes small and consistent with the existing file structure. There is no test suite yet; `npm run check` catches syntax errors, and the app is designed to be exercised manually against a throwaway Pages fixture.

When testing connected-site changes, use a disposable copy of a Pages repository. The studio's safety rules are intentionally conservative, but a real repository is still the best place to verify section detection and removal behavior.

---

## Troubleshooting

### The page will not load

Use the exact URL printed by the terminal. If port `4321` was busy, the server may be on `4322` or later. The footer and terminal banner show the active URL and counts.

### `Cannot find module 'marked'`

Dependencies are not installed. Run:

```bash
npm install
```

### `Writing Studio needs Node.js 20.11 or newer`

Upgrade Node. With nvm:

```bash
nvm install --lts
nvm use --lts
```

Or install the current LTS from [nodejs.org](https://nodejs.org).

### The terminal logo is plain text

Color is disabled for non-TTY output, `NO_COLOR`, `CLICOLOR=0`, `FORCE_COLOR=0`, and `TERM=dumb`. The ASCII logo still prints. Force a theme with `WRITING_STUDIO_THEME=light` or `WRITING_STUDIO_THEME=dark`.

### A connected Pages folder is rejected

The scanner requires an existing local directory. Use the full path, check that the folder contains the site source (not only generated `dist/` output), and confirm the writing section in the wizard. The studio will not write outside the sections you confirm.

### HTML posts are read-only

Imported or archived `.html` posts are previewed as raw HTML. The studio does not rewrite them because that would risk corrupting a migrated Bearblog or static archive. Edit the `.html` file directly in your editor; it can still be removed with **Remove from Pages…**.

### The AI test fails

Check the provider, model ID, and key. Free tiers can have quota limits. OpenRouter and Groq may require a model that supports images for diagram/PDF explanations. The key is stored in your browser, so clearing site data removes it.

### Git status says `unavailable`

Git is optional. The studio works without it. The footer status is only a convenience.

### My posts disappeared after `git clean`

`content/` is intentionally ignored. `git clean -fdx` removes ignored files, including your local writing. Back up `content/` and `data/notes/` before running destructive Git commands. The same applies to `dist/` and `node_modules/`.

---

## FAQ

**Does Writing Studio upload my writing anywhere?**

No. It runs locally and stores writing as files. The only outbound requests are AI calls you initiate and remote PDF fetches you request. Built article pages load KaTeX CSS and web fonts from public CDNs.

**Does it need GitHub?**

No. The Local blog and private notes work entirely offline. GitHub Pages is an optional connected mode for people who already publish with Git.

**Does it run Git or deploy for me?**

No. It never runs Git, a build, a commit, or a push for a connected Pages repository. It shows the commands; you decide when to run them.

**Where is my AI key stored?**

In your browser's `localStorage` under `writing-studio:ai-config`. It is not written to the repository or to a server file. Use a dedicated browser profile on a shared machine.

**Can I use it on a remote server?**

The server binds to `127.0.0.1`, so it is local-only by default. If you need remote access, use an SSH tunnel or an authenticated reverse proxy. Do not expose the port directly to the internet.

**Can I edit the HTML posts imported from Bearblog?**

You can preview them, and you can remove them with the archive flow. Editing is intentionally disabled; edit the `.html` file directly.

**How do I back up everything?**

Copy `content/` and `data/notes/`. Copy `data/workspace.json` only if you want to keep the Pages connection.

**Can I use multiple Pages sites?**

One site is connected at a time. Disconnect or scan a different folder to switch.

**Why is `content/` ignored in this repository?**

Because this is the app repository, not your writing archive. Ignoring `content/` and `data/` keeps personal writing, private notes, and local paths out of Git. A separate repository can hold your published site if you want to version it.

**Is there a license?**

No license file is included yet. See [License](#license).

---

## Credits

- **Plus Jakarta Sans** — brand wordmark typography in the README hero and UI brand font. SIL Open Font License.
- **Virgil** — hand-drawn canvas font. The license is included at `public/fonts/Virgil-LICENSE.md`.
- **KaTeX** — server-side math rendering.
- **marked** — Markdown parsing.
- **PDF.js** — local PDF rendering.
- **GitHub** — the Pages connection is designed around a normal Git workflow.

Writing Studio is built as a local tool, with a bias toward plain files, readable source, and workflows you can inspect.

---

## License

This repository does not include a `LICENSE` file yet. The source is publicly visible, but that is not the same as an open-source license. If you plan to redistribute Writing Studio, publish a fork, or accept contributions, add a license that matches your intent — for example MIT for permissive reuse — before doing so.
