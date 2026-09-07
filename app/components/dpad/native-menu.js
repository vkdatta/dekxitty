(function () {
  if (window.__dexNativeMenuLoaded) return;
  window.__dexNativeMenuLoaded = true;

  const MENU_DELAY_MS = 1000;
  // IC here is the real global DexIcons proxy (window.IC, set by icons.js) —
  // every 'xxx' call below (copy, cut, paste, selectAll, delete, swap,
  // bookmark, swapSaved, save, closeDpad) is a valid key on it already,
  // either directly or through DexIcons' own ALIASES table. A local IC
  // object used to shadow it here, mapping each of those to a plain icon-name
  // *string* instead of rendered SVG — renderMenu() was embedding that raw
  // string as literal text inside the delluna-icon span instead of an icon.

  function $(id) { return document.getElementById(id); }

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
        // FIX #19: check execCommand return value instead of always returning true
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e2) { return false; }
    }
  }

  async function clipboardRead() {
    try { return await navigator.clipboard.readText(); }
    catch (e) {
      // FIX #20: distinguish permission/security failures from actual empty clipboard.
      // NotAllowedError = permission denied (not an empty clipboard).
      if (e && e.name === 'NotAllowedError') return undefined; // signals "access denied"
      return null; // other failures → treat as unavailable
    }
  }

  function currentMode() {
    // Mirrors the router's route regex exactly: "/note/:id/:mode" with an
    // optional mode segment and optional trailing slash (see dexlabs.txt).
    const m = location.pathname.match(/^\/note\/[^/]+(?:\/([a-z]+))?\/?$/);
    const mode = m && m[1];
    if (mode === 'diffusion') return 'diffusion';
    if (mode === 'mermaid') return 'mermaid';
    return 'base';
  }

  let menu = null;
  let activeActions = null;
  // FIX (bug #3 / Scenario D): track which surface most recently opened the
  // visible menu so that menu actions only collapse the D-pad when it was the
  // D-pad that opened the menu. An unrelated Copy from a normal text selection
  // must never collapse the D-pad.
  let activeMenuSource = null;

  // ---- Per-surface timer ownership ----
  // FIX #8: instead of one shared pendingTimer, each surface owns its timer slot.
  // The menu controller tracks which surface is "active" so that a stale surface
  // cannot accidentally cancel a timer started by a different surface.
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

  // FIX #2 / #7: closeMenu now takes an optional surface parameter.
  // When called from a surface's own handler it closes unconditionally.
  // When called from a foreign handler (e.g. the diff selectionchange firing
  // because a CodeMirror selection changed the DOM) it only closes if that
  // surface actually has an active timer — it never cancels another surface's timer.
  // FIX #10: separate timer ownership from visible-menu ownership. A surface
  // can still close the visible menu even after its timer has already fired
  // (surfaceTimers[surface] === null), as long as that surface is the one that
  // last opened the visible menu (activeMenuSource). Without this, the menu
  // stays open after the originating selection disappears because the timer was
  // already consumed when the menu rendered.
  function closeMenu(surface) {
    if (surface) {
      const ownsPending = !!surfaceTimers[surface];
      const ownsVisible = activeMenuSource === surface;
      if (!ownsPending && !ownsVisible) return; // foreign surface; do nothing
      clearPendingFor(surface);
    } else {
      clearAllPending();
    }
    if (menu) menu.classList.remove('open');
    activeActions = null;
    activeMenuSource = null;
  }
  window.dexCloseNativeMenu = () => closeMenu();

  function renderMenu(actions, rect, source) {
    ensureMenu();
    activeActions = actions;
    activeMenuSource = source || null;
    let html = '';
    actions.forEach((a, i) => {
      if (a.sep) { html += '<div class="dex-nm-sep"></div>'; return; }
      html += '<button type="button" class="dex-nm-item' + (a.danger ? ' dex-nm-danger' : '') + '" data-nm-idx="' + i + '">' +
              '<delluna-icon name="' + (a.icon || '') + '"></delluna-icon><span>' + a.label + '</span></button>';
    });
    menu.innerHTML = html;
    menu.querySelectorAll('[data-nm-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.nmIdx, 10);
        const action = activeActions && activeActions[idx];
        // Capture the source before closeMenu() clears activeMenuSource.
        // FIX #11: use isDpadSource() so doubletap/longpress collapse the dpad too.
        const menuWasFromDpad = isDpadSource(activeMenuSource);
        closeMenu();
        // FIX (bug #3 / Scenario D): only collapse the D-pad when the menu was
        // opened BY the D-pad. Collapsing unconditionally means that any Copy
        // action from a normal text selection (diff, generic, CM) collapses the
        // D-pad even when it was unrelated to what the user was doing with the
        // D-pad. The D-pad should only be dismissed by its own interactions.
        if (menuWasFromDpad) {
          const dpad = window.__dexDpad;
          if (dpad && typeof dpad.collapseDpad === 'function') dpad.collapseDpad();
        }
        if (action && typeof action.run === 'function') action.run();
      });
    });

    menu.style.visibility = 'hidden';
    menu.classList.add('open');
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = rect ? rect.left : (vw - mw) / 2;
    let top  = rect ? rect.bottom + 8 : (vh - mh) / 2;
    if (rect && top + mh > vh - 8) top = rect.top - mh - 8;
    left = Math.max(8, Math.min(vw - mw - 8, left));
    top  = Math.max(8, Math.min(vh - mh - 8, top));
    menu.style.left = left + 'px';
    menu.style.top  = top + 'px';
    menu.style.visibility = '';
  }

  // FIX #1 / #8: scheduleMenu now takes a surface name so timers are scoped.
  // A surface's own calls only reset that surface's timer, not others.
  // FIX #4 / #10: pass surface as the source argument to renderMenu so that
  // activeMenuSource is always populated for auto-scheduled menus. Without this,
  // activeMenuSource remained null for every menu not opened via
  // dexOpenMenuForSelection(), so closeMenu('codemirror') couldn't close a
  // visible auto-scheduled CM menu (the #10 fix was incomplete), and
  // menuWasFromDpad was always false on auto-scheduled paths.
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

  // ---- Source normalisation ----
  // FIX #11 / #29: selection.js calls dexOpenMenuForSelection('doubletap') and
  // ('longpress') for touch interactions on the CM editor wrapper, while the
  // D-pad's recordCenterTap path calls it with 'dpad'. All three are D-pad /
  // touch-originated interactions that share the same contract:
  //   • show the "Close D-Pad" action in the menu
  //   • collapse the D-pad when a menu action is executed
  // Using three different string values caused the === 'dpad' checks to miss
  // the doubletap and longpress cases, so the "Close D-Pad" item was absent
  // and the D-pad never collapsed after copy/cut on a doubletap word-select.
  // isDpadSource() is the single place that expresses this equivalence.
  function isDpadSource(src) {
    return src === 'dpad' || src === 'doubletap' || src === 'longpress';
  }

  // ---- CodeMirror surface (base-mode textarea, diffusion's raw/morph editing panes) ----

  function codeMirrorActions(cm, range, opts) {
    const source = opts && opts.source;
    const actions = [
      { label: 'Copy', icon: 'copy', run: async () => { notify((await clipboardWrite(range.text)) ? 'Copied' : 'Copy failed'); } },
      { label: 'Cut', icon: 'cut', run: async () => {
          if (!(await clipboardWrite(range.text))) { notify('Cut failed'); return; }
          cm.operation(() => { cm.replaceRange('', range.from, range.to); });
          notify('Cut');
        } },
      { label: 'Paste', icon: 'paste', run: async () => {
          const text = await clipboardRead();
          // FIX #20/#21: undefined = permission denied; null = other failure; '' = valid empty string
          if (text === undefined) { notify('Clipboard access denied'); return; }
          if (text === null) { notify('Clipboard unavailable'); return; }
          cm.operation(() => { cm.replaceRange(text, range.from, range.to); });
          notify('Pasted');
        } },
      { label: 'Select All', icon: 'selectAll', run: () => {
          const lastLine = cm.lineCount() - 1;
          cm.setSelection({ line: 0, ch: 0 }, { line: lastLine, ch: cm.getLine(lastLine).length });
        } },
      { label: 'Delete', icon: 'delete', danger: true, run: () => {
          cm.operation(() => { cm.replaceRange('', range.from, range.to); });
          notify('Deleted');
        } }
    ];
    // Everything the scrapped dpad "Diff" submenu offered (issue 6), so
    // dropping that menu doesn't drop functionality.
    if (currentMode() === 'diffusion') {
      actions.push({ sep: true });
      actions.push({ label: 'Swap Raw ↔ Morph', icon: 'swap', run: () => { if (typeof diffSwapTexts === 'function') diffSwapTexts(); } });
      actions.push({ label: 'Save selection to pane', icon: 'save', run: () => {
          if (typeof diffCommitPane === 'function') { diffCommitPane(window.dexMode ? window.dexMode.activePane : 'raw'); notify('Saved'); }
        } });
      actions.push({ label: 'Copy Raw', icon: 'copy', run: () => { if (typeof diffCopyText === 'function') diffCopyText('raw'); } });
      actions.push({ label: 'Copy Morph', icon: 'copy', run: () => { if (typeof diffCopyText === 'function') diffCopyText('morph'); } });
      actions.push({ label: 'Paste to Raw', icon: 'paste', run: () => { if (typeof diffPasteText === 'function') diffPasteText('raw'); } });
      actions.push({ label: 'Paste to Morph', icon: 'paste', run: () => { if (typeof diffPasteText === 'function') diffPasteText('morph'); } });
      actions.push({ label: 'Clear Raw', icon: 'delete', danger: true, run: () => { if (typeof diffClearText === 'function') diffClearText('raw'); } });
      actions.push({ label: 'Clear Morph', icon: 'delete', danger: true, run: () => { if (typeof diffClearText === 'function') diffClearText('morph'); } });
    }
    // The dpad's own "Close D-Pad" action only makes sense when the menu was
    // opened from a D-pad/touch interaction, not from a real text selection.
    // FIX #11: isDpadSource covers 'dpad', 'doubletap', and 'longpress'.
    if (isDpadSource(source)) {
      actions.push({ sep: true });
      actions.push({ label: 'Close D-Pad', icon: 'x', danger: true, run: () => {
          if (typeof window.dexHideDpad === 'function') window.dexHideDpad();
        } });
    }
    return actions;
  }

  // No-selection fallback for the dpad's menu button (issue 6) — the old
  // dpad menu offered Paste/Select All even with nothing selected; native
  // menu keeps that when opened from the dpad, anchored at the cursor.
  function cursorActions(cm, source) {
    const actions = [
      { label: 'Paste', icon: 'paste', run: async () => {
          const text = await clipboardRead();
          if (text === undefined) { notify('Clipboard access denied'); return; }
          if (text === null) { notify('Clipboard unavailable'); return; }
          const pos = cm.getCursor();
          cm.operation(() => { cm.replaceRange(text, pos); });
          notify('Pasted');
        } },
      { label: 'Select All', icon: 'selectAll', run: () => {
          const lastLine = cm.lineCount() - 1;
          cm.setSelection({ line: 0, ch: 0 }, { line: lastLine, ch: cm.getLine(lastLine).length });
        } }
    ];
    // FIX #11: isDpadSource covers 'dpad', 'doubletap', and 'longpress'.
    if (isDpadSource(source)) {
      actions.push({ sep: true });
      actions.push({ label: 'Close D-Pad', icon: 'x', danger: true, run: () => {
          if (typeof window.dexHideDpad === 'function') window.dexHideDpad();
        } });
    }
    return actions;
  }

  // ---- Entry point for the dpad (issue 6) ----
  // The dpad no longer builds its own menu — double-tapping its center
  // handle now opens THIS menu for whatever is currently selected in
  // CodeMirror (or, with nothing selected, a Paste/Select All menu anchored
  // at the cursor), making native-menu the single, superior menu on the
  // site, reachable either by a real text selection or by the dpad.
  window.dexOpenMenuForSelection = function (source) {
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (!cm) { notify('Editor not ready'); return; }

    if (!cm.somethingSelected()) {
      const pos = cm.getCursor();
      const coords = cm.charCoords(pos, 'window');
      // FIX (bug #3): pass source so renderMenu records activeMenuSource = 'dpad'
      // (or whatever the caller passed), enabling the click handler to only
      // collapse the D-pad when the menu was opened BY the D-pad.
      renderMenu(cursorActions(cm, source), { left: coords.right, top: coords.top, bottom: coords.bottom }, source);
      return;
    }

    const range = { from: cm.getCursor('from'), to: cm.getCursor('to'), text: cm.getSelection() };
    const coords = cm.charCoords(range.to, 'window');
    renderMenu(
      codeMirrorActions(cm, range, { source }),
      { left: coords.right, top: coords.top, bottom: coords.bottom },
      source
    );
  };

  function hookCodeMirror() {
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (!cm) { setTimeout(hookCodeMirror, 300); return; }

    // FIX #16: track the cm instance by reference, not just a flag on the object.
    // If the editor is recreated we detect it here and re-hook the new instance.
    if (hookCodeMirror._boundCm === cm) return; // already hooked to this instance

    // FIX #25: remove the cursorActivity handler from the PREVIOUS CM instance
    // before attaching to the new one. Previously the old handler was stored in
    // cm.__dexNativeMenuHandler but never actually removed via cm.off(). On SPA
    // navigation the old CM object stays alive (it's still in the DOM until the
    // parent element is removed), its handler keeps firing, and it can still
    // manipulate the global native menu — including scheduling menus and calling
    // closeMenu() — for selections that belong to a completely different editor.
    const prevCm = hookCodeMirror._boundCm;
    if (prevCm && typeof prevCm.off === 'function' && prevCm.__dexNativeMenuHandler) {
      try { prevCm.off('cursorActivity', prevCm.__dexNativeMenuHandler); } catch (_e) {}
      prevCm.__dexNativeMenuHandler = null;
      prevCm.__dexNativeMenuHooked = false; // allow re-hooking if the instance is reused
    }

    hookCodeMirror._boundCm = cm;

    // Guard: only hook each cm instance once. __dexNativeMenuHooked is cleared
    // above when we unhook, so a recycled instance gets re-hooked correctly.
    if (cm.__dexNativeMenuHooked) return;
    cm.__dexNativeMenuHooked = true;

    // FIX #18: store the handler so it can be removed on the next editor replacement.
    // FIX (perf / bug #5): check somethingSelected() first so that plain
    // cursor movement (every keystroke when nothing is selected) exits before
    // touching any timer allocations or doing DOM work.
    const handler = () => {
      if (!cm.somethingSelected()) {
        // FIX #2: only close/cancel this surface's timer, not others.
        closeMenu('codemirror');
        return;
      }
      // FIX (bug #5): skip scheduling when find panel is open — the selection
      // change was caused by focusCurrentMatch(), not the user selecting text.
      const findMenu = document.getElementById('find-replace-menu');
      if (findMenu && !findMenu.classList.contains('find-replace-hidden')) return;
      // FIX (bug #5 / #7 / Scenario C): skip scheduling when ANY D-pad center
      // drag is active — both the collapsed-centre drag and the normal expanded
      // joystick drag. Previously only getCollapsedCenterDrag() was checked, so
      // the normal drag (ctx.startCenterDrag) was invisible to this guard and
      // the native menu could appear 1 second into a joystick selection.
      const dpad = window.__dexDpad;
      if (dpad) {
        const collapsedDragging = typeof dpad.getCollapsedCenterDrag === 'function'
          && dpad.getCollapsedCenterDrag();
        const normalDragging = typeof dpad.isCenterDragging === 'function'
          && dpad.isCenterDragging();
        if (collapsedDragging || normalDragging) return;
      }
      // FIX (bug #5 / Scenario E): skip scheduling while a selection handle
      // is being dragged. The user is still manipulating the selection; the
      // menu appearing mid-drag is disruptive.
      if (window.__dexSelHandleDragging) return;
      // FIX #1: pass surface name so only the CM timer is reset, not the diff timer.
      scheduleMenu('codemirror', () => {
        if (!cm.somethingSelected()) return null;
        const range = { from: cm.getCursor('from'), to: cm.getCursor('to'), text: cm.getSelection() };
        const coords = cm.charCoords(range.to, 'window');
        return { actions: codeMirrorActions(cm, range), rect: { left: coords.right, top: coords.top, bottom: coords.bottom } };
      });
    };
    cm.on('cursorActivity', handler);
    cm.__dexNativeMenuHandler = handler; // store for potential cleanup
  }

  // FIX #16: periodically check whether dexEditor.cm has been replaced.
  // This handles SPA navigation that destroys and recreates the editor.
  setInterval(() => {
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (cm && hookCodeMirror._boundCm !== cm) hookCodeMirror();
  }, 1000);

  // ---- Diff-view surface (diffusion's read-only Diff 1 / Diff 2 comparison tables) ----

  // FIX #14: scope diffSavedText with a getter/setter that could later be
  // extended to be note-scoped. For now it remains one global value but the
  // intent is explicit.
  let diffSavedText = '';

  // FIX #4: extract the plain-text character offset of a DOM range endpoint
  // within a given line's text-content, regardless of internal DOM structure.
  // Instead of trusting Range.startOffset (which is a child-node index when
  // startContainer is an element), we walk the text nodes inside the line row
  // and count characters up to the range's actual boundary point.
  function domRangeOffsetInLineRow(lineRow, rangeContainer, rangeOffset) {
    let charCount = 0;
    const walker = document.createTreeWalker(lineRow, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      if (node === rangeContainer) {
        return charCount + rangeOffset;
      }
      charCount += node.textContent.length;
    }
    // Fallback: rangeContainer is an element — count all text before it.
    // (Handles the case where the selection lands on an element boundary.)
    if (rangeContainer.nodeType !== 3) {
      const treeWalker2 = document.createTreeWalker(lineRow, NodeFilter.SHOW_TEXT, null, false);
      charCount = 0;
      while ((node = treeWalker2.nextNode())) {
        // If rangeOffset points to a child-node index, stop after that many children.
        if (rangeContainer.childNodes[rangeOffset] &&
            rangeContainer.childNodes[rangeOffset].contains(node)) break;
        charCount += node.textContent.length;
      }
      return charCount;
    }
    return 0;
  }

  function diffGetLines(isRaw) {
    // FIX #12: guard against diffElements not yet initialized.
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
      { label: 'Save selection', icon: 'bookmark', run: () => {
          diffSavedText = sel.text;
          const st = $('diffStatSaved');
          if (st) st.textContent = diffSavedText;
        } },
      { label: 'Swap corresponding line(s)', icon: 'swap', run: () => {
          if (sel.startLine < 0) return;
          try {
            const isSourceRaw = sel.viewId === 'diffDiff1View';
            const sourceLines = diffGetLines(isSourceRaw);
            const targetLines = diffGetLines(!isSourceRaw);
            for (let i = sel.startLine; i <= sel.endLine; i++) sourceLines[i] = targetLines[i] !== undefined ? targetLines[i] : sourceLines[i];
            diffSetLines(isSourceRaw, sourceLines);
            if (typeof diffusion === 'function') diffusion();
          } catch (e) { notify('Diff data unavailable'); }
        } }
    ];
    if (diffSavedText) {
      actions.push({ label: 'Swap with saved text', icon: 'swapSaved', run: () => {
          if (!diffSavedText || sel.startLine < 0) return;
          try {
            const isSourceRaw = sel.viewId === 'diffDiff1View';
            const lines = diffGetLines(isSourceRaw);
            const savedLines = diffSavedText.split(/\r?\n/);
            const start = sel.startLine, end = sel.endLine;
            if (sel.isLineSelection || start !== end) {
              for (let i = start; i <= end; i++) lines[i] = (i - start < savedLines.length) ? savedLines[i - start] : lines[i];
            } else {
              // FIX #4: use the corrected character offsets, not raw DOM offsets.
              const lineText = lines[start] || '';
              lines[start] = lineText.substring(0, sel.startCharOffset)
                           + diffSavedText
                           + lineText.substring(sel.endCharOffset);
            }
            diffSetLines(isSourceRaw, lines);
            if (typeof diffusion === 'function') diffusion();
          } catch (e) { notify('Diff data unavailable'); }
        } });
    }
    return actions;
  }

  function hookDiffView() {
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();

      // FIX #7: Before calling closeMenu, check whether the selection is
      // inside a diff view. Only cancel the DIFF surface's timer — never touch
      // the CodeMirror or textarea timers from here.
      if (!sel || sel.isCollapsed) { closeMenu('diff'); return; }

      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const element = container.nodeType === 3 ? container.parentElement : container;
      const view = element && element.closest ? element.closest('.diff-view') : null;
      if (!view || (view.id !== 'diffDiff1View' && view.id !== 'diffDiff2View')) {
        // FIX #7: selection is outside diff — only cancel diff's own timer.
        closeMenu('diff');
        return;
      }

      const startRow = (range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer).closest('.diff-line-row');
      const endRow   = (range.endContainer.nodeType === 3   ? range.endContainer.parentElement   : range.endContainer  ).closest('.diff-line-row');
      if (!startRow || !endRow) { closeMenu('diff'); return; }

      const gutter = startRow.querySelector('.diff-gutter-cell');
      let isLineSelection = false;
      if (gutter && (range.intersectsNode(gutter) || gutter.contains(range.startContainer) || gutter.contains(range.endContainer))) {
        isLineSelection = true;
      }

      // FIX #4: compute proper character offsets within the line's plain text.
      const startCharOffset = domRangeOffsetInLineRow(startRow, range.startContainer, range.startOffset);
      const endCharOffset   = domRangeOffsetInLineRow(endRow,   range.endContainer,   range.endOffset);

      const capturedSel = {
        viewId: view.id,
        startLine: parseInt(startRow.dataset.line, 10),
        endLine:   parseInt(endRow.dataset.line,   10),
        text: sel.toString(),
        isLineSelection,
        startCharOffset,
        endCharOffset
      };

      // FIX #3 / #6: don't capture the rect now — recalculate it when the timer
      // fires so that a 3-second scroll doesn't misplace the menu.
      // Also re-validate the selection at fire time.
      scheduleMenu('diff', () => {
        // FIX #6: re-validate that the selection still exists and matches what we captured.
        const currentSel = window.getSelection();
        if (!currentSel || currentSel.isCollapsed) return null;

        const currentText = currentSel.toString();
        if (currentText !== capturedSel.text) return null; // selection changed

        // Recheck that it's still inside a diff view.
        const currentRange = currentSel.getRangeAt(0);
        const currentContainer = currentRange.commonAncestorContainer;
        const currentEl = currentContainer.nodeType === 3 ? currentContainer.parentElement : currentContainer;
        const currentView = currentEl && currentEl.closest ? currentEl.closest('.diff-view') : null;
        if (!currentView || currentView.id !== view.id) return null;

        // FIX #11: recalculate rect at fire time, not at scheduling time.
        const currentRect = currentRange.getBoundingClientRect();
        if (currentRect.width === 0 || currentRect.height === 0) return null;

        return {
          actions: diffViewActions(capturedSel),
          rect: { left: currentRect.left, top: currentRect.top, bottom: currentRect.bottom }
        };
      });
    });
  }

  // ---- Generic surface (everything else: homepage, docs overlay, sidebar
  // labels, notifications, mermaid preview labels, etc.) ----
  //
  // Issue 7: native text selection previously only worked in CodeMirror
  // (base/diffusion raw+morph) and the diff1/diff2 tables — everywhere else
  // the browser's own selection toolbar took over. This surface is a
  // catch-all: any selection landing outside the surfaces above (and outside
  // real form fields, which keep native OS copy/paste since our menu can't
  // type into them) gets the same native menu, but with Copy only — static
  // site text can't be cut, pasted into, or deleted.
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
      { label: 'Copy', icon: 'copy', run: async () => { notify((await clipboardWrite(text)) ? 'Copied' : 'Copy failed'); } }
    ];
  }

  function hookGenericText() {
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { closeMenu('generic'); return; }

      const range = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const element = container.nodeType === 3 ? container.parentElement : container;
      if (isFormField(element) || isDedicatedSurface(element)) { closeMenu('generic'); return; }

      const capturedText = sel.toString();
      if (!capturedText) { closeMenu('generic'); return; }

      scheduleMenu('generic', () => {
        const currentSel = window.getSelection();
        if (!currentSel || currentSel.isCollapsed || !currentSel.rangeCount) return null;
        if (currentSel.toString() !== capturedText) return null;

        const currentRange = currentSel.getRangeAt(0);
        const currentContainer = currentRange.commonAncestorContainer;
        const currentEl = currentContainer.nodeType === 3 ? currentContainer.parentElement : currentContainer;
        if (isFormField(currentEl) || isDedicatedSurface(currentEl)) return null;

        const rect = currentRange.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;

        return { actions: genericActions(capturedText), rect: { left: rect.left, top: rect.top, bottom: rect.bottom } };
      });
    });
  }

  // Issue 7: suppress the browser's own right-click/long-press context menu
  // everywhere except real form fields (search boxes, modal inputs) where
  // users may still want the OS's native paste option.
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
