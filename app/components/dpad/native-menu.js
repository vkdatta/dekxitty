(function () {
  if (window.__dexNativeMenuLoaded) return;
  window.__dexNativeMenuLoaded = true;

  // Delay before the menu appears after a selection change.
  // Short enough to feel responsive; long enough not to fire mid-drag.
  const MENU_DELAY_MS = 300;

  function notify(m) { if (typeof showNotification === 'function') showNotification(m); }

  async function clipboardWrite(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e2) { return false; }
    }
  }

  async function clipboardRead() {
    try { return await navigator.clipboard.readText(); }
    catch (e) {
      if (e && e.name === 'NotAllowedError') return undefined;
      return null;
    }
  }

  function currentMode() {
    const m = location.pathname.match(/^\/note\/[^/]+(?:\/([a-z]+))?\/?$/);
    const mode = m && m[1];
    if (mode === 'diffusion') return 'diffusion';
    if (mode === 'mermaid') return 'mermaid';
    return 'base';
  }

  // ── Menu element & state ──────────────────────────────────────────────────
  let menu = null;
  let activeActions = null;
  let activeMenuSource = null;
  const surfaceTimers = { codemirror: null, diff: null, generic: null };

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
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'dexNativeMenu';
    document.body.appendChild(menu);
    document.addEventListener('pointerdown', (e) => {
      if (menu.classList.contains('open') && !menu.contains(e.target)) closeMenu();
    });
    return menu;
  }

  function closeMenu(surface) {
    if (surface) {
      const ownsPending = !!surfaceTimers[surface];
      const ownsVisible = activeMenuSource === surface;
      if (!ownsPending && !ownsVisible) return;
      clearPendingFor(surface);
    } else {
      clearAllPending();
    }
    if (menu) menu.classList.remove('open');
    activeActions = null;
    activeMenuSource = null;
  }
  window.dexCloseNativeMenu = () => closeMenu();

  // ── Render ────────────────────────────────────────────────────────────────
  // rect = { left (center-X of selection), top, bottom }
  // Menu appears above the selection, centred; falls back below if no room.
  function escapeAttr(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderMenu(actions, rect, source) {
    ensureMenu();
    activeActions  = actions;
    activeMenuSource = source || null;

    let html = '';
    actions.forEach((a, i) => {
      if (a.sep) { html += '<div class="dex-nm-sep"></div>'; return; }
      html +=
        '<button type="button"' +
        ' class="dex-nm-item' + (a.danger ? ' dex-nm-danger' : '') + '"' +
        ' data-nm-idx="' + i + '"' +
        ' title="' + escapeAttr(a.label) + '"' +
        ' aria-label="' + escapeAttr(a.label) + '">' +
        '<delluna-icon name="' + (a.icon || '') + '"></delluna-icon>' +
        '</button>';
    });
    menu.innerHTML = html;

    menu.querySelectorAll('[data-nm-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx    = parseInt(btn.dataset.nmIdx, 10);
        const action = activeActions && activeActions[idx];
        closeMenu();
        if (action && typeof action.run === 'function') action.run();
      });
    });

    menu.style.visibility = 'hidden';
    menu.classList.add('open');

    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer appearing above the selection, centred on it
    let left = rect ? rect.left - mw / 2 : (vw - mw) / 2;
    let top  = rect ? rect.top - mh - 10 : (vh - mh) / 2;
    // Fallback: appear below if there isn't room above
    if (rect && top < 8) top = rect.bottom + 10;
    left = Math.max(8, Math.min(vw - mw - 8, left));
    top  = Math.max(8, Math.min(vh - mh - 8, top));

    menu.style.left = left + 'px';
    menu.style.top  = top  + 'px';
    menu.style.visibility = '';
  }

  function scheduleMenu(surface, getActionsAndRect) {
    clearPendingFor(surface);
    if (menu && menu.classList.contains('open')) closeMenu();
    surfaceTimers[surface] = setTimeout(() => {
      surfaceTimers[surface] = null;
      const result = getActionsAndRect();
      if (!result || !result.actions || !result.actions.length) return;
      renderMenu(result.actions, result.rect, surface);
    }, MENU_DELAY_MS);
  }

  // ── Action builders ───────────────────────────────────────────────────────
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
      {
        label: 'Select All', icon: 'selectAll',
        run: () => {
          const lastLine = cm.lineCount() - 1;
          cm.setSelection({ line: 0, ch: 0 }, { line: lastLine, ch: cm.getLine(lastLine).length });
        }
      },
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
      {
        label: 'Select All', icon: 'selectAll',
        run: () => {
          const lastLine = cm.lineCount() - 1;
          cm.setSelection({ line: 0, ch: 0 }, { line: lastLine, ch: cm.getLine(lastLine).length });
        }
      }
    ];
  }

  // ── Public: open menu for current CM selection ────────────────────────────
  window.dexOpenMenuForSelection = function (source) {
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (!cm) { notify('Editor not ready'); return; }

    if (!cm.somethingSelected()) {
      const pos    = cm.getCursor();
      const coords = cm.charCoords(pos, 'window');
      renderMenu(
        cursorActions(cm),
        { left: coords.right, top: coords.top, bottom: coords.bottom },
        source
      );
      return;
    }

    const range      = { from: cm.getCursor('from'), to: cm.getCursor('to'), text: cm.getSelection() };
    const fromCoords = cm.charCoords(range.from, 'window');
    const toCoords   = cm.charCoords(range.to,   'window');
    renderMenu(
      codeMirrorActions(cm, range),
      {
        left:   (fromCoords.left + toCoords.right) / 2,
        top:    Math.min(fromCoords.top,    toCoords.top),
        bottom: Math.max(fromCoords.bottom, toCoords.bottom)
      },
      source
    );
  };

  // ── CodeMirror cursor-activity hook ───────────────────────────────────────
  function hookCodeMirror() {
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (!cm) { setTimeout(hookCodeMirror, 300); return; }
    if (hookCodeMirror._boundCm === cm) return;

    const prevCm = hookCodeMirror._boundCm;
    if (prevCm && typeof prevCm.off === 'function' && prevCm.__dexNativeMenuHandler) {
      try { prevCm.off('cursorActivity', prevCm.__dexNativeMenuHandler); } catch (_e) {}
      prevCm.__dexNativeMenuHandler = null;
      prevCm.__dexNativeMenuHooked  = false;
    }
    hookCodeMirror._boundCm = cm;
    if (cm.__dexNativeMenuHooked) return;
    cm.__dexNativeMenuHooked = true;

    const handler = () => {
      if (!cm.somethingSelected()) { closeMenu('codemirror'); return; }

      // Don't schedule while find-replace is open
      const findMenu = document.getElementById('find-replace-menu');
      if (findMenu && !findMenu.classList.contains('find-replace-hidden')) return;

      // Don't schedule while a selection handle is being dragged
      if (window.__dexSelHandleDragging) return;

      scheduleMenu('codemirror', () => {
        if (!cm.somethingSelected()) return null;
        const range      = { from: cm.getCursor('from'), to: cm.getCursor('to'), text: cm.getSelection() };
        const fromCoords = cm.charCoords(range.from, 'window');
        const toCoords   = cm.charCoords(range.to,   'window');
        return {
          actions: codeMirrorActions(cm, range),
          rect: {
            left:   (fromCoords.left + toCoords.right) / 2,
            top:    Math.min(fromCoords.top,    toCoords.top),
            bottom: Math.max(fromCoords.bottom, toCoords.bottom)
          }
        };
      });
    };

    cm.on('cursorActivity', handler);
    cm.__dexNativeMenuHandler = handler;
  }

  setInterval(() => {
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (cm && hookCodeMirror._boundCm !== cm) hookCodeMirror();
  }, 1000);

  // ── Diff-view selection hook ──────────────────────────────────────────────
  let diffSavedText = '';

  function domRangeOffsetInLineRow(lineRow, rangeContainer, rangeOffset) {
    let charCount = 0;
    const walker = document.createTreeWalker(lineRow, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      if (node === rangeContainer) return charCount + rangeOffset;
      charCount += node.textContent.length;
    }
    if (rangeContainer.nodeType !== 3) {
      const walker2 = document.createTreeWalker(lineRow, NodeFilter.SHOW_TEXT, null, false);
      charCount = 0;
      while ((node = walker2.nextNode())) {
        if (rangeContainer.childNodes[rangeOffset] &&
            rangeContainer.childNodes[rangeOffset].contains(node)) break;
        charCount += node.textContent.length;
      }
      return charCount;
    }
    return 0;
  }

  function diffGetLines(isRaw) {
    if (!diffElements || !diffElements.raw || !diffElements.morph || !diffElements.optBreaks) {
      throw new Error('diffElements not initialized');
    }
    const text = isRaw ? diffElements.raw.value : diffElements.morph.value;
    return diffElements.optBreaks.checked ? text.split(/\r?\n/) : [text.replace(/\r?\n/g, ' ')];
  }

  function diffSetLines(isRaw, linesArray) {
    if (!diffElements || !diffElements.raw || !diffElements.morph) {
      throw new Error('diffElements not initialized');
    }
    const result = linesArray.join('\n');
    if (isRaw) diffElements.raw.value = result; else diffElements.morph.value = result;
  }

  function diffViewActions(sel) {
    const actions = [
      {
        label: 'Save selection', icon: 'bookmark',
        run: () => {
          diffSavedText = sel.text;
          const st = document.getElementById('diffStatSaved');
          if (st) st.textContent = diffSavedText;
        }
      },
      {
        label: 'Swap corresponding line(s)', icon: 'swap',
        run: () => {
          if (sel.startLine < 0) return;
          try {
            const isSourceRaw  = sel.viewId === 'diffDiff1View';
            const sourceLines  = diffGetLines(isSourceRaw);
            const targetLines  = diffGetLines(!isSourceRaw);
            for (let i = sel.startLine; i <= sel.endLine; i++) {
              sourceLines[i] = targetLines[i] !== undefined ? targetLines[i] : sourceLines[i];
            }
            diffSetLines(isSourceRaw, sourceLines);
            if (typeof diffusion === 'function') diffusion();
          } catch (e) { notify('Diff data unavailable'); }
        }
      }
    ];

    if (diffSavedText) {
      actions.push({
        label: 'Swap with saved text', icon: 'swapSaved',
        run: () => {
          if (!diffSavedText || sel.startLine < 0) return;
          try {
            const isSourceRaw = sel.viewId === 'diffDiff1View';
            const lines       = diffGetLines(isSourceRaw);
            const savedLines  = diffSavedText.split(/\r?\n/);
            const start = sel.startLine, end = sel.endLine;
            if (sel.isLineSelection || start !== end) {
              for (let i = start; i <= end; i++) {
                lines[i] = (i - start < savedLines.length) ? savedLines[i - start] : lines[i];
              }
            } else {
              const lineText = lines[start] || '';
              lines[start] = lineText.substring(0, sel.startCharOffset)
                           + diffSavedText
                           + lineText.substring(sel.endCharOffset);
            }
            diffSetLines(isSourceRaw, lines);
            if (typeof diffusion === 'function') diffusion();
          } catch (e) { notify('Diff data unavailable'); }
        }
      });
    }
    return actions;
  }

  function hookDiffView() {
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { closeMenu('diff'); return; }
      const range     = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const element   = container.nodeType === 3 ? container.parentElement : container;
      const view      = element && element.closest ? element.closest('.diff-view') : null;
      if (!view || (view.id !== 'diffDiff1View' && view.id !== 'diffDiff2View')) {
        closeMenu('diff'); return;
      }
      const startRow = (range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer).closest('.diff-line-row');
      const endRow   = (range.endContainer.nodeType   === 3 ? range.endContainer.parentElement   : range.endContainer  ).closest('.diff-line-row');
      if (!startRow || !endRow) { closeMenu('diff'); return; }

      const gutter = startRow.querySelector('.diff-gutter-cell');
      let isLineSelection = false;
      if (gutter && (range.intersectsNode(gutter) || gutter.contains(range.startContainer) || gutter.contains(range.endContainer))) {
        isLineSelection = true;
      }

      const startCharOffset = domRangeOffsetInLineRow(startRow, range.startContainer, range.startOffset);
      const endCharOffset   = domRangeOffsetInLineRow(endRow,   range.endContainer,   range.endOffset);
      const capturedSel = {
        viewId: view.id,
        startLine: parseInt(startRow.dataset.line, 10),
        endLine:   parseInt(endRow.dataset.line,   10),
        text: sel.toString(),
        isLineSelection, startCharOffset, endCharOffset
      };

      scheduleMenu('diff', () => {
        const currentSel = window.getSelection();
        if (!currentSel || currentSel.isCollapsed) return null;
        const currentText = currentSel.toString();
        if (currentText !== capturedSel.text) return null;
        const currentRange     = currentSel.getRangeAt(0);
        const currentContainer = currentRange.commonAncestorContainer;
        const currentEl  = currentContainer.nodeType === 3 ? currentContainer.parentElement : currentContainer;
        const currentView = currentEl && currentEl.closest ? currentEl.closest('.diff-view') : null;
        if (!currentView || currentView.id !== view.id) return null;
        const rect = currentRange.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        return {
          actions: diffViewActions(capturedSel),
          rect: { left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom }
        };
      });
    });
  }

  // ── Generic text selection hook ───────────────────────────────────────────
  function isFormField(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('input, textarea, [contenteditable="true"], [contenteditable=""]');
  }
  function isDedicatedSurface(el) {
    if (!el || !el.closest) return false;
    return !!el.closest('.CodeMirror, .diff-view, #dexNativeMenu');
  }
  function genericActions(text) {
    return [
      {
        label: 'Copy', icon: 'copy',
        run: async () => { notify((await clipboardWrite(text)) ? 'Copied' : 'Copy failed'); }
      }
    ];
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
        const currentEl  = currentContainer.nodeType === 3 ? currentContainer.parentElement : currentContainer;
        if (isFormField(currentEl) || isDedicatedSurface(currentEl)) return null;
        const rect = currentRange.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        return {
          actions: genericActions(capturedText),
          rect: { left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom }
        };
      });
    });
  }

  function suppressBrowserContextMenu() {
    document.addEventListener('contextmenu', (e) => {
      if (isFormField(e.target) && !isDedicatedSurface(e.target)) return;
      e.preventDefault();
    });
  }

  function init() {
    hookCodeMirror();
    hookDiffView();
    hookGenericText();
    suppressBrowserContextMenu();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
