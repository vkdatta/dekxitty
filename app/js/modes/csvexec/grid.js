/**
 * csvexec — spreadsheet grid UI.
 *
 * A fixed 1000 × 100 virtualised grid. Only the visible window of cells is in the DOM,
 * so 100 000 cells cost the same as a screenful. Everything is pointer-event based so it
 * works the same with a mouse and with touch.
 *
 *   createGrid(hostElement, hooks) -> api
 *   hooks: { onChange(csv), onMeta(meta), notify(msg) }
 */
import { Sheet, ROWS, COLS, colName, addr, parseAddr, isFormula, shiftFormula, fillCells, autoFillLastRow } from "./engine.js";
import { parseStored, serializeGrid, serialize, parseClipboard, toClipboardText } from "./csv.js";
import { FUNCTION_LIST, CATEGORIES, importCache, exportCache, clearCache, onCacheChange } from "./functions.js";

const ROWH = 30, HEADH = 28, RHW = 52, DEFW = 120, MINW = 44;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function createGrid(host, hooks) {
  hooks = hooks || {};
  const notify = (m) => { try { (hooks.notify || (() => {}))(m); } catch (e) {} };

  /* ───────────── state ───────────── */
  const sheet = new Sheet();
  let widths = new Array(COLS).fill(DEFW);
  let colX = [];
  function rebuildCols() { colX = new Array(COLS + 1); colX[0] = 0; for (let c = 0; c < COLS; c++) colX[c + 1] = colX[c] + widths[c]; }
  rebuildCols();

  let cur = { r: 0, c: 0 }, ext = { r: 0, c: 0 };
  let ed = null;                       // {r,c,mode:'enter'|'edit',origin:'cell'|'bar',ref:null|{start,len}}
  let undoStack = [], redoStack = [];
  let clip = null;                     // {tsv, raws, rect, noShift}
  let rangeMode = false;
  let active = false;
  let drag = null;
  let refRect = null;
  let fillPrev = null;
  let lastTap = { t: 0, r: -1, c: -1 };
  let lastHandleTap = 0;
  let pickerOpen = false;
  let suggest = { items: [], idx: -1, prefix: "" };

  /* ───────────── DOM ───────────── */
  host.innerHTML = `
  <div class="cx-root" tabindex="0">
    <div class="cx-toolbar">
      <div class="cx-row cx-row-bar">
        <input class="cx-name" spellcheck="false" autocomplete="off" aria-label="Cell address" value="A1">
        <button type="button" class="cx-btn cx-fxbtn" title="Insert function">fx</button>
        <input class="cx-fx" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Formula bar" placeholder="Value or =formula">
      </div>
      <div class="cx-row cx-row-actions">
        <button type="button" class="cx-btn" data-a="undo" title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" class="cx-btn" data-a="redo" title="Redo (Ctrl+Y)">Redo</button>
        <button type="button" class="cx-btn" data-a="copy" title="Copy selected values">Copy</button>
        <button type="button" class="cx-btn" data-a="paste" title="Paste from clipboard">Paste</button>
        <button type="button" class="cx-btn" data-a="filldown" title="Fill down (Ctrl+D)">Fill ↓</button>
        <button type="button" class="cx-btn cx-toggle" data-a="range" title="Touch: drag to select a range instead of scrolling">Range</button>
        <button type="button" class="cx-btn" data-a="export" title="Download computed values as CSV">Export</button>
        <button type="button" class="cx-btn" data-a="recalc" title="Recalculate everything (clears the ENCRYPT/DECRYPT cache)">Recalc</button>
        <span class="cx-status"></span>
      </div>
    </div>
    <div class="cx-scroller">
      <div class="cx-sizer"></div>
      <div class="cx-stage">
        <div class="cx-cells"></div>
        <div class="cx-sel"></div>
        <div class="cx-refbox"></div>
        <div class="cx-fillprev"></div>
        <div class="cx-active"></div>
        <div class="cx-fh" title="Drag to fill · double-tap to fill down"></div>
        <input class="cx-editor" spellcheck="false" autocomplete="off" autocapitalize="off">
        <div class="cx-heads"></div>
      </div>
    </div>
    <div class="cx-suggest"></div>
    <div class="cx-picker" aria-hidden="true">
      <div class="cx-picker-card">
        <div class="cx-picker-head"><input class="cx-picker-search" placeholder="Search functions…" spellcheck="false" autocomplete="off"><button type="button" class="cx-btn cx-picker-close">Close</button></div>
        <div class="cx-picker-list"></div>
      </div>
    </div>
  </div>`;
  const $ = (s) => host.querySelector(s);
  const root = $(".cx-root"), scroller = $(".cx-scroller"), sizer = $(".cx-sizer"), stage = $(".cx-stage");
  const elCells = $(".cx-cells"), elSel = $(".cx-sel"), elActive = $(".cx-active"), elFH = $(".cx-fh");
  const elRef = $(".cx-refbox"), elFillPrev = $(".cx-fillprev"), elHeads = $(".cx-heads");
  const editor = $(".cx-editor"), nameBox = $(".cx-name"), fxIn = $(".cx-fx"), statusEl = $(".cx-status");
  const suggestEl = $(".cx-suggest"), picker = $(".cx-picker"), pickerList = $(".cx-picker-list"), pickerSearch = $(".cx-picker-search");

  /* ───────────── helpers ───────────── */
  const rect = () => ({ r1: Math.min(cur.r, ext.r), r2: Math.max(cur.r, ext.r), c1: Math.min(cur.c, ext.c), c2: Math.max(cur.c, ext.c) });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const cx = (c) => RHW + colX[c] - scroller.scrollLeft;
  const cy = (r) => HEADH + r * ROWH - scroller.scrollTop;
  function findCol(x) {
    if (x <= 0) return 0;
    if (x >= colX[COLS]) return COLS - 1;
    let lo = 0, hi = COLS - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (colX[m] <= x) lo = m; else hi = m - 1; }
    return lo;
  }
  function hit(clientX, clientY) {
    const b = stage.getBoundingClientRect();
    const x = clientX - b.left, y = clientY - b.top;
    const sl = scroller.scrollLeft, st = scroller.scrollTop;
    const c = findCol(x - RHW + sl), r = clamp(Math.floor((y - HEADH + st) / ROWH), 0, ROWS - 1);
    if (x < RHW && y < HEADH) return { zone: "corner", x, y };
    if (y < HEADH) {
      const edge = Math.abs(x - (RHW + colX[c + 1] - sl)) <= 7 ? c : (c > 0 && Math.abs(x - (RHW + colX[c] - sl)) <= 7 ? c - 1 : -1);
      return { zone: "colhead", c, edge, x, y };
    }
    if (x < RHW) return { zone: "rowhead", r, x, y };
    return { zone: "cell", r, c, x, y };
  }
  const isEditing = () => !!ed;
  const focusedInput = () => (ed && ed.origin === "bar" ? fxIn : editor);

  /* ───────────── rendering ───────────── */
  let rafPending = false;
  function requestRender() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; render(); }); }

  function updateSizes() {
    sizer.style.width = (RHW + colX[COLS]) + "px";
    sizer.style.height = (HEADH + ROWS * ROWH) + "px";
    stage.style.width = scroller.clientWidth + "px";
    stage.style.height = scroller.clientHeight + "px";
  }

  function render() {
    if (!active) return;
    const vw = scroller.clientWidth, vh = scroller.clientHeight;
    if (!vw || !vh) return;
    if (stage.style.width !== vw + "px" || stage.style.height !== vh + "px") updateSizes();
    const sl = scroller.scrollLeft, st = scroller.scrollTop;
    const r0 = clamp(Math.floor(st / ROWH), 0, ROWS - 1);
    const r1 = clamp(Math.floor((st + vh - HEADH) / ROWH), 0, ROWS - 1);
    const c0 = findCol(sl), c1 = findCol(sl + vw - RHW);
    const sr = rect();
    let cells = "", heads = "";
    for (let r = r0; r <= r1; r++) {
      const top = HEADH + r * ROWH - st;
      for (let c = c0; c <= c1; c++) {
        const raw = sheet.get(r, c);
        if (raw === "" && !(ed && ed.r === r && ed.c === c)) { cells += `<div class="cx-c" style="left:${RHW + colX[c] - sl}px;top:${top}px;width:${widths[c]}px"></div>`; continue; }
        const f = isFormula(raw);
        const txt = sheet.display(r, c);
        let cls = "cx-c";
        if (f) { cls += " cx-fm"; if (sheet.isError(r, c)) cls += " cx-err"; else if (txt === "…") cls += " cx-pend"; }
        cells += `<div class="${cls}" style="left:${RHW + colX[c] - sl}px;top:${top}px;width:${widths[c]}px">${esc(txt)}</div>`;
      }
    }
    elCells.innerHTML = cells;

    heads += `<div class="cx-corner" style="width:${RHW}px;height:${HEADH}px"></div>`;
    for (let c = c0; c <= c1; c++) {
      const hl = c >= sr.c1 && c <= sr.c2 ? " cx-hl" : "";
      heads += `<div class="cx-ch${hl}" style="left:${RHW + colX[c] - sl}px;width:${widths[c]}px;height:${HEADH}px">${colName(c)}</div>`;
    }
    for (let r = r0; r <= r1; r++) {
      const hl = r >= sr.r1 && r <= sr.r2 ? " cx-hl" : "";
      heads += `<div class="cx-rh${hl}" style="top:${HEADH + r * ROWH - st}px;width:${RHW}px;height:${ROWH}px">${r + 1}</div>`;
    }
    elHeads.innerHTML = heads;

    // selection overlays
    const sx = cx(sr.c1), sy = cy(sr.r1), sw = colX[sr.c2 + 1] - colX[sr.c1], sh = (sr.r2 - sr.r1 + 1) * ROWH;
    place(elSel, sx, sy, sw, sh);
    elSel.style.display = (sr.r1 === sr.r2 && sr.c1 === sr.c2) ? "none" : "block";
    place(elActive, cx(cur.c), cy(cur.r), widths[cur.c], ROWH);
    // fill handle at bottom-right of selection
    elFH.style.display = ed ? "none" : "block";
    elFH.style.left = (sx + sw - 6) + "px";
    elFH.style.top = (sy + sh - 6) + "px";
    if (fillPrev) { place(elFillPrev, cx(fillPrev.c1), cy(fillPrev.r1), colX[fillPrev.c2 + 1] - colX[fillPrev.c1], (fillPrev.r2 - fillPrev.r1 + 1) * ROWH); elFillPrev.style.display = "block"; }
    else elFillPrev.style.display = "none";
    if (refRect) { place(elRef, cx(refRect.c1), cy(refRect.r1), colX[refRect.c2 + 1] - colX[refRect.c1], (refRect.r2 - refRect.r1 + 1) * ROWH); elRef.style.display = "block"; }
    else elRef.style.display = "none";
    // editor
    if (ed) {
      editor.style.display = "block";
      editor.style.left = cx(ed.c) + "px";
      editor.style.top = cy(ed.r) + "px";
      editor.style.width = Math.max(widths[ed.c], 200) + "px";
      editor.style.height = ROWH + "px";
    } else editor.style.display = "none";
    positionSuggest();
    updateStatus();
  }
  function place(el, x, y, w, h) { el.style.left = x + "px"; el.style.top = y + "px"; el.style.width = w + "px"; el.style.height = h + "px"; }

  function updateStatus() {
    let s = "";
    if (sheet.running && sheet.progress.total) s = `Calculating ${sheet.progress.done}/${sheet.progress.total}…`;
    else if (sheet.isError(cur.r, cur.c)) s = sheet.errorMessage(cur.r, cur.c);
    else s = "1000 × 100 max";
    if (statusEl.textContent !== s) statusEl.textContent = s;
    statusEl.classList.toggle("cx-busy", sheet.running);
  }

  function syncBar() {
    nameBox.value = addr(cur.r, cur.c);
    if (!ed) fxIn.value = sheet.get(cur.r, cur.c);
  }
  function selChanged(scroll) {
    if (scroll !== false) ensureVisible(ext.r, ext.c);
    syncBar();
    requestRender();
  }
  function ensureVisible(r, c) {
    const sl = scroller.scrollLeft, st = scroller.scrollTop, vw = scroller.clientWidth, vh = scroller.clientHeight;
    const x0 = colX[c], x1 = colX[c + 1];
    if (x0 < sl) scroller.scrollLeft = x0; else if (x1 > sl + vw - RHW) scroller.scrollLeft = Math.min(x0, x1 - (vw - RHW));
    const y0 = r * ROWH, y1 = y0 + ROWH;
    if (y0 < st) scroller.scrollTop = y0; else if (y1 > st + vh - HEADH) scroller.scrollTop = y1 - (vh - HEADH);
  }

  /* ───────────── persistence / recalc scheduling ───────────── */
  let persistT = null, recalcT = null, metaT = null;
  function schedulePersist() { clearTimeout(persistT); persistT = setTimeout(flush, 300); }
  function flush() {
    if (persistT) { clearTimeout(persistT); persistT = null; }
    try { hooks.onChange && hooks.onChange(serializeGrid(sheet.raw)); } catch (e) { console.error(e); }
    emitMeta();
  }
  let metaDirty = false;
  function emitMeta() {
    clearTimeout(metaT); metaT = null;
    if (!metaDirty) return;
    metaDirty = false;
    const w = {};
    widths.forEach((v, i) => { if (v !== DEFW) w[i] = v; });
    try { hooks.onMeta && hooks.onMeta({ w, cache: exportCache() }); } catch (e) {}
  }
  function scheduleMeta() { metaDirty = true; clearTimeout(metaT); metaT = setTimeout(emitMeta, 700); }
  onCacheChange(scheduleMeta);
  function scheduleRecalc() { clearTimeout(recalcT); recalcT = setTimeout(() => { sheet.recalc(); requestRender(); }, 30); }
  sheet.onUpdate = () => requestRender();
  function changed() { schedulePersist(); scheduleRecalc(); requestRender(); }

  /* ───────────── cell mutation + undo ───────────── */
  function setCells(list) {
    const ch = [];
    for (const it of list) {
      if (it.r < 0 || it.r >= ROWS || it.c < 0 || it.c >= COLS) continue;
      const o = sheet.get(it.r, it.c);
      if (o === it.v) continue;
      ch.push({ r: it.r, c: it.c, o, n: it.v });
      sheet.set(it.r, it.c, it.v);
    }
    if (!ch.length) return 0;
    undoStack.push({ ch, cur: { ...cur }, ext: { ...ext } });
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
    changed();
    return ch.length;
  }
  function undo() {
    if (ed) cancelEdit();
    const e = undoStack.pop(); if (!e) { notify("Nothing to undo"); return; }
    e.ch.forEach((x) => sheet.set(x.r, x.c, x.o));
    redoStack.push(e); cur = { ...e.cur }; ext = { ...e.ext };
    changed(); selChanged();
  }
  function redo() {
    if (ed) cancelEdit();
    const e = redoStack.pop(); if (!e) { notify("Nothing to redo"); return; }
    e.ch.forEach((x) => sheet.set(x.r, x.c, x.n));
    undoStack.push(e); cur = { ...e.cur }; ext = { ...e.ext };
    changed(); selChanged();
  }

  /* ───────────── editing ───────────── */
  function startEdit(initial, mode, origin) {
    if (ed) return;
    const raw = sheet.get(cur.r, cur.c);
    ed = { r: cur.r, c: cur.c, mode: mode || "edit", origin: origin || "cell", ref: null, orig: raw };
    const text = initial == null ? raw : initial;
    editor.value = text; fxIn.value = text;
    editor.style.display = "block";
    ensureVisible(cur.r, cur.c);
    requestRender();
    const inp = focusedInput();
    inp.focus();
    try { inp.setSelectionRange(text.length, text.length); } catch (e) {}
    updateSuggest();
  }
  function commitEdit(move) {
    if (!ed) return;
    const e = ed; const v = (e.origin === "bar" ? fxIn.value : editor.value);
    ed = null; hideSuggest(); refRect = null;
    editor.style.display = "none";
    cur = { r: e.r, c: e.c }; ext = { ...cur };
    setCells([{ r: e.r, c: e.c, v }]);
    if (move === "down") moveCur(1, 0, false); else if (move === "up") moveCur(-1, 0, false);
    else if (move === "right") moveCur(0, 1, false); else if (move === "left") moveCur(0, -1, false);
    syncBar(); selChanged();
    if (move) root.focus({ preventScroll: true });
  }
  function cancelEdit() {
    if (!ed) return;
    ed = null; hideSuggest(); refRect = null;
    editor.style.display = "none"; syncBar(); requestRender();
    root.focus({ preventScroll: true });
  }
  function onEditInput(src) {
    if (!ed) return;
    const v = src.value;
    if (src === editor) fxIn.value = v; else editor.value = v;
    ed.ref = null;
    updateSuggest();
  }
  editor.addEventListener("input", () => onEditInput(editor));
  fxIn.addEventListener("input", () => { if (!ed) startEditFromBar(); onEditInput(fxIn); });
  function startEditFromBar() {
    if (ed) return;
    ed = { r: cur.r, c: cur.c, mode: "edit", origin: "bar", ref: null, orig: sheet.get(cur.r, cur.c) };
    editor.value = fxIn.value; editor.style.display = "block"; requestRender();
  }
  fxIn.addEventListener("focus", () => { if (!ed) startEditFromBar(); });
  function editKeydown(e, inp) {
    const sOpen = suggest.items.length > 0;
    if (sOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); suggest.idx = (suggest.idx + 1) % suggest.items.length; renderSuggest(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); suggest.idx = (suggest.idx - 1 + suggest.items.length) % suggest.items.length; renderSuggest(); return; }
      if (e.key === "Tab" || (e.key === "Enter" && suggest.idx >= 0)) { e.preventDefault(); acceptSuggest(suggest.idx >= 0 ? suggest.idx : 0); return; }
      if (e.key === "Escape") { e.preventDefault(); hideSuggest(); return; }
    }
    if (e.key === "Enter") { e.preventDefault(); commitEdit(e.shiftKey ? "up" : "down"); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(e.shiftKey ? "left" : "right"); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    else if (ed && ed.mode === "enter" && ed.origin === "cell" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
             (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      // Excel "Enter mode": arrows commit and move — unless we are building a formula (then caret keys edit)
      if (!(inp.value[0] === "=")) {
        e.preventDefault();
        commitEdit(e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "ArrowLeft" ? "left" : "right");
      }
    }
  }
  editor.addEventListener("keydown", (e) => editKeydown(e, editor));
  fxIn.addEventListener("keydown", (e) => editKeydown(e, fxIn));
  function onBlur() {
    setTimeout(() => {
      if (!ed || pickerOpen) return;
      const a = document.activeElement;
      if (a === editor || a === fxIn || (a && suggestEl.contains(a))) return;
      commitEdit(null);
    }, 0);
  }
  editor.addEventListener("blur", onBlur);
  fxIn.addEventListener("blur", onBlur);

  /* ───────────── function-name autocomplete ───────────── */
  function updateSuggest() {
    if (!ed) { hideSuggest(); return; }
    const inp = focusedInput(); const v = inp.value;
    if (v[0] !== "=") { hideSuggest(); return; }
    const pos = inp.selectionStart == null ? v.length : inp.selectionStart;
    const before = v.slice(0, pos);
    if ((before.match(/"/g) || []).length % 2) { hideSuggest(); return; }
    const m = /([A-Za-z][A-Za-z0-9_.]*)$/.exec(before);
    if (!m) { hideSuggest(); return; }
    const prevCh = before[before.length - m[1].length - 1];
    if (prevCh && !/[=(,;+\-*\/^&<>\s]/.test(prevCh)) { hideSuggest(); return; }
    const p = m[1].toUpperCase();
    const items = FUNCTION_LIST.filter((f) => f.name.startsWith(p)).slice(0, 8);
    if (!items.length || (items.length === 1 && items[0].name === p && v[pos] === "(")) { hideSuggest(); return; }
    suggest = { items, idx: -1, prefix: m[1] };
    renderSuggest();
  }
  function renderSuggest() {
    suggestEl.innerHTML = suggest.items.map((f, i) =>
      `<div class="cx-sg${i === suggest.idx ? " on" : ""}" data-i="${i}"><b>${esc(f.sig)}</b><span>${esc(f.desc)}</span></div>`).join("");
    suggestEl.style.display = "block";
    positionSuggest();
  }
  function positionSuggest() {
    if (suggestEl.style.display !== "block" || !ed) return;
    const rb = root.getBoundingClientRect();
    let x, y;
    if (ed.origin === "bar") { const b = fxIn.getBoundingClientRect(); x = b.left - rb.left; y = b.bottom - rb.top + 2; }
    else { const b = editor.getBoundingClientRect(); x = b.left - rb.left; y = b.bottom - rb.top + 2; }
    suggestEl.style.left = Math.max(4, Math.min(x, rb.width - 280)) + "px";
    suggestEl.style.top = y + "px";
  }
  function hideSuggest() { suggest = { items: [], idx: -1, prefix: "" }; suggestEl.style.display = "none"; }
  function acceptSuggest(i) {
    const f = suggest.items[i]; if (!f || !ed) return;
    const inp = focusedInput(); const v = inp.value; const pos = inp.selectionStart;
    const start = pos - suggest.prefix.length;
    const nv = v.slice(0, start) + f.name + "(" + v.slice(pos);
    inp.value = nv; const np = start + f.name.length + 1; inp.setSelectionRange(np, np);
    onEditInput(inp); inp.focus();
  }
  suggestEl.addEventListener("pointerdown", (e) => {
    const row = e.target.closest(".cx-sg"); if (!row) return;
    e.preventDefault(); acceptSuggest(parseInt(row.dataset.i, 10));
  });

  /* ───────────── formula reference pointing ───────────── */
  function refInsertOK() {
    if (!ed) return false;
    const inp = focusedInput(); const v = inp.value;
    if (v[0] !== "=") return false;
    const pos = inp.selectionStart == null ? v.length : inp.selectionStart;
    if (ed.ref && pos === ed.ref.start + ed.ref.len) return true;
    const b = v.slice(0, pos).replace(/\s+$/, "");
    if (b === "=") return true;
    return "=(,;+-*/^&<>".includes(b[b.length - 1]);
  }
  function setRefText(r1, c1, r2, c2) {
    const inp = focusedInput(); const v = inp.value; const pos = inp.selectionStart;
    const same = r1 === r2 && c1 === c2;
    const txt = same ? addr(r1, c1) : addr(Math.min(r1, r2), Math.min(c1, c2)) + ":" + addr(Math.max(r1, r2), Math.max(c1, c2));
    let start = pos, end = pos;
    if (ed.ref && pos === ed.ref.start + ed.ref.len) { start = ed.ref.start; end = pos; }
    inp.value = v.slice(0, start) + txt + v.slice(end);
    const np = start + txt.length; inp.setSelectionRange(np, np);
    ed.ref = { start, len: txt.length };
    if (inp === editor) fxIn.value = inp.value; else editor.value = inp.value;
    refRect = { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
    hideSuggest(); requestRender();
  }

  /* ───────────── navigation ───────────── */
  function moveCur(dr, dc, extend) {
    if (extend) { ext = { r: clamp(ext.r + dr, 0, ROWS - 1), c: clamp(ext.c + dc, 0, COLS - 1) }; }
    else { cur = { r: clamp(cur.r + dr, 0, ROWS - 1), c: clamp(cur.c + dc, 0, COLS - 1) }; ext = { ...cur }; }
    selChanged();
  }
  function jump(dr, dc, extend) {
    // Ctrl+Arrow: move to the edge of the current data block (Excel behaviour)
    let p = extend ? { ...ext } : { ...cur };
    const filled = (r, c) => sheet.get(r, c) !== "";
    const inb = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
    let r = p.r + dr, c = p.c + dc;
    if (!inb(r, c)) return;
    if (filled(p.r, p.c) && filled(r, c)) { while (inb(r + dr, c + dc) && filled(r + dr, c + dc)) { r += dr; c += dc; } }
    else { while (inb(r, c) && !filled(r, c)) { if (!inb(r + dr, c + dc)) break; r += dr; c += dc; } }
    if (extend) ext = { r, c }; else { cur = { r, c }; ext = { ...cur }; }
    selChanged();
  }
  function selectAll() { cur = { r: 0, c: 0 }; ext = { r: ROWS - 1, c: COLS - 1 }; selChanged(false); }
  function usedRange() {
    let maxR = -1, maxC = -1;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (sheet.get(r, c) !== "") { if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
    return { maxR, maxC };
  }

  /* ───────────── clipboard ───────────── */
  function selectionBlock(valuesOnly) {
    const s = rect();
    let r2 = s.r2;
    if (s.r1 === 0 && s.r2 === ROWS - 1) {        // whole column(s): trim trailing empties
      r2 = -1;
      for (let r = ROWS - 1; r >= 0 && r2 < 0; r--) for (let c = s.c1; c <= s.c2; c++) if (sheet.get(r, c) !== "") { r2 = r; break; }
      if (r2 < 0) r2 = 0;
    }
    const rows = [];
    for (let r = s.r1; r <= r2; r++) { const row = []; for (let c = s.c1; c <= s.c2; c++) row.push(valuesOnly ? sheet.valueText(r, c) : sheet.get(r, c)); rows.push(row); }
    return { rows, rect: { r1: s.r1, c1: s.c1, r2, c2: s.c2 } };
  }
  function doCopy(cut) {
    const vals = selectionBlock(true), raws = selectionBlock(false);
    const tsv = toClipboardText(vals.rows);
    clip = { tsv, raws: raws.rows, rect: raws.rect, noShift: !!cut };
    if (cut) { const s = raws.rect; const l = []; for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) l.push({ r, c, v: "" }); setCells(l); }
    return tsv;
  }
  function pasteText(text) {
    if (ed) return;
    let rows, internal = false;
    const norm = (t) => String(t).replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (clip && norm(text) === norm(clip.tsv)) { rows = clip.raws; internal = true; } else rows = parseClipboard(text);
    if (!rows.length) return;
    const s = rect(); const r0 = s.r1, c0 = s.c1;
    const h = rows.length; const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const list = []; let truncated = false;
    const tx = (v, i, j) => (internal && !clip.noShift ? shiftFormula(v, (r0 + i) - (clip.rect.r1 + i), (c0 + j) - (clip.rect.c1 + j)) : v);
    if (h === 1 && w === 1 && (s.r2 > s.r1 || s.c2 > s.c1)) {
      for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) list.push({ r, c, v: internal && !clip.noShift ? shiftFormula(rows[0][0], r - clip.rect.r1, c - clip.rect.c1) : rows[0][0] });
      setCells(list); selChanged(false); return;
    }
    for (let i = 0; i < h; i++) for (let j = 0; j < rows[i].length; j++) {
      const r = r0 + i, c = c0 + j;
      if (r >= ROWS || c >= COLS) { truncated = true; continue; }
      list.push({ r, c, v: tx(rows[i][j], i, j) });
    }
    setCells(list);
    cur = { r: r0, c: c0 }; ext = { r: Math.min(r0 + h - 1, ROWS - 1), c: Math.min(c0 + w - 1, COLS - 1) };
    selChanged(false);
    notify(truncated ? `Pasted — extra data beyond ${ROWS} rows × ${COLS} columns was dropped` : `Pasted ${h} × ${w}`);
    if (clip && clip.noShift && internal) clip = null;
  }
  const inMyInput = (t) => t === editor || t === fxIn || t === nameBox || t === pickerSearch;
  document.addEventListener("copy", (e) => {
    if (!active || pickerOpen || inMyInput(e.target) || ed) return;
    if (!root.contains(document.activeElement) && document.activeElement !== document.body) return;
    const t = doCopy(false); e.clipboardData.setData("text/plain", t); e.preventDefault();
  });
  document.addEventListener("cut", (e) => {
    if (!active || pickerOpen || inMyInput(e.target) || ed) return;
    if (!root.contains(document.activeElement) && document.activeElement !== document.body) return;
    const t = doCopy(true); e.clipboardData.setData("text/plain", t); e.preventDefault();
  });
  document.addEventListener("paste", (e) => {
    if (!active || pickerOpen || inMyInput(e.target) || ed) return;
    if (!root.contains(document.activeElement) && document.activeElement !== document.body) return;
    const t = e.clipboardData.getData("text/plain"); e.preventDefault(); pasteText(t);
  });

  /* ───────────── fill ───────────── */
  function applyFill(src, target) {
    const list = fillCells(sheet, src, target);
    setCells(list);
    cur = { r: Math.min(src.r1, target.r1), c: Math.min(src.c1, target.c1) };
    ext = { r: Math.max(src.r2, target.r2), c: Math.max(src.c2, target.c2) };
    selChanged(false);
    return list.length;
  }
  function autoFillDown() {
    const s = rect();
    const last = autoFillLastRow(sheet, s);
    if (last < 0) { notify("Nothing to fill — the neighbouring column is empty"); return; }
    const n = applyFill(s, { r1: s.r1, r2: last, c1: s.c1, c2: s.c2 });
    notify(`Filled ${n} cell${n === 1 ? "" : "s"}`);
  }
  function fillDownSelection() {
    const s = rect();
    if (s.r2 === s.r1) { autoFillDown(); return; }
    const src = { r1: s.r1, r2: s.r1, c1: s.c1, c2: s.c2 };
    const list = fillCells(sheet, src, s);
    setCells(list); selChanged(false);
  }
  function fillTargetFor(src, r, c) {
    const dv = r > src.r2 ? r - src.r2 : r < src.r1 ? src.r1 - r : 0;
    const dh = c > src.c2 ? c - src.c2 : c < src.c1 ? src.c1 - c : 0;
    if (!dv && !dh) return null;
    if (dv >= dh) return r > src.r2 ? { r1: src.r1, r2: r, c1: src.c1, c2: src.c2 } : { r1: r, r2: src.r2, c1: src.c1, c2: src.c2 };
    return c > src.c2 ? { r1: src.r1, r2: src.r2, c1: src.c1, c2: c } : { r1: src.r1, r2: src.r2, c1: c, c2: src.c2 };
  }

  /* ───────────── pointer handling ───────────── */
  stage.addEventListener("mousedown", (e) => { if (ed) e.preventDefault(); });   // keep the editor focused while pointing at cells
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const onHandle = e.target.closest && e.target.closest(".cx-fh");
    if (onHandle) {
      e.preventDefault();
      const now = Date.now();
      if (now - lastHandleTap < 400) { lastHandleTap = 0; autoFillDown(); return; }
      lastHandleTap = now;
      drag = { type: "fill", src: rect(), id: e.pointerId };
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      return;
    }
    if (e.target === editor) return;
    const h = hit(e.clientX, e.clientY);
    const touch = e.pointerType === "touch" || e.pointerType === "pen";
    const direct = !touch || rangeMode;

    if (ed && h.zone === "cell" && refInsertOK()) {
      e.preventDefault();
      setRefText(h.r, h.c, h.r, h.c);
      drag = { type: "ref", r: h.r, c: h.c, id: e.pointerId };
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      return;
    }
    if (ed) commitEdit(null);
    root.focus({ preventScroll: true });

    if (h.zone === "colhead" && h.edge >= 0) {
      drag = { type: "cresize", c: h.edge, x0: e.clientX, w0: widths[h.edge], id: e.pointerId };
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      e.preventDefault(); return;
    }
    if (h.zone === "corner") { selectAll(); return; }
    if (h.zone === "colhead") {
      if (e.shiftKey) { ext = { r: ROWS - 1, c: h.c }; } else { cur = { r: 0, c: h.c }; ext = { r: ROWS - 1, c: h.c }; }
      drag = { type: "colsel", id: e.pointerId };
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      selChanged(false); return;
    }
    if (h.zone === "rowhead") {
      if (e.shiftKey) { ext = { r: h.r, c: COLS - 1 }; } else { cur = { r: h.r, c: 0 }; ext = { r: h.r, c: COLS - 1 }; }
      drag = { type: "rowsel", id: e.pointerId };
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
      selChanged(false); return;
    }
    // cell
    const now = Date.now();
    if (direct) {
      e.preventDefault();
      const dbl = !e.shiftKey && lastTap.r === h.r && lastTap.c === h.c && now - lastTap.t < 400;
      if (e.shiftKey) ext = { r: h.r, c: h.c }; else { cur = { r: h.r, c: h.c }; ext = { ...cur }; }
      lastTap = { t: now, r: h.r, c: h.c };
      selChanged(false);
      if (dbl) { startEdit(null, "edit"); return; }
      drag = { type: "select", id: e.pointerId };
      try { stage.setPointerCapture(e.pointerId); } catch (x) {}
    } else {
      // touch: decide on pointerup (a drag means the user is scrolling)
      drag = { type: "tap", x: e.clientX, y: e.clientY, t: now, r: h.r, c: h.c, id: e.pointerId };
    }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag || (drag.id != null && e.pointerId !== drag.id)) return;
    if (drag.type === "tap") { if (Math.abs(e.clientX - drag.x) > 8 || Math.abs(e.clientY - drag.y) > 8) drag = null; return; }
    if (drag.type === "cresize") {
      widths[drag.c] = Math.max(MINW, drag.w0 + (e.clientX - drag.x0));
      rebuildCols(); updateSizes(); requestRender(); return;
    }
    autoScroll(e);
    const hh = hitClamped(e.clientX, e.clientY);
    if (drag.type === "select") { ext = { r: hh.r, c: hh.c }; selChanged(false); }
    else if (drag.type === "colsel") { ext = { r: ROWS - 1, c: hh.c }; selChanged(false); }
    else if (drag.type === "rowsel") { ext = { r: hh.r, c: COLS - 1 }; selChanged(false); }
    else if (drag.type === "fill") { fillPrev = fillTargetFor(drag.src, hh.r, hh.c); requestRender(); }
    else if (drag.type === "ref") { if (ed) setRefText(drag.r, drag.c, hh.r, hh.c); }
  });
  function hitClamped(x, y) {
    const b = stage.getBoundingClientRect(); const sl = scroller.scrollLeft, st = scroller.scrollTop;
    const px = clamp(x - b.left, RHW, b.width), py = clamp(y - b.top, HEADH, b.height);
    return { r: clamp(Math.floor((py - HEADH + st) / ROWH), 0, ROWS - 1), c: findCol(px - RHW + sl) };
  }
  function autoScroll(e) {
    const b = stage.getBoundingClientRect(); const m = 28, step = 24;
    if (e.clientY > b.bottom - m) scroller.scrollTop += step; else if (e.clientY < b.top + HEADH + m) scroller.scrollTop -= step;
    if (e.clientX > b.right - m) scroller.scrollLeft += step; else if (e.clientX < b.left + RHW + m) scroller.scrollLeft -= step;
  }
  function endPointer(e, cancelled) {
    if (!drag || (drag.id != null && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    try { stage.releasePointerCapture(e.pointerId); } catch (x) {}
    if (d.type === "tap" && !cancelled) {
      const now = Date.now();
      if (now - d.t < 600) {
        const dbl = lastTap.r === d.r && lastTap.c === d.c && now - lastTap.t < 450;
        cur = { r: d.r, c: d.c }; ext = { ...cur }; lastTap = { t: now, r: d.r, c: d.c };
        selChanged(false);
        if (dbl) startEdit(null, "edit");
      }
    } else if (d.type === "fill") {
      const t = fillPrev; fillPrev = null;
      if (t && !cancelled) { const n = applyFill(d.src, t); notify(`Filled ${n} cell${n === 1 ? "" : "s"}`); } else requestRender();
    } else if (d.type === "cresize") scheduleMeta();
    else if (d.type === "ref") { requestRender(); }
  }
  stage.addEventListener("pointerup", (e) => endPointer(e, false));
  stage.addEventListener("pointercancel", (e) => endPointer(e, true));
  stage.addEventListener("dblclick", (e) => {
    // double-click on a column-header border = auto-fit
    const h = hit(e.clientX, e.clientY);
    if (h.zone === "colhead" && h.edge >= 0) {
      let max = 6; for (let r = 0; r < ROWS; r++) { const t = sheet.display(r, h.edge); if (t.length > max) max = Math.min(t.length, 60); }
      widths[h.edge] = clamp(Math.round(max * 8.2 + 20), MINW, 520); rebuildCols(); updateSizes(); requestRender(); scheduleMeta();
    }
  });
  scroller.addEventListener("scroll", requestRender, { passive: true });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { updateSizes(); requestRender(); }).observe(scroller);
  window.addEventListener("resize", () => { if (active) { updateSizes(); requestRender(); } });

  /* ───────────── keyboard ───────────── */
  root.addEventListener("keydown", (e) => {
    if (ed || inMyInput(e.target) || pickerOpen) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const lk = k.toLowerCase();
      if (lk === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (lk === "y") { e.preventDefault(); redo(); return; }
      if (lk === "a") { e.preventDefault(); selectAll(); return; }
      if (lk === "d") { e.preventDefault(); fillDownSelection(); return; }
      if (k === "ArrowUp") { e.preventDefault(); jump(-1, 0, e.shiftKey); return; }
      if (k === "ArrowDown") { e.preventDefault(); jump(1, 0, e.shiftKey); return; }
      if (k === "ArrowLeft") { e.preventDefault(); jump(0, -1, e.shiftKey); return; }
      if (k === "ArrowRight") { e.preventDefault(); jump(0, 1, e.shiftKey); return; }
      if (k === "Home") { e.preventDefault(); cur = { r: 0, c: 0 }; ext = { ...cur }; selChanged(); return; }
      return; // let copy/cut/paste events through
    }
    switch (k) {
      case "ArrowUp": e.preventDefault(); moveCur(-1, 0, e.shiftKey); return;
      case "ArrowDown": e.preventDefault(); moveCur(1, 0, e.shiftKey); return;
      case "ArrowLeft": e.preventDefault(); moveCur(0, -1, e.shiftKey); return;
      case "ArrowRight": e.preventDefault(); moveCur(0, 1, e.shiftKey); return;
      case "PageDown": e.preventDefault(); moveCur(Math.max(1, Math.floor(scroller.clientHeight / ROWH) - 2), 0, e.shiftKey); return;
      case "PageUp": e.preventDefault(); moveCur(-Math.max(1, Math.floor(scroller.clientHeight / ROWH) - 2), 0, e.shiftKey); return;
      case "Home": e.preventDefault(); cur = { r: cur.r, c: 0 }; ext = { ...cur }; selChanged(); return;
      case "End": e.preventDefault(); { const u = usedRange(); cur = { r: cur.r, c: Math.max(0, u.maxC) }; ext = { ...cur }; selChanged(); } return;
      case "Enter": e.preventDefault(); moveCur(e.shiftKey ? -1 : 1, 0, false); return;
      case "Tab": e.preventDefault(); moveCur(0, e.shiftKey ? -1 : 1, false); return;
      case "F2": e.preventDefault(); startEdit(null, "edit"); return;
      case "Delete": case "Backspace": {
        e.preventDefault();
        const s = rect(); const l = [];
        for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) l.push({ r, c, v: "" });
        setCells(l); return;
      }
      case "Escape": clip = null; return;
    }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(k, "enter"); }
  });

  /* ───────────── toolbar ───────────── */
  nameBox.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const parts = nameBox.value.trim().split(":");
    const a = parseAddr(parts[0]), b = parts[1] ? parseAddr(parts[1]) : a;
    if (!a || !b) { notify(`Invalid cell. Valid range: A1 – ${addr(ROWS - 1, COLS - 1)}`); syncBar(); return; }
    cur = { ...a }; ext = { ...b }; selChanged(); root.focus({ preventScroll: true });
  });
  nameBox.addEventListener("focus", () => nameBox.select());
  host.querySelector(".cx-row-actions").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a;
    if (ed) commitEdit(null);
    if (a === "undo") undo();
    else if (a === "redo") redo();
    else if (a === "copy") {
      const t = doCopy(false);
      try { await navigator.clipboard.writeText(t); notify("Copied values"); } catch (x) { notify("Copy blocked by the browser — use Ctrl+C"); }
    } else if (a === "paste") {
      try { pasteText(await navigator.clipboard.readText()); } catch (x) { notify("Paste blocked by the browser — use Ctrl+V"); }
    } else if (a === "filldown") fillDownSelection();
    else if (a === "range") { rangeMode = !rangeMode; b.classList.toggle("on", rangeMode); root.classList.toggle("cx-range-mode", rangeMode); notify(rangeMode ? "Range mode: drag to select" : "Range mode off: drag to scroll"); }
    else if (a === "export") exportValues();
    else if (a === "recalc") { clearCache(); scheduleMeta(); sheet.recalc(); requestRender(); notify("Recalculating…"); }
  });
  function exportValues() {
    const u = usedRange(); if (u.maxR < 0) { notify("Sheet is empty"); return; }
    const rows = [];
    for (let r = 0; r <= u.maxR; r++) { const row = []; for (let c = 0; c <= u.maxC; c++) row.push(sheet.valueText(r, c)); rows.push(row); }
    const blob = new Blob([serialize(rows, ",")], { type: "text/csv;charset=utf-8" });
    const name = ((hooks.getName && hooks.getName()) || "sheet") + "-values.csv";
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  $(".cx-fxbtn").addEventListener("pointerdown", (e) => e.preventDefault());
  $(".cx-fxbtn").addEventListener("click", () => openPicker());

  /* ───────────── function picker ───────────── */
  function buildPicker(q) {
    q = (q || "").trim().toLowerCase();
    let html = "";
    for (const cat of CATEGORIES) {
      const items = FUNCTION_LIST.filter((f) => f.cat === cat && (!q || f.name.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q) || cat.toLowerCase().includes(q)));
      if (!items.length) continue;
      html += `<div class="cx-pcat">${esc(cat)}</div>` + items.map((f) => `<div class="cx-pfn" data-n="${f.name}"><b>${esc(f.sig)}</b><span>${esc(f.desc)}</span></div>`).join("");
    }
    pickerList.innerHTML = html || `<div class="cx-pempty">No matching functions</div>`;
  }
  function openPicker() {
    pickerOpen = true; picker.classList.add("open"); picker.setAttribute("aria-hidden", "false");
    pickerSearch.value = ""; buildPicker(""); setTimeout(() => pickerSearch.focus(), 0);
  }
  function closePicker() {
    pickerOpen = false; picker.classList.remove("open"); picker.setAttribute("aria-hidden", "true");
    if (ed) focusedInput().focus(); else root.focus({ preventScroll: true });
  }
  function insertFunction(name) {
    const was = pickerOpen; if (was) { pickerOpen = false; picker.classList.remove("open"); picker.setAttribute("aria-hidden", "true"); }
    if (!ed) { startEdit("=" + name + "(", "edit"); return; }
    const inp = focusedInput(); let v = inp.value; let pos = inp.selectionStart == null ? v.length : inp.selectionStart;
    if (v[0] !== "=") { v = "=" + v; pos++; }
    inp.value = v.slice(0, pos) + name + "(" + v.slice(pos);
    const np = pos + name.length + 1; inp.focus(); inp.setSelectionRange(np, np); onEditInput(inp);
  }
  pickerSearch.addEventListener("input", () => buildPicker(pickerSearch.value));
  pickerList.addEventListener("click", (e) => { const r = e.target.closest(".cx-pfn"); if (r) insertFunction(r.dataset.n); });
  $(".cx-picker-close").addEventListener("click", closePicker);
  picker.addEventListener("pointerdown", (e) => { if (e.target === picker) closePicker(); });

  /* ───────────── public API ───────────── */
  function load(text, meta) {
    clearTimeout(persistT); persistT = null;
    sheet.gen++;                                  // cancel any in-flight calc
    sheet.load(parseStored(text));
    widths = new Array(COLS).fill(DEFW);
    if (meta && meta.w) Object.keys(meta.w).forEach((k) => { const i = +k; if (i >= 0 && i < COLS) widths[i] = Math.max(MINW, +meta.w[k] || DEFW); });
    rebuildCols();
    importCache(meta && meta.cache);
    cur = { r: 0, c: 0 }; ext = { r: 0, c: 0 };
    undoStack = []; redoStack = []; ed = null; clip = null; refRect = null; fillPrev = null; hideSuggest();
    editor.style.display = "none";
    scroller.scrollLeft = 0; scroller.scrollTop = 0;
    updateSizes(); syncBar(); requestRender();
    if (sheet.hasFormulas()) sheet.recalc().then(requestRender); else { sheet.recalc(); }
  }
  function show() { active = true; host.style.display = ""; updateSizes(); syncBar(); requestRender(); setTimeout(() => { try { root.focus({ preventScroll: true }); } catch (e) {} }, 0); }
  function hide() { if (ed) commitEdit(null); active = false; }

  return {
    load, show, hide, flush, undo, redo,
    getCsv: () => serializeGrid(sheet.raw),
    isActive: () => active,
    openPicker, insertFunction,
    refresh: () => { updateSizes(); requestRender(); },
    sheet
  };
}
