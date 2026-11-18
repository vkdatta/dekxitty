/**
 * Transformer › Intelligent document copier for Google Docs
 * ─────────────────────────────────────────────────────────────────────────────
 * AI chat answers (Markdown) often lose their layout when pasted straight into
 * Google Docs. Paste the text into a note, run this function, confirm, and a
 * formatted (text/html + text/plain) version lands on the system clipboard —
 * ready for Ctrl+V in Docs.
 *
 * What is kept or dropped is decided by the user's saved preferences
 * (Settings › App › Docs copier, schema in prefs.js). Table width comes from the
 * table transformer in csvexec/csv.js: total width ÷ number of columns
 * (default 450).
 *
 * Source = the current selection if there is one, otherwise the whole note.
 * Needs `marked` (loaded globally by loader.js).
 */
import { toClipboardHtml } from "../../../../js/modes/csvexec/csv.js";
import { htmlToPlainText } from "../3code/html.js";
import { getPrefs, DOCS_COPIER_DEFAULTS } from "./prefs.js";

const MONO = "Consolas,'Courier New',monospace";
const CELL_BORDER = "border:1px solid #000000;padding:4px 6px;vertical-align:top;";

/* ───────────────────────── helpers ───────────────────────── */

const unwrap = (el) => el.replaceWith(...Array.from(el.childNodes));

/** Rows / formats of a rendered <table>, in the shape toClipboardHtml expects. */
function readTable(table, headerStyle) {
  const rows = [], fmts = [], cells = [];
  table.querySelectorAll("tr").forEach((tr) => {
    const head = !!tr.closest("thead");
    const r = [], f = [], c = [];
    Array.from(tr.children).forEach((td) => {
      if (!/^(TD|TH)$/.test(td.tagName)) return;
      const al = (td.getAttribute("align") || (td.style && td.style.textAlign) || "").toLowerCase();
      const isHead = headerStyle && (head || td.tagName === "TH");
      r.push(td.textContent.replace(/\s+/g, " ").trim());
      f.push({ b: isHead, bg: isHead ? "#f3f3f3" : "", al: al ? al[0] : "" });
      c.push(td.innerHTML);
    });
    if (r.length) { rows.push(r); fmts.push(f); cells.push(c); }
  });
  return { rows, fmts, cells };
}

function rebuildTable(doc, table, p) {
  const { rows, fmts, cells } = readTable(table, p.tableHeader);
  if (!rows.length) return;

  if (!p.tables) {               // tables off → tab-separated lines
    const para = doc.createElement("p");
    para.style.whiteSpace = "pre-wrap";
    rows.forEach((r, i) => {
      if (i) para.appendChild(doc.createElement("br"));
      para.appendChild(doc.createTextNode(r.map((t) => t.replace(/\t/g, " ")).join("\t")));
    });
    table.replaceWith(para);
    return;
  }

  // The table transformer lays out the widths (total ÷ columns); the original inline markup goes back in.
  const holder = doc.createElement("div");
  holder.innerHTML = toClipboardHtml(rows, fmts, p.tableWidth);
  holder.querySelectorAll("tr").forEach((tr, i) => {
    Array.from(tr.children).forEach((td, j) => { if (cells[i] && cells[i][j] != null) td.innerHTML = cells[i][j]; });
  });
  const fresh = holder.firstElementChild;
  if (!fresh) return;
  if (!p.tableBorders) {
    fresh.setAttribute("border", "0");
    fresh.style.border = "none";
    fresh.querySelectorAll("td").forEach((td) => { td.style.border = "none"; });
  }
  table.replaceWith(fresh);
}

/** ul/ol → plain paragraphs (optionally with typed "•" / "1." markers). */
function flattenList(doc, list, typed, depth, out) {
  const ordered = list.tagName === "OL";
  let n = parseInt(list.getAttribute("start") || "1", 10) || 1;
  Array.from(list.children).forEach((li) => {
    if (li.tagName !== "LI") return;
    const p = doc.createElement("p");
    if (depth) p.style.marginLeft = depth * 24 + "px";
    if (typed) p.appendChild(doc.createTextNode(ordered ? `${n}. ` : "• "));
    n++;
    const nested = [];
    Array.from(li.childNodes).forEach((ch) => {
      if (ch.nodeType === 1 && /^(UL|OL)$/.test(ch.tagName)) nested.push(ch);
      else p.appendChild(ch.cloneNode(true));
    });
    out.push(p);
    nested.forEach((sub) => flattenList(doc, sub, typed, depth + 1, out));
  });
}

/* ───────────────────────── Markdown → Docs-friendly HTML ───────────────────────── */

/**
 * @param {string} md
 * @param {object} [prefs]  see prefs.js (missing keys use the defaults)
 */
export function markdownToDocsHtml(md, prefs = {}) {
  const p = Object.assign({}, DOCS_COPIER_DEFAULTS, prefs);
  if (!window.marked) throw new Error("Markdown engine (marked) is not loaded yet");

  // breaks:true — AI answers rely on single line breaks; keep them.
  let html = window.marked.parse(String(md).replace(/\r\n?/g, "\n"), { gfm: true, breaks: true });
  if (window.DOMPurify) html = window.DOMPurify.sanitize(html);

  const doc = new DOMParser().parseFromString(`<body><div id="dc-root">${html}</div></body>`, "text/html");
  const root = doc.getElementById("dc-root");

  // Tables first (so the later passes never touch table internals twice).
  root.querySelectorAll("table").forEach((t) => rebuildTable(doc, t, p));

  // Headings → keep, bold paragraph, or plain paragraph.
  if (!p.headings) {
    root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      const para = doc.createElement("p");
      if (p.headingsBold) { const b = doc.createElement("b"); b.innerHTML = h.innerHTML; para.appendChild(b); }
      else para.innerHTML = h.innerHTML;
      h.replaceWith(para);
    });
  }

  // Loose lists render every item as <li><p>…</p></li>; Docs then adds a gap per bullet. Tighten.
  root.querySelectorAll("li").forEach((li) => {
    const ps = Array.from(li.children).filter((c) => c.tagName === "P");
    if (ps.length === 1 && li.children.length === 1) ps[0].replaceWith(...Array.from(ps[0].childNodes));
  });

  // Task-list checkboxes don't survive a paste; use glyphs.
  root.querySelectorAll("input[type=checkbox]").forEach((c) => c.replaceWith(doc.createTextNode(c.hasAttribute("checked") ? "☑ " : "☐ ")));

  // Lists off → paragraphs (outermost lists only; nested ones are handled by flattenList).
  if (!p.lists) {
    Array.from(root.querySelectorAll("ul,ol")).filter((l) => !l.parentElement.closest("ul,ol")).forEach((l) => {
      const out = [];
      flattenList(doc, l, p.listsText, 0, out);
      l.replaceWith(...out);
    });
  }

  // Inline formatting the user chose to drop.
  const drop = (sel) => root.querySelectorAll(sel).forEach(unwrap);
  if (!p.bold) drop("strong,b");
  if (!p.italics) drop("em,i");
  if (!p.underlines) drop("u");
  if (!p.strike) drop("del,s,strike");
  if (!p.links) drop("a");
  if (!p.blockquotes) drop("blockquote");
  if (!p.code) root.querySelectorAll("code").forEach((c) => { if (!c.closest("pre")) unwrap(c); });
  if (!p.codeBlocks) {
    root.querySelectorAll("pre").forEach((pre) => {
      const para = doc.createElement("p");
      para.style.whiteSpace = "pre-wrap";
      para.textContent = pre.textContent.replace(/\n$/, "");
      pre.replaceWith(para);
    });
  }

  // Anchor ids are only noise once pasted.
  root.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));

  // Docs ignores stylesheets — inline what matters.
  root.querySelectorAll("pre").forEach((el) => { el.style.fontFamily = MONO; el.style.whiteSpace = "pre-wrap"; });
  root.querySelectorAll("code").forEach((el) => { el.style.fontFamily = MONO; });
  root.querySelectorAll("blockquote").forEach((el) => { el.style.marginLeft = "24px"; });

  return root.innerHTML;
}

/** Wrap a fragment the way browsers do for clipboard HTML. */
function asClipboardDocument(fragment) {
  return `<html><body><!--StartFragment-->${fragment}<!--EndFragment--></body></html>`;
}

/* ───────────────────────── clipboard ───────────────────────── */

/** Put rich text on the clipboard. Prefers the async API; falls back to a synthetic copy event. */
export async function copyRichText(html, text) {
  try {
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      })]);
      return true;
    }
  } catch (err) { /* fall through to the legacy path */ }

  let ok = false;
  const scratch = document.createElement("textarea");
  scratch.value = text || " ";
  scratch.setAttribute("readonly", "");
  scratch.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
  document.body.appendChild(scratch);
  scratch.select();
  // Capture + stopImmediatePropagation so other copy handlers (csv grid, md designer) can't overwrite ours.
  const onCopy = (e) => {
    e.stopImmediatePropagation();
    e.preventDefault();
    e.clipboardData.setData("text/html", html);
    e.clipboardData.setData("text/plain", text);
    ok = true;
  };
  document.addEventListener("copy", onCopy, true);
  try { document.execCommand("copy"); } catch (err) { ok = false; }
  document.removeEventListener("copy", onCopy, true);
  scratch.remove();
  return ok;
}

/* ───────────────────────── confirmation + entry points ───────────────────────── */

let pendingSource = "";

function sourceText() {
  const v = noteTextarea.value;
  const s = noteTextarea.selectionStart, e = noteTextarea.selectionEnd;
  return typeof s === "number" && typeof e === "number" && e > s ? { text: v.slice(s, e), selected: true } : { text: v, selected: false };
}

/** One-line recap of what the saved settings will do, shown in the confirmation. */
function describePrefs(p) {
  const heads = p.headings ? "kept" : (p.headingsBold ? "made bold" : "plain");
  const tables = p.tables ? `kept, ${p.tableWidth}px wide` : "as tab-separated text";
  return `Headings ${heads} · Tables ${tables}`;
}

export async function openDocsCopier() {
  if (!currentNote || !noteTextarea) return;
  const src = sourceText();
  if (!src.text.trim()) return showNotification("Nothing to copy — the note is empty!");
  pendingSource = src.text;
  const chars = src.text.length.toLocaleString();

  await showModal({
    header: `<div class="modal-title">Copy for Google Docs?</div>`,
    body: `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div>Copy ${src.selected ? "the selected text" : "this note"} (${chars} characters) as formatted content. Then paste it into Google Docs with Ctrl+V.</div>
        <div style="opacity:.75;font-size:.9em;">${describePrefs(getPrefs())}. Change these in Settings › App › Docs copier.</div>
      </div>
    `,
    footer: `<button onclick="closeModal()">Cancel</button><button onclick="docsCopierOpenSettings()" data-skip-validation>Settings</button><button onclick="handleDocsCopierSubmit()" data-skip-validation class="modal-btn">Copy</button>`,
    html: true
  });
  pendingSource = "";
}

export function docsCopierOpenSettings() {
  closeModal();
  if (typeof window.openSettingsManager === "function") window.openSettingsManager();
}

/**
 * Runs synchronously inside the Copy button's click so the browser still treats the
 * clipboard write as user-initiated (Safari is strict about this).
 */
export function handleDocsCopierSubmit() {
  let fragment, plain;
  try {
    fragment = markdownToDocsHtml(pendingSource, getPrefs());
    plain = htmlToPlainText(fragment);
  } catch (err) {
    console.error("DocsCopier error:", err);
    closeModal();
    return showNotification("Copy failed: " + (err && err.message ? err.message : String(err)));
  }
  const write = copyRichText(asClipboardDocument(fragment), plain);
  closeModal({ action: "submit" });
  write.then((ok) => showNotification(ok ? "Copied — paste it into Google Docs" : "Copy blocked by the browser — try again"));
}
