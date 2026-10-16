/**
 * mdexec / design — Design (edit) mode for Markdown in exec view.
 *
 * The note's text stays the single source of truth: it lives in the hidden CodeMirror editor,
 * exactly as in Read mode. Design shows the document as BLOCKS (paragraph, heading, list, quote,
 * code, mermaid, table, rule …). Every block is rendered; tapping one opens it for editing —
 * a text box holding that block's Markdown (tables open as a cell grid, like the CSV sheet).
 *
 *   • Lossless: blocks carry exact character offsets (blocks.js), so editing one block patches
 *     only its characters. Nothing else in the file is ever re-serialised.
 *   • Sidebar 2 keeps working: the selection inside the open block is mirrored into the hidden
 *     editor (offset by the block's start), so every existing function — Bold, Uppercase, Find &
 *     Replace, Pattern, Cleanup, Cipher … — acts on exactly what you selected. When a function
 *     rewrites the text, the designer re-splits the document and re-opens the same place.
 *   • Undo / redo are the editor's own history, so top-bar undo works.
 *
 *   window.dexMdexec.design.run(name) — the same actions the toolbar uses (Sidebar 2 › Markdown).
 */
import {
  splitBlocks, blockInfo, blockAt, toggleWrap, insertLink, insertImage, convertBlock, seedBlock, seedCaret,
  indentLines, smartEnter, parseTable, serializeTable, tableOps, newTable, parseGrid,
  patchMove, patchDuplicate, patchDelete, patchInsert, findTaskLines, setTaskChecked
} from "./blocks.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TYPE_ITEMS = [
  ["Paragraph", "p"], ["Heading 1", "h1"], ["Heading 2", "h2"], ["Heading 3", "h3"], ["Heading 4", "h4"], ["Heading 5", "h5"], ["Heading 6", "h6"],
  ["Bullet list", "ul"], ["Numbered list", "ol"], ["Task list", "task"], ["Quote", "quote"], ["Code block", "code"], ["Mermaid diagram", "mermaid"]
];
const INSERT_ITEMS = [
  ["Paragraph", "p"], ["Heading 1", "h1"], ["Heading 2", "h2"], ["Heading 3", "h3"], ["Bullet list", "ul"], ["Numbered list", "ol"], ["Task list", "task"],
  ["Quote", "quote"], ["Code block", "code"], ["Mermaid diagram", "mermaid"], ["Table…", "table"], ["Divider", "hr"], ["Image…", "image"]
];
const CASE_ITEMS = [["UPPERCASE", "handleUppercase"], ["lowercase", "handlelowercase"], ["Capitalise Words", "capitalizeWords"], ["Capitalise Sentences", "capitalizeSentences"], ["Reverse Words", "reverseWords"]];
const CASE_FN = { handleUppercase: "handleUppercase", handlelowercase: "handleLowercase", capitalizeWords: "capitalizeWords", capitalizeSentences: "capitalizeSentences", reverseWords: "reverseWords" };

export function createDesigner(env) {
  const { pane, toolbar, scroller, body } = env;
  const cm = () => env.cm;
  const src = () => env.getSource();

  let on = false;
  let blocks = [];
  let active = null;          // { i, ta, tbl, view, origin, text, virtual, sepFrom, tsel }
  let gen = 0;
  let extTimer = null, tblTimer = null;
  let menuEl = null, askEl = null, fxEl = null;
  let toolbarBuilt = false;
  let pendingCaret = null;

  const notify = (m) => env.notify(m);
  const doc = () => cm();

  /* ───────────────────────── document access ───────────────────────── */

  const pos = (i) => doc().posFromIndex(i);
  const textOf = (b) => src().slice(b.start, b.end);

  /** Replace src[from,to) with `text` in the hidden editor without triggering our own refresh. */
  function patchDoc(from, to, text, origin) {
    env.selfWrite(() => doc().replaceRange(text, pos(from), pos(to), origin || "mdx"));
    const delta = text.length - (to - from);
    for (const x of blocks) if (x.start >= to && !(active && x === blocks[active.i])) { x.start += delta; x.end += delta; }
  }

  /** Replace only the part that differs (keeps the editor's history small and the caret stable). */
  function minimalReplace(base, oldText, newText, origin) {
    if (oldText === newText) return;
    let a = 0; const max = Math.min(oldText.length, newText.length);
    while (a < max && oldText.charCodeAt(a) === newText.charCodeAt(a)) a++;
    let b = 0;
    while (b < max - a && oldText.charCodeAt(oldText.length - 1 - b) === newText.charCodeAt(newText.length - 1 - b)) b++;
    patchDoc(base + a, base + oldText.length - b, newText.slice(a, newText.length - b), origin);
  }

  function reparse() {
    blocks = splitBlocks(src());
    if (active && active.virtual) {
      const v = active.virtualAt;
      let k = 0; while (k < blocks.length && blocks[k].start < v) k++;
      blocks.splice(k, 0, { start: v, end: v, type: "paragraph", virtual: true });
      active.i = k;
    } else if (!blocks.length) {
      const n = src().length;
      blocks = [{ start: n, end: n, type: "paragraph", virtual: true }];
      active = { i: 0, virtual: true, virtualAt: n, sepFrom: null };
    }
  }

  /* ───────────────────────── rendering ───────────────────────── */

  function renderAll() {
    if (!on) return;
    const g = ++gen;
    const top = scroller.scrollTop;
    closeMenu();
    reparse();
    body.textContent = "";
    blocks.forEach((b, i) => body.appendChild(buildBlock(b, i, g)));
    const add = document.createElement("button");
    add.type = "button"; add.className = "mdb-add"; add.textContent = "＋ Add block";
    add.addEventListener("click", () => insertAfter(blocks.length - 1, "p"));
    body.appendChild(add);
    scroller.scrollTop = top;
    paintToolbar();
    if (active && pendingCaret) { focusEditor(pendingCaret); pendingCaret = null; }
  }

  function buildBlock(b, i, g) {
    const sec = document.createElement("section");
    sec.className = "mdb"; sec.dataset.i = i; sec.dataset.type = b.type;
    if (active && active.i === i) { buildEditor(sec, b, i); return sec; }
    const text = textOf(b);
    const view = document.createElement("div");
    view.className = "mdb-view";
    if (b.type === "front") { view.innerHTML = '<pre class="mdb-front"></pre>'; view.firstChild.textContent = text; }
    else env.renderInto(view, text, g, () => g !== gen);
    sec.appendChild(view);
    wireChecks(view, b);
    view.addEventListener("click", (e) => onViewClick(e, i, view, b));
    return sec;
  }

  function wireChecks(view, b) {
    const boxes = [...view.querySelectorAll('input[type="checkbox"]')];
    if (!boxes.length) return;
    const lines = findTaskLines(textOf(b));
    if (lines.length !== boxes.length) { boxes.forEach((x) => { x.disabled = true; }); return; }
    boxes.forEach((box, k) => {
      box.disabled = false; box.classList.add("mdx-task");
      box.addEventListener("change", () => {
        const bi = blocks.indexOf(b); if (bi < 0) return;
        const text = textOf(b), ls = text.split("\n");
        const next = setTaskChecked(ls[lines[k]], box.checked);
        if (next === ls[lines[k]]) { box.checked = !box.checked; return; }
        ls[lines[k]] = next;
        const nt = ls.join("\n");
        minimalReplace(b.start, text, nt, "mdx");
        b.end = b.start + nt.length;
        env.afterEdit();
      });
    });
  }

  function onViewClick(e, i, view, b) {
    if (e.target.closest && (e.target.closest("input[type=checkbox]") || e.target.closest(".dex-check-wrap"))) return;
    const a = e.target.closest && e.target.closest("a"); if (a) e.preventDefault();
    const text = textOf(b);
    activate(i, guessCaret(view, text, e.clientX, e.clientY));
  }

  /** Map a tap on the rendered block back to a caret position in its Markdown source. */
  function guessCaret(view, text, x, y) {
    let node = null, off = 0;
    try {
      if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { node = r.startContainer; off = r.startOffset; } }
      else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { node = p.offsetNode; off = p.offset; } }
    } catch (e) {}
    if (!node || node.nodeType !== 3 || !view.contains(node)) return text.length;
    const tx = node.nodeValue || "";
    const pre = tx.slice(Math.max(0, off - 10), off), post = tx.slice(off, off + 10);
    let k = (pre + post).length >= 4 ? text.indexOf(pre + post) : -1;
    if (k >= 0) return k + pre.length;
    if (pre.length >= 3 && (k = text.indexOf(pre)) >= 0) return k + pre.length;
    if (post.length >= 3 && (k = text.indexOf(post)) >= 0) return k;
    return text.length;
  }

  /* ───────────────────────── editing a block ───────────────────────── */

  function activate(i, caret) {
    if (!on) return;
    let startOff = blocks[i] ? blocks[i].start : 0;
    if (active) { const rm = commitActive(); if (rm && startOff > rm.from) startOff -= rm.n; }
    reparse();
    let k = blockAt(blocks, startOff); if (k < 0) k = Math.min(i, blocks.length - 1);
    if (k < 0) return;
    active = { i: k, origin: null };
    pendingCaret = { s: caret == null ? 1e9 : caret, e: caret == null ? 1e9 : caret };
    renderAll();
    const el = body.querySelector('.mdb[data-i="' + k + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }

  /** Close the open block: tidy up an empty one, forget the editor. Does not re-render. */
  function commitActive() {
    if (!active) return null;
    clearTimeout(tblTimer); flushTable();
    const b = blocks[active.i];
    let removed = null;
    if (active.virtual && b && textOf(b).trim() === "" && active.sepFrom != null) {
      // the empty block we added was never typed in → take its separator back out
      const t = src(), from = active.sepFrom;
      if (t.slice(from, from + 2) === "\n\n") { env.selfWrite(() => doc().replaceRange("", pos(from), pos(from + 2), "mdx")); removed = { from, n: 2 }; }
    }
    active = null;
    env.afterEdit();
    return removed;
  }

  function done() { if (!active) return; commitActive(); renderAll(); }

  function buildEditor(sec, b, i) {
    const text = textOf(b);
    sec.classList.add("active");
    const info = blockInfo(text);
    active.text = text; active.type = b.type = info.type; active.info = info;
    sec.dataset.type = info.type;
    if (info.type === "table") buildTable(sec, text);
    else {
      const ta = document.createElement("textarea");
      ta.className = "mdb-ta"; ta.value = text; ta.rows = 1; ta.spellcheck = false;
      ta.setAttribute("autocomplete", "off"); ta.setAttribute("autocapitalize", "sentences");
      if (info.type === "heading") ta.dataset.h = String(info.level);
      if (info.type === "code" || info.type === "mermaid" || info.type === "html" || info.type === "front") ta.classList.add("mdb-mono");
      sec.appendChild(ta);
      active.ta = ta;
      ta.addEventListener("input", onTaInput);
      ta.addEventListener("keydown", onTaKey);
      ["select", "keyup", "pointerup", "focus", "touchend"].forEach((ev) => ta.addEventListener(ev, mirrorSel));
      if (info.type === "mermaid") {
        const pv = document.createElement("div"); pv.className = "mdb-preview"; sec.appendChild(pv); active.preview = pv; drawPreview();
      }
      requestAnimationFrame(autogrow);
    }
    sec.appendChild(blockBar());
  }

  function autogrow() {
    const ta = active && active.ta; if (!ta) return;
    ta.style.height = "auto"; ta.style.height = Math.max(ta.scrollHeight, 28) + "px";
  }

  function focusEditor(c) {
    if (!active) return;
    if (active.ta) {
      const ta = active.ta, n = ta.value.length;
      const s = Math.max(0, Math.min(n, c.s)), e = Math.max(s, Math.min(n, c.e));
      if (!c.quiet) ta.focus({ preventScroll: false });
      try { ta.setSelectionRange(s, e); } catch (x) {}
      autogrow(); mirrorSel();
    } else if (active.tbl) {
      if (c.quiet) { mirrorSel(); return; }
      const first = body.querySelector(".mdb.active .mdb-cell"); if (first) { first.focus(); }
    }
  }

  function onTaInput() {
    if (!active || !active.ta) return;
    const b = blocks[active.i], ta = active.ta, nt = ta.value;
    minimalReplace(b.start, active.text, nt, active.origin || "+input");
    active.origin = null; active.text = nt; b.end = b.start + nt.length;
    if (active.virtual && nt) active.virtual = false;
    autogrow(); mirrorSel(); drawPreview();
    const info = blockInfo(nt);
    if (info.type !== active.type) { active.type = info.type; active.info = info; paintToolbar(); }
    env.afterEdit(true);
  }

  /** Mirror the selection inside the open block into the hidden editor so Sidebar 2 acts on it. */
  function mirrorSel() {
    if (!active) return;
    const b = blocks[active.i]; if (!b) return;
    let s, e;
    if (active.ta) { s = active.ta.selectionStart; e = active.ta.selectionEnd; }
    else { s = 0; e = b.end - b.start; }
    env.selfWrite(() => { try { doc().setSelection(pos(b.start + s), pos(b.start + e), { scroll: false }); } catch (x) {} });
  }

  function setTa(text, s, e, origin) {
    const ta = active && active.ta; if (!ta) return;
    ta.value = text;
    try { ta.setSelectionRange(s, e == null ? s : e); } catch (x) {}
    active.origin = origin || "mdx";
    onTaInput();
  }

  function onTaKey(ev) {
    if (!active || !active.ta || ev.isComposing) return;
    const ta = active.ta, s = ta.selectionStart, e = ta.selectionEnd, t = ta.value, mod = ev.ctrlKey || ev.metaKey;
    const info = blockInfo(t);
    if (mod && !ev.altKey) {
      const k = ev.key.toLowerCase();
      if (k === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
      if (k === "y") { ev.preventDefault(); redo(); return; }
      if (k === "b") { ev.preventDefault(); run("bold"); return; }
      if (k === "i") { ev.preventDefault(); run("italic"); return; }
      if (k === "k") { ev.preventDefault(); run("link"); return; }
      return;
    }
    if (ev.key === "Escape") { ev.preventDefault(); done(); return; }
    if (ev.key === "Enter" && !ev.shiftKey) {
      const r = smartEnter(t, s, e);
      if (r) {
        ev.preventDefault();
        setTa(r.text, r.s, r.e);
        if (r.exit) insertAfter(active.i, "p", true);
        return;
      }
      if (s === e && s === t.length) {
        if (info.type === "heading" && !info.setext) { ev.preventDefault(); insertAfter(active.i, "p"); return; }
        if (info.type === "paragraph" && /\n$/.test(t)) { ev.preventDefault(); setTa(t.replace(/\n+$/, ""), t.replace(/\n+$/, "").length); insertAfter(active.i, "p"); return; }
        if (info.type === "hr") { ev.preventDefault(); insertAfter(active.i, "p"); return; }
      }
      return;
    }
    if (ev.key === "Tab") {
      if (info.type === "list") { ev.preventDefault(); const r = indentLines(t, s, e, ev.shiftKey ? -1 : 1); setTa(r.text, r.s, r.e); }
      else if (info.type === "code" || info.type === "mermaid") { ev.preventDefault(); setTa(t.slice(0, s) + "  " + t.slice(e), s + 2); }
      return;
    }
    if (ev.key === "Backspace" && s === 0 && e === 0 && active.i > 0 && t === "") {
      ev.preventDefault(); const i = active.i; removeBlock(i, true); return;
    }
    if (ev.key === "ArrowUp" && s === e && s === 0 && active.i > 0 && !ev.shiftKey) { ev.preventDefault(); activate(active.i - 1, 1e9); return; }
    if (ev.key === "ArrowDown" && s === e && s === t.length && active.i < blocks.length - 1 && !ev.shiftKey) { ev.preventDefault(); activate(active.i + 1, 0); return; }
  }

  /* ───────────────────────── mermaid live preview ───────────────────────── */

  let pvTimer = null;
  function drawPreview() {
    if (!active || !active.preview) return;
    clearTimeout(pvTimer);
    const pv = active.preview, g = gen;
    pvTimer = setTimeout(() => {
      if (!active || active.preview !== pv) return;
      env.renderInto(pv, active.ta ? active.ta.value : "", g, () => !active || active.preview !== pv);
    }, 350);
  }

  /* ───────────────────────── tables (cell grid) ───────────────────────── */

  function buildTable(sec, text) {
    const t = parseTable(text);
    active.tbl = t; active.tsel = active.tsel || { r: 0, c: 0 };
    const wrap = document.createElement("div"); wrap.className = "mdb-tbl-wrap";
    const tbl = document.createElement("table"); tbl.className = "mdb-grid";
    const al = (c) => ({ l: "left", c: "center", r: "right" }[t.align[c]] || "left");
    let h = "<thead><tr><th class=\"mdb-rn\">#</th>";
    t.head.forEach((v, c) => { h += `<th><input class="mdb-cell mdb-head" data-r="-1" data-c="${c}" value="${esc(v)}" style="text-align:${al(c)}" spellcheck="false" autocomplete="off"></th>`; });
    h += "</tr></thead><tbody>";
    t.rows.forEach((row, r) => {
      h += `<tr><td class="mdb-rn" data-rn="${r}">${r + 1}</td>`;
      row.forEach((v, c) => { h += `<td><input class="mdb-cell" data-r="${r}" data-c="${c}" value="${esc(v)}" style="text-align:${al(c)}" spellcheck="false" autocomplete="off"></td>`; });
      h += "</tr>";
    });
    tbl.innerHTML = h + "</tbody>";
    wrap.appendChild(tbl); sec.appendChild(wrap);
    active.tblEl = tbl;
    tbl.addEventListener("focusin", (e) => {
      const el = e.target.closest(".mdb-cell"); if (!el) return;
      active.tsel = { r: +el.dataset.r, c: +el.dataset.c }; markCell(); mirrorSel(); paintToolbar();
    });
    tbl.addEventListener("input", (e) => {
      const el = e.target.closest(".mdb-cell"); if (!el) return;
      const r = +el.dataset.r, c = +el.dataset.c;
      if (r < 0) t.head[c] = el.value; else t.rows[r][c] = el.value;
      scheduleTable();
    });
    tbl.addEventListener("keydown", onCellKey);
    tbl.addEventListener("paste", onCellPaste);
    tbl.addEventListener("click", (e) => {
      const rn = e.target.closest(".mdb-rn[data-rn]"); if (!rn) return;
      active.tsel = { r: +rn.dataset.rn, c: Math.max(0, active.tsel.c) }; focusCell(active.tsel.r, active.tsel.c);
    });
  }

  const cellEl = (r, c) => active && active.tblEl && active.tblEl.querySelector(`.mdb-cell[data-r="${r}"][data-c="${c}"]`);
  function focusCell(r, c) { const el = cellEl(r, c); if (el) { el.focus(); try { el.select(); } catch (x) {} } }
  function markCell() {
    if (!active || !active.tblEl) return;
    active.tblEl.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
    const { r, c } = active.tsel;
    const el = cellEl(r, c); if (el && el.parentElement) el.parentElement.classList.add("sel");
    active.tblEl.querySelectorAll(`[data-c="${c}"]`).forEach((x) => { if (x.parentElement) x.parentElement.classList.add("colsel"); });
    active.tblEl.querySelectorAll(".colsel").forEach((x) => { const i = x.querySelector(".mdb-cell"); if (!i || +i.dataset.c !== c) x.classList.remove("colsel"); });
  }

  function scheduleTable() { clearTimeout(tblTimer); tblTimer = setTimeout(flushTable, 160); }
  function flushTable() {
    clearTimeout(tblTimer);
    if (!active || !active.tbl) return;
    const b = blocks[active.i], nt = serializeTable(active.tbl);
    if (nt === active.text) return;
    minimalReplace(b.start, active.text, nt, active.origin || "+input");
    active.origin = null; active.text = nt; b.end = b.start + nt.length;
    env.afterEdit(true);
  }
  function rebuildTable() {
    flushTable();
    const sec = body.querySelector(".mdb.active"); if (!sec) return;
    const old = sec.querySelector(".mdb-tbl-wrap"); const keep = active.tsel;
    if (old) old.remove();
    const bar = sec.querySelector(".mdb-bar");
    const tmp = document.createElement("div"); sec.insertBefore(tmp, bar);
    buildTable(sec, active.text); tmp.remove();
    const w = sec.querySelector(".mdb-tbl-wrap"); if (w && bar) sec.insertBefore(w, bar);
    active.tsel = keep; markCell();
  }
  function onCellKey(ev) {
    const el = ev.target.closest(".mdb-cell"); if (!el || !active) return;
    const t = active.tbl; let r = +el.dataset.r, c = +el.dataset.c;
    if (ev.key === "Enter") {
      ev.preventDefault(); flushTable();
      if (r + 1 >= t.rows.length) { tableOps.addRow(t, t.rows.length); rebuildTable(); }
      focusCell(r + 1, c);
    } else if (ev.key === "Tab") {
      ev.preventDefault(); flushTable();
      let nr = r, nc = c + (ev.shiftKey ? -1 : 1);
      if (nc >= t.head.length) { nc = 0; nr++; } else if (nc < 0) { nc = t.head.length - 1; nr--; }
      if (nr >= t.rows.length) { tableOps.addRow(t, t.rows.length); rebuildTable(); }
      if (nr >= -1) focusCell(nr, nc);
    } else if (ev.key === "ArrowDown" && r + 1 < t.rows.length) { ev.preventDefault(); focusCell(r + 1, c); }
    else if (ev.key === "ArrowUp" && r - 1 >= -1) { ev.preventDefault(); focusCell(r - 1, c); }
    else if (ev.key === "Escape") { ev.preventDefault(); done(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
  }
  function onCellPaste(ev) {
    const el = ev.target.closest(".mdb-cell"); if (!el || !active) return;
    const grid = parseGrid((ev.clipboardData || window.clipboardData).getData("text/plain"));
    if (!grid) return;
    ev.preventDefault();
    tableOps.paste(active.tbl, +el.dataset.r, +el.dataset.c, grid);
    rebuildTable(); flushTable();
    notify("Pasted " + grid.length + " × " + Math.max(...grid.map((x) => x.length)) + " into the table");
  }
  function tblDo(fn) {
    if (!active || !active.tbl) { notify("Open a table first"); return; }
    flushTable(); active.origin = "mdx";
    const t = active.tbl, sel = active.tsel;
    const nsel = fn(t, sel) || sel;
    active.tsel = { r: Math.max(-1, Math.min(t.rows.length - 1, nsel.r)), c: Math.max(0, Math.min(t.head.length - 1, nsel.c)) };
    const b = blocks[active.i], nt = serializeTable(t);
    minimalReplace(b.start, active.text, nt, "mdx"); active.text = nt; b.end = b.start + nt.length; active.origin = null;
    rebuildTable(); focusCell(active.tsel.r, active.tsel.c); env.afterEdit(true);
  }

  /* ───────────────────────── block-level actions ───────────────────────── */

  function applyPatch(p, origin) {
    env.selfWrite(() => doc().replaceRange(p.text, pos(p.from), pos(p.to), origin || "mdx"));
  }

  function blockOps(kind) {
    if (!active) { notify("Tap a block first"); return; }
    if (active.virtual && blocks[active.i] && textOf(blocks[active.i]).trim() === "") { notify("Type something in this block first"); return; }
    commitKeepIndex();
    const i = active.i;
    let p = null;
    if (kind === "up") p = patchMove(src(), blocks, i, -1);
    else if (kind === "down") p = patchMove(src(), blocks, i, 1);
    else if (kind === "dup") p = patchDuplicate(src(), blocks, i);
    if (!p) { notify(kind === "up" ? "Already the first block" : kind === "down" ? "Already the last block" : ""); return; }
    applyPatch(p);
    env.afterEdit();
    reparse2(p.focus);
  }
  /** Flush pending table edits before a structural patch; keep `active` for index bookkeeping. */
  function commitKeepIndex() { clearTimeout(tblTimer); flushTable(); }

  function reparse2(focusIdx, caret) {
    active = { i: focusIdx, origin: null };
    pendingCaret = { s: caret == null ? 1e9 : caret, e: caret == null ? 1e9 : caret };
    blocks = splitBlocks(src());
    if (focusIdx >= blocks.length) active.i = blocks.length - 1;
    if (active.i < 0) { active = null; }
    renderAll();
    const el = body.querySelector(".mdb.active"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }

  function removeBlock(i, toPrev) {
    if (active && active.virtual && blocks[active.i] && textOf(blocks[active.i]).trim() === "") {
      const k = active.i; commitActive();
      blocks = splitBlocks(src());
      if (blocks.length) reparse2(Math.max(0, Math.min(k - 1, blocks.length - 1)), 1e9); else renderAll();
      return;
    }
    commitKeepIndex();
    const p = patchDelete(src(), splitBlocks(src()), i);
    active = null;
    applyPatch(p);
    env.afterEdit();
    blocks = splitBlocks(src());
    if (p.focus >= 0 && blocks.length) { reparse2(toPrev ? Math.max(0, i - 1) : Math.min(p.focus, blocks.length - 1), toPrev ? 1e9 : 0); }
    else renderAll();
  }

  /** Insert a new block of `kind` after block i (i = -1 → at the very top). */
  function insertAfter(i, kind, fromExit) {
    commitKeepIndex();
    // remember WHERE we are by offset: closing the open block can merge, split or drop blocks
    const refOff = blocks[i] ? blocks[i].start : -1;
    let shift = 0;
    if (active) { const rm = commitActive(); if (rm && refOff > rm.from) shift = rm.n; }
    active = null;
    blocks = splitBlocks(src());
    if (refOff >= 0) { let k = -1; for (let j = 0; j < blocks.length; j++) if (blocks[j].start <= refOff - shift) k = j; i = k; }
    else i = Math.min(i, blocks.length - 1);
    void fromExit;
    const seed = seedBlock(kind);
    if (kind === "p") {
      // an empty paragraph can't exist in the text → open a "virtual" block at the right spot
      let at, sepFrom = null;
      if (!blocks.length) at = src().length;
      else if (i < 0) { env.selfWrite(() => doc().replaceRange("\n\n", pos(0), pos(0), "mdx")); sepFrom = 0; at = 0; }
      else { sepFrom = blocks[i].end; env.selfWrite(() => doc().replaceRange("\n\n", pos(sepFrom), pos(sepFrom), "mdx")); at = sepFrom + 2; }
      active = { i: 0, virtual: true, virtualAt: at, sepFrom };
      pendingCaret = { s: 0, e: 0 };
      renderAll();
      const el = body.querySelector(".mdb.active"); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
      return;
    }
    const p = patchInsert(src(), blocks, i, seed);
    applyPatch(p);
    env.afterEdit();
    reparse2(p.focus, seedCaret(kind, seed));
    if (kind === "table") requestAnimationFrame(() => focusCell(0, 0));
  }

  /** The row under the open block: add below, move, duplicate, delete, done. */
  function blockBar() {
    const bar = document.createElement("div");
    bar.className = "mdb-bar";
    bar.innerHTML = '<button type="button" data-b="add">＋ Below ▾</button><button type="button" data-b="up" title="Move up">↑</button><button type="button" data-b="down" title="Move down">↓</button>' +
      '<button type="button" data-b="dup">Duplicate</button><button type="button" data-b="del" class="mdb-danger">Delete</button><button type="button" data-b="done" class="mdb-done">Done</button>';
    bar.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) e.preventDefault(); });
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-b]"); if (!b) return;
      const k = b.dataset.b;
      if (k === "add") { openMenu(b.getBoundingClientRect(), INSERT_ITEMS.map(([l, key]) => ({ l, a: () => run("ins:" + key) }))); return; }
      run({ up: "up", down: "down", dup: "dup", del: "del", done: "done" }[k]);
    });
    return bar;
  }

  /* ───────────────────────── toolbar ───────────────────────── */

  function buildToolbar() {
    if (toolbarBuilt) return;
    toolbarBuilt = true;
    const B = (a, label, title, cls) => `<button type="button" class="cx-btn${cls ? " " + cls : ""}" data-a="${a}" title="${esc(title || label)}">${label}</button>`;
    const S = '<span class="cx-sep"></span>';
    toolbar.innerHTML =
      `<div class="cx-row cx-row-actions mdx-r1">${B("undo", "↶", "Undo")}${B("redo", "↷", "Redo")}${S}${B("type", "Type ▾", "Change block type")}${S}` +
      `${B("bold", "B", "Bold (Ctrl+B)", "cx-b")}${B("italic", "I", "Italic (Ctrl+I)", "cx-i")}${B("strike", "S̶", "Strikethrough")}${B("icode", "&lt;/&gt;", "Inline code")}${B("link", "Link", "Link (Ctrl+K)")}${B("image", "Img", "Image")}</div>` +
      `<div class="cx-row cx-row-actions mdx-r2">${B("ul", "• List", "Bullet list")}${B("ol", "1. List", "Numbered list")}${B("task", "☑ Task", "Task list")}${B("quote", "❝", "Quote")}${B("outdent", "⇤", "Outdent")}${B("indent", "⇥", "Indent")}${S}` +
      `${B("insert", "＋ Insert ▾", "Insert a block")}${B("case", "Aa ▾", "Change case")}${B("selblock", "Sel", "Select the whole block (so Sidebar 2 functions act on it)")}${B("find", "Find", "Find & replace")}${B("fx", "Fx", "All Sidebar 2 functions")}</div>` +
      `<div class="cx-row cx-row-actions mdx-r3" style="display:none">${B("t-rowup", "Row ↑＋", "Insert row above")}${B("t-rowdn", "Row ↓＋", "Insert row below")}${B("t-colL", "Col ←＋", "Insert column left")}${B("t-colR", "Col →＋", "Insert column right")}${S}` +
      `${B("t-delrow", "Row ✕", "Delete row")}${B("t-delcol", "Col ✕", "Delete column")}${S}${B("t-mvL", "◀", "Move column left")}${B("t-mvR", "▶", "Move column right")}${B("t-mvU", "▲", "Move row up")}${B("t-mvD", "▼", "Move row down")}${S}` +
      `${B("t-al-l", "⇤ L", "Align left")}${B("t-al-c", "↔ C", "Centre")}${B("t-al-r", "R ⇥", "Align right")}${S}${B("t-sa", "A→Z", "Sort ascending")}${B("t-sd", "Z→A", "Sort descending")}</div>`;
    toolbar.addEventListener("pointerdown", (e) => { if (e.target.closest(".cx-btn")) e.preventDefault(); });   // keep the keyboard & selection
    toolbar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      const a = b.dataset.a, r = b.getBoundingClientRect();
      onToolbar(a, r);
    });
  }

  function onToolbar(a, rect) {
    switch (a) {
      case "type": openMenu(rect, TYPE_ITEMS.map(([l, k]) => ({ l, a: () => run(k) }))); return;
      case "insert": openMenu(rect, INSERT_ITEMS.map(([l, k]) => ({ l, a: () => run("ins:" + k) }))); return;
      case "case": openMenu(rect, CASE_ITEMS.map(([l, k]) => ({ l, a: () => runSidebarFn(CASE_FN[k], true) }))); return;
      case "find": runSidebarFn("findandreplace", false); return;
      case "fx": openFxPicker(); return;
    }
    if (a.startsWith("t-")) { tableAction(a.slice(2)); return; }
    run(a);
  }

  function tableAction(a) {
    switch (a) {
      case "rowup": tblDo((t, s) => { tableOps.addRow(t, Math.max(0, s.r)); return { r: Math.max(0, s.r), c: s.c }; }); break;
      case "rowdn": tblDo((t, s) => { tableOps.addRow(t, s.r + 1); return { r: s.r + 1, c: s.c }; }); break;
      case "colL": tblDo((t, s) => { tableOps.addCol(t, s.c); return s; }); break;
      case "colR": tblDo((t, s) => { tableOps.addCol(t, s.c + 1); return { r: s.r, c: s.c + 1 }; }); break;
      case "delrow": tblDo((t, s) => { if (s.r < 0) { notify("Select a body row first"); return s; } tableOps.delRow(t, s.r); return { r: Math.min(s.r, t.rows.length - 1), c: s.c }; }); break;
      case "delcol": tblDo((t, s) => { if (t.head.length <= 1) { notify("A table needs at least one column"); return s; } tableOps.delCol(t, s.c); return { r: s.r, c: Math.min(s.c, t.head.length - 2) }; }); break;
      case "mvL": tblDo((t, s) => ({ r: s.r, c: tableOps.moveCol(t, s.c, -1) })); break;
      case "mvR": tblDo((t, s) => ({ r: s.r, c: tableOps.moveCol(t, s.c, 1) })); break;
      case "mvU": tblDo((t, s) => (s.r < 0 ? s : { r: tableOps.moveRow(t, s.r, -1), c: s.c })); break;
      case "mvD": tblDo((t, s) => (s.r < 0 ? s : { r: tableOps.moveRow(t, s.r, 1), c: s.c })); break;
      case "al-l": tblDo((t, s) => { tableOps.setAlign(t, s.c, "l"); return s; }); break;
      case "al-c": tblDo((t, s) => { tableOps.setAlign(t, s.c, "c"); return s; }); break;
      case "al-r": tblDo((t, s) => { tableOps.setAlign(t, s.c, "r"); return s; }); break;
      case "sa": tblDo((t, s) => { tableOps.sort(t, s.c, 1); return s; }); break;
      case "sd": tblDo((t, s) => { tableOps.sort(t, s.c, -1); return s; }); break;
    }
  }

  function paintToolbar() {
    if (!toolbarBuilt) return;
    const t = active && active.tbl;
    const r3 = toolbar.querySelector(".mdx-r3"), r2 = toolbar.querySelector(".mdx-r2");
    if (r3) r3.style.display = t ? "" : "none";
    const textOnly = ["bold", "italic", "strike", "icode", "link", "image", "ul", "ol", "task", "quote", "outdent", "indent"];
    textOnly.forEach((a) => { const b = toolbar.querySelector(`[data-a="${a}"]`); if (b) b.classList.toggle("mdx-off", !!t); });
    // highlight the list/quote button of the open block
    const info = active && active.info;
    const on = (a, v) => { const b = toolbar.querySelector(`[data-a="${a}"]`); if (b) b.classList.toggle("on", !!v); };
    on("ul", info && info.type === "list" && !info.ordered && !info.task); on("ol", info && info.type === "list" && info.ordered);
    on("task", info && info.type === "list" && info.task); on("quote", info && info.type === "quote");
    const ty = toolbar.querySelector('[data-a="type"]');
    if (ty) ty.textContent = (info ? ({ paragraph: "Paragraph", heading: "H" + (info.level || ""), list: info.task ? "Tasks" : info.ordered ? "Numbered" : "Bullets", quote: "Quote", code: "Code", mermaid: "Mermaid", table: "Table", hr: "Divider", html: "HTML", front: "Front matter" }[info.type] || "Type") : "Type") + " ▾";
    void r2;
  }

  /* ----- popover menu ----- */
  function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
  function openMenu(rect, items) {
    closeMenu();
    const m = document.createElement("div"); m.className = "mdx-menu";
    items.forEach((it, i) => { const b = document.createElement("button"); b.type = "button"; b.className = "mdx-mi"; b.dataset.i = i; b.textContent = it.l; m.appendChild(b); });
    m.addEventListener("pointerdown", (e) => e.preventDefault());
    m.addEventListener("click", (e) => { const b = e.target.closest(".mdx-mi"); if (!b) return; const it = items[+b.dataset.i]; closeMenu(); setTimeout(() => it.a(), 0); });
    document.body.appendChild(m);
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(6, Math.min(innerWidth - w - 6, rect.left)) + "px";
    m.style.top = Math.max(6, Math.min(innerHeight - h - 6, rect.bottom + 4)) + "px";
    menuEl = m;
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    function outside(e) { if (menuEl && !menuEl.contains(e.target)) { closeMenu(); document.removeEventListener("pointerdown", outside, true); } else if (!menuEl) document.removeEventListener("pointerdown", outside, true); }
  }

  /* ----- small input popover (link / image / table size) ----- */
  function ask(title, fields, ok) {
    closeAsk();
    const m = document.createElement("div"); m.className = "mdx-ask";
    m.innerHTML = `<div class="mdx-ask-t">${esc(title)}</div>` + fields.map((f, i) => `<input class="mdx-ask-i" data-i="${i}" placeholder="${esc(f.ph)}" value="${esc(f.v || "")}" ${f.type ? `type="${f.type}"` : ""} autocomplete="off" spellcheck="false">`).join("") +
      '<div class="mdx-ask-b"><button type="button" class="cx-btn" data-x="no">Cancel</button><button type="button" class="cx-btn on" data-x="ok">OK</button></div>';
    pane.appendChild(m); askEl = m;
    const go = () => { const v = [...m.querySelectorAll("input")].map((x) => x.value.trim()); closeAsk(); ok(v); };
    m.addEventListener("click", (e) => { const x = e.target.closest("[data-x]"); if (!x) return; if (x.dataset.x === "ok") go(); else { closeAsk(); } });
    m.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } else if (e.key === "Escape") closeAsk(); });
    const first = m.querySelector("input"); if (first) { first.focus(); first.select(); }
  }
  function closeAsk() { if (askEl) { askEl.remove(); askEl = null; } if (active && active.ta) { try { active.ta.focus(); } catch (e) {} } }

  /* ----- Fx: every Sidebar 2 function, searchable ----- */
  function openFxPicker() {
    closeFx();
    const reg = window.FunctionRegistry; if (!reg) { notify("Functions are still loading"); return; }
    const l1 = Object.fromEntries(reg.getAllLevel1().map((x) => [x.id, x.name]));
    const all = reg.getAllFunctions().filter((f) => f.fn !== "openCsvexecFunctions");
    const m = document.createElement("div"); m.className = "mdx-fx";
    m.innerHTML = '<div class="mdx-fx-h"><input class="mdx-fx-q" placeholder="Search functions…" spellcheck="false" autocomplete="off"><button type="button" class="cx-btn" data-x="close">✕</button></div>' +
      '<div class="mdx-fx-note">Acts on the selected text — nothing selected means the whole note. Use <b>Sel</b> to select the open block.</div><div class="mdx-fx-l"></div>';
    pane.appendChild(m); fxEl = m;
    const list = m.querySelector(".mdx-fx-l"), q = m.querySelector(".mdx-fx-q");
    const draw = () => {
      const k = q.value.trim().toLowerCase();
      const rows = all.filter((f) => !k || f.name.toLowerCase().includes(k) || f.under.join(" ").toLowerCase().includes(k));
      rows.sort((a, b) => (a.under[0] === "markdown" ? -1 : 0) - (b.under[0] === "markdown" ? -1 : 0));
      list.innerHTML = rows.map((f) => `<button type="button" class="mdx-fxrow" data-id="${f.id}"><span>${esc(f.name)}</span><small>${esc([l1[f.under[0]] || f.under[0]].concat(f.under.slice(1)).join(" › "))}</small></button>`).join("") || '<div class="mdx-fx-none">No match</div>';
    };
    draw(); q.addEventListener("input", draw);
    m.addEventListener("click", (e) => {
      if (e.target.closest('[data-x="close"]')) { closeFx(); return; }
      const r = e.target.closest(".mdx-fxrow"); if (!r) return;
      const f = all.find((x) => String(x.id) === r.dataset.id); if (!f) return;
      closeFx(); mirrorSel();
      setTimeout(() => runOnclick(f.onclick), 0);
    });
    q.focus();
  }
  function closeFx() { if (fxEl) { fxEl.remove(); fxEl = null; } }
  /** Run a registry onclick string exactly the way Sidebar 2 does (an inline handler). */
  function runOnclick(js) { const b = document.createElement("button"); b.setAttribute("onclick", js); b.style.display = "none"; document.body.appendChild(b); try { b.click(); } finally { b.remove(); } }

  function runSidebarFn(name, selectBlockIfCollapsed) {
    const fn = window[name];
    if (typeof fn !== "function") { notify("That function isn't loaded"); return; }
    if (active && active.ta && selectBlockIfCollapsed && active.ta.selectionStart === active.ta.selectionEnd) { active.ta.select(); }
    mirrorSel();
    fn();
  }

  /* ───────────────────────── actions (toolbar + Sidebar 2 › Markdown) ───────────────────────── */

  const needsText = () => { if (!active || !active.ta) { notify(active && active.tbl ? "Select text inside a paragraph, list or quote" : "Tap a block first"); return false; } return true; };

  function inline(L, R) {
    if (!needsText()) return;
    const ta = active.ta, r = toggleWrap(ta.value, ta.selectionStart, ta.selectionEnd, L, R);
    setTa(r.text, r.s, r.e);
  }

  function run(name) {
    if (!on) { notify("Switch this file to Design (bottom bar) to edit blocks"); return; }
    if (name.startsWith("ins:")) return insertKind(name.slice(4));
    switch (name) {
      case "undo": return undo();
      case "redo": return redo();
      case "bold": return inline("**");
      case "italic": return inline("*");
      case "strike": return inline("~~");
      case "icode": return inline("`");
      case "link": {
        if (!needsText()) return;
        const ta = active.ta, s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e);
        const sv = { s, e };
        ask("Insert link", sel ? [{ ph: "https://", v: "https://" }] : [{ ph: "https://", v: "https://" }, { ph: "Link text" }], (v) => {
          if (!v[0] || v[0] === "https://") return;
          const r = insertLink(ta.value, sv.s, sv.e, v[0], v[1]); setTa(r.text, r.s, r.e);
        });
        return;
      }
      case "image": {
        if (!needsText()) return;
        const ta = active.ta, sv = { s: ta.selectionStart, e: ta.selectionEnd };
        ask("Insert image", [{ ph: "Image URL", v: "https://" }, { ph: "Alt text (optional)" }], (v) => {
          if (!v[0] || v[0] === "https://") return;
          const r = insertImage(ta.value, sv.s, sv.e, v[0], v[1]); setTa(r.text, r.s, r.e);
        });
        return;
      }
      case "p": case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
      case "ul": case "ol": case "task": case "quote": case "code": case "mermaid": return convert(name);
      case "indent": case "outdent": {
        if (!needsText()) return;
        const ta = active.ta;
        if (active.info && active.info.type !== "list") { if (name === "indent") { /* not a list: nothing to nest */ } notify("Indent works inside lists"); return; }
        const r = indentLines(ta.value, ta.selectionStart, ta.selectionEnd, name === "indent" ? 1 : -1); setTa(r.text, r.s, r.e); return;
      }
      case "selblock": if (!active) { notify("Tap a block first"); return; } if (active.ta) { active.ta.focus(); active.ta.select(); } mirrorSel(); notify("Block selected — Sidebar 2 functions now act on it"); return;
      case "up": case "down": case "dup": return blockOps(name);
      case "del": if (!active) { notify("Tap a block first"); return; } removeBlock(active.i, false); notify("Block deleted — Undo brings it back"); return;
      case "hr": return insertKind("hr");
      case "table": return insertKind("table");
      case "done": return done();
    }
  }

  function convert(target) {
    if (!active) { notify("Tap a block first"); return; }
    if (active.tbl) { notify("Tables can't be converted — delete and insert another block"); return; }
    const ta = active.ta, t = ta.value, nt = convertBlock(t, target);
    if (nt === t) return;
    const keepEnd = nt.length;
    ta.value = nt; active.origin = "mdx"; onTaInput();
    // the block's kind changed → rebuild its editor (a mermaid block gains a preview, a heading its size…)
    const startOff = blocks[active.i].start;
    commitKeepIndex();
    blocks = splitBlocks(src());
    const k = blockAt(blocks, startOff);
    active = { i: Math.max(0, k), origin: null }; pendingCaret = { s: keepEnd, e: keepEnd };
    renderAll();
  }

  function insertKind(kind) {
    if (kind === "table") {
      ask("Insert table", [{ ph: "Columns", v: "3", type: "number" }, { ph: "Rows", v: "3", type: "number" }], (v) => {
        const c = Math.max(1, Math.min(12, parseInt(v[0], 10) || 3)), r = Math.max(1, Math.min(200, parseInt(v[1], 10) || 3));
        insertBlockText(serializeTable(newTable(r, c)), "table");
      });
      return;
    }
    if (kind === "image") { insertBlockText(seedBlock("image"), "image"); return; }
    const i = active ? active.i : blocks.length - 1;
    insertAfter(i, kind);
  }
  function insertBlockText(text, kind) {
    commitKeepIndex();
    const i = active ? active.i : blocks.length - 1;
    if (active) commitActive();
    blocks = splitBlocks(src());
    const p = patchInsert(src(), blocks, Math.min(i, blocks.length - 1), text);
    applyPatch(p); env.afterEdit();
    reparse2(p.focus, seedCaret(kind, text));
    if (kind === "table") requestAnimationFrame(() => focusCell(0, 0));
  }

  function undo() { try { doc().undo(); } catch (e) {} }
  function redo() { try { doc().redo(); } catch (e) {} }

  /* ───────────────────────── reacting to outside changes ───────────────────────── */

  /** The note text changed behind our back (undo, a Sidebar 2 function…): re-split and reopen the same spot. */
  function onExternalChange() {
    if (!on) return;
    clearTimeout(extTimer);
    extTimer = setTimeout(() => {
      if (!on) return;
      const hadFocus = !!(active && active.ta && document.activeElement === active.ta);
      let selS = 0, selE = 0, off = null;
      try { off = doc().indexFromPos(doc().getCursor("from")); selS = off; selE = doc().indexFromPos(doc().getCursor("to")); } catch (e) {}
      const wasActive = !!active;
      const wasVirtual = active && active.virtual;
      active = null; clearTimeout(tblTimer);
      blocks = splitBlocks(src());
      if (wasActive && blocks.length) {
        const k = blockAt(blocks, off == null ? 0 : off);
        if (k >= 0) {
          const b = blocks[k];
          active = { i: k, origin: null };
          pendingCaret = { s: Math.max(0, selS - b.start), e: Math.max(0, selE - b.start) };
          if (!hadFocus) pendingCaret = { ...pendingCaret, quiet: true };
        }
      }
      void wasVirtual;
      renderAll();
    }, 40);
  }

  /* ───────────────────────── lifecycle ───────────────────────── */

  function enter() {
    if (on) return;
    on = true; active = null;
    buildToolbar();
    pane.classList.add("mdx-design");
    toolbar.style.display = "";
    document.addEventListener("selectionchange", onSelChange);
    renderAll();
  }
  function exit() {
    if (!on) return;
    commitActive();
    on = false; active = null;
    clearTimeout(extTimer); clearTimeout(tblTimer); clearTimeout(pvTimer);
    closeMenu(); closeAsk(); closeFx();
    pane.classList.remove("mdx-design");
    toolbar.style.display = "none";
    document.removeEventListener("selectionchange", onSelChange);
  }
  function onSelChange() { if (active && active.ta && document.activeElement === active.ta) mirrorSel(); }

  return { enter, exit, isOn: () => on, renderAll, onExternalChange, run, openFx: openFxPicker, hasActive: () => !!active, commit: () => { if (on) commitActive(); } };
}
