(function () {
  if (window.__dexEditorUiLoaded) return;
  window.__dexEditorUiLoaded = true;

  // ─── Constants ────────────────────────────────────────────────────────────
  const MENU_DELAY_MS    = 300;
  const LONG_PRESS_MS    = 450;
  const DBL_TAP_MS       = 350;
  const MOVE_CANCEL_PX   = 10;
  const ATTACH_MAX_TRIES = 200;
  const HANDLE_OFFSET    = 14;
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
      renderMenu(codeMirrorActions(cm, range), rectForRange(cm, range), source);
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
    handleEnd = document.createElement('div');
    handleEnd.className = 'dex-sel-handle dex-sel-handle-end';
    document.body.appendChild(handleStart);
    document.body.appendChild(handleEnd);

    [[handleStart, 'from'], [handleEnd, 'to']].forEach(([el, which]) => {
      el.addEventListener('pointerdown', (e) => {
        if (!isTouchLike(e)) return;
        e.preventDefault(); e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch (_e) {}
        beginHandleDrag(which, e.pointerId);
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

  function positionHandles() {
    const cm = getCm();
    if (!cm || !cm.somethingSelected()) { hideHandles(); return; }
    if (findMenuOpen()) { hideHandles(); return; }
    ensureHandles();

    const a = cm.charCoords(cm.getCursor('from'), 'window');
    const b = cm.charCoords(cm.getCursor('to'),   'window');

    handleStart.style.left = a.left + 'px';
    handleStart.style.top  = (a.top - HANDLE_OFFSET) + 'px';
    handleStart.style.display = 'block';

    handleEnd.style.left = b.right + 'px';
    handleEnd.style.top  = (b.bottom + HANDLE_OFFSET) + 'px';
    handleEnd.style.display = 'block';
  }

  function scheduleHandles() {
    if (_handleRafId !== null) return;
    _handleRafId = requestAnimationFrame(() => {
      _handleRafId = null;
      positionHandles();
    });
  }

  window.dexHideSelectionHandles     = hideHandles;
  window.dexScheduleSelectionHandles = scheduleHandles;
  window.dexPositionSelectionHandles = positionHandles;
  window.addEventListener('popstate', hideHandles);

  // ─── Handle drag ──────────────────────────────────────────────────────────
  let dragging = null, dragPointerId = null, dragFixedPoint = null;

  function beginHandleDrag(which, pointerId) {
    const cm = getCm();
    if (!cm || !cm.somethingSelected()) return;
    dragging       = which;
    dragPointerId  = pointerId;
    dragFixedPoint = (which === 'from') ? cm.getCursor('to') : cm.getCursor('from');
    window.__dexSelHandleDragging = true;
    if (isMenuOpen()) closeMenu();
  }

  function onHandleDragMove(e) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    e.preventDefault();
    const cm = getCm();
    if (!cm) return;
    const delta = dragging === 'from' ? HANDLE_OFFSET : -HANDLE_OFFSET;
    const pos = cm.coordsChar({ left: e.clientX, top: e.clientY + delta }, 'window');
    cm.setSelection(dragFixedPoint, pos);
    positionHandles();
  }

  function endHandleDrag(e) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = null; dragPointerId = null; dragFixedPoint = null;
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