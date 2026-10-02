/**
 * csvexec — spreadsheet grid UI (touch-first, Excel / Google-Sheets behaviour).
 *
 *  Touch   tap = select · double-tap = edit · drag = scroll (with momentum)
 *          blue circle handles = resize the selection · small square = fill (formula drag)
 *          long-press a selection, or drag its border = move cells (cell drag)
 *          drag a header edge = resize that row / column · double-tap the edge (or header) = auto-fit
 *  Mouse   drag = select · border = move (Ctrl = copy) · square = fill · right-click = menu
 *
 * Virtualised: only visible cells are in the DOM; rows/columns have individual sizes.
 */
import { Sheet, ROWS, COLS, DEF_COLW, DEF_ROWH, keyOf, colName, colIndex, addr, parseAddr, isFormula, shiftFormula, fillCells, autoFillLastRow } from "./engine.js";
import { parseStored, serializeGrid, serialize, parseClipboard, toClipboardText } from "./csv.js";
import { FUNCTION_LIST, CATEGORIES, importCache, exportCache, clearCache, onCacheChange } from "./functions.js";

const HEADH = 28, RHW = 52, MINW = 24, MINH = 18, LH = 18, PADX = 8, MAXW = 800;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const PALETTE = ["#ffffff", "#e0e0e0", "#9e9e9e", "#424242", "#000000", "#ef9a9a", "#f44336", "#b71c1c", "#ffcc80", "#ff9800", "#e65100", "#fff59d", "#ffeb3b", "#a5d6a7", "#4caf50", "#1b5e20", "#80deea", "#00bcd4", "#90caf9", "#2196f3", "#0d47a1", "#ce93d8", "#9c27b0", "#4a148c"];
const isNumLike = (s) => s !== "" && isFinite(Number(s)) && /^\s*[-+]?(\d|\.\d)/.test(s);

export function createGrid(host, hooks) {
  hooks = hooks || {};
  const notify = (m) => { try { (hooks.notify || (() => {}))(m); } catch (e) {} };

  /* ═════════════════════════════ state ═════════════════════════════ */
  const sheet = new Sheet();
  let colX = new Array(COLS + 1).fill(0), rowY = new Array(ROWS + 1).fill(0);
  let cur = { r: 0, c: 0 }, ext = { r: 0, c: 0 };
  let ed = null;                       // {r,c,mode,origin,ref,orig}
  let undoStack = [], redoStack = [];
  let clip = null;                     // {tsv, raws, fmts, rect, noShift}
  let active = false, drag = null, refRect = null, fillPrev = null, movePrev = null;
  let touchUI = false, rafPending = false;
  let lastTap = { t: 0, r: -1, c: -1, z: "" };
  let pickerOpen = false, menuOpen = false;
  let suggest = { items: [], idx: -1, prefix: "" };
  let finds = { q: "", list: [], i: -1 };
  let lastPtr = { x: 0, y: 0 };

  const sizeC = (c) => (sheet.hidC.has(c) ? 0 : sheet.colW[c]);
  const sizeR = (r) => (sheet.hidR.has(r) ? 0 : sheet.rowH[r]);
  function rebuildCols() { colX[0] = 0; for (let c = 0; c < COLS; c++) colX[c + 1] = colX[c] + sizeC(c); }
  function rebuildRows() { rowY[0] = 0; for (let r = 0; r < ROWS; r++) rowY[r + 1] = rowY[r] + sizeR(r); }
  function rebuildGeom() { rebuildCols(); rebuildRows(); }
  rebuildGeom();

  /* ═════════════════════════════ DOM ═════════════════════════════ */
  host.innerHTML = `
  <div class="cx-root" tabindex="0">
    <div class="cx-toolbar">
      <div class="cx-row">
        <input class="cx-name" spellcheck="false" autocomplete="off" aria-label="Cell address" value="A1">
        <button type="button" class="cx-btn cx-fxbtn" title="Insert function">fx</button>
        <textarea class="cx-fx" rows="1" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="Formula bar" placeholder="Value or =formula"></textarea>
      </div>
      <div class="cx-row cx-row-actions">
        <button type="button" class="cx-btn" data-a="undo" title="Undo (Ctrl+Z)">↶</button>
        <button type="button" class="cx-btn" data-a="redo" title="Redo (Ctrl+Y)">↷</button>
        <span class="cx-sep"></span>
        <button type="button" class="cx-btn" data-a="cut">Cut</button>
        <button type="button" class="cx-btn" data-a="copy">Copy</button>
        <button type="button" class="cx-btn" data-a="paste">Paste</button>
        <span class="cx-sep"></span>
        <button type="button" class="cx-btn cx-b" data-a="bold" title="Bold (Ctrl+B)">B</button>
        <button type="button" class="cx-btn cx-i" data-a="italic" title="Italic (Ctrl+I)">I</button>
        <button type="button" class="cx-btn" data-a="wrap" title="Wrap text">Wrap</button>
        <button type="button" class="cx-btn" data-a="al-l" title="Align left">⇤</button>
        <button type="button" class="cx-btn" data-a="al-c" title="Align center">↔</button>
        <button type="button" class="cx-btn" data-a="al-r" title="Align right">⇥</button>
        <button type="button" class="cx-btn" data-a="tc" title="Text colour"><span style="border-bottom:3px solid var(--c-accent)">A</span></button>
        <button type="button" class="cx-btn" data-a="bg" title="Fill colour">Fill</button>
        <span class="cx-sep"></span>
        <button type="button" class="cx-btn" data-a="filldown" title="Fill down (Ctrl+D)">Fill ↓</button>
        <button type="button" class="cx-btn" data-a="find" title="Find & replace (Ctrl+F)">Find</button>
        <button type="button" class="cx-btn" data-a="menu" title="More: insert, delete, sort, freeze…">More ⋯</button>
        <span class="cx-status"></span>
      </div>
      <div class="cx-row cx-find" style="display:none">
        <input class="cx-fq" placeholder="Find" spellcheck="false" autocomplete="off">
        <input class="cx-fr" placeholder="Replace with" spellcheck="false" autocomplete="off">
        <button type="button" class="cx-btn" data-f="prev">↑</button>
        <button type="button" class="cx-btn" data-f="next">↓</button>
        <button type="button" class="cx-btn cx-fcase" data-f="case" title="Match case">Aa</button>
        <button type="button" class="cx-btn" data-f="rep">Replace</button>
        <button type="button" class="cx-btn" data-f="all">All</button>
        <button type="button" class="cx-btn" data-f="close">✕</button>
        <span class="cx-fcount"></span>
      </div>
    </div>
    <div class="cx-scroller">
      <div class="cx-sizer"></div>
      <div class="cx-stage">
        <div class="cx-cells"></div>
        <div class="cx-cells cx-cells-f"></div>
        <div class="cx-sel"></div><div class="cx-refbox"></div><div class="cx-fillprev"></div><div class="cx-moveprev"></div><div class="cx-active"></div>
        <div class="cx-fh" title="Drag to fill · double-tap to fill down"></div>
        <div class="cx-sh cx-sh1"></div><div class="cx-sh cx-sh2"></div>
        <textarea class="cx-editor" rows="1" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
        <div class="cx-heads"></div>
      </div>
    </div>
    <div class="cx-suggest"></div>
    <div class="cx-menu" aria-hidden="true"></div>
    <div class="cx-dialog" aria-hidden="true"><div class="cx-dialog-card"><div class="cx-dialog-title"></div><input class="cx-dialog-input" type="number" inputmode="decimal"><div class="cx-dialog-btns"><button type="button" class="cx-btn cx-dialog-cancel">Cancel</button><button type="button" class="cx-btn on cx-dialog-ok">OK</button></div></div></div>
    <div class="cx-picker" aria-hidden="true">
      <div class="cx-picker-card">
        <div class="cx-picker-head"><input class="cx-picker-search" placeholder="Search functions…" spellcheck="false" autocomplete="off"><button type="button" class="cx-btn cx-picker-close">Close</button></div>
        <div class="cx-picker-list"></div>
      </div>
    </div>
  </div>`;
  const $ = (s) => host.querySelector(s);
  const root = $(".cx-root"), scroller = $(".cx-scroller"), sizer = $(".cx-sizer"), stage = $(".cx-stage");
  const elCells = $(".cx-cells"), elCellsF = $(".cx-cells-f"), elSel = $(".cx-sel"), elActive = $(".cx-active"), elFH = $(".cx-fh");
  const elRef = $(".cx-refbox"), elFillPrev = $(".cx-fillprev"), elMovePrev = $(".cx-moveprev"), elHeads = $(".cx-heads");
  const elSH1 = $(".cx-sh1"), elSH2 = $(".cx-sh2");
  const editor = $(".cx-editor"), nameBox = $(".cx-name"), fxIn = $(".cx-fx"), statusEl = $(".cx-status");
  const suggestEl = $(".cx-suggest"), picker = $(".cx-picker"), pickerList = $(".cx-picker-list"), pickerSearch = $(".cx-picker-search");
  const menuEl = $(".cx-menu"), dialogEl = $(".cx-dialog"), findRow = $(".cx-find"), fq = $(".cx-fq"), fr = $(".cx-fr"), fcount = $(".cx-fcount");
  const mctx = document.createElement("canvas").getContext("2d");

  /* ═════════════════════════════ geometry ═════════════════════════════ */
  const rect = () => ({ r1: Math.min(cur.r, ext.r), r2: Math.max(cur.r, ext.r), c1: Math.min(cur.c, ext.c), c2: Math.max(cur.c, ext.c) });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const FC = () => sheet.freeze.c, FR = () => sheet.freeze.r;
  const X = (c) => RHW + colX[c] - (c < FC() ? 0 : scroller.scrollLeft);
  const Y = (r) => HEADH + rowY[r] - (r < FR() ? 0 : scroller.scrollTop);
  function idx(arr, v, n) { if (v <= 0) return 0; let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= v) lo = m; else hi = m - 1; } return lo; }
  const colAt = (u) => (u < colX[FC()] ? idx(colX, u, COLS) : idx(colX, u + scroller.scrollLeft, COLS));
  const rowAt = (v) => (v < rowY[FR()] ? idx(rowY, v, ROWS) : idx(rowY, v + scroller.scrollTop, ROWS));
  const isWholeCols = (s) => s.r1 === 0 && s.r2 === ROWS - 1;
  const isWholeRows = (s) => s.c1 === 0 && s.c2 === COLS - 1;

  function hit(clientX, clientY) {
    const b = stage.getBoundingClientRect();
    const x = clientX - b.left, y = clientY - b.top, tol = touchUI ? 14 : 5;
    if (x < RHW && y < HEADH) return { zone: "corner", x, y };
    if (y < HEADH) {
      const c = colAt(x - RHW); let edge = -1;
      for (const k of [c, c - 1, c + 1]) if (k >= 0 && k < COLS && sizeC(k) > 0 && Math.abs(x - (X(k) + sizeC(k))) <= tol && (edge < 0 || Math.abs(x - (X(k) + sizeC(k))) < Math.abs(x - (X(edge) + sizeC(edge))))) edge = k;
      return { zone: "colhead", c, edge, x, y };
    }
    if (x < RHW) {
      const r = rowAt(y - HEADH); let edge = -1;
      for (const k of [r, r - 1, r + 1]) if (k >= 0 && k < ROWS && sizeR(k) > 0 && Math.abs(y - (Y(k) + sizeR(k))) <= tol && (edge < 0 || Math.abs(y - (Y(k) + sizeR(k))) < Math.abs(y - (Y(edge) + sizeR(edge))))) edge = k;
      return { zone: "rowhead", r, edge, x, y };
    }
    return { zone: "cell", r: rowAt(y - HEADH), c: colAt(x - RHW), x, y };
  }
  function hitClamped(cx, cy) {
    const b = stage.getBoundingClientRect();
    const x = clamp(cx - b.left, RHW, b.width - 1), y = clamp(cy - b.top, HEADH, b.height - 1);
    return { r: rowAt(y - HEADH), c: colAt(x - RHW) };
  }
  /** screen rectangle of a cell rectangle */
  function screenRect(s) {
    const x1 = X(s.c1), y1 = Y(s.r1), x2 = X(s.c2) + sizeC(s.c2), y2 = Y(s.r2) + sizeR(s.r2);
    return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
  }
  /** is a stage point within `tol` px of the selection border (and not on a handle)? */
  function onSelBorder(x, y, tol) {
    const s = screenRect(rect());
    const inX = x >= s.x - tol && x <= s.x + s.w + tol, inY = y >= s.y - tol && y <= s.y + s.h + tol;
    if (!inX || !inY) return false;
    const nearL = Math.abs(x - s.x) <= tol, nearR = Math.abs(x - (s.x + s.w)) <= tol, nearT = Math.abs(y - s.y) <= tol, nearB = Math.abs(y - (s.y + s.h)) <= tol;
    return nearL || nearR || nearT || nearB;
  }
  function visibleBounds() {
    const sl = scroller.scrollLeft, st = scroller.scrollTop, vw = scroller.clientWidth, vh = scroller.clientHeight;
    return {
      c0: Math.max(FC(), idx(colX, sl + colX[FC()], COLS)), c1: idx(colX, sl + vw - RHW, COLS),
      r0: Math.max(FR(), idx(rowY, st + rowY[FR()], ROWS)), r1: idx(rowY, st + vh - HEADH, ROWS)
    };
  }
  function ensureVisible(r, c) {
    const sl = scroller.scrollLeft, st = scroller.scrollTop, vw = scroller.clientWidth, vh = scroller.clientHeight;
    if (c >= FC()) {
      const lo = sl + colX[FC()], hi = sl + vw - RHW;
      if (colX[c] < lo) scroller.scrollLeft = Math.max(0, colX[c] - colX[FC()]); else if (colX[c + 1] > hi) scroller.scrollLeft = Math.max(0, colX[c + 1] - (vw - RHW));
    }
    if (r >= FR()) {
      const lo = st + rowY[FR()], hi = st + vh - HEADH;
      if (rowY[r] < lo) scroller.scrollTop = Math.max(0, rowY[r] - rowY[FR()]); else if (rowY[r + 1] > hi) scroller.scrollTop = Math.max(0, rowY[r + 1] - (vh - HEADH));
    }
  }

  /* ═════════════════════════════ rendering ═════════════════════════════ */
  function requestRender() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; render(); }); }
  function updateSizes() {
    sizer.style.width = (RHW + colX[COLS]) + "px";
    sizer.style.height = (HEADH + rowY[ROWS]) + "px";
    stage.style.width = scroller.clientWidth + "px";
    stage.style.height = scroller.clientHeight + "px";
  }
  function cellHtml(r, c, frozen) {
    const w = sizeC(c), h = sizeR(r);
    if (w <= 0 || h <= 0) return "";
    const raw = sheet.get(r, c), fm = sheet.getFmt(r, c);
    let cls = "cx-c" + (frozen ? " cx-fz" : "") + (frozen && c === FC() - 1 ? " cx-fzr" : "") + (frozen && r === FR() - 1 ? " cx-fzb" : "");
    let st = `left:${X(c)}px;top:${Y(r)}px;width:${w}px;height:${h}px;`;
    let txt = "";
    if (raw !== "") {
      txt = sheet.display(r, c);
      if (isFormula(raw)) { cls += " cx-fm"; if (sheet.isError(r, c)) cls += " cx-err"; else if (txt === "…") cls += " cx-pend"; }
    }
    if (fm) {
      if (fm.wr) cls += " cx-wr";
      if (fm.b) st += "font-weight:700;";
      if (fm.i) st += "font-style:italic;";
      if (fm.tc) st += `color:${fm.tc};`;
      if (fm.bg) st += `background:${fm.bg};`;
      const al = fm.al || (txt !== "" && !sheet.isError(r, c) && isNumLike(txt) ? "r" : "");
      if (al) st += `text-align:${al === "c" ? "center" : al === "r" ? "right" : "left"};`;
    } else if (txt !== "" && isNumLike(txt) && !sheet.isError(r, c)) st += "text-align:right;";
    return `<div class="${cls}" style="${st}">${txt === "" ? "" : esc(txt)}</div>`;
  }
  function render() {
    if (!active) return;
    const vw = scroller.clientWidth, vh = scroller.clientHeight;
    if (!vw || !vh) return;
    if (stage.style.width !== vw + "px" || stage.style.height !== vh + "px") updateSizes();
    const fc = FC(), fr = FR(), vb = visibleBounds(), s = rect();
    const rowsList = [], colsList = [];
    for (let r = 0; r < fr; r++) rowsList.push(r);
    for (let r = vb.r0; r <= vb.r1; r++) rowsList.push(r);
    for (let c = 0; c < fc; c++) colsList.push(c);
    for (let c = vb.c0; c <= vb.c1; c++) colsList.push(c);
    let a = "", f = "";
    for (const r of rowsList) for (const c of colsList) { const fz = r < fr || c < fc; if (fz) f += cellHtml(r, c, true); else a += cellHtml(r, c, false); }
    elCells.innerHTML = a; elCellsF.innerHTML = f;

    let heads = "";
    const headCell = (cls, st, txt) => `<div class="${cls}" style="${st}">${txt}</div>`;
    for (const c of colsList) {
      const w = sizeC(c); if (w <= 0) continue;
      const sel = c >= s.c1 && c <= s.c2, whole = sel && isWholeCols(s);
      heads += headCell("cx-ch" + (sel ? " cx-hl" : "") + (whole ? " cx-hw" : "") + (c < fc ? " cx-hz" : ""), `left:${X(c)}px;width:${w}px;height:${HEADH}px`, colName(c));
    }
    for (const r of rowsList) {
      const h = sizeR(r); if (h <= 0) continue;
      const sel = r >= s.r1 && r <= s.r2, whole = sel && isWholeRows(s);
      heads += headCell("cx-rh" + (sel ? " cx-hl" : "") + (whole ? " cx-hw" : "") + (r < fr ? " cx-hz" : ""), `top:${Y(r)}px;width:${RHW}px;height:${h}px`, r + 1);
    }
    heads += `<div class="cx-corner" style="width:${RHW}px;height:${HEADH}px"></div>`;
    elHeads.innerHTML = heads;

    // selection overlays
    const sr = screenRect(s), single = s.r1 === s.r2 && s.c1 === s.c2;
    place(elSel, sr.x, sr.y, sr.w, sr.h); elSel.style.display = single ? "none" : "block";
    place(elActive, X(cur.c), Y(cur.r), sizeC(cur.c), sizeR(cur.r));
    const showH = !ed && sr.w > 0;
    elFH.style.display = showH ? "block" : "none";
    elFH.style.left = (sr.x + sr.w - 6) + "px"; elFH.style.top = (sr.y + sr.h - 6) + "px";
    const th = showH && touchUI;
    elSH1.style.display = elSH2.style.display = th ? "block" : "none";
    if (th) { elSH1.style.left = (sr.x - 24) + "px"; elSH1.style.top = (sr.y - 24) + "px"; elSH2.style.left = (sr.x + sr.w + 8) + "px"; elSH2.style.top = (sr.y + sr.h + 8) + "px"; }
    showRect(elFillPrev, fillPrev); showRect(elRef, refRect); showRect(elMovePrev, movePrev);
    if (ed) {
      editor.style.display = "block";
      editor.style.left = X(ed.c) + "px"; editor.style.top = Y(ed.r) + "px";
      editor.style.width = Math.max(sizeC(ed.c), 200) + "px";
      sizeEditor();
    } else editor.style.display = "none";
    positionSuggest(); updateStatus();
  }
  function showRect(el, rc) { if (rc) { const q = screenRect(rc); place(el, q.x, q.y, q.w, q.h); el.style.display = "block"; } else el.style.display = "none"; }
  function place(el, x, y, w, h) { el.style.left = x + "px"; el.style.top = y + "px"; el.style.width = w + "px"; el.style.height = h + "px"; }
  function sizeEditor() {
    if (!ed) return;
    editor.style.height = "auto";
    const need = Math.min(280, Math.max(sizeR(ed.r), editor.scrollHeight + 2));
    editor.style.height = need + "px";
  }
  function updateStatus() {
    let s;
    if (sheet.running && sheet.progress.total) s = `Calculating ${sheet.progress.done}/${sheet.progress.total}…`;
    else if (sheet.isError(cur.r, cur.c)) s = sheet.errorMessage(cur.r, cur.c);
    else { const q = rect(), n = (q.r2 - q.r1 + 1) * (q.c2 - q.c1 + 1); s = n > 1 && !isWholeCols(q) && !isWholeRows(q) ? `${q.r2 - q.r1 + 1}R × ${q.c2 - q.c1 + 1}C` : "1000 × 100 max"; }
    if (statusEl.textContent !== s) statusEl.textContent = s;
    statusEl.classList.toggle("cx-busy", sheet.running);
    const fm = sheet.getFmt(cur.r, cur.c) || {};
    host.querySelectorAll('[data-a="bold"],[data-a="italic"],[data-a="wrap"],[data-a="al-l"],[data-a="al-c"],[data-a="al-r"]').forEach((b) => {
      const k = b.dataset.a; b.classList.toggle("on", k === "bold" ? !!fm.b : k === "italic" ? !!fm.i : k === "wrap" ? !!fm.wr : k === "al-l" ? fm.al === "l" : k === "al-c" ? fm.al === "c" : fm.al === "r");
    });
  }
  function syncBar() {
    const s = rect();
    nameBox.value = (s.r1 === s.r2 && s.c1 === s.c2) ? addr(cur.r, cur.c) : isWholeCols(s) ? (s.c1 === s.c2 ? colName(s.c1) : colName(s.c1) + ":" + colName(s.c2)) : isWholeRows(s) ? (s.r1 === s.r2 ? String(s.r1 + 1) : (s.r1 + 1) + ":" + (s.r2 + 1)) : addr(s.r1, s.c1) + ":" + addr(s.r2, s.c2);
    if (!ed) fxIn.value = sheet.get(cur.r, cur.c);
  }
  function selChanged(scroll) { if (scroll !== false) ensureVisible(ext.r, ext.c); syncBar(); requestRender(); }

  /* ═════════════════════════════ persistence / recalc ═════════════════════════════ */
  let persistT = null, recalcT = null, metaT = null, metaDirty = false;
  function schedulePersist() { clearTimeout(persistT); persistT = setTimeout(flush, 300); }
  function getMeta() {
    const w = {}, h = {}, fmt = {};
    sheet.colW.forEach((v, i) => { if (v !== DEF_COLW) w[i] = v; });
    sheet.rowH.forEach((v, i) => { if (v !== DEF_ROWH) h[i] = v; });
    sheet.fmt.forEach((v, k) => { fmt[k] = v; });
    return { w, h, hr: [...sheet.hidR], hc: [...sheet.hidC], fz: { ...sheet.freeze }, fmt, cache: exportCache() };
  }
  function applyMeta(m) {
    sheet.resetLayout();
    if (m) {
      const ok = (v, d) => (typeof v === "number" && isFinite(v) && v >= 0 ? v : d);
      if (m.w) for (const k in m.w) { const i = +k; if (i >= 0 && i < COLS) sheet.colW[i] = Math.max(MINW, ok(m.w[k], DEF_COLW)); }
      if (m.h) for (const k in m.h) { const i = +k; if (i >= 0 && i < ROWS) sheet.rowH[i] = Math.max(MINH, ok(m.h[k], DEF_ROWH)); }
      (m.hr || []).forEach((i) => { if (i >= 0 && i < ROWS) sheet.hidR.add(i); });
      (m.hc || []).forEach((i) => { if (i >= 0 && i < COLS) sheet.hidC.add(i); });
      if (m.fz) sheet.freeze = { r: clamp(m.fz.r | 0, 0, 50), c: clamp(m.fz.c | 0, 0, 20) };
      if (m.fmt) for (const k in m.fmt) { const n = +k; if (n >= 0 && n < ROWS * COLS && m.fmt[k] && typeof m.fmt[k] === "object") sheet.fmt.set(n, m.fmt[k]); }
    }
    rebuildGeom();
  }
  function flush() {
    if (persistT) { clearTimeout(persistT); persistT = null; }
    try { hooks.onChange && hooks.onChange(serializeGrid(sheet.raw)); } catch (e) { console.error(e); }
    emitMeta();
  }
  function emitMeta() { clearTimeout(metaT); metaT = null; if (!metaDirty) return; metaDirty = false; try { hooks.onMeta && hooks.onMeta(getMeta()); } catch (e) {} }
  function scheduleMeta() { metaDirty = true; clearTimeout(metaT); metaT = setTimeout(emitMeta, 700); }
  onCacheChange(scheduleMeta);
  let recalcPending = false;
  function scheduleRecalc() { recalcPending = true; clearTimeout(recalcT); recalcT = setTimeout(() => { recalcPending = false; sheet.recalc(); requestRender(); }, 30); }
  sheet.onUpdate = () => requestRender();
  function changed(metaToo) { schedulePersist(); scheduleRecalc(); if (metaToo) scheduleMeta(); requestRender(); }

  /* ═════════════════════════════ mutations + undo ═════════════════════════════ */
  const fmtEq = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
  const cleanFmt = (f) => { for (const k of Object.keys(f)) if (!f[k]) delete f[k]; return Object.keys(f).length ? f : null; };
  /** cells: [{r,c,v}]  fmts: [{r,c,f}] (f = style object or null) — one undo step */
  function setCells(cells, fmts) {
    const ch = [], fch = [];
    for (const it of cells || []) {
      if (it.r < 0 || it.r >= ROWS || it.c < 0 || it.c >= COLS) continue;
      const o = sheet.get(it.r, it.c); if (o === it.v) continue;
      ch.push({ r: it.r, c: it.c, o, n: it.v }); sheet.set(it.r, it.c, it.v);
    }
    for (const it of fmts || []) {
      if (it.r < 0 || it.r >= ROWS || it.c < 0 || it.c >= COLS) continue;
      const k = keyOf(it.r, it.c), o = sheet.fmt.get(k) || null, n = it.f ? cleanFmt({ ...it.f }) : null;
      if (fmtEq(o, n)) continue;
      fch.push({ k, o, n }); if (n) sheet.fmt.set(k, n); else sheet.fmt.delete(k);
    }
    if (!ch.length && !fch.length) return 0;
    pushUndo({ t: "d", ch, fch, cur: { ...cur }, ext: { ...ext } });
    changed(fch.length > 0);
    return ch.length + fch.length;
  }
  function pushUndo(e) { undoStack.push(e); redoStack = []; if (undoStack.length > 200) undoStack.shift(); let n = 0; for (let i = undoStack.length - 1; i >= 0; i--) if (undoStack[i].t === "s" && ++n > 20) undoStack[i] = { t: "d", ch: [], fch: [], cur, ext }; }
  /** structural / layout change: snapshot before & after */
  function structural(fn, layoutOnly) {
    if (ed) commitEdit(null);
    if (sheet.running || recalcPending) { notify("Wait for the calculation to finish"); return false; }
    const before = sheet.snapshot();
    const err = fn();
    if (typeof err === "string" && err) { sheet.restore(before); rebuildGeom(); notify(err); return false; }
    rebuildGeom(); updateSizes();
    pushUndo({ t: "s", before, after: sheet.snapshot(), cur: { ...cur }, ext: { ...ext } });
    if (layoutOnly) { schedulePersist(); scheduleMeta(); requestRender(); } else { sheet.values.clear(); changed(true); }
    syncBar();
    return true;
  }
  function applyEntry(e, dir) {
    if (e.t === "s") { sheet.restore(dir < 0 ? e.before : e.after); rebuildGeom(); updateSizes(); }
    else {
      for (const x of dir < 0 ? e.ch.slice().reverse() : e.ch) sheet.set(x.r, x.c, dir < 0 ? x.o : x.n);
      for (const x of e.fch || []) { const v = dir < 0 ? x.o : x.n; if (v) sheet.fmt.set(x.k, v); else sheet.fmt.delete(x.k); }
    }
  }
  function undo() {
    if (ed) cancelEdit();
    const e = undoStack.pop(); if (!e) { notify("Nothing to undo"); return; }
    applyEntry(e, -1); redoStack.push(e); cur = { ...e.cur }; ext = { ...e.ext };
    sheet.values.clear(); changed(true); selChanged();
  }
  function redo() {
    if (ed) cancelEdit();
    const e = redoStack.pop(); if (!e) { notify("Nothing to redo"); return; }
    applyEntry(e, 1); undoStack.push(e);
    sheet.values.clear(); changed(true); selChanged();
  }

  /* ═════════════════════════════ editing ═════════════════════════════ */
  const focusedInput = () => (ed && ed.origin === "bar" ? fxIn : editor);
  function startEdit(initial, mode, origin) {
    if (ed) return;
    if (sheet.hidR.has(cur.r) || sheet.hidC.has(cur.c)) return;
    const raw = sheet.get(cur.r, cur.c);
    ed = { r: cur.r, c: cur.c, mode: mode || "edit", origin: origin || "cell", ref: null, orig: raw };
    const text = initial == null ? raw : initial;
    editor.value = text; fxIn.value = text; editor.style.display = "block";
    ensureVisible(cur.r, cur.c); requestRender();
    const inp = focusedInput(); inp.focus();
    try { inp.setSelectionRange(text.length, text.length); } catch (e) {}
    updateSuggest();
  }
  function commitEdit(move) {
    if (!ed) return;
    const e = ed, v = e.origin === "bar" ? fxIn.value : editor.value;
    ed = null; hideSuggest(); refRect = null; editor.style.display = "none";
    cur = { r: e.r, c: e.c }; ext = { ...cur };
    setCells([{ r: e.r, c: e.c, v }]);
    if (move === "down") moveCur(1, 0, false); else if (move === "up") moveCur(-1, 0, false);
    else if (move === "right") moveCur(0, 1, false); else if (move === "left") moveCur(0, -1, false);
    syncBar(); selChanged();
    if (move) root.focus({ preventScroll: true });
  }
  function cancelEdit() { if (!ed) return; ed = null; hideSuggest(); refRect = null; editor.style.display = "none"; syncBar(); requestRender(); root.focus({ preventScroll: true }); }
  function onEditInput(src) {
    if (!ed) return;
    if (src === editor) fxIn.value = src.value; else editor.value = src.value;
    ed.ref = null; sizeEditor(); updateSuggest();
  }
  editor.addEventListener("input", () => onEditInput(editor));
  fxIn.addEventListener("input", () => { if (!ed) startEditFromBar(); onEditInput(fxIn); });
  function startEditFromBar() {
    if (ed) return;
    ed = { r: cur.r, c: cur.c, mode: "edit", origin: "bar", ref: null, orig: sheet.get(cur.r, cur.c) };
    editor.value = fxIn.value; editor.style.display = "block"; requestRender();
  }
  fxIn.addEventListener("focus", () => { if (!ed) startEditFromBar(); });
  function insertNewline(inp) {
    const s = inp.selectionStart, e = inp.selectionEnd;
    inp.value = inp.value.slice(0, s) + "\n" + inp.value.slice(e); inp.setSelectionRange(s + 1, s + 1); onEditInput(inp);
  }
  function editKeydown(e, inp) {
    if (suggest.items.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); suggest.idx = (suggest.idx + 1) % suggest.items.length; renderSuggest(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); suggest.idx = (suggest.idx - 1 + suggest.items.length) % suggest.items.length; renderSuggest(); return; }
      if (e.key === "Tab" || (e.key === "Enter" && suggest.idx >= 0)) { e.preventDefault(); acceptSuggest(suggest.idx >= 0 ? suggest.idx : 0); return; }
      if (e.key === "Escape") { e.preventDefault(); hideSuggest(); return; }
    }
    if (e.key === "Enter") { e.preventDefault(); if (e.altKey) insertNewline(inp); else commitEdit(e.shiftKey ? "up" : "down"); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(e.shiftKey ? "left" : "right"); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
    else if (ed && ed.mode === "enter" && ed.origin === "cell" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && inp.value[0] !== "=" &&
             (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault(); commitEdit(e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : e.key === "ArrowLeft" ? "left" : "right");
    }
  }
  editor.addEventListener("keydown", (e) => editKeydown(e, editor));
  fxIn.addEventListener("keydown", (e) => editKeydown(e, fxIn));
  function onBlur() {
    setTimeout(() => {
      if (!ed || pickerOpen || menuOpen) return;
      const a = document.activeElement;
      if (a === editor || a === fxIn || (a && suggestEl.contains(a))) return;
      commitEdit(null);
    }, 0);
  }
  editor.addEventListener("blur", onBlur); fxIn.addEventListener("blur", onBlur);

  /* ═════════════════════════════ function autocomplete ═════════════════════════════ */
  function updateSuggest() {
    if (!ed) { hideSuggest(); return; }
    const inp = focusedInput(), v = inp.value;
    if (v[0] !== "=") { hideSuggest(); return; }
    const pos = inp.selectionStart == null ? v.length : inp.selectionStart, before = v.slice(0, pos);
    if ((before.match(/"/g) || []).length % 2) { hideSuggest(); return; }
    const m = /([A-Za-z][A-Za-z0-9_.]*)$/.exec(before);
    if (!m) { hideSuggest(); return; }
    const prev = before[before.length - m[1].length - 1];
    if (prev && !/[=(,;+\-*\/^&<>\s]/.test(prev)) { hideSuggest(); return; }
    const p = m[1].toUpperCase(), items = FUNCTION_LIST.filter((f) => f.name.startsWith(p)).slice(0, 8);
    if (!items.length || (items.length === 1 && items[0].name === p && v[pos] === "(")) { hideSuggest(); return; }
    suggest = { items, idx: -1, prefix: m[1] }; renderSuggest();
  }
  function renderSuggest() {
    suggestEl.innerHTML = suggest.items.map((f, i) => `<div class="cx-sg${i === suggest.idx ? " on" : ""}" data-i="${i}"><b>${esc(f.sig)}</b><span>${esc(f.desc)}</span></div>`).join("");
    suggestEl.style.display = "block"; positionSuggest();
  }
  function positionSuggest() {
    if (suggestEl.style.display !== "block" || !ed) return;
    const rb = root.getBoundingClientRect(), b = (ed.origin === "bar" ? fxIn : editor).getBoundingClientRect();
    suggestEl.style.left = Math.max(4, Math.min(b.left - rb.left, rb.width - 280)) + "px"; suggestEl.style.top = (b.bottom - rb.top + 2) + "px";
  }
  function hideSuggest() { suggest = { items: [], idx: -1, prefix: "" }; suggestEl.style.display = "none"; }
  function acceptSuggest(i) {
    const f = suggest.items[i]; if (!f || !ed) return;
    const inp = focusedInput(), v = inp.value, pos = inp.selectionStart, start = pos - suggest.prefix.length;
    inp.value = v.slice(0, start) + f.name + "(" + v.slice(pos); const np = start + f.name.length + 1; inp.setSelectionRange(np, np);
    onEditInput(inp); inp.focus();
  }
  suggestEl.addEventListener("pointerdown", (e) => { const row = e.target.closest(".cx-sg"); if (!row) return; e.preventDefault(); acceptSuggest(parseInt(row.dataset.i, 10)); });

  /* ═════════════════════════════ formula reference pointing ═════════════════════════════ */
  function refInsertOK() {
    if (!ed) return false;
    const inp = focusedInput(), v = inp.value;
    if (v[0] !== "=") return false;
    const pos = inp.selectionStart == null ? v.length : inp.selectionStart;
    if (ed.ref && pos === ed.ref.start + ed.ref.len) return true;
    const b = v.slice(0, pos).replace(/\s+$/, "");
    return b === "=" || "=(,;+-*/^&<>".includes(b[b.length - 1]);
  }
  function setRefText(r1, c1, r2, c2) {
    const inp = focusedInput(), v = inp.value, pos = inp.selectionStart;
    const txt = r1 === r2 && c1 === c2 ? addr(r1, c1) : addr(Math.min(r1, r2), Math.min(c1, c2)) + ":" + addr(Math.max(r1, r2), Math.max(c1, c2));
    let start = pos, end = pos;
    if (ed.ref && pos === ed.ref.start + ed.ref.len) { start = ed.ref.start; end = pos; }
    inp.value = v.slice(0, start) + txt + v.slice(end);
    const np = start + txt.length; inp.setSelectionRange(np, np); ed.ref = { start, len: txt.length };
    if (inp === editor) fxIn.value = inp.value; else editor.value = inp.value;
    refRect = { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
    hideSuggest(); requestRender();
  }

  /* ═════════════════════════════ navigation ═════════════════════════════ */
  function stepVisible(v, d, hid, n) { let k = v + d; while (k >= 0 && k < n && hid.has(k)) k += d; return k < 0 || k >= n ? v : k; }
  function moveCur(dr, dc, extend) {
    const base = extend ? ext : cur;
    let r = base.r, c = base.c;
    if (dr) { const s = Math.sign(dr); for (let i = 0; i < Math.abs(dr); i++) r = stepVisible(r, s, sheet.hidR, ROWS); }
    if (dc) { const s = Math.sign(dc); for (let i = 0; i < Math.abs(dc); i++) c = stepVisible(c, s, sheet.hidC, COLS); }
    if (extend) ext = { r, c }; else { cur = { r, c }; ext = { ...cur }; }
    selChanged();
  }
  function jump(dr, dc, extend) {
    const p = extend ? { ...ext } : { ...cur }, filled = (r, c) => sheet.get(r, c) !== "", inb = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
    let r = p.r + dr, c = p.c + dc; if (!inb(r, c)) return;
    if (filled(p.r, p.c) && filled(r, c)) { while (inb(r + dr, c + dc) && filled(r + dr, c + dc)) { r += dr; c += dc; } }
    else { while (inb(r, c) && !filled(r, c)) { if (!inb(r + dr, c + dc)) break; r += dr; c += dc; } }
    if (extend) ext = { r, c }; else { cur = { r, c }; ext = { ...cur }; }
    selChanged();
  }
  function selectAll() { cur = { r: 0, c: 0 }; ext = { r: ROWS - 1, c: COLS - 1 }; selChanged(false); }
  function selectCols(a, b) { cur = { r: 0, c: Math.min(a, b) }; ext = { r: ROWS - 1, c: Math.max(a, b) }; selChanged(false); }
  function selectRows(a, b) { cur = { r: Math.min(a, b), c: 0 }; ext = { r: Math.max(a, b), c: COLS - 1 }; selChanged(false); }
  function usedRange() {
    let maxR = -1, maxC = -1;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (sheet.get(r, c) !== "") { if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
    return { maxR, maxC };
  }

  /* ═════════════════════════════ clipboard ═════════════════════════════ */
  function selectionBlock(valuesOnly) {
    const s = rect(); let r2 = s.r2, c2 = s.c2;
    if (isWholeCols(s) || isWholeRows(s) || (s.r1 === 0 && s.c1 === 0 && s.r2 === ROWS - 1 && s.c2 === COLS - 1)) {   // whole rows/cols: trim to the used area
      const u = usedRange(); if (isWholeCols(s)) r2 = Math.max(0, u.maxR); if (isWholeRows(s)) c2 = Math.max(0, u.maxC);
    }
    const rows = [], fmts = [];
    for (let r = s.r1; r <= r2; r++) { const row = [], fr2 = []; for (let c = s.c1; c <= c2; c++) { row.push(valuesOnly ? sheet.valueText(r, c) : sheet.get(r, c)); fr2.push(sheet.getFmt(r, c) || null); } rows.push(row); fmts.push(fr2); }
    return { rows, fmts, rect: { r1: s.r1, c1: s.c1, r2, c2 } };
  }
  function doCopy(cut) {
    const vals = selectionBlock(true), raws = selectionBlock(false);
    const tsv = toClipboardText(vals.rows);
    clip = { tsv, raws: raws.rows, fmts: raws.fmts, rect: raws.rect, noShift: !!cut };
    if (cut) clearSelection(true);
    return tsv;
  }
  function pasteText(text, mode) {
    if (ed) return;
    mode = mode || "all";
    let rows, fmts = null, internal = false;
    const norm = (t) => String(t).replace(/\r\n/g, "\n").replace(/\n$/, "");
    if (clip && mode !== "values" && norm(text) === norm(clip.tsv)) { rows = clip.raws; fmts = clip.fmts; internal = true; }
    else rows = parseClipboard(text);
    if (!rows.length) return;
    const s = rect(), r0 = s.r1, c0 = s.c1, h = rows.length, w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const shift = internal && !clip.noShift;
    const list = [], fl = []; let truncated = false;
    if (h === 1 && w === 1 && (s.r2 > s.r1 || s.c2 > s.c1)) {                       // one value into a bigger selection → fill the selection
      for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) {
        list.push({ r, c, v: shift ? shiftFormula(rows[0][0], r - clip.rect.r1, c - clip.rect.c1) : rows[0][0] });
        if (fmts && fmts[0][0]) fl.push({ r, c, f: fmts[0][0] });
      }
      setCells(list, fl); selChanged(false); return;
    }
    for (let i = 0; i < h; i++) for (let j = 0; j < rows[i].length; j++) {
      const r = r0 + i, c = c0 + j;
      if (r >= ROWS || c >= COLS) { truncated = true; continue; }
      list.push({ r, c, v: shift ? shiftFormula(rows[i][j], r - (clip.rect.r1 + i), c - (clip.rect.c1 + j)) : rows[i][j] });
      if (fmts && mode === "all") fl.push({ r, c, f: fmts[i][j] || null });
    }
    setCells(list, fl);
    cur = { r: r0, c: c0 }; ext = { r: Math.min(r0 + h - 1, ROWS - 1), c: Math.min(c0 + w - 1, COLS - 1) };
    selChanged(false);
    notify(truncated ? `Pasted — data beyond ${ROWS} rows × ${COLS} columns was dropped` : `Pasted ${h} × ${w}`);
    if (clip && clip.noShift && internal) clip = null;
  }
  const inMyInput = (t) => t === editor || t === fxIn || t === nameBox || t === pickerSearch || t === fq || t === fr || t === $(".cx-dialog-input");
  const mine = () => active && !pickerOpen && !menuOpen && (root.contains(document.activeElement) || document.activeElement === document.body);
  document.addEventListener("copy", (e) => { if (!mine() || inMyInput(e.target) || ed) return; e.clipboardData.setData("text/plain", doCopy(false)); e.preventDefault(); });
  document.addEventListener("cut", (e) => { if (!mine() || inMyInput(e.target) || ed) return; e.clipboardData.setData("text/plain", doCopy(true)); e.preventDefault(); });
  document.addEventListener("paste", (e) => { if (!mine() || inMyInput(e.target) || ed) return; e.preventDefault(); pasteText(e.clipboardData.getData("text/plain"), pasteMode); pasteMode = "all"; });
  let pasteMode = "all";
  async function pasteFromClipboard(mode) {
    try { pasteText(await navigator.clipboard.readText(), mode); }
    catch (x) { if (clip) pasteText(clip.tsv, mode); else notify("Paste blocked by the browser — use Ctrl+V"); }
  }
  async function copyToSystem(cut) {
    const t = doCopy(cut);
    try { await navigator.clipboard.writeText(t); notify(cut ? "Cut" : "Copied"); } catch (x) { notify(cut ? "Cut (paste inside this sheet)" : "Copied (paste inside this sheet)"); }
  }

  /* ═════════════════════════════ clear / fill / format ═════════════════════════════ */
  function cellsOf(s) { const l = []; for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) l.push({ r, c }); return l; }
  function limited(s) {      // whole-row/col/sheet selections only touch the used area for formatting loops
    const u = usedRange(); const q = { ...s };
    if (isWholeCols(s)) q.r2 = Math.max(0, Math.min(ROWS - 1, Math.max(u.maxR, 0)));
    if (isWholeRows(s)) q.c2 = Math.max(0, Math.min(COLS - 1, Math.max(u.maxC, 0)));
    return q;
  }
  function clearSelection(contentsOnly) {
    const s = rect(); const l = [];
    for (let r = s.r1; r <= s.r2; r++) { if (sheet.get(r, s.c1) === "" && s.c1 === s.c2 && false) continue; for (let c = s.c1; c <= s.c2; c++) if (sheet.get(r, c) !== "") l.push({ r, c, v: "" }); }
    setCells(l);
  }
  function clearFormats() { const s = rect(); const fl = []; sheet.fmt.forEach((f, k) => { const r = Math.floor(k / COLS), c = k % COLS; if (r >= s.r1 && r <= s.r2 && c >= s.c1 && c <= s.c2) fl.push({ r, c, f: null }); }); setCells([], fl); }
  function formatSel(mut) {
    const s = limited(rect()), fl = [];
    for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) { const f = { ...(sheet.getFmt(r, c) || {}) }; mut(f); fl.push({ r, c, f }); }
    setCells([], fl);
  }
  const curFmt = () => sheet.getFmt(cur.r, cur.c) || {};
  function toggleFmt(key) { const on = !curFmt()[key]; formatSel((f) => { f[key] = on ? 1 : 0; }); }
  function setAlign(a) { const same = curFmt().al === a; formatSel((f) => { f.al = same ? "" : a; }); }
  function applyFill(src, target) {
    const list = fillCells(sheet, src, target), fl = [];
    for (const x of list) {                                  // formats follow the fill (like Excel)
      const v = target.r1 !== src.r1 || target.r2 !== src.r2;
      const sr = v ? src.r1 + ((((x.r - src.r1) % (src.r2 - src.r1 + 1)) + (src.r2 - src.r1 + 1)) % (src.r2 - src.r1 + 1)) : x.r;
      const sc = v ? x.c : src.c1 + ((((x.c - src.c1) % (src.c2 - src.c1 + 1)) + (src.c2 - src.c1 + 1)) % (src.c2 - src.c1 + 1));
      fl.push({ r: x.r, c: x.c, f: sheet.getFmt(sr, sc) || null });
    }
    setCells(list, fl);
    cur = { r: Math.min(src.r1, target.r1), c: Math.min(src.c1, target.c1) }; ext = { r: Math.max(src.r2, target.r2), c: Math.max(src.c2, target.c2) };
    selChanged(false); return list.length;
  }
  function autoFillDown() {
    const s = rect(), last = autoFillLastRow(sheet, s);
    if (last < 0) { notify("Nothing to fill — the neighbouring column is empty"); return; }
    const n = applyFill(s, { r1: s.r1, r2: last, c1: s.c1, c2: s.c2 }); notify(`Filled ${n} cell${n === 1 ? "" : "s"}`);
  }
  function fillDownSelection() {
    const s = rect(); if (s.r2 === s.r1) { autoFillDown(); return; }
    setCells(fillCells(sheet, { r1: s.r1, r2: s.r1, c1: s.c1, c2: s.c2 }, s)); selChanged(false);
  }
  function fillRightSelection() {
    const s = rect(); if (s.c2 === s.c1) { notify("Select 2 or more columns to fill right"); return; }
    setCells(fillCells(sheet, { r1: s.r1, r2: s.r2, c1: s.c1, c2: s.c1 }, s)); selChanged(false);
  }
  function fillTargetFor(src, r, c) {
    const dv = r > src.r2 ? r - src.r2 : r < src.r1 ? src.r1 - r : 0, dh = c > src.c2 ? c - src.c2 : c < src.c1 ? src.c1 - c : 0;
    if (!dv && !dh) return null;
    if (dv >= dh) return r > src.r2 ? { r1: src.r1, r2: r, c1: src.c1, c2: src.c2 } : { r1: r, r2: src.r2, c1: src.c1, c2: src.c2 };
    return c > src.c2 ? { r1: src.r1, r2: src.r2, c1: src.c1, c2: c } : { r1: src.r1, r2: src.r2, c1: c, c2: src.c2 };
  }

  /* ═════════════════════════════ auto-fit ═════════════════════════════ */
  function textW(t, fm) { mctx.font = `${fm && fm.i ? "italic " : ""}${fm && fm.b ? "700 " : ""}13px ${getComputedStyle(root).fontFamily || "monospace"}`; return mctx.measureText(t).width; }
  function colFitWidth(c) {
    let w = 0;
    for (let r = 0; r < ROWS; r++) {
      if (sheet.get(r, c) === "") continue;
      const t = sheet.display(r, c); if (!t || t === "…") continue;
      const fm = sheet.getFmt(r, c); let lw = 0;
      for (const line of t.split("\n")) lw = Math.max(lw, textW(line, fm));
      w = Math.max(w, fm && fm.wr ? Math.min(lw, 300) : lw);
    }
    return w === 0 ? DEF_COLW : clamp(Math.ceil(w + 2 * PADX + 6), 44, MAXW);
  }
  /** fits the tallest cell; cells whose text overflows or has line breaks get Wrap switched on so the whole value shows */
  function rowFitHeight(r) {
    let h = 0, any = false;
    for (let c = 0; c < COLS; c++) {
      if (sheet.get(r, c) === "" || sizeC(c) <= 0) continue;
      const t = sheet.display(r, c); if (!t || t === "…") continue;
      const fm = sheet.getFmt(r, c), avail = Math.max(20, sizeC(c) - 2 * PADX - 2), paras = t.split("\n");
      const over = Math.max(...paras.map((p) => textW(p, fm))) > avail;
      if (!(fm && fm.wr) && !over && paras.length === 1) continue;
      if (!(fm && fm.wr)) sheet.fmt.set(keyOf(r, c), { ...(fm || {}), wr: 1 });
      let lines = 0; for (const p of paras) lines += Math.max(1, Math.ceil(textW(p, fm) / (avail * 0.96)));
      h = Math.max(h, lines * LH + 10); any = true;
    }
    return any ? clamp(Math.ceil(h), DEF_ROWH, 546) : DEF_ROWH;
  }
  const colsSel = () => { const s = rect(); return { a: s.c1, b: s.c2 }; };
  const rowsSel = () => { const s = rect(); return { a: s.r1, b: s.r2 }; };
  function fitTargets(axis, idx) {
    const s = rect(), whole = axis === "c" ? isWholeCols(s) : isWholeRows(s), lo = axis === "c" ? s.c1 : s.r1, hi = axis === "c" ? s.c2 : s.r2;
    if (whole && idx >= lo && idx <= hi) { const l = []; for (let i = lo; i <= hi; i++) l.push(i); return l; }
    return [idx];
  }
  function autofit(axis, list) {
    if (sheet.running || recalcPending) { notify("Wait for the calculation to finish, then try again"); return; }
    const ok = structural(() => { for (const i of list) { if (axis === "c") { sheet.hidC.delete(i); sheet.colW[i] = colFitWidth(i); } else { sheet.hidR.delete(i); sheet.rowH[i] = rowFitHeight(i); } } }, true);
    if (ok) notify(axis === "c" ? "Column width fitted" : "Row height fitted");
  }

  /* ═════════════════════════════ rows / columns / sort / freeze ═════════════════════════════ */
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  function insertRowsAt(below) { const s = rect(), k = s.r2 - s.r1 + 1, at = below ? s.r2 + 1 : s.r1; if (at >= ROWS) { notify("No room to insert below the last row"); return; } structural(() => sheet.insertRows(at, k)); }
  function insertColsAt(right) { const s = rect(), k = s.c2 - s.c1 + 1, at = right ? s.c2 + 1 : s.c1; if (at >= COLS) { notify("No room to insert after the last column"); return; } structural(() => sheet.insertCols(at, k)); }
  function deleteRowsSel() { const s = rect(); const n = s.r2 - s.r1 + 1; if (structural(() => sheet.deleteRows(s.r1, n))) { ext = { ...cur }; selChanged(); } }
  function deleteColsSel() { const s = rect(); const n = s.c2 - s.c1 + 1; if (structural(() => sheet.deleteCols(s.c1, n))) { ext = { ...cur }; selChanged(); } }
  function hideSel(axis) {
    const s = rect(), lo = axis === "r" ? s.r1 : s.c1, hi = axis === "r" ? s.r2 : s.c2, set = axis === "r" ? sheet.hidR : sheet.hidC, n = axis === "r" ? ROWS : COLS;
    if (hi - lo + 1 + set.size >= n) { notify("Can't hide everything"); return; }
    structural(() => { for (let i = lo; i <= hi; i++) set.add(i); }, true);
    if (axis === "r") { cur = { r: stepVisible(s.r2, 1, sheet.hidR, ROWS), c: cur.c }; } else cur = { r: cur.r, c: stepVisible(s.c2, 1, sheet.hidC, COLS) };
    if ((axis === "r" ? sheet.hidR : sheet.hidC).has(axis === "r" ? cur.r : cur.c)) cur = axis === "r" ? { r: stepVisible(s.r1, -1, sheet.hidR, ROWS), c: cur.c } : { r: cur.r, c: stepVisible(s.c1, -1, sheet.hidC, COLS) };
    ext = { ...cur }; selChanged();
  }
  function unhideSel(axis) {
    const s = rect(), set = axis === "r" ? sheet.hidR : sheet.hidC, lo = Math.max(0, (axis === "r" ? s.r1 : s.c1) - 1), hi = Math.min((axis === "r" ? ROWS : COLS) - 1, (axis === "r" ? s.r2 : s.c2) + 1);
    let any = false; for (let i = lo; i <= hi; i++) if (set.has(i)) any = true;
    if (!any) { notify(`No hidden ${axis === "r" ? "rows" : "columns"} next to the selection`); return; }
    structural(() => { for (let i = lo; i <= hi; i++) set.delete(i); }, true);
  }
  function askSize(axis) {
    const s = rect(), lo = axis === "r" ? s.r1 : s.c1, hi = axis === "r" ? s.r2 : s.c2;
    askNumber(axis === "r" ? "Row height (px)" : "Column width (px)", axis === "r" ? sheet.rowH[lo] : sheet.colW[lo], (v) => {
      if (!(v > 0)) return;
      structural(() => { for (let i = lo; i <= hi; i++) { if (axis === "r") { sheet.hidR.delete(i); sheet.rowH[i] = clamp(Math.round(v), MINH, 546); } else { sheet.hidC.delete(i); sheet.colW[i] = clamp(Math.round(v), MINW, MAXW); } } }, true);
    });
  }
  function freezeTo(kind) {
    structural(() => {
      if (kind === "off") { sheet.freeze = { r: 0, c: 0 }; return ""; }
      const f = { ...sheet.freeze };
      if (kind === "r") f.r = cur.r + 1; else if (kind === "c") f.c = cur.c + 1;
      const vw = scroller.clientWidth, vh = scroller.clientHeight;
      sheet.freeze = f; rebuildGeom();
      if (rowY[f.r] > vh * 0.6 || colX[f.c] > vw * 0.6) return "That area is too big to freeze on this screen";
      return "";
    }, true);
  }
  function sortSel(dir) {
    const s = rect(), u = usedRange();
    if (u.maxR < 0) { notify("Nothing to sort"); return; }
    let r1, r2, c1, c2, key = cur.c;
    const single = s.r1 === s.r2 && s.c1 === s.c2;
    if (single || isWholeCols(s)) { r1 = Math.min(FR(), u.maxR); r2 = u.maxR; c1 = 0; c2 = u.maxC; }
    else if (isWholeRows(s)) { r1 = s.r1; r2 = Math.min(s.r2, u.maxR); c1 = 0; c2 = u.maxC; key = clamp(cur.c, 0, u.maxC); }
    else { r1 = s.r1; r2 = s.r2; c1 = s.c1; c2 = s.c2; if (key < c1 || key > c2) key = c1; }
    if (r2 <= r1) { notify("Need at least 2 rows to sort"); return; }
    if (structural(() => { sheet.sortRows(r1, r2, c1, c2, key, dir); })) notify(`Sorted ${r2 - r1 + 1} rows by column ${colName(key)} ${dir > 0 ? "A→Z" : "Z→A"}`);
  }
  function moveBlock(src, dr, dc, copy) {
    if (structural(() => sheet.moveCells(src, dr, dc, copy))) {
      cur = { r: src.r1 + dr, c: src.c1 + dc }; ext = { r: src.r2 + dr, c: src.c2 + dc }; selChanged(false);
      notify(copy ? "Copied" : "Moved");
    }
  }

  /* ═════════════════════════════ find & replace ═════════════════════════════ */
  let matchCase = false;
  function openFind(focusReplace) {
    findRow.style.display = "flex"; fq.focus();
    if (!fq.value) { const t = sheet.get(cur.r, cur.c); if (t && !isFormula(t) && t.length < 60) fq.value = t; }
    fq.select(); if (focusReplace) fr.focus(); runFind(false);
  }
  function closeFind() { findRow.style.display = "none"; root.focus({ preventScroll: true }); }
  function runFind(jump) {
    const q = fq.value; finds.q = q; finds.list = [];
    if (q) {
      const n = matchCase ? q : q.toLowerCase();
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const raw = sheet.get(r, c); if (raw === "") continue;
        const a = matchCase ? raw : raw.toLowerCase(); let hitIt = a.includes(n);
        if (!hitIt && isFormula(raw)) { const d = sheet.display(r, c); hitIt = (matchCase ? d : d.toLowerCase()).includes(n); }
        if (hitIt) finds.list.push([r, c]);
      }
    }
    let i = finds.list.findIndex(([r, c]) => r > cur.r || (r === cur.r && c >= cur.c)); if (i < 0) i = finds.list.length ? 0 : -1;
    finds.i = i; showFind(jump);
  }
  function showFind(jump) {
    fcount.textContent = finds.q ? (finds.list.length ? `${finds.i + 1}/${finds.list.length}` : "0 found") : "";
    if (jump && finds.i >= 0) { const [r, c] = finds.list[finds.i]; cur = { r, c }; ext = { r, c }; selChanged(); }
  }
  function findStep(d) {
    if (!finds.list.length || finds.q !== fq.value) runFind(false);
    if (!finds.list.length) { showFind(false); return; }
    const onMatch = finds.list.findIndex(([r, c]) => r === cur.r && c === cur.c);
    finds.i = onMatch >= 0 ? (onMatch + d + finds.list.length) % finds.list.length : (finds.i + (d > 0 ? 0 : -1) + finds.list.length) % finds.list.length;
    showFind(true);
  }
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function replaceIn(raw, q, rep) { return raw.replace(new RegExp(reEsc(q), "g" + (matchCase ? "" : "i")), () => rep); }
  function replaceCurrent() {
    const q = fq.value; if (!q) return;
    const raw = sheet.get(cur.r, cur.c), n = replaceIn(raw, q, fr.value);
    if (n !== raw) setCells([{ r: cur.r, c: cur.c, v: n }]);
    runFind(false); findStep(1);
  }
  function replaceAll() {
    const q = fq.value; if (!q) return;
    const l = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const raw = sheet.get(r, c); if (raw === "") continue; const n = replaceIn(raw, q, fr.value); if (n !== raw) l.push({ r, c, v: n }); }
    setCells(l); notify(l.length ? `Replaced in ${plural(l.length, "cell")}` : "No matches in cell text or formulas"); runFind(false);
  }
  findRow.addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]"); if (!b) return; const k = b.dataset.f;
    if (k === "next") findStep(1); else if (k === "prev") findStep(-1); else if (k === "rep") replaceCurrent(); else if (k === "all") replaceAll();
    else if (k === "close") closeFind(); else if (k === "case") { matchCase = !matchCase; b.classList.toggle("on", matchCase); runFind(false); }
  });
  fq.addEventListener("input", () => runFind(true));
  const findKeys = (e) => { if (e.key === "Enter") { e.preventDefault(); findStep(e.shiftKey ? -1 : 1); } else if (e.key === "Escape") { e.preventDefault(); closeFind(); } };
  fq.addEventListener("keydown", findKeys); fr.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); replaceCurrent(); } else if (e.key === "Escape") closeFind(); });

  /* ═════════════════════════════ menus / palette / dialog ═════════════════════════════ */
  function closeMenu() { if (!menuOpen) return; menuOpen = false; menuEl.classList.remove("open", "cx-sheet"); menuEl.setAttribute("aria-hidden", "true"); menuEl.innerHTML = ""; }
  function placeMenu(x, y) {
    const rb = root.getBoundingClientRect();
    menuEl.classList.add("open"); menuEl.setAttribute("aria-hidden", "false"); menuOpen = true;
    if (rb.width < 640) { menuEl.classList.add("cx-sheet"); menuEl.style.left = menuEl.style.top = ""; return; }
    menuEl.classList.remove("cx-sheet");
    const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    menuEl.style.left = clamp(x - rb.left, 4, rb.width - mw - 4) + "px"; menuEl.style.top = clamp(y - rb.top, 4, rb.height - mh - 4) + "px";
  }
  function openMenu(items, x, y) {
    menuEl.innerHTML = items.map((it, i) => it.sep ? `<div class="cx-msep"></div>` : it.h ? `<div class="cx-mh">${esc(it.h)}</div>` : `<button type="button" class="cx-mi${it.danger ? " danger" : ""}" data-i="${i}"><span>${esc(it.l)}</span>${it.k ? `<em>${esc(it.k)}</em>` : ""}</button>`).join("");
    menuEl._items = items; placeMenu(x, y);
  }
  menuEl.addEventListener("click", (e) => { const b = e.target.closest(".cx-mi"); if (!b) return; const it = menuEl._items[+b.dataset.i]; closeMenu(); root.focus({ preventScroll: true }); if (it && it.a) setTimeout(it.a, 0); });
  document.addEventListener("pointerdown", (e) => { if (menuOpen && !menuEl.contains(e.target)) closeMenu(); }, true);
  function openPalette(kind) {
    menuEl.innerHTML = `<div class="cx-mh">${kind === "tc" ? "Text colour" : "Fill colour"}</div><div class="cx-pal">${PALETTE.map((c) => `<button type="button" class="cx-sw" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}</div><button type="button" class="cx-mi" data-c="">None / default</button>`;
    menuEl._items = null; placeMenu(lastPtr.x, lastPtr.y);
    menuEl.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => { const c = b.dataset.c; closeMenu(); root.focus({ preventScroll: true }); formatSel((f) => { f[kind === "tc" ? "tc" : "bg"] = c; }); }));
  }
  function buildMenu() {
    const s = rect(), wc = isWholeCols(s) && !isWholeRows(s), wr = isWholeRows(s) && !isWholeCols(s), nR = s.r2 - s.r1 + 1, nC = s.c2 - s.c1 + 1, A = [];
    const add = (l, a, extra) => A.push(Object.assign({ l, a }, extra || {}));
    add("Cut", () => copyToSystem(true), { k: "Ctrl+X" }); add("Copy", () => copyToSystem(false), { k: "Ctrl+C" });
    add("Paste", () => pasteFromClipboard("all"), { k: "Ctrl+V" }); add("Paste values only", () => pasteFromClipboard("values"), { k: "Ctrl+Shift+V" });
    A.push({ sep: 1 });
    if (!wc) add(`Insert ${plural(nR, "row")} above`, () => insertRowsAt(false));
    if (!wc) add(`Insert ${plural(nR, "row")} below`, () => insertRowsAt(true));
    if (!wr) add(`Insert ${plural(nC, "column")} left`, () => insertColsAt(false));
    if (!wr) add(`Insert ${plural(nC, "column")} right`, () => insertColsAt(true));
    if (!wc) add(`Delete ${plural(nR, "row")}`, deleteRowsSel, { danger: 1 });
    if (!wr) add(`Delete ${plural(nC, "column")}`, deleteColsSel, { danger: 1 });
    A.push({ sep: 1 });
    if (!wc) { add("Row height…", () => askSize("r")); add("Auto-fit row height", () => autofit("r", fitTargets("r", s.r1))); add("Hide rows", () => hideSel("r")); add("Unhide rows", () => unhideSel("r")); }
    if (!wr) { add("Column width…", () => askSize("c")); add("Auto-fit column width", () => autofit("c", fitTargets("c", s.c1))); add("Hide columns", () => hideSel("c")); add("Unhide columns", () => unhideSel("c")); }
    A.push({ sep: 1 });
    add("Fill down", fillDownSelection, { k: "Ctrl+D" }); add("Fill right", fillRightSelection, { k: "Ctrl+R" });
    add("Sort A → Z", () => sortSel(1)); add("Sort Z → A", () => sortSel(-1));
    A.push({ sep: 1 });
    add("Bold", () => toggleFmt("b"), { k: "Ctrl+B" }); add("Italic", () => toggleFmt("i"), { k: "Ctrl+I" }); add("Wrap text", () => toggleFmt("wr"));
    add("Text colour…", () => openPalette("tc")); add("Fill colour…", () => openPalette("bg"));
    add("Clear contents", () => clearSelection(true), { k: "Del" }); add("Clear formats", clearFormats);
    A.push({ sep: 1 });
    add(`Freeze rows through ${cur.r + 1}`, () => freezeTo("r")); add(`Freeze columns through ${colName(cur.c)}`, () => freezeTo("c"));
    if (FR() || FC()) add("Unfreeze panes", () => freezeTo("off"));
    A.push({ sep: 1 });
    add("Find & replace", () => openFind(false), { k: "Ctrl+F" }); add("Insert function (fx)", () => openPicker()); add("Select all", selectAll, { k: "Ctrl+A" });
    add("Export values as CSV", exportValues); add("Recalculate all", () => { clearCache(); scheduleMeta(); sheet.recalc(); requestRender(); notify("Recalculating…"); });
    return A;
  }
  function showMenuAt(x, y) { if (ed) commitEdit(null); openMenu(buildMenu(), x, y); }
  let dialogCb = null;
  function askNumber(title, val, cb) {
    dialogCb = cb; dialogEl.querySelector(".cx-dialog-title").textContent = title; const inp = dialogEl.querySelector(".cx-dialog-input"); inp.value = Math.round(val);
    dialogEl.classList.add("open"); setTimeout(() => { inp.focus(); inp.select(); }, 0);
  }
  function closeDialog(ok) { const v = parseFloat(dialogEl.querySelector(".cx-dialog-input").value); dialogEl.classList.remove("open"); const cb = dialogCb; dialogCb = null; root.focus({ preventScroll: true }); if (ok && cb) cb(v); }
  dialogEl.querySelector(".cx-dialog-ok").addEventListener("click", () => closeDialog(true));
  dialogEl.querySelector(".cx-dialog-cancel").addEventListener("click", () => closeDialog(false));
  dialogEl.querySelector(".cx-dialog-input").addEventListener("keydown", (e) => { if (e.key === "Enter") closeDialog(true); else if (e.key === "Escape") closeDialog(false); });
  function exportValues() {
    const u = usedRange(); if (u.maxR < 0) { notify("Sheet is empty"); return; }
    const rows = []; for (let r = 0; r <= u.maxR; r++) { const row = []; for (let c = 0; c <= u.maxC; c++) row.push(sheet.valueText(r, c)); rows.push(row); }
    const blob = new Blob([serialize(rows, ",")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = ((hooks.getName && hooks.getName()) || "sheet") + "-values.csv";
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ═════════════════════════════ function picker ═════════════════════════════ */
  function buildPicker(q) {
    q = (q || "").trim().toLowerCase(); let html = "";
    for (const cat of CATEGORIES) {
      const items = FUNCTION_LIST.filter((f) => f.cat === cat && (!q || f.name.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q) || cat.toLowerCase().includes(q)));
      if (items.length) html += `<div class="cx-pcat">${esc(cat)}</div>` + items.map((f) => `<div class="cx-pfn" data-n="${f.name}"><b>${esc(f.sig)}</b><span>${esc(f.desc)}</span></div>`).join("");
    }
    pickerList.innerHTML = html || `<div class="cx-pempty">No matching functions</div>`;
  }
  function openPicker() { pickerOpen = true; picker.classList.add("open"); picker.setAttribute("aria-hidden", "false"); pickerSearch.value = ""; buildPicker(""); setTimeout(() => pickerSearch.focus(), 0); }
  function closePicker() { pickerOpen = false; picker.classList.remove("open"); picker.setAttribute("aria-hidden", "true"); if (ed) focusedInput().focus(); else root.focus({ preventScroll: true }); }
  function insertFunction(name) {
    if (pickerOpen) { pickerOpen = false; picker.classList.remove("open"); picker.setAttribute("aria-hidden", "true"); }
    if (!ed) { startEdit("=" + name + "(", "edit"); return; }
    const inp = focusedInput(); let v = inp.value, pos = inp.selectionStart == null ? v.length : inp.selectionStart;
    if (v[0] !== "=") { v = "=" + v; pos++; }
    inp.value = v.slice(0, pos) + name + "(" + v.slice(pos); const np = pos + name.length + 1; inp.focus(); inp.setSelectionRange(np, np); onEditInput(inp);
  }
  pickerSearch.addEventListener("input", () => buildPicker(pickerSearch.value));
  pickerList.addEventListener("click", (e) => { const r = e.target.closest(".cx-pfn"); if (r) insertFunction(r.dataset.n); });
  $(".cx-picker-close").addEventListener("click", closePicker);
  picker.addEventListener("pointerdown", (e) => { if (e.target === picker) closePicker(); });

  /* ═════════════════════════════ pointer handling ═════════════════════════════ */
  let inertia = null, tickT = null, lastBorderTap = { t: 0, axis: "", i: -1 }, lastHandleTap = 0, hoverCursor = "";
  const AUTO = new Set(["select", "colsel", "rowsel", "selresize", "fill", "move", "ref"]);
  function setTouch(t) { if (touchUI !== t) { touchUI = t; root.classList.toggle("cx-touch", t); requestRender(); } }
  function stopInertia() { if (inertia) { cancelAnimationFrame(inertia); inertia = null; } }
  function capture(e) { try { stage.setPointerCapture(e.pointerId); } catch (x) {} }
  function startDrag(d, e) { drag = d; d.id = e.pointerId; capture(e); if (AUTO.has(d.type)) { clearInterval(tickT); tickT = setInterval(tick, 30); } }
  function endTick() { clearInterval(tickT); tickT = null; }
  function autoScrollStep() {
    const b = stage.getBoundingClientRect(), m = 36; let dx = 0, dy = 0;
    if (lastPtr.x > b.right - m) dx = Math.min(32, (lastPtr.x - (b.right - m)) / 2 + 4); else if (lastPtr.x < b.left + RHW + m) dx = -Math.min(32, ((b.left + RHW + m) - lastPtr.x) / 2 + 4);
    if (lastPtr.y > b.bottom - m) dy = Math.min(32, (lastPtr.y - (b.bottom - m)) / 2 + 4); else if (lastPtr.y < b.top + HEADH + m) dy = -Math.min(32, ((b.top + HEADH + m) - lastPtr.y) / 2 + 4);
    if (drag && (drag.type === "colsel")) dy = 0; if (drag && drag.type === "rowsel") dx = 0;
    if (!dx && !dy) return false;
    const l = scroller.scrollLeft, t = scroller.scrollTop; scroller.scrollLeft += dx; scroller.scrollTop += dy;
    return l !== scroller.scrollLeft || t !== scroller.scrollTop;
  }
  function tick() { if (!drag || !AUTO.has(drag.type)) { endTick(); return; } if (autoScrollStep()) dragUpdate(lastPtr.x, lastPtr.y); }
  function dragUpdate(cx, cy) {
    const d = drag; if (!d) return;
    if (d.type === "resize") {
      const nv = d.axis === "c" ? clamp(Math.round(d.orig + cx - d.start), MINW, MAXW) : clamp(Math.round(d.orig + cy - d.start), MINH, 546);
      for (const i of d.idxs) { if (d.axis === "c") sheet.colW[i] = nv; else sheet.rowH[i] = nv; }
      d.moved = true; rebuildGeom(); updateSizes(); requestRender(); return;
    }
    const hh = hitClamped(cx, cy);
    switch (d.type) {
      case "select": case "selresize": ext = { r: hh.r, c: hh.c }; selChanged(false); break;
      case "colsel": ext = { r: ROWS - 1, c: hh.c }; selChanged(false); break;
      case "rowsel": ext = { r: hh.r, c: COLS - 1 }; selChanged(false); break;
      case "fill": fillPrev = fillTargetFor(d.src, hh.r, hh.c); requestRender(); break;
      case "move": {
        const s = d.src; d.dr = clamp(hh.r - d.grab.r, -s.r1, ROWS - 1 - s.r2); d.dc = clamp(hh.c - d.grab.c, -s.c1, COLS - 1 - s.c2);
        movePrev = d.dr || d.dc ? { r1: s.r1 + d.dr, r2: s.r2 + d.dr, c1: s.c1 + d.dc, c2: s.c2 + d.dc } : null; requestRender(); break;
      }
      case "ref": if (ed) setRefText(d.r, d.c, hh.r, hh.c); break;
    }
  }
  function startPending(e, h, pointing) {
    const d = { type: "tap", id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), h, pointing, sl: scroller.scrollLeft, st: scroller.scrollTop, moved: false, samples: [{ t: performance.now(), x: e.clientX, y: e.clientY }] };
    d.lp = setTimeout(() => longPress(d), 450); drag = d; capture(e);
  }
  function longPress(d) {
    if (drag !== d || d.moved) return;
    try { navigator.vibrate && navigator.vibrate(12); } catch (x) {}
    const h = d.h; drag = null;
    if (h.zone === "cell") {
      if (ed) commitEdit(null);
      const s = rect();
      if (h.r >= s.r1 && h.r <= s.r2 && h.c >= s.c1 && h.c <= s.c2) {                      // long-press on the selection → pick it up and drag
        drag = { type: "move", id: d.id, src: s, grab: { r: h.r, c: h.c }, copy: false, dr: 0, dc: 0 }; tickT = setInterval(tick, 30); notify("Drag to move · release to drop"); return;
      }
      cur = { r: h.r, c: h.c }; ext = { ...cur }; selChanged(false); showMenuAt(d.x, d.y);
    } else if (h.zone === "colhead" || h.zone === "rowhead") {
      const s = rect(), isC = h.zone === "colhead", i = isC ? h.c : h.r;
      if (!(isC ? isWholeCols(s) && i >= s.c1 && i <= s.c2 : isWholeRows(s) && i >= s.r1 && i <= s.r2)) { if (isC) selectCols(i, i); else selectRows(i, i); }
      showMenuAt(d.x, d.y);
    }
  }
  function startMove(e, h, copy) { startDrag({ type: "move", src: rect(), grab: { r: h.r, c: h.c }, copy, dr: 0, dc: 0 }, e); }
  function startResize(e, h) {
    const axis = h.zone === "colhead" ? "c" : "r", i = h.edge, now = Date.now();
    if (lastBorderTap.axis === axis && lastBorderTap.i === i && now - lastBorderTap.t < 450) { lastBorderTap = { t: 0, axis: "", i: -1 }; autofit(axis, fitTargets(axis, i)); return; }
    lastBorderTap = { t: now, axis, i };
    startDrag({ type: "resize", axis, idxs: fitTargets(axis, i), start: axis === "c" ? e.clientX : e.clientY, orig: axis === "c" ? sheet.colW[i] : sheet.rowH[i], before: sheet.snapshot(), moved: false }, e);
  }
  stage.addEventListener("mousedown", (e) => { if (ed) e.preventDefault(); });
  stage.addEventListener("contextmenu", (e) => {
    e.preventDefault(); if (touchUI) return;
    const h = hit(e.clientX, e.clientY), s = rect();
    if (h.zone === "cell") { if (!(h.r >= s.r1 && h.r <= s.r2 && h.c >= s.c1 && h.c <= s.c2)) { cur = { r: h.r, c: h.c }; ext = { ...cur }; selChanged(false); } }
    else if (h.zone === "colhead") { if (!(isWholeCols(s) && h.c >= s.c1 && h.c <= s.c2)) selectCols(h.c, h.c); }
    else if (h.zone === "rowhead") { if (!(isWholeRows(s) && h.r >= s.r1 && h.r <= s.r2)) selectRows(h.r, h.r); }
    else return;
    showMenuAt(e.clientX, e.clientY);
  });
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stopInertia(); const touch = e.pointerType !== "mouse"; setTouch(touch); lastPtr = { x: e.clientX, y: e.clientY };
    closeMenu();
    const t = e.target;
    if (t.closest && t.closest(".cx-fh")) {
      e.preventDefault(); const now = Date.now();
      if (now - lastHandleTap < 400) { lastHandleTap = 0; autoFillDown(); return; }
      lastHandleTap = now; startDrag({ type: "fill", src: rect() }, e); return;
    }
    if (t.closest && t.closest(".cx-sh")) {
      e.preventDefault(); const s = rect();
      if (t.closest(".cx-sh2")) { cur = { r: s.r1, c: s.c1 }; ext = { r: s.r2, c: s.c2 }; } else { cur = { r: s.r2, c: s.c2 }; ext = { r: s.r1, c: s.c1 }; }
      startDrag({ type: "selresize" }, e); return;
    }
    if (t === editor) return;
    const h = hit(e.clientX, e.clientY), now = Date.now();
    if (ed && h.zone === "cell" && refInsertOK()) {
      e.preventDefault();
      if (!touch) { setRefText(h.r, h.c, h.r, h.c); startDrag({ type: "ref", r: h.r, c: h.c }, e); } else startPending(e, h, true);
      return;
    }
    if (ed && touch) { startPending(e, h, false); return; }
    if (ed) commitEdit(null);
    root.focus({ preventScroll: true });
    if ((h.zone === "colhead" || h.zone === "rowhead") && h.edge >= 0) { e.preventDefault(); startResize(e, h); return; }
    if (h.zone === "corner") { e.preventDefault(); selectAll(); return; }
    if (h.zone === "colhead" || h.zone === "rowhead") {
      if (touch) { startPending(e, h, false); return; }
      e.preventDefault();
      const isC = h.zone === "colhead", i = isC ? h.c : h.r, key = (isC ? "c" : "r") + i;
      if (lastTap.z === key && now - lastTap.t < 400) { lastTap = { t: 0, r: -1, c: -1, z: "" }; autofit(isC ? "c" : "r", fitTargets(isC ? "c" : "r", i)); return; }
      lastTap = { t: now, r: -1, c: -1, z: key };
      if (e.shiftKey) { if (isC) ext = { r: ROWS - 1, c: i }; else ext = { r: i, c: COLS - 1 }; selChanged(false); }
      else if (isC) selectCols(i, i); else selectRows(i, i);
      startDrag({ type: isC ? "colsel" : "rowsel" }, e); return;
    }
    if (h.zone === "cell") {
      if (!touch) {
        e.preventDefault();
        if (!e.shiftKey && onSelBorder(h.x, h.y, 4)) { startMove(e, h, e.ctrlKey || e.metaKey || e.altKey); return; }
        const dbl = !e.shiftKey && lastTap.z === "cell" && lastTap.r === h.r && lastTap.c === h.c && now - lastTap.t < 400;
        if (e.shiftKey) ext = { r: h.r, c: h.c }; else { cur = { r: h.r, c: h.c }; ext = { ...cur }; }
        lastTap = { t: now, r: h.r, c: h.c, z: "cell" }; selChanged(false);
        if (dbl) { startEdit(null, "edit"); return; }
        startDrag({ type: "select" }, e); return;
      }
      if (onSelBorder(h.x, h.y, 7)) { e.preventDefault(); startMove(e, h, false); return; }
      startPending(e, h, false);
    }
  });
  function hover(e) {
    if (e.target.closest && (e.target.closest(".cx-fh") || e.target.closest(".cx-sh"))) return;
    const h = hit(e.clientX, e.clientY); let c = "";
    if (h.zone === "colhead" && h.edge >= 0) c = "col-resize"; else if (h.zone === "rowhead" && h.edge >= 0) c = "row-resize";
    else if (h.zone === "cell" && onSelBorder(h.x, h.y, 4)) c = "move"; else if (h.zone === "colhead" || h.zone === "rowhead") c = "pointer";
    if (c !== hoverCursor) { hoverCursor = c; stage.style.cursor = c; }
  }
  stage.addEventListener("pointermove", (e) => {
    lastPtr = { x: e.clientX, y: e.clientY };
    if (!drag) { if (e.pointerType === "mouse") hover(e); return; }
    if (e.pointerId !== drag.id) return;
    const d = drag;
    if (d.type === "tap") {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 7) { d.moved = true; clearTimeout(d.lp); }
      if (d.moved) {
        scroller.scrollLeft = d.sl - dx; scroller.scrollTop = d.st - dy;
        d.samples.push({ t: performance.now(), x: e.clientX, y: e.clientY }); while (d.samples.length > 6) d.samples.shift(); requestRender();
      }
      return;
    }
    dragUpdate(e.clientX, e.clientY);
  });
  function startInertia(d) {
    const a = d.samples[0], b = d.samples[d.samples.length - 1], dt = b.t - a.t;
    if (dt <= 0 || performance.now() - b.t > 90) return;
    let vx = -(b.x - a.x) / dt, vy = -(b.y - a.y) / dt;
    if (Math.hypot(vx, vy) < 0.25) return;
    let prev = performance.now();
    const step = (now) => {
      const el = now - prev; prev = now;
      scroller.scrollLeft += vx * el; scroller.scrollTop += vy * el;
      const f = Math.pow(0.94, el / 16); vx *= f; vy *= f;
      inertia = Math.hypot(vx, vy) > 0.03 ? requestAnimationFrame(step) : null;
    };
    inertia = requestAnimationFrame(step);
  }
  function handleTap(d) {
    const h = d.h, now = Date.now();
    if (ed) {
      if (h.zone === "cell" && d.pointing && refInsertOK()) { setRefText(h.r, h.c, h.r, h.c); return; }
      commitEdit(null);
    }
    root.focus({ preventScroll: true });
    if (h.zone === "corner") { selectAll(); return; }
    if (h.zone === "cell") {
      const s = rect(), isSingleSel = s.r1 === s.r2 && s.c1 === s.c2 && cur.r === h.r && cur.c === h.c;
      const dbl = lastTap.z === "cell" && lastTap.r === h.r && lastTap.c === h.c && now - lastTap.t < 400;
      if (dbl) { cur = { r: h.r, c: h.c }; ext = { ...cur }; lastTap = { t: 0, r: -1, c: -1, z: "" }; selChanged(false); startEdit(null, "edit"); return; }
      if (isSingleSel) { lastTap = { t: now, r: h.r, c: h.c, z: "cell" }; showMenuAt(d.x, d.y); return; }
      cur = { r: h.r, c: h.c }; ext = { ...cur }; lastTap = { t: now, r: h.r, c: h.c, z: "cell" }; selChanged(false); return;
    }
    const isC = h.zone === "colhead", i = isC ? h.c : h.r, s = rect(), key = (isC ? "c" : "r") + i;
    const selNow = isC ? isWholeCols(s) && i >= s.c1 && i <= s.c2 : isWholeRows(s) && i >= s.r1 && i <= s.r2;
    if (lastTap.z === key && now - lastTap.t < 400) { lastTap = { t: 0, r: -1, c: -1, z: "" }; autofit(isC ? "c" : "r", fitTargets(isC ? "c" : "r", i)); return; }
    lastTap = { t: now, r: -1, c: -1, z: key };
    if (selNow) { showMenuAt(d.x, d.y); return; }
    if (isC) selectCols(i, i); else selectRows(i, i);
  }
  function endPointer(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; endTick();
    try { stage.releasePointerCapture(e.pointerId); } catch (x) {}
    switch (d.type) {
      case "tap": clearTimeout(d.lp); if (cancelled) return; if (d.moved) startInertia(d); else handleTap(d); return;
      case "fill": { const t = fillPrev; fillPrev = null; if (t && !cancelled) { const n = applyFill(d.src, t); notify(`Filled ${plural(n, "cell")}`); } else requestRender(); return; }
      case "move": { const mp = movePrev; movePrev = null; if (mp && !cancelled && (d.dr || d.dc)) moveBlock(d.src, d.dr, d.dc, d.copy); else requestRender(); return; }
      case "resize":
        if (d.moved && !cancelled) { pushUndo({ t: "s", before: d.before, after: sheet.snapshot(), cur: { ...cur }, ext: { ...ext } }); changed(true); }
        else if (d.moved) { sheet.restore(d.before); rebuildGeom(); updateSizes(); requestRender(); }
        return;
      default: requestRender();
    }
  }
  stage.addEventListener("pointerup", (e) => endPointer(e, false));
  stage.addEventListener("pointercancel", (e) => endPointer(e, true));
  scroller.addEventListener("scroll", requestRender, { passive: true });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { updateSizes(); requestRender(); }).observe(scroller);
  window.addEventListener("resize", () => { if (active) { updateSizes(); requestRender(); } });

  /* ═════════════════════════════ keyboard ═════════════════════════════ */
  root.addEventListener("keydown", (e) => {
    if (ed || inMyInput(e.target) || pickerOpen) return;
    if (menuOpen && e.key === "Escape") { closeMenu(); return; }
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const lk = k.toLowerCase();
      if (lk === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (lk === "y") { e.preventDefault(); redo(); return; }
      if (lk === "a") { e.preventDefault(); selectAll(); return; }
      if (lk === "d") { e.preventDefault(); fillDownSelection(); return; }
      if (lk === "r") { e.preventDefault(); fillRightSelection(); return; }
      if (lk === "b") { e.preventDefault(); toggleFmt("b"); return; }
      if (lk === "i") { e.preventDefault(); toggleFmt("i"); return; }
      if (lk === "f") { e.preventDefault(); openFind(false); return; }
      if (lk === "h") { e.preventDefault(); openFind(true); return; }
      if (lk === "v" && e.shiftKey) { pasteMode = "values"; return; }
      if (k === " ") { e.preventDefault(); selectCols(cur.c, ext.c); return; }
      if (k === "ArrowUp") { e.preventDefault(); jump(-1, 0, e.shiftKey); return; }
      if (k === "ArrowDown") { e.preventDefault(); jump(1, 0, e.shiftKey); return; }
      if (k === "ArrowLeft") { e.preventDefault(); jump(0, -1, e.shiftKey); return; }
      if (k === "ArrowRight") { e.preventDefault(); jump(0, 1, e.shiftKey); return; }
      if (k === "Home") { e.preventDefault(); cur = { r: 0, c: 0 }; ext = { ...cur }; selChanged(); return; }
      return;
    }
    if (k === " " && e.shiftKey) { e.preventDefault(); selectRows(cur.r, ext.r); return; }
    switch (k) {
      case "ArrowUp": e.preventDefault(); moveCur(-1, 0, e.shiftKey); return;
      case "ArrowDown": e.preventDefault(); moveCur(1, 0, e.shiftKey); return;
      case "ArrowLeft": e.preventDefault(); moveCur(0, -1, e.shiftKey); return;
      case "ArrowRight": e.preventDefault(); moveCur(0, 1, e.shiftKey); return;
      case "PageDown": e.preventDefault(); moveCur(Math.max(1, Math.floor(scroller.clientHeight / DEF_ROWH) - 2), 0, e.shiftKey); return;
      case "PageUp": e.preventDefault(); moveCur(-Math.max(1, Math.floor(scroller.clientHeight / DEF_ROWH) - 2), 0, e.shiftKey); return;
      case "Home": e.preventDefault(); cur = { r: cur.r, c: 0 }; ext = { ...cur }; selChanged(); return;
      case "End": e.preventDefault(); { const u = usedRange(); cur = { r: cur.r, c: Math.max(0, u.maxC) }; ext = { ...cur }; selChanged(); } return;
      case "Enter": e.preventDefault(); moveCur(e.shiftKey ? -1 : 1, 0, false); return;
      case "Tab": e.preventDefault(); moveCur(0, e.shiftKey ? -1 : 1, false); return;
      case "F2": e.preventDefault(); startEdit(null, "edit"); return;
      case "ContextMenu": e.preventDefault(); { const q = screenRect(rect()), b = stage.getBoundingClientRect(); showMenuAt(b.left + q.x + 20, b.top + q.y + q.h); } return;
      case "Delete": case "Backspace": e.preventDefault(); clearSelection(true); return;
      case "Escape": clip = null; closeMenu(); return;
    }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(k, "enter"); }
  });

  /* ═════════════════════════════ toolbar ═════════════════════════════ */
  nameBox.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return; e.preventDefault();
    const v = nameBox.value.trim().toUpperCase(); let m;
    if ((m = /^([A-Z]{1,2}):([A-Z]{1,2})$/.exec(v)) && colIndex(m[1]) < COLS && colIndex(m[2]) < COLS) selectCols(colIndex(m[1]), colIndex(m[2]));
    else if ((m = /^(\d{1,4}):(\d{1,4})$/.exec(v)) && +m[1] >= 1 && +m[1] <= ROWS && +m[2] >= 1 && +m[2] <= ROWS) selectRows(+m[1] - 1, +m[2] - 1);
    else {
      const p = v.split(":"), a = parseAddr(p[0]), b = p[1] ? parseAddr(p[1]) : a;
      if (!a || !b) { notify(`Invalid cell. Valid range: A1 – ${addr(ROWS - 1, COLS - 1)}`); syncBar(); return; }
      cur = { ...a }; ext = { ...b }; selChanged();
    }
    root.focus({ preventScroll: true });
  });
  nameBox.addEventListener("focus", () => nameBox.select());
  host.querySelector(".cx-row-actions").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-a]"); if (!b) return; const a = b.dataset.a;
    const br = b.getBoundingClientRect(); lastPtr = { x: br.left, y: br.bottom };
    if (ed) commitEdit(null);
    switch (a) {
      case "undo": undo(); break; case "redo": redo(); break;
      case "cut": copyToSystem(true); break; case "copy": copyToSystem(false); break; case "paste": pasteFromClipboard("all"); break;
      case "bold": toggleFmt("b"); break; case "italic": toggleFmt("i"); break; case "wrap": toggleFmt("wr"); break;
      case "al-l": setAlign("l"); break; case "al-c": setAlign("c"); break; case "al-r": setAlign("r"); break;
      case "tc": case "bg": openPalette(a); break;
      case "filldown": fillDownSelection(); break; case "find": openFind(false); break;
      case "menu": showMenuAt(br.right - 240, br.bottom + 4); break;
    }
  });
  host.querySelectorAll(".cx-row-actions .cx-btn").forEach((b) => b.addEventListener("pointerdown", (e) => e.preventDefault()));
  $(".cx-fxbtn").addEventListener("pointerdown", (e) => e.preventDefault());
  $(".cx-fxbtn").addEventListener("click", () => openPicker());

  /* ═════════════════════════════ public API ═════════════════════════════ */
  function load(text, meta) {
    clearTimeout(persistT); persistT = null;
    sheet.gen++; sheet.load(parseStored(text)); applyMeta(meta); importCache(meta && meta.cache);
    cur = { r: 0, c: 0 }; ext = { r: 0, c: 0 };
    undoStack = []; redoStack = []; ed = null; clip = null; refRect = null; fillPrev = null; movePrev = null; drag = null; hideSuggest(); closeMenu();
    editor.style.display = "none"; scroller.scrollLeft = 0; scroller.scrollTop = 0;
    updateSizes(); syncBar(); requestRender();
    sheet.recalc().then(requestRender);
  }
  function show() { active = true; host.style.display = ""; updateSizes(); syncBar(); requestRender(); setTimeout(() => { try { root.focus({ preventScroll: true }); } catch (e) {} }, 0); }
  function hide() { if (ed) commitEdit(null); closeMenu(); active = false; }

  return { load, show, hide, flush, undo, redo, getCsv: () => serializeGrid(sheet.raw), isActive: () => active, openPicker, insertFunction, refresh: () => { updateSizes(); requestRender(); }, sheet };
}
