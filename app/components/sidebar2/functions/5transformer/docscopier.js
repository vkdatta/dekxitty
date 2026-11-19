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

/* ───────────────────────── plain-text tables → pipe tables ───────────────────────── */

const isBlank = (l) => l == null || !l.trim();
const LIST_MARK = /^\s*([-*+]|\d+[.)])\s/;
const PIPE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const SEP_CELL = /^:?[-=_─━—–]{2,}:?$/;                  // "---", "----", ":--:", "====" …
const RULE_TEXT = /^\s*([-*_=─━—–]\s*){3,}$/;           // a line made only of rule characters

/** Row made only of separator cells (e.g. "----  ---  -----" or "---<tab>---"): not data. */
const isSepRow = (cells) => {
  const f = cells.filter(Boolean);
  return f.length > 0 && f.every((c) => SEP_CELL.test(c));
};

/** Split a line into cells. Tabs win; otherwise two or more spaces separate columns. */
function splitCells(line, mode) {
  const raw = line.replace(/\s+$/, "");
  if (mode === "tab") return raw.split("\t").map((c) => c.trim());
  return raw.trim().split(/\s{2,}/).map((c) => c.trim());
}

/** Cells of a pipe row, without the outer pipes. */
const pipeCells = (line) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").replace(/\\\|/g, "\u0001").split("|").map((c) => c.trim());

const trimEnd = (cells) => { const c = cells.slice(); while (c.length && !c[c.length - 1]) c.pop(); return c; };

const toPipeRow = (cells, n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push((cells[i] || "").replace(/\|/g, "\\|"));
  return "| " + out.join(" | ") + " |";
};

/**
 * Markdown's own table syntax needs pipes. AI answers and copied sheets often arrive as
 * tab-separated (or column-aligned) rows instead. Rewrite those as pipe tables so marked
 * sees one table. Tolerated on the way: blank lines between rows, rows with fewer or more
 * cells than the header, and dashed separator rows (which are dropped, never shown as "---"
 * cells). A pipe table whose separator row has the wrong number of columns is repaired.
 * Fenced code is left alone.
 */
export function normalizeTextTables(md) {
  const lines = String(md).split("\n").map((l) => l.replace(/\r$/, ""));
  const out = [];
  let inFence = false;
  let i = 0;

  const startOk = (line, mode) => {
    if (isBlank(line) || /^\s*(\|)/.test(line) || /^\s*(#{1,6}\s|>)/.test(line)) return null;
    if (/^\s*[-*+]\s/.test(line)) return null;                       // bullet lists are never tables
    if (mode === "space" && (LIST_MARK.test(line) || RULE_TEXT.test(line))) return null;
    const cells = splitCells(line, mode);
    const filled = cells.filter(Boolean).length;
    if (isSepRow(cells)) return null;
    return cells.length >= 2 && filled >= 2 ? cells : null;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; out.push(line); i++; continue; }
    if (inFence) { out.push(line); i++; continue; }

    // Pipe table: header, then the separator row (possibly after blank lines, possibly with
    // a different number of columns than the header — marked would then print it as text).
    if (line.includes("|") && !RULE_TEXT.test(line)) {
      let j = i + 1;
      while (j < lines.length && isBlank(lines[j])) j++;
      if (j < lines.length && lines[j].includes("|") && PIPE_SEP.test(lines[j])) {
        const h = pipeCells(line), s = pipeCells(lines[j]);
        out.push(line);
        out.push("| " + h.map((_, c) => s[c] || "---").join(" | ") + " |");
        i = j + 1;
        continue;
      }
    }

    const mode = line.includes("\t") ? "tab" : "space";
    const head = startOk(line, mode);
    if (head) {
      const rows = [head];
      let j = i + 1;
      while (j < lines.length) {
        let k = j;
        while (k < lines.length && isBlank(lines[k])) k++;
        const gap = k - j;
        // After the header any gap is fine; later, a single blank line between rows is fine.
        if (gap && rows.length > 1 && gap > 1) break;
        const l = lines[k];
        if (l == null || isBlank(l)) break;
        if (mode === "tab") {
          if (!l.includes("\t") || /^\s+([-*+]|\d+[.)])\s/.test(l)) break;
          rows.push(splitCells(l, mode));
        } else {
          if (gap || LIST_MARK.test(l) || /^\s*[|#>]/.test(l)) break;
          const c = splitCells(l, mode);
          if (isSepRow(c)) { rows.push(c); j = k + 1; continue; }
          if (c.length !== head.length || c.some((x) => x.length > 60)) break;
          rows.push(c);
        }
        j = k + 1;
      }
      const data = rows.filter((r) => !isSepRow(r));
      const minRows = mode === "tab" ? 2 : 3;
      if (data.length >= minRows) {
        const n = data.reduce((m, r) => Math.max(m, trimEnd(r).length), 0);
        if (out.length && !isBlank(out[out.length - 1])) out.push("");
        out.push(toPipeRow(data[0], n));
        out.push("| " + Array(n).fill("---").join(" | ") + " |");
        data.slice(1).forEach((r) => out.push(toPipeRow(r, n)));
        if (j < lines.length && !isBlank(lines[j])) out.push("");
        i = j;
        continue;
      }
    }
    out.push(line);
    i++;
  }
  return out.join("\n");
}

/* ───────────────────────── blocks of capital letters → sentence case ───────────────────────── */

const hasLetter = (t) => /\p{L}/u.test(t);
const isCapsWord = (t) => hasLetter(t) && !/\p{Ll}/u.test(t);
const upFirst = (t) => t.replace(/\p{L}/u, (ch) => ch.toUpperCase());

/**
 * A "block" is 3 or more capital-letter words in a row (numbers and dashes between them
 * don't break it). HELLO is not a block; HELLO THIS IS A GOOD DAY is. A block becomes
 * lowercase, with the first letter of every sentence capitalised — but only when the block
 * actually starts a sentence (`atStart` says whether the text begins one).
 */
export function sentenceCaseCapsBlocks(text, atStart = true) {
  const toks = [];
  String(text).replace(/\S+/g, (t, idx) => { toks.push({ t, idx }); return t; });
  if (toks.length < 3) return text;

  const repl = new Map();
  let run = [];
  let count = 0;

  const close = () => {
    while (run.length && !hasLetter(toks[run[run.length - 1]].t)) run.pop();   // trailing numbers stay out
    if (count >= 3 && run.length) {
      const first = run[0];
      const prev = first > 0 ? toks[first - 1].t : null;
      let cap = prev == null ? atStart : /[.!?]["')\]]*$/.test(prev);
      run.forEach((ti) => {
        let w = toks[ti].t.toLowerCase();
        w = w.replace(/(^|[^\p{L}])i(?=$|[^\p{L}])/gu, "$1I");              // keep a lone "I"
        if (cap && hasLetter(w)) { w = upFirst(w); cap = false; }
        if (/[.!?]["')\]]*$/.test(toks[ti].t)) cap = true;
        repl.set(ti, w);
      });
    }
    run = []; count = 0;
  };

  toks.forEach((tok, ti) => {
    if (isCapsWord(tok.t)) { run.push(ti); count++; }
    else if (!hasLetter(tok.t) && run.length) run.push(ti);
    else close();
  });
  close();

  if (!repl.size) return text;
  let out = "", pos = 0;
  toks.forEach((tok, ti) => {
    if (!repl.has(ti)) return;
    out += text.slice(pos, tok.idx) + repl.get(ti);
    pos = tok.idx + tok.t.length;
  });
  return out + text.slice(pos);
}

const BLOCK_TAGS = /^(P|LI|TD|TH|H[1-6]|BLOCKQUOTE|DIV|PRE|BODY)$/;

/** Does this text node begin a new sentence-level block (paragraph, cell, list item…)? */
function startsBlock(node) {
  let n = node;
  while (n) {
    let prev = n.previousSibling;
    while (prev && prev.nodeType === 3 && !prev.textContent.trim()) prev = prev.previousSibling;
    if (prev) return prev.nodeType === 1 && prev.tagName === "BR";
    n = n.parentNode;
    if (n && n.nodeType === 1 && BLOCK_TAGS.test(n.tagName)) return true;
  }
  return true;
}

function fixCapsBlocks(doc, root) {
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.parentElement && n.parentElement.closest("code,pre")) continue;
    nodes.push(n);
  }
  nodes.forEach((n) => {
    const next = sentenceCaseCapsBlocks(n.nodeValue, startsBlock(n));
    if (next !== n.nodeValue) n.nodeValue = next;
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

  // Tab-separated / column-aligned tables become pipe tables first (also closes header gaps).
  const source = normalizeTextTables(String(md).replace(/\r\n?/g, "\n"));

  // breaks:true — AI answers rely on single line breaks; keep them.
  let html = window.marked.parse(source, { gfm: true, breaks: true });
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

  // Horizontal lines (---) the user doesn't want. Also sweeps up any that survived as literal
  // text (a paragraph of only dashes, or a table row of only "---" cells), so none is left behind.
  if (!p.rules) {
    root.querySelectorAll("hr").forEach((h) => h.remove());
    root.querySelectorAll("p").forEach((el) => {
      if (!el.querySelector("img") && RULE_TEXT.test(el.textContent)) el.remove();
    });
    root.querySelectorAll("tr").forEach((tr) => {
      const t = Array.from(tr.children).map((c) => c.textContent.trim()).filter(Boolean);
      if (t.length && t.every((x) => SEP_CELL.test(x))) tr.remove();
    });
  }

  // Blocks of capital letters → sentence case (code is never touched).
  if (!p.capsBlock) fixCapsBlocks(doc, root);

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
