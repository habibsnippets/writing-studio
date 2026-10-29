/* Standalone Writing Studio — Article & Preview Runtime */
(function () {
  "use strict";

  // 1. Theme Toggle
  const root = document.documentElement;
  const themeBtn = document.getElementById("themeToggle");
  const metaTheme = document.querySelector('meta[name="theme-color"]');

  function applyTheme(name) {
    root.setAttribute("data-theme", name);
    if (metaTheme) metaTheme.setAttribute("content", name === "light" ? "#faf4e6" : "#08080a");
    if (themeBtn) {
      themeBtn.setAttribute("aria-pressed", name === "light" ? "true" : "false");
      themeBtn.setAttribute("title", name === "light" ? "Switch to dark theme" : "Switch to light theme");
    }
    try { localStorage.setItem("theme", name); } catch (e) {}
  }

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      const current = root.getAttribute("data-theme") || "light";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }

  // 2. Reading Progress Bar
  const progressBar = document.getElementById("progressBar");
  if (progressBar) {
    window.addEventListener("scroll", () => {
      const total = document.documentElement.scrollHeight - window.innerHeight;
      if (total <= 0) {
        progressBar.style.width = "0%";
      } else {
        const pct = Math.min(100, Math.max(0, (window.scrollY / total) * 100));
        progressBar.style.width = pct + "%";
      }
    }, { passive: true });
  }

  // 3. Code Block Copy Buttons
  document.querySelectorAll("pre > code").forEach((code) => {
    const pre = code.parentElement;
    if (pre.querySelector(".code-copy")) return;
    const btn = document.createElement("button");
    btn.className = "code-copy";
    btn.type = "button";
    btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.innerText);
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 1500);
      } catch (err) {}
    });
    pre.style.position = "relative";
    pre.appendChild(btn);
  });

  // 4. Year in footer
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
})();
