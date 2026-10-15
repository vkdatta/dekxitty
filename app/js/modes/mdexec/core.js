/**
 * mdexec — "exec" view for Markdown notes.
 *
 *  • A `.md` note whose view mode is "exec" (chosen per file with the raw / exec
 *    toggle in sidebar 1 — see js/modes/viewmode/viewmode.js) shows a live,
 *    rendered document instead of the CodeMirror editor. "raw" shows the editor.
 *  • What gets executed:
 *      – GitHub-flavoured Markdown (tables, task lists, strikethrough, autolinks…)
 *      – ```mermaid fences are drawn as diagrams
 *      – task-list checkboxes are live: ticking one rewrites that line in the note
 *      – heading anchors (#links) scroll within the document
 *  • The note's `content` is never changed by merely viewing it, and the hidden
 *    editor stays bound to it, so undo, sidebar functions, download and sync all
 *    keep working; the preview re-renders whenever the text changes underneath.
 *  • Output is always sanitised (DOMPurify) — a note can contain arbitrary HTML.
 *
 * Mirrors csvexec/core.js: one pane inside #textAreaWrapper, shown by a body
 * class that also hides the editor.
 */

// Per-diagram theme via an init directive (works on every mermaid 10.x/11.x; frontmatter config only exists on newer 10.x).
const THEME_DIRECTIVE = () =>
  `%%{init: {"theme": "${document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark"}"}}%%\n`;

// Diffusion / Mermaid need the plain editor for their panes, so exec stands down while they run.
const wantsPreview = (n) => !!n && !!window.dexView && window.dexView.isExec(n, "md") && !window.dexView.exclusiveActive();

/* ───────── pure helpers (no DOM) ───────── */

/** Line indexes of every "- [ ]" / "1. [x]" task marker that is NOT inside a fenced code block. */
export function findTaskLines(src) {
  const lines = String(src).split(/\r?\n/);
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = l.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(l)) fence = null;
      continue;
    }
    if (f) { fence = f[1]; continue; }
    if (/^(?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\](?:\s|$)/.test(l)) out.push(i);
  }
  return out;
}

/** Flip the checkbox on one line; returns the new line text. */
export function setTaskChecked(line, checked) {
  return line.replace(/^((?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])\s+)\[[ xX]\]/, (_, pre) => pre + "[" + (checked ? "x" : " ") + "]");
}

export function slugify(text) {
  return String(text).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-");
}

/* ───────── boot ───────── */

function boot() {
  const wrapper = document.getElementById("textAreaWrapper");
  if (!wrapper || !window.dexEditor || !window.dexEditor.cm || !window.dexView) { setTimeout(boot, 60); return; }
  if (document.getElementById("mdexecPane")) return;

  const pane = document.createElement("div");
  pane.id = "mdexecPane";
  pane.innerHTML = '<div class="mdx-scroll"><article class="mdx-body"></article></div>';
  wrapper.appendChild(pane);
  const scroller = pane.querySelector(".mdx-scroll");
  const body = pane.querySelector(".mdx-body");

  let activeNote = null;   // note the preview is bound to
  let selfWrite = false;   // true while WE edit the hidden editor (ticking a checkbox)
  let renderGen = 0;       // bumps on every render so a slow mermaid draw can't land on a newer page
  let lastSrc = null;      // source the DOM currently reflects
  let mmCounter = 0;
  let timer = null;
  let purify = null;

  const notify = (m) => { if (typeof showNotification === "function") showNotification(m); };
  const source = () => window.dexEditor.getValue();

  /* ----- rendering ----- */

  function libsReady() { return !!(window.marked && window.DOMPurify); }

  function getPurify() {
    if (purify) return purify;
    purify = window.DOMPurify(window);   // own instance: our link hook must not leak into anyone else's use
    purify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName !== "A" || !node.hasAttribute("href")) return;
      if ((node.getAttribute("href") || "").startsWith("#")) { node.removeAttribute("target"); return; }
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    });
    return purify;
  }

  function toHtml(src) {
    const raw = window.marked.parse(src, { gfm: true, breaks: false, async: false });
    return getPurify().sanitize(raw, { USE_PROFILES: { html: true } });
  }

  function addHeadingIds() {
    const seen = Object.create(null);
    body.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      let id = slugify(h.textContent) || "section";
      if (seen[id] != null) id += "-" + (++seen[id]); else seen[id] = 0;
      h.id = "mdx-" + id;
    });
    // hrefs were written as "#slug"; point them at the prefixed ids
    body.querySelectorAll('a[href^="#"]').forEach((a) => {
      const slug = decodeURIComponent((a.getAttribute("href") || "").slice(1));
      a.setAttribute("href", "#mdx-" + slugify(slug).replace(/^mdx-/, ""));
    });
  }

  function wireCheckboxes(src) {
    const boxes = [...body.querySelectorAll('input[type="checkbox"]')];
    if (!boxes.length) return;
    const lines = findTaskLines(src);
    // If the document's checkboxes don't line up 1:1 with task markers in the source (raw HTML
    // inputs, exotic nesting), leave them read-only rather than risk ticking the wrong line.
    if (lines.length !== boxes.length) { boxes.forEach((b) => { b.disabled = true; }); return; }
    boxes.forEach((box, i) => {
      box.disabled = false;
      box.classList.add("mdx-task");
      box.addEventListener("change", () => toggleTask(lines[i], box.checked, box));
    });
  }

  function toggleTask(lineNo, checked, box) {
    const note = activeNote;
    const cm = window.dexEditor.cm;
    if (!note || note !== currentNote || lineNo >= cm.lineCount()) { box.checked = !checked; return; }
    const old = cm.getLine(lineNo);
    const next = setTaskChecked(old, checked);
    if (next === old) { box.checked = !checked; return; }
    selfWrite = true;
    try { cm.replaceRange(next, { line: lineNo, ch: 0 }, { line: lineNo, ch: old.length }); }
    finally { selfWrite = false; }
    const v = source();
    lastSrc = v;                           // the DOM already shows this state — no re-render needed
    if (note.content !== v) { note.content = v; note.lastEdited = new Date().toISOString(); note._dirty = true; }
    if (typeof saveNotes === "function") saveNotes();
    if (typeof updateDocumentInfo === "function") updateDocumentInfo();
    if (typeof populateNoteList === "function") populateNoteList();
  }

  async function drawMermaid(gen) {
    const blocks = [...body.querySelectorAll("pre > code.language-mermaid")];
    for (const code of blocks) {
      const pre = code.parentElement;
      const text = code.textContent || "";
      const holder = document.createElement("div");
      holder.className = "mdx-mermaid";
      pre.replaceWith(holder);
      const fail = (msg) => {
        holder.classList.add("mdx-mermaid-err");
        holder.textContent = "";
        const m = document.createElement("div"); m.className = "mdx-mermaid-msg"; m.textContent = msg;
        const p = document.createElement("pre"); p.textContent = text;
        holder.append(m, p);
      };
      if (!window.mermaid || typeof window.mermaid.render !== "function") { fail("Mermaid library not loaded"); continue; }
      const id = "mdxm" + (++mmCounter);
      try {
        // Per-diagram theme via a directive: we never touch mermaid's global config, which the
        // Mermaid Flow mode owns (and tunes with the user's colours).
        const input = /^\s*(---|%%\{)/.test(text) ? text : THEME_DIRECTIVE() + text;
        const { svg } = await window.mermaid.render(id, input);
        if (gen !== renderGen) return;
        // Mermaid Flow runs mermaid with securityLevel "loose" globally, so don't trust the SVG blindly.
        holder.innerHTML = getPurify().sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true, html: true },
          ADD_TAGS: ["foreignObject"], HTML_INTEGRATION_POINTS: { foreignobject: true }
        });
      } catch (e) {
        const leaked = document.getElementById("d" + id); if (leaked) leaked.remove();
        const leaked2 = document.getElementById(id); if (leaked2) leaked2.remove();
        if (gen !== renderGen) return;
        fail("Mermaid error: " + String((e && e.message) || e).split("\n")[0]);
      }
    }
  }

  function render(force) {
    if (!activeNote) return;
    const src = source();
    if (!force && src === lastSrc) return;
    if (!libsReady()) {
      body.innerHTML = '<p class="mdx-note">Loading renderer…</p>';
      lastSrc = null;
      clearTimeout(timer); timer = setTimeout(() => render(true), 150);
      return;
    }
    lastSrc = src;
    const gen = ++renderGen;
    const top = scroller.scrollTop;
    if (!src.trim()) {
      body.innerHTML = '<p class="mdx-note">This file is empty. Switch to <b>raw</b> to write something.</p>';
      return;
    }
    try { body.innerHTML = toHtml(src); }
    catch (e) { body.textContent = "Could not render this file: " + ((e && e.message) || e); return; }
    addHeadingIds();
    wireCheckboxes(src);
    scroller.scrollTop = top;
    drawMermaid(gen).then(() => { if (gen === renderGen) scroller.scrollTop = top; });
  }

  function scheduleRender() { clearTimeout(timer); timer = setTimeout(() => render(false), 120); }

  /* ----- interaction ----- */

  body.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    const t = body.querySelector("#" + (window.CSS && CSS.escape ? CSS.escape(a.getAttribute("href").slice(1)) : a.getAttribute("href").slice(1)));
    if (t) t.scrollIntoView({ block: "start", behavior: "smooth" });
  });

  /* ----- activation, same shape as csvexec ----- */

  function activate(note) {
    activeNote = note;
    lastSrc = null;
    document.body.classList.add("mdexec-active");
    scroller.scrollTop = 0;
    render(true);
  }
  function deactivate() {
    activeNote = null;
    lastSrc = null;
    renderGen++;
    clearTimeout(timer);
    body.innerHTML = "";
    document.body.classList.remove("mdexec-active");
  }

  function sync() {
    const note = (typeof currentNote !== "undefined" && currentNote) || null;
    const want = wantsPreview(note) ? note : null;
    if (want === activeNote) return;
    if (!want) deactivate(); else activate(want);
  }

  window.addEventListener("dexNoteOpened", sync);
  window.addEventListener("dexViewModeChanged", sync);
  window.addEventListener("dexSettingsChanged", () => { if (activeNote) render(true); });   // theme flip → redraw diagrams
  setInterval(sync, 400);   // delete / rename / exclusive-mode changes fire no event

  // text changed from outside the preview (undo, a sidebar function, another tool)
  window.dexEditor.on("change", () => {
    if (selfWrite || !activeNote || activeNote !== currentNote) return;
    scheduleRender();
  });

  window.dexMdexec = { render: () => render(true), isActive: () => !!activeNote };
  sync();
}
boot();
