(function () {
  if (window.__dexEditorUiLoaded) return;
  window.__dexEditorUiLoaded = true;

  // ─── Constants ────────────────────────────────────────────────────────────
  const MENU_DELAY_MS    = 300;
  const LONG_PRESS_MS    = 450;
  const DBL_TAP_MS       = 350;
  const MOVE_CANCEL_PX   = 10;
  const ATTACH_MAX_TRIES = 200;
  const FIND_MENU_ID     = 'find-replace-menu';
  const FIND_MENU_HIDDEN = 'find-replace-hidden';

  // ─── Utilities ────────────────────────────────────────────────────────────
  const notify = (m) => { if (typeof showNotification === 'function') showNotification(m); };
  const getCm  = () => { const ed = window.dexEditor; return ed && ed.cm ? ed.cm : null; };
  const isTouchLike = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';

  const findMenuOpen = () => {
    const fm = document.getElementById(FIND_MENU_ID);
    return !!(fm && !fm.classList.contains(FIND_MENU_HIDDEN));
  };

  function currentMode() {
    const m = location.pathname.match(/^\/note\/[^/]+(?:\/([a-z]+))?\/?$/);
    const mode = m && m[1];
    if (mode === 'diffusion') return 'diffusion';
    if (mode === 'mermaid')   return 'mermaid';
    return 'base';
  }

  async function clipboardWrite(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (_e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity  = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (_e2) { return false; }
    }
  }

  async function clipboardRead() {
    try { return await navigator.clipboard.readText(); }
    catch (e) {
      if (e && e.name === 'NotAllowedError') return undefined;
      return null;
    }
  }

  // ─── Menu DOM & state ─────────────────────────────────────────────────────
  let menuEl = null;
  let activeActions = null;
  let activeMenuSource = null;
  let menuSelection = null;
  const surfaceTimers = Object.create(null);

  function clearPendingFor(surface) {
    if (surfaceTimers[surface]) {
      clearTimeout(surfaceTimers[surface]);
      surfaceTimers[surface] = null;
    }
  }
  function clearAllPending() {
    Object.keys(surfaceTimers).forEach(clearPendingFor);
  }

  function ensureMenu() {
    if (menuEl) return menuEl;
    menuEl = document.createElement('div');
    menuEl.id = 'dexNativeMenu';
    document.body.appendChild(menuEl);
    document.addEventListener('pointerdown', (e) => {
      // *** THE FIX ***  When we open a menu synchronously from within a
      // pointerdown handler (double-tap), the same event then bubbles up to
      // document and this listener would immediately close it. The wrapper
      // handler marks the event; we honour that mark here.
      if (e && e.__dexJustOpenedMenu) return;
      if (menuEl.classList.contains('open') && !menuEl.contains(e.target)) closeMenu();
    });
    return menuEl;
  }

  const isMenuOpen = () => !!(menuEl && menuEl.classList.contains('open'));

  function closeMenu(surface) {
    if (surface) {
      const ownsPending = !!surfaceTimers[surface];
      const ownsVisible = activeMenuSource === surface;
      if (!ownsPending && !ownsVisible) return;
      clearPendingFor(surface);
    } else {
      clearAllPending();
    }
    if (menuEl) menuEl.classList.remove('open');
    activeActions = null;
    activeMenuSource = null;
    menuSelection = null;
  }
  window.dexCloseNativeMenu = () => closeMenu();

  function escapeAttr(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function snapshotSelection() {
    const cm = getCm();
    if (!cm) return null;
    if (cm.somethingSelected()) {
      return { from: cm.getCursor('from'), to: cm.getCursor('to') };
    }
    const p = cm.getCursor();
    return { from: p, to: p };
  }

  function sameSel(a, b) {
    if (!a || !b) return false;
    return a.from.line === b.from.line && a.from.ch === b.from.ch &&
           a.to.line   === b.to.line   && a.to.ch   === b.to.ch;
  }

  function renderMenu(actions, rect, source) {
    ensureMenu();
    activeActions = actions;
    activeMenuSource = source || null;
    menuSelection = snapshotSelection();

    let html = '';
    actions.forEach((a, i) => {
      if (a.sep) { html += '<div class="dex-nm-sep"></div>'; return; }
      html +=
        '<button type="button" class="dex-nm-item' + (a.danger ? ' dex-nm-danger' : '') +
        '" data-nm-idx="' + i + '"' +
        ' title="' + escapeAttr(a.label) + '"' +
        ' aria-label="' + escapeAttr(a.label) + '">' +
        '<delluna-icon name="' + escapeAttr(a.icon || '') + '"></delluna-icon>' +
        '</button>';
    });
    menuEl.innerHTML = html;

    menuEl.querySelectorAll('[data-nm-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.nmIdx, 10);
        const action = activeActions && activeActions[idx];
        closeMenu();
        if (action && typeof action.run === 'function') action.run();
      });
    });

    menuEl.style.visibility = 'hidden';
    menuEl.classList.add('open');
    const mw = menuEl.offsetWidth;
    const mh = menuEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect ? rect.left - mw / 2 : (vw - mw) / 2;
    let top  = rect ? rect.top - mh - 10 : (vh - mh) / 2;
    if (rect && top < 8) top = rect.bottom + 10;
    left = Math.max(8, Math.min(vw - mw - 8, left));
    top  = Math.max(8, Math.min(vh - mh - 8, top));

    menuEl.style.left = left + 'px';
    menuEl.style.top  = top  + 'px';
    menuEl.style.visibility = '';
  }

  function scheduleMenu(surface, getActionsAndRect) {
    if (!(surface in surfaceTimers)) surfaceTimers[surface] = null;
    clearPendingFor(surface);
    surfaceTimers[surface] = setTimeout(() => {
      surfaceTimers[surface] = null;
      let result;
      try { result = getActionsAndRect(); } catch (_e) { result = null; }
      if (!result || !result.actions || !result.actions.length) return;
      renderMenu(result.actions, result.rect, surface);
    }, MENU_DELAY_MS);
  }

  window.__dexMenuApi = {
    schedule: scheduleMenu,
    close: closeMenu,
    open: renderMenu,
    isOpen: isMenuOpen,
    notify,
    clipboardWrite,
    clipboardRead
  };

  // ─── Action builders ──────────────────────────────────────────────────────
  function selectAll(cm) {
    const lastLine = cm.lineCount() - 1;
    cm.setSelection({ line: 0, ch: 0 }, { line: lastLine, ch: cm.getLine(lastLine).length });
  }

  function codeMirrorActions(cm, range) {
    const actions = [
      {
        label: 'Copy', icon: 'copy',
        run: async () => { notify((await clipboardWrite(range.text)) ? 'Copied' : 'Copy failed'); }
      },
      {
        label: 'Cut', icon: 'content_cut',
        run: async () => {
          if (!(await clipboardWrite(range.text))) { notify('Cut failed'); return; }
          cm.operation(() => { cm.replaceRange('', range.from, range.to); });
          notify('Cut');
        }
      },
      {
        label: 'Paste', icon: 'paste',
        run: async () => {
          const text = await clipboardRead();
          if (text === undefined) { notify('Clipboard access denied'); return; }
          if (text === null)      { notify('Clipboard unavailable');  return; }
          cm.operation(() => { cm.replaceRange(text, range.from, range.to); });
          notify('Pasted');
        }
      },
      { label: 'Select All', icon: 'selectAll', run: () => selectAll(cm) },
      {
        label: 'Delete', icon: 'delete', danger: true,
        run: () => {
          cm.operation(() => { cm.replaceRange('', range.from, range.to); });
          notify('Deleted');
        }
      }
    ];

    if (currentMode() === 'diffusion') {
      actions.push({ sep: true });
      actions.push({
        label: 'Swap Raw ↔ Morph', icon: 'swap',
        run: () => { if (typeof diffSwapTexts === 'function') diffSwapTexts(); }
      });
      actions.push({
        label: 'Save selection to pane', icon: 'save',
        run: () => {
          if (typeof diffCommitPane === 'function') {
            diffCommitPane(window.dexMode ? window.dexMode.activePane : 'raw');
            notify('Saved');
          }
        }
      });
    }
    return actions;
  }

  function cursorActions(cm) {
    return [
      {
        label: 'Paste', icon: 'paste',
        run: async () => {
          const text = await clipboardRead();
          if (text === undefined) { notify('Clipboard access denied'); return; }
          if (text === null)      { notify('Clipboard unavailable');  return; }
          const pos = cm.getCursor();
          cm.operation(() => { cm.replaceRange(text, pos); });
          notify('Pasted');
        }
      },
      { label: 'Select All', icon: 'selectAll', run: () => selectAll(cm) }
    ];
  }

  function rectForRange(cm, range) {
    const a = cm.charCoords(range.from, 'window');
    const b = cm.charCoords(range.to,   'window');
    return {
      left:   (a.left + b.right) / 2,
      top:    Math.min(a.top,    b.top),
      bottom: Math.max(a.bottom, b.bottom)
    };
  }

  // ─── Public open API ──────────────────────────────────────────────────────
  window.dexOpenMenuForSelection = function (source) {
    const cm = getCm();
    if (!cm) { notify('Editor not ready'); return; }

    clearPendingFor('codemirror');
    clearPendingFor('generic');

    try {
      if (!cm.somethingSelected()) {
        const pos = cm.getCursor();
        const c   = cm.charCoords(pos, 'window');
        renderMenu(cursorActions(cm), { left: c.right, top: c.top, bottom: c.bottom }, source);
        return;
      }
      const range = {
        from: cm.getCursor('from'),
        to:   cm.getCursor('to'),
        text: cm.getSelection()
      };
      renderMenu(codeMirrorActions(cm, range), designMenuRect() || rectForRange(cm, range), source);
    } catch (_e) {
      closeMenu();
    }
  };

  window.dexMenuOpen      = isMenuOpen;
  window.dexOpenToolbar   = (s) => window.dexOpenMenuForSelection(s || 'toolbar');
  window.dexCloseToolbar  = () => closeMenu();
  window.dexToggleToolbar = () => isMenuOpen() ? closeMenu() : window.dexOpenMenuForSelection('toolbar');

  // ─── Selection handles ────────────────────────────────────────────────────
  let handleStart = null;
  let handleEnd   = null;
  let _handleRafId = null;

  function ensureHandles() {
    if (handleStart) return;
    handleStart = document.createElement('div');
    handleStart.className = 'dex-sel-handle dex-sel-handle-start';
    handleStart.innerHTML = '<i class="dex-sh-l"></i><i class="dex-sh-d"></i>';
    handleEnd = document.createElement('div');
    handleEnd.className = 'dex-sel-handle dex-sel-handle-end';
    handleEnd.innerHTML = '<i class="dex-sh-l"></i><i class="dex-sh-d"></i>';
    document.body.appendChild(handleStart);
    document.body.appendChild(handleEnd);

    [[handleStart, 'from'], [handleEnd, 'to']].forEach(([el, which]) => {
      el.addEventListener('pointerdown', (e) => {
        if (!isTouchLike(e)) return;
        e.preventDefault(); e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch (_e) {}
        beginHandleDrag(which, e.pointerId, e, el);
      }, { passive: false });
    });

    document.addEventListener('pointermove',   onHandleDragMove, { passive: false });
    document.addEventListener('pointerup',     endHandleDrag,    { passive: false });
    document.addEventListener('pointercancel', endHandleDrag,    { passive: false });
  }

  function hideHandles() {
    if (_handleRafId !== null) { cancelAnimationFrame(_handleRafId); _handleRafId = null; }
    if (handleStart) handleStart.style.display = 'none';
    if (handleEnd)   handleEnd.style.display   = 'none';
  }

  // Handles are fixed on <body> (z-index 9990) so they would float above the
  // slide-in sidebars. Hide them whenever one of those panels is showing.
  function overlayPanelOpen() {
    const s2 = document.getElementById('secondary-sidebar');
    if (s2 && s2.classList.contains('open')) return true;
    const s1 = document.getElementById('sidebar1');
    if (s1 && s1.classList.contains('open') && !document.body.classList.contains('mode-filemanager')) return true;
    return false;
  }

  // ─── Design-mode surface (md Design: <textarea> / contenteditable blocks) ───
  // In Design mode the CodeMirror instance is hidden, so its coordinates are meaningless. The open
  // block's own selection drives the handles and the menu instead.
  const PAD = 18;                       // extra hit area above/below the line (px)
  const designOn = () => { const m = window.dexMdexec; return !!(m && m.design && m.design.hasActive && m.design.hasActive()); };

  function designTarget() {
    if (!designOn()) return null;
    const ae = document.activeElement;
    if (ae && ae.tagName === 'TEXTAREA' && ae.classList.contains('mdb-ta') && ae.selectionStart !== ae.selectionEnd) return { kind: 'ta', el: ae };
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const n = sel.anchorNode, host = n && (n.nodeType === 1 ? n : n.parentElement);
      const el = host && host.closest && host.closest('.mdb-rich, .mdb-cell');
      if (el) return { kind: 'rich', el, sel };
    }
    return null;
  }

  function taMirror(ta) {
    const cs = getComputedStyle(ta), r = ta.getBoundingClientRect(), m = document.createElement('div');
    ['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','textTransform','textIndent','lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','boxSizing','tabSize','wordSpacing','wordBreak'].forEach((k) => { m.style[k] = cs[k]; });
    m.style.cssText += ';position:fixed;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden;height:auto;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;';
    m.textContent = ta.value + '\u200b';
    document.body.appendChild(m);
    const node = m.firstChild, len = ta.value.length, st = ta.scrollTop;
    const at = (i) => {
      i = Math.max(0, Math.min(i, len));
      const rg = document.createRange();
      rg.setStart(node, i); rg.setEnd(node, i);
      let rc = rg.getClientRects()[0];
      if (!rc || !rc.height) {
        const j = i < len ? i : i - 1; rg.setStart(node, Math.max(0, j)); rg.setEnd(node, Math.max(0, j) + 1);
        rc = rg.getClientRects()[0] || rg.getBoundingClientRect();
        const x = i < len ? rc.left : rc.right;
        return { left: x, right: x, top: rc.top - st, bottom: rc.bottom - st };
      }
      return { left: rc.left, right: rc.right, top: rc.top - st, bottom: rc.bottom - st };
    };
    return { at, len, destroy() { m.remove(); } };
  }

  function taIndexAt(mir, x, y) {
    let lo = 0, hi = mir.len;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (mir.at(mid).bottom <= y) lo = mid + 1; else hi = mid; }
    const top = mir.at(lo).top;
    let s = lo, e = lo, n = 0;
    while (s > 0 && n++ < 600 && Math.abs(mir.at(s - 1).top - top) < 3) s--;
    n = 0;
    while (e < mir.len && n++ < 600 && Math.abs(mir.at(e + 1).top - top) < 3) e++;
    let a = s, b = e;
    while (a < b) { const mid = (a + b) >> 1; if (mir.at(mid).left < x) a = mid + 1; else b = mid; }
    if (a > s && Math.abs(mir.at(a - 1).left - x) < Math.abs(mir.at(a).left - x)) a--;
    return a;
  }

  function designRects(t) {
    if (t.kind === 'ta') {
      const mir = taMirror(t.el);
      try {
        const a = mir.at(t.el.selectionStart), b = mir.at(t.el.selectionEnd);
        return { a: { left: a.left, top: a.top, bottom: a.bottom }, b: { right: b.left, top: b.top, bottom: b.bottom } };
      } finally { mir.destroy(); }
    }
    const rects = Array.from(t.sel.getRangeAt(0).getClientRects()).filter((r) => r.width > 0 || r.height > 0);
    if (!rects.length) return null;
    const f = rects[0], l = rects[rects.length - 1];
    return { a: { left: f.left, top: f.top, bottom: f.bottom }, b: { right: l.right, top: l.top, bottom: l.bottom } };
  }

  function designMenuRect() {
    const t = designTarget(); if (!t) return null;
    const r = designRects(t); if (!r) return null;
    const sameLine = Math.abs(r.a.top - r.b.top) < 3;
    const er = t.el.getBoundingClientRect();
    return { left: sameLine ? (r.a.left + r.b.right) / 2 : er.left + er.width / 2, top: r.a.top, bottom: r.b.bottom };
  }

  function placeHandle(el, x, top, bottom, isStart) {
    const h = Math.max(14, bottom - top);
    el.style.left = x + 'px';
    el.style.top = (top - PAD) + 'px';
    el.style.height = (h + PAD * 2) + 'px';
    el.style.setProperty('--lh', h + 'px');
    el._cx = x; el._cy = (top + bottom) / 2;
    el.style.display = 'block';
  }

  function positionHandles() {
    const dt = designTarget();
    let A, B;
    if (dt) {
      const r = designRects(dt);
      if (!r) { hideHandles(); return; }
      A = r.a; B = r.b;
    } else if (designOn()) {
      hideHandles(); return;
    } else {
      const cm = getCm();
      if (!cm || !cm.somethingSelected()) { hideHandles(); return; }
      const a = cm.charCoords(cm.getCursor('from'), 'window');
      const b = cm.charCoords(cm.getCursor('to'),   'window');
      A = { left: a.left, top: a.top, bottom: a.bottom };
      B = { right: b.right, top: b.top, bottom: b.bottom };
    }
    if (findMenuOpen() || overlayPanelOpen()) { hideHandles(); return; }
    ensureHandles();
    placeHandle(handleStart, A.left,  A.top, A.bottom, true);
    placeHandle(handleEnd,   B.right, B.top, B.bottom, false);
  }

  function scheduleHandles() {
    if (_handleRafId !== null) return;
    _handleRafId = requestAnimationFrame(() => {
      _handleRafId = null;
      positionHandles();
    });
  }

  document.addEventListener('selectionchange', () => { if (designOn() && !window.__dexSelHandleDragging) scheduleHandles(); });
  window.addEventListener('scroll', () => { if (handleStart && handleStart.style.display === 'block') scheduleHandles(); }, true);
  window.dexHideSelectionHandles     = hideHandles;
  window.dexScheduleSelectionHandles = scheduleHandles;
  window.dexPositionSelectionHandles = positionHandles;
  window.addEventListener('popstate', hideHandles);

  (function watchPanels() {
    if (typeof MutationObserver !== 'function') return;
    let tries = 0;
    (function bind() {
      const targets = ['secondary-sidebar', 'sidebar1']
        .map((id) => document.getElementById(id)).filter(Boolean);
      if (targets.length < 2 && tries++ < 50) { setTimeout(bind, 200); }
      const mo = new MutationObserver(() => scheduleHandles());
      targets.forEach((el) => {
        if (el.__dexHandleWatch) return;
        el.__dexHandleWatch = true;
        mo.observe(el, { attributes: true, attributeFilter: ['class'] });
      });
    })();
  })();

  // ─── Handle drag ──────────────────────────────────────────────────────────
  let dragging = null, dragPointerId = null, dragFixedPoint = null, dragGrabX = 0, dragGrabY = 0;

  let dragDesign = null;

  function beginHandleDrag(which, pointerId, e, el) {
    const cm = getCm();
    const dt = designTarget();
    if (!dt && (designOn() || !cm || !cm.somethingSelected())) return;
    dragging       = which;
    dragPointerId  = pointerId;
    dragDesign     = null;
    if (dt) {
      if (dt.kind === 'ta') {
        dragDesign = { kind: 'ta', el: dt.el, fixed: which === 'from' ? dt.el.selectionEnd : dt.el.selectionStart, mir: taMirror(dt.el) };
      } else {
        const r = dt.sel.getRangeAt(0);
        dragDesign = { kind: 'rich', el: dt.el, fixed: which === 'from' ? { n: r.endContainer, o: r.endOffset } : { n: r.startContainer, o: r.startOffset } };
      }
    } else {
      dragFixedPoint = (which === 'from') ? cm.getCursor('to') : cm.getCursor('from');
    }
    // finger offset from the line's centre, so the selection doesn't jump on first move
    dragGrabX = e.clientX - (el._cx || 0);
    dragGrabY = e.clientY - (el._cy || 0);
    window.__dexSelHandleDragging = true;
    if (isMenuOpen()) closeMenu();
  }

  function onHandleDragMove(e) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    e.preventDefault();
    const x = e.clientX - dragGrabX;
    const y = e.clientY - dragGrabY;
    if (dragDesign) {
      const d = dragDesign;
      if (d.kind === 'ta') {
        const i = taIndexAt(d.mir, x, y);
        d.el.setSelectionRange(Math.min(d.fixed, i), Math.max(d.fixed, i));
        d.el.dispatchEvent(new Event('select'));
      } else {
        let n = null, o = 0;
        if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { n = r.startContainer; o = r.startOffset; } }
        else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { n = p.offsetNode; o = p.offset; } }
        if (n && d.el.contains(n)) { try { window.getSelection().setBaseAndExtent(d.fixed.n, d.fixed.o, n, o); } catch (_e) {} }
      }
      positionHandles();
      return;
    }
    const cm = getCm();
    if (!cm) return;
    const pos = cm.coordsChar({ left: x, top: y }, 'window');
    cm.setSelection(dragFixedPoint, pos);
    positionHandles();
  }

  function endHandleDrag(e) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = null; dragPointerId = null; dragFixedPoint = null;
    if (dragDesign && dragDesign.mir) dragDesign.mir.destroy();
    dragDesign = null;
    window.__dexSelHandleDragging = false;
    if (typeof window.dexOpenMenuForSelection === 'function') {
      window.dexOpenMenuForSelection('selhandle');
    }
  }

  // ─── Long-press / double-tap on CodeMirror wrapper ────────────────────────
  let pressTimer = null, pressStart = null, suppressNextPointerUp = false;
  let lastTapTime = 0, lastTapX = 0, lastTapY = 0;
  let suppressClickUntil = 0;

  function cancelPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressStart = null;
  }

  const posEq = (a, b) => a.line === b.line && a.ch === b.ch;

  function firePress(clientX, clientY) {
    const cm = getCm();
    if (!cm) return;
    const pos  = cm.coordsChar({ left: clientX, top: clientY }, 'window');
    const word = cm.findWordAt(pos);
    suppressNextPointerUp = true;
    suppressClickUntil    = Date.now() + 500;
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (_e) {} }

    if (typeof window.dexCloseNativeMenu === 'function') window.dexCloseNativeMenu();

    if (posEq(word.anchor, word.head)) {
      cm.setCursor(pos);
      cm.focus();
      if (typeof window.dexOpenMenuForSelection === 'function') {
        window.dexOpenMenuForSelection('longpress');
      }
      return;
    }
    cm.setSelection(word.anchor, word.head);
    cm.focus();
    positionHandles();
    if (typeof window.dexOpenMenuForSelection === 'function') {
      window.dexOpenMenuForSelection('longpress');
    }
  }

  function fireDblTap(clientX, clientY) {
    const cm = getCm();
    if (!cm) return;
    const pos  = cm.coordsChar({ left: clientX, top: clientY }, 'window');
    const word = cm.findWordAt(pos);

    suppressNextPointerUp = true;
    suppressClickUntil    = Date.now() + 500;
    if (typeof window.dexCloseNativeMenu === 'function') window.dexCloseNativeMenu();

    if (posEq(word.anchor, word.head)) {
      cm.setCursor(pos);
    } else {
      cm.setSelection(word.anchor, word.head);
      positionHandles();
    }
    cm.focus();
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (_e) {} }
    if (typeof window.dexOpenMenuForSelection === 'function') {
      window.dexOpenMenuForSelection('doubletap');
    }
  }

  function attachLongPress(tries) {
    const cm = getCm();
    if (!cm) {
      tries = tries || 0;
      if (tries < ATTACH_MAX_TRIES) setTimeout(() => attachLongPress(tries + 1), 300);
      return;
    }
    const wrapper = cm.getWrapperElement();
    if (wrapper.__dexLongPressBound) return;
    wrapper.__dexLongPressBound = true;

    wrapper.addEventListener('pointerdown', (e) => {
      if (!isTouchLike(e)) return;

      const now  = Date.now();
      const near = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 30;
      if (near && (now - lastTapTime) < DBL_TAP_MS) {
        lastTapTime = 0;
        cancelPress();
        // *** THE FIX ***  Tag this very event so the document-level
        // close-on-outside-tap listener (ensureMenu) skips it. Without this,
        // the menu we open synchronously inside fireDblTap would be closed
        // the instant this same pointerdown finishes bubbling to document.
        e.__dexJustOpenedMenu = true;
        fireDblTap(e.clientX, e.clientY);
        return;
      }
      lastTapTime = now; lastTapX = e.clientX; lastTapY = e.clientY;

      if (pressStart) { cancelPress(); return; }
      pressStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
      pressTimer = setTimeout(() => {
        firePress(pressStart.x, pressStart.y);
        pressTimer = null;
      }, LONG_PRESS_MS);
    }, { passive: true });

    wrapper.addEventListener('pointermove', (e) => {
      if (!pressStart || e.pointerId !== pressStart.id) return;
      if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > MOVE_CANCEL_PX) {
        cancelPress();
      }
    }, { passive: true });

    wrapper.addEventListener('pointerup', (e) => {
      if (pressStart && e.pointerId === pressStart.id) cancelPress();
      if (suppressNextPointerUp) {
        suppressNextPointerUp = false;
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false, capture: true });

    wrapper.addEventListener('pointercancel', (e) => {
      if (pressStart && e.pointerId === pressStart.id) cancelPress();
      suppressNextPointerUp = false;
    }, { passive: true });

    wrapper.addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }, { capture: true });

    wrapper.addEventListener('mousedown', (e) => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
    }, { capture: true });
  }

  // ─── Unified CodeMirror hook ──────────────────────────────────────────────
  function attachToCm() {
    const cm = getCm();
    if (!cm) return false;
    if (attachToCm._cm === cm) return true;

    const prev = attachToCm._cm;
    if (prev && typeof prev.off === 'function') {
      if (prev.__dexCursorHandler) { try { prev.off('cursorActivity', prev.__dexCursorHandler); } catch (_e) {} }
      if (prev.__dexScrollHandler) { try { prev.off('scroll',         prev.__dexScrollHandler); } catch (_e) {} }
    }
    attachToCm._cm = cm;

    const onCursorActivity = () => {
      scheduleHandles();
      if (window.__dexSelHandleDragging) return;
      if (findMenuOpen()) { closeMenu('codemirror'); return; }

      if (isMenuOpen()) {
        const cur = snapshotSelection();
        if (sameSel(cur, menuSelection)) return;   // echo of our own setSelection
        closeMenu('codemirror');
      }

      if (!cm.somethingSelected()) return;

      scheduleMenu('codemirror', () => {
        if (!cm.somethingSelected()) return null;
        if (findMenuOpen()) return null;
        if (window.__dexSelHandleDragging) return null;
        const range = {
          from: cm.getCursor('from'),
          to:   cm.getCursor('to'),
          text: cm.getSelection()
        };
        return { actions: codeMirrorActions(cm, range), rect: rectForRange(cm, range) };
      });
    };
    const onScroll = () => scheduleHandles();

    cm.on('cursorActivity', onCursorActivity);
    cm.on('scroll',         onScroll);
    cm.__dexCursorHandler = onCursorActivity;
    cm.__dexScrollHandler = onScroll;

    attachLongPress();
    return true;
  }

  // ─── Generic text selection (outside dedicated surfaces) ──────────────────
  function isFormField(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');
  }
  function isDedicatedSurface(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('.CodeMirror, .diff-view, #dexNativeMenu');
  }

  function hookGenericText() {
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { closeMenu('generic'); return; }

      const range     = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const element   = container.nodeType === 3 ? container.parentElement : container;
      if (isFormField(element) || isDedicatedSurface(element)) { closeMenu('generic'); return; }

      const capturedText = sel.toString();
      if (!capturedText) { closeMenu('generic'); return; }

      scheduleMenu('generic', () => {
        const currentSel = window.getSelection();
        if (!currentSel || currentSel.isCollapsed || !currentSel.rangeCount) return null;
        if (currentSel.toString() !== capturedText) return null;

        const currentRange     = currentSel.getRangeAt(0);
        const currentContainer = currentRange.commonAncestorContainer;
        const currentEl = currentContainer.nodeType === 3 ? currentContainer.parentElement : currentContainer;
        if (isFormField(currentEl) || isDedicatedSurface(currentEl)) return null;

        const rect = currentRange.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;

        return {
          actions: [{
            label: 'Copy', icon: 'copy',
            run: async () => { notify((await clipboardWrite(capturedText)) ? 'Copied' : 'Copy failed'); }
          }],
          rect: { left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom }
        };
      });
    });
  }

  // ─── Suppress native UI ───────────────────────────────────────────────────
  function suppressBrowserContextMenu() {
    document.addEventListener('contextmenu', (e) => {
      if (isFormField(e.target) && !isDedicatedSurface(e.target)) return;
      e.preventDefault();
    });
  }

  function suppressNativeSelectionUI() {
    const attach = () => {
      const cmEl = document.querySelector('.CodeMirror');
      if (!cmEl) { setTimeout(attach, 200); return; }
      if (cmEl.__dexNoNativeUI) return;
      cmEl.__dexNoNativeUI = true;
      cmEl.style.webkitTouchCallout = 'none';
      cmEl.style.touchAction = 'manipulation';
      const scroller = cmEl.querySelector('.CodeMirror-scroll');
      if (scroller) {
        scroller.style.webkitTouchCallout = 'none';
        scroller.style.touchAction = 'manipulation';
      }
      cmEl.addEventListener('selectstart', (e) => e.preventDefault());
    };
    attach();
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────
  const closeAll = () => closeMenu();
  window.addEventListener('popstate',   closeAll);
  window.addEventListener('hashchange', closeAll);
  window.addEventListener('dexEditorReady', () => { attachToCm(); attachLongPress(); });

  function init() {
    attachToCm();
    hookGenericText();
    suppressBrowserContextMenu();
    suppressNativeSelectionUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  (function watchForEditor() {
    let tries = 0;
    (function retry() {
      const cm = getCm();
      if (cm) { attachToCm(); return; }
      if (++tries < ATTACH_MAX_TRIES) setTimeout(retry, 300);
    })();

    let scheduled = false;
    const check = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        const cm = getCm();
        if (cm && attachToCm._cm !== cm) attachToCm();
      });
    };
    try {
      const obs = new MutationObserver(check);
      obs.observe(document.body, { childList: true, subtree: true });
    } catch (_e) {}
  })();
})();