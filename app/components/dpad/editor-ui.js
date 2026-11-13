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

  // Toolbar placement (touch best practice: keep the toolbar OFF the selection handles' touch zones,
  // inside the visible viewport, away from the top-bar hotspot, and ignore the finger that opened it).
  const MENU_EDGE_PAD    = 8;    // min distance from viewport edges (px)
  const MENU_GAP_SEL     = 38;   // gap from a selection: handle dot + its ~27px touch halo + breathing room
  const MENU_GAP_CARET   = 14;   // gap from a bare caret (no handles are shown)
  const MENU_TAP_GUARD   = 140;  // ms after opening during which item taps are ignored (stray finger release)
  const TOP_HOTSPOT_PX   = 44;   // keep clear of the top-bar edge hotspot on touch devices
  const MODIFIER_KEYS    = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'];
  const FOREIGN_SOURCES  = { generic: 1, diff: 1 };   // menus owned by other selection surfaces

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
  let menuAnchor = null, menuOpenedAt = 0, menuDesign = null, repositionRaf = null;
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
    // Tapping a toolbar button must not steal focus from the editor (that collapses the selection and
    // dismisses the soft keyboard). 'click' still fires normally.
    ['pointerdown', 'mousedown'].forEach((t) => menuEl.addEventListener(t, (e) => e.preventDefault()));
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
    if (menuEl) { menuEl.classList.remove('open'); menuEl.style.visibility = ''; }
    activeActions = null;
    activeMenuSource = null;
    menuSelection = null;
    menuAnchor = null;
    menuDesign = null;
  }
  window.dexCloseNativeMenu = () => closeMenu();

  // Close a menu that belongs to the editor (long-press, double-tap, handle release, toolbar button, ...),
  // whatever 'source' label it was opened with. closeMenu('codemirror') alone only closes menus opened with
  // that exact label, which is why the toolbar used to survive Backspace/Delete.
  function closeEditorMenu() {
    clearPendingFor('codemirror');
    if (isMenuOpen() && !FOREIGN_SOURCES[activeMenuSource]) closeMenu();
  }

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
    menuDesign = designOn() ? designSnap() : null;

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
        if (Date.now() - menuOpenedAt < MENU_TAP_GUARD) return;   // stray release of the opening gesture
        const idx = parseInt(btn.dataset.nmIdx, 10);
        const action = activeActions && activeActions[idx];
        closeMenu();
        if (action && typeof action.run === 'function') action.run();
      });
    });

    menuEl.style.visibility = 'hidden';
    menuEl.classList.add('open');
    menuOpenedAt = Date.now();
    menuAnchor = rect || null;
    placeMenu();
  }

  // Visible area (accounts for the soft keyboard / pinch-zoom through visualViewport).
  function viewportBox() {
    const vv = window.visualViewport;
    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const x0 = vv ? vv.offsetLeft : 0, y0 = vv ? vv.offsetTop : 0;
    const w  = vv ? vv.width  : window.innerWidth;
    const h  = vv ? vv.height : window.innerHeight;
    return {
      left:   x0 + MENU_EDGE_PAD,
      right:  x0 + w - MENU_EDGE_PAD,
      top:    y0 + (coarse ? TOP_HOTSPOT_PX : MENU_EDGE_PAD),
      bottom: y0 + h - MENU_EDGE_PAD
    };
  }

  // Preferred spot: centred above the selection, clear of the handles. Otherwise below it, clear of the
  // end handle. If the selection fills the screen, float over its visible part. Hidden while the selection
  // is scrolled completely out of view.
  function placeMenu() {
    if (!menuEl || !menuEl.classList.contains('open')) return;
    const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    const b = viewportBox();
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const rect = menuAnchor;
    let left, top, offscreen = false;
    if (!rect) {
      left = (b.left + b.right - mw) / 2;
      top  = (b.top + b.bottom - mh) / 2;
    } else {
      const gap   = rect.caret ? MENU_GAP_CARET : MENU_GAP_SEL;
      const above = rect.top - gap - mh;
      const below = rect.bottom + gap;
      left = clamp(rect.left - mw / 2, b.left, Math.max(b.left, b.right - mw));
      if (above >= b.top)                  top = above;
      else if (below + mh <= b.bottom)     top = below;
      else {
        const vt = Math.max(rect.top, b.top), vb = Math.min(rect.bottom, b.bottom);
        top = clamp((vt + vb) / 2 - mh / 2, b.top, Math.max(b.top, b.bottom - mh));
      }
      offscreen = rect.bottom < b.top || rect.top > b.bottom;
    }
    menuEl.style.left = Math.round(left) + 'px';
    menuEl.style.top  = Math.round(top)  + 'px';
    menuEl.style.visibility = offscreen ? 'hidden' : '';
  }

  // Where the open editor menu should be anchored right now (selection may have scrolled / viewport resized).
  function editorAnchor() {
    if (designOn()) return designMenuRect() || null;
    const cm = getCm();
    if (!cm) return null;
    if (cm.somethingSelected()) return rectForRange(cm, { from: cm.getCursor('from'), to: cm.getCursor('to') });
    const c = cm.charCoords(cm.getCursor(), 'window');
    return { left: c.right, top: c.top, bottom: c.bottom, caret: true };
  }

  function repositionMenu() {
    if (!isMenuOpen() || repositionRaf !== null) return;
    repositionRaf = requestAnimationFrame(() => {
      repositionRaf = null;
      if (!isMenuOpen()) return;
      try {
        if (FOREIGN_SOURCES[activeMenuSource]) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount && !sel.isCollapsed) {
            const r = sel.getRangeAt(0).getBoundingClientRect();
            if (r.width || r.height) menuAnchor = { left: r.left + r.width / 2, top: r.top, bottom: r.bottom };
          }
        } else {
          const a = editorAnchor();
          if (a) menuAnchor = a;
        }
      } catch (_e) {}
      placeMenu();
    });
  }

  // Design-mode selection snapshot, to notice when the selection moved or vanished under an open menu.
  function designSnap() {
    const t = designTarget(); if (!t) return null;
    if (t.kind === 'ta') return { el: t.el, a: t.s, b: t.e };
    const r = t.range;
    return { el: t.el, n1: r.startContainer, o1: r.startOffset, n2: r.endContainer, o2: r.endOffset };
  }
  function sameDesign(x, y) {
    if (!x || !y) return x === y;
    return x.el === y.el && x.a === y.a && x.b === y.b &&
           x.n1 === y.n1 && x.o1 === y.o1 && x.n2 === y.n2 && x.o2 === y.o2;
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
  function readActions() {
    return [
      {
        label: 'Copy', icon: 'copy',
        run: async () => {
          const v = curV(); const text = v ? v.range.toString() : String(window.getSelection() || '');
          notify((await clipboardWrite(text)) ? 'Copied' : 'Copy failed');
          V = null; hidePaint(); hideHandles();
        }
      },
      {
        label: 'Select All', icon: 'selectAll',
        run: () => {
          const body = document.querySelector('#mdexecPane .mdx-body'); if (!body) return;
          const rg = document.createRange(); rg.selectNodeContents(body);
          vBusy = true; try { window.getSelection().removeAllRanges(); } catch (_e) {} vBusy = false;
          V = { kind: 'rich', el: body, range: rg };
          scheduleHandles();
          scheduleMenu('generic', () => ({ actions: readActions(), rect: designMenuRect() }));
        }
      }
    ];
  }

  window.dexOpenMenuForSelection = function (source) {
    if (readOn() && curV()) { clearPendingFor('generic'); renderMenu(readActions(), designMenuRect(), 'generic'); return; }
    const cm = getCm();
    if (!cm) { notify('Editor not ready'); return; }

    clearPendingFor('codemirror');
    clearPendingFor('generic');

    try {
      if (!cm.somethingSelected()) {
        const pos = cm.getCursor();
        const c   = cm.charCoords(pos, 'window');
        renderMenu(cursorActions(cm), { left: c.right, top: c.top, bottom: c.bottom, caret: true }, source);
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
    hidePaint();
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
  // Markdown Read view: static rendered HTML (#mdexecPane .mdx-body) with no editable blocks. Touch
  // selections there get the same treatment as Design blocks, so the browser's own handles / floating
  // bar / "search with Google" chip never show and ours do.
  const readOn = () => document.body.classList.contains('mdexec-active') && !designOn() && !!document.querySelector('#mdexecPane .mdx-body');
  const readBodyOf = (n) => { const h = n && (n.nodeType === 1 ? n : n.parentElement); return h && h.closest ? h.closest('#mdexecPane .mdx-body') : null; };

  // ── Virtual selection ─────────────────────────────────────────────────────
  // Touch selections made inside a design block would make the browser show ITS OWN handles and its
  // Cut/Copy bar on top of ours. So the moment a touch selection appears we remember it, collapse the real
  // one (the browser then has no selection UI to show) and draw the highlight + handles ourselves. The
  // real selection is handed back right before anything edits it (typing, cut/copy/paste, toolbar).
  let V = null;                         // { kind:'ta', el, s, e } | { kind:'rich', el, range }
  let lastTouchAt = 0, lastKeyAt = 0, vBusy = false, paintEl = null;
  const BLOCK_SEL = '.mdb-ta, .mdb-rich, .mdb-cell';
  const blockOf = (n) => { const h = n && (n.nodeType === 1 ? n : n.parentElement); return h && h.closest ? h.closest(BLOCK_SEL) : null; };

  function curV() {
    if (!V) return null;
    try {
      if (!V.el.isConnected) { V = null; return null; }
      if (V.kind === 'ta') { if (V.e > V.el.value.length || V.s > V.e) { V = null; return null; } }
      else if (!V.range.commonAncestorContainer.isConnected) { V = null; return null; }
    } catch (_e) { V = null; return null; }
    return V;
  }

  function hidePaint() { if (paintEl) paintEl.innerHTML = ''; }
  function paintRects(rects) {
    if (!paintEl) {
      paintEl = document.createElement('div');
      paintEl.id = 'dexVSel';
      paintEl.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:9980;pointer-events:none';
      document.body.appendChild(paintEl);
    }
    paintEl.innerHTML = '';
    rects.forEach((r) => {
      if (!(r.width > 0)) return;
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;';
      paintEl.appendChild(d);
    });
  }

  function restoreV() {
    const v = curV(); if (!v) return false;
    vBusy = true;
    try {
      if (v.kind === 'ta') { v.el.focus({ preventScroll: true }); v.el.setSelectionRange(v.s, v.e); }
      else { v.el.focus({ preventScroll: true }); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(v.range); }
    } catch (_e) {}
    V = null; hidePaint(); vBusy = false;
    return true;
  }

  function realTarget() {
    const ae = document.activeElement;
    if (ae && ae.tagName === 'TEXTAREA' && ae.classList.contains('mdb-ta') && ae.selectionStart !== ae.selectionEnd) return { kind: 'ta', el: ae, s: ae.selectionStart, e: ae.selectionEnd };
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const el = blockOf(sel.anchorNode);
      if (el) return { kind: 'rich', el, range: sel.getRangeAt(0).cloneRange() };
      if (readOn()) {
        const rb = readBodyOf(sel.anchorNode);
        if (rb && rb.contains(sel.focusNode)) return { kind: 'rich', el: rb, range: sel.getRangeAt(0).cloneRange() };
      }
    }
    return null;
  }

  function virtualize() {
    const t = realTarget(); if (!t) return false;
    vBusy = true;
    try {
      if (t.kind === 'ta') { V = { kind: 'ta', el: t.el, s: t.s, e: t.e }; t.el.setSelectionRange(t.e, t.e); }
      else { V = { kind: 'rich', el: t.el, range: t.range }; window.getSelection().collapseToEnd(); }
    } catch (_e) { V = null; }
    vBusy = false;
    return !!V;
  }

  window.dexVirtualSel = curV;
  window.dexRestoreVirtualSel = restoreV;
  window.dexClearVirtualSel = () => { V = null; hidePaint(); };

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') lastTouchAt = Date.now();
    if (V && e.target.closest && (e.target.closest(BLOCK_SEL) || e.target.closest('.mdx-body')) && !e.target.closest('.dex-sel-handle')) { V = null; hidePaint(); scheduleHandles(); }
  }, true);
  document.addEventListener('keydown', (e) => {
    lastKeyAt = Date.now();
    if (!V || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].indexOf(e.key) >= 0) return;
    restoreV();
  }, true);
  ['beforeinput', 'cut', 'copy', 'paste'].forEach((ev) => document.addEventListener(ev, () => { if (V) restoreV(); }, true));
  document.addEventListener('selectionchange', () => {
    const inRead = readOn();
    if (vBusy || !(designOn() || inRead)) return;
    const now = Date.now();
    let fresh = false;
    if (!window.__dexSelHandleDragging && now - lastKeyAt > 400 && now - lastTouchAt < 4000 && !curV()) fresh = virtualize();
    scheduleHandles();
    if (inRead && fresh) scheduleMenu('generic', () => {
      const v = curV(); if (!v) return null;
      return { actions: readActions(), rect: designMenuRect() };
    });
    if (isMenuOpen() && !FOREIGN_SOURCES[activeMenuSource] && !window.__dexSelHandleDragging && !sameDesign(designSnap(), menuDesign)) closeMenu();
  });

  function designTarget() {
    if (!designOn() && !readOn()) return null;
    const v = curV();
    if (v) return v.kind === 'ta' ? { kind: 'ta', el: v.el, s: v.s, e: v.e, virtual: true } : { kind: 'rich', el: v.el, range: v.range, virtual: true };
    return realTarget();
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
    const rects = (a, b) => {
      const rg = document.createRange(); rg.setStart(node, Math.min(a, len)); rg.setEnd(node, Math.min(b, len));
      return Array.from(rg.getClientRects()).map((r) => ({ left: r.left, top: r.top - st, width: r.width, height: r.height }));
    };
    return { at, rects, len, destroy() { m.remove(); } };
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
        const a = mir.at(t.s), b = mir.at(t.e);
        return { a: { left: a.left, top: a.top, bottom: a.bottom }, b: { right: b.left, top: b.top, bottom: b.bottom }, paint: t.virtual ? mir.rects(t.s, t.e) : null };
      } finally { mir.destroy(); }
    }
    const all = Array.from(t.range.getClientRects());
    const rects = all.filter((r) => r.width > 0 || r.height > 0);
    if (!rects.length) return null;
    const f = rects[0], l = rects[rects.length - 1];
    return { a: { left: f.left, top: f.top, bottom: f.bottom }, b: { right: l.right, top: l.top, bottom: l.bottom }, paint: t.virtual ? all.map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height })) : null };
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
      if (r.paint) paintRects(r.paint); else hidePaint();
    } else if (designOn() || readOn()) {
      hideHandles(); return;
    } else {
      const cm = getCm();
      if (!cm || !cm.somethingSelected()) { hideHandles(); return; }
      // cursorCoords = the exact edge position. (charCoords is the box of the character AFTER the edge,
      // which put the end handle one character too far right.) 'before' keeps the end handle at the end of
      // a wrapped row instead of jumping to the start of the next one.
      const f = cm.getCursor('from'), t = cm.getCursor('to');
      const a = cm.cursorCoords({ line: f.line, ch: f.ch, sticky: 'after' },  'window');
      const b = cm.cursorCoords({ line: t.line, ch: t.ch, sticky: 'before' }, 'window');
      A = { left: a.left, top: a.top, bottom: a.bottom };
      B = { right: b.left, top: b.top, bottom: b.bottom };
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
    if (!dt && (designOn() || readOn() || !cm || !cm.somethingSelected())) return;
    dragging       = which;
    dragPointerId  = pointerId;
    dragDesign     = null;
    lastTouchAt    = Date.now();
    if (dt) {
      if (dt.kind === 'ta') {
        dragDesign = { kind: 'ta', el: dt.el, virtual: !!dt.virtual, fixed: which === 'from' ? dt.e : dt.s, mir: taMirror(dt.el) };
      } else {
        const r = dt.range;
        dragDesign = { kind: 'rich', el: dt.el, virtual: !!dt.virtual, fixed: which === 'from' ? { n: r.endContainer, o: r.endOffset } : { n: r.startContainer, o: r.startOffset } };
      }
    } else {
      dragFixedPoint = (which === 'from') ? cm.getCursor('to') : cm.getCursor('from');
    }
    dragGrabX = e.clientX - (el._cx || 0);
    dragGrabY = e.clientY - (el._cy || 0);
    window.__dexSelHandleDragging = true;
    if (isMenuOpen()) closeMenu();
  }

  function pointToDom(x, y) {
    let n = null, o = 0;
    if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); if (r) { n = r.startContainer; o = r.startOffset; } }
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { n = p.offsetNode; o = p.offset; } }
    return n ? { n, o } : null;
  }

  function onHandleDragMove(e) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    e.preventDefault();
    const x = e.clientX - dragGrabX;
    const y = e.clientY - dragGrabY;
    if (dragDesign) {
      const d = dragDesign;
      if (d.kind === 'ta') {
        const i = taIndexAt(d.mir, x, y), a = Math.min(d.fixed, i), b = Math.max(d.fixed, i);
        if (d.virtual) { const v = curV(); if (v) { v.s = a; v.e = b; } }
        else { d.el.setSelectionRange(a, b); }
      } else {
        const pt = pointToDom(x, y);
        if (pt && d.el.contains(pt.n)) {
          const r = document.createRange();
          try {
            r.setStart(d.fixed.n, d.fixed.o); r.collapse(true);
            if (r.comparePoint(pt.n, pt.o) < 0) r.setStart(pt.n, pt.o); else r.setEnd(pt.n, pt.o);
            if (d.virtual) { const v = curV(); if (v) v.range = r; }
            else { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
          } catch (_e) {}
        }
      }
      try { window.dexMdexec.design.mirror(); } catch (_e) {}
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
      if (prev.__dexChangeHandler) { try { prev.off('change',         prev.__dexChangeHandler); } catch (_e) {} }
    }
    attachToCm._cm = cm;

    const onCursorActivity = () => {
      scheduleHandles();
      if (window.__dexSelHandleDragging) return;
      if (findMenuOpen()) { closeEditorMenu(); return; }

      if (isMenuOpen() && !FOREIGN_SOURCES[activeMenuSource]) {
        const cur = snapshotSelection();
        if (sameSel(cur, menuSelection)) return;   // echo of our own setSelection
        closeEditorMenu();                         // selection moved / collapsed (e.g. after Backspace)
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
    const onScroll = () => { scheduleHandles(); repositionMenu(); };
    // Any edit invalidates the toolbar (its actions were built for the old text/selection).
    const onChange = () => closeEditorMenu();

    cm.on('cursorActivity', onCursorActivity);
    cm.on('scroll',         onScroll);
    cm.on('change',         onChange);
    cm.__dexCursorHandler = onCursorActivity;
    cm.__dexScrollHandler = onScroll;
    cm.__dexChangeHandler = onChange;

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
      if (readOn() && (curV() || vBusy)) return;   // virtual selection: its own menu is managed above
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
      if (e.target.closest && e.target.closest(BLOCK_SEL)) { e.preventDefault(); return; }
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

  // ─── Keep the toolbar honest (typing, scrolling, keyboard) ────────────────
  // Typing / deleting / arrow keys end the selection interaction: dismiss the toolbar (also covers
  // Design-mode textareas and contenteditable blocks, which have no CodeMirror events).
  document.addEventListener('keydown', (e) => {
    if (!isMenuOpen() || MODIFIER_KEYS.indexOf(e.key) >= 0) return;
    if (menuEl.contains(e.target)) return;      // keyboard activation of a toolbar button
    closeEditorMenu();
  }, true);
  ['beforeinput', 'input'].forEach((ev) => document.addEventListener(ev, () => closeEditorMenu(), true));

  // Follow the selection while the page scrolls or the soft keyboard / zoom changes the visible area.
  window.addEventListener('scroll', (e) => {
    if (!isMenuOpen() || (menuEl && menuEl.contains(e.target))) return;
    repositionMenu();
  }, true);
  window.addEventListener('resize', repositionMenu);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', repositionMenu);
    window.visualViewport.addEventListener('scroll', repositionMenu);
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