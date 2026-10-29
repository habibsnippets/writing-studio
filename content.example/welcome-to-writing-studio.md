# Welcome to Writing Studio

Writing Studio is a **local-first** place to write, sketch, annotate, and publish. Everything you create is stored as plain files on your computer — no account, no cloud, and no telemetry.

This starter article is created automatically on the first run. Edit it, publish it, or delete it and start something new.

---

## Three kinds of writing, one workspace

| Scope | Where it lives | What it is for |
|---|---|---|
| **Local blog** | `content/` | Publishable Markdown articles and the static site they build |
| **Private notes** | `data/notes/` | Obsidian-style notes that never appear in the blog or a Pages scan |
| **GitHub Pages** | your existing Pages repository | Writing that you publish yourself with Git |

The scope strip above the editor always tells you which one you are editing.

## Write in Markdown

The editor supports GitHub-Flavored Markdown, tables, fenced code blocks, and KaTeX mathematics:

Inline math looks natural: $f(x) = \frac{1}{1 + e^{-x}}$.

```js
const studio = "local-first";
console.log(`Writing Studio is ${studio}.`);
```

Press **Preview** and then **Recompile** (or `Ctrl/⌘ + Enter`) whenever you want a fresh render. Reading time and word counts are calculated for you.

## Draw diagrams

Open the **Draw** tab to sketch architecture diagrams, flowcharts, and notes. Shapes, connectors, hand-drawn strokes, rounded corners, and the Virgil font are all available. Use **Export area → Save to post** to place a PNG directly into the article you are writing.

## Read and annotate PDFs

Drop a PDF or an arXiv link onto the canvas, render the pages you need, then highlight, draw, or add text. Crop the annotated region with **Export area** and save it into your post.

## Keep private notes private

The **Private notes** group is a real folder tree under `data/notes/`. Notes never enter `content/posts.json`, the built blog, or a connected Pages site. Add images by dragging them into the editor; they are stored beside the note in `data/notes/.assets/`.

## Connect a GitHub Pages site

Click **Connect to Pages** in the top-right corner. The studio scans a local Pages repository read-only, asks you to confirm which folders are writing sections, and then remembers the connection in `data/workspace.json`.

In connected mode the studio writes source files only. It **never runs Git, a build, a commit, or a push**. You publish with your own terminal:

```bash
git add .
git commit -m "new writing"
git push
```

Removing a published Pages post is also safe: **⋯ → Remove from Pages…** archives the article to the Local blog first, then removes the Pages source and offers the exact Git commands to publish the removal.

## Make it yours

- Press **New note** to start a local article or a private note.
- Use the theme button for light and dark mode.
- Your AI key, if you add one, stays in your browser's local storage.
- Back up your work by copying `content/` and `data/notes/`.

Happy writing.
