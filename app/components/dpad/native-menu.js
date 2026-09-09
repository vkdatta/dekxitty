(function () {
  if (window.__dexNativeMenuLoaded) return;
  window.__dexNativeMenuLoaded = true;

  const MENU_DELAY_MS = 180;
  const SURFACE_CODEMIRROR = 'codemirror';

  function notify(message) {
    if (typeof window.showNotification === 'function') window.showNotification(message);
  }

  async function clipboardWrite(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        (document.body || document.documentElement).appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (_e2) {
        return false;
      }
    }
  }

  async function clipboardRead() {
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      if (e && e.name === 'NotAllowedError') return undefined;
      return null;
    }
  }

  let menu = null;
  let activeActions = null;
  let activeSurface = null;
  let menuSerial = 0;
  let selectionTimer = null;
  let genericSelectionTimer = null;
  let baseActions = null;
  let lastMenuRect = null;

  function getDpad() {
    return window.__dexDpad || null;
  }

  function isDpadOpen() {
    const dpad = getDpad();
    if (!dpad || typeof dpad.isDpadOpen !== 'function') return false;
    return !!dpad.isDpadOpen();
  }

  function clearPendingMenu() {
    if (selectionTimer !== null) {
      clearTimeout(selectionTimer);
      selectionTimer = null;
    }
    if (genericSelectionTimer !== null) {
      clearTimeout(genericSelectionTimer);
      genericSelectionTimer = null;
    }
  }

  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement('div');
    menu.id = 'dexNativeMenu';
    (document.body || document.documentElement).appendChild(menu);
    document.addEventListener('pointerdown', (e) => {
      if (menu && menu.classList.contains('open') && !menu.contains(e.target)) closeMenu();
    });
    return menu;
  }

  function closeMenu() {
    clearPendingMenu();
    menuSerial++;
    if (menu) menu.classList.remove('open');
    activeActions = null;
    activeSurface = null;
  }
  window.dexCloseNativeMenu = closeMenu;
  window.dexNativeMenuOpen = () => !!(menu && menu.classList.contains('open'));
  window.dexNativeMenuSurface = () => activeSurface;

  function closeDpadAction() {
    return {
      id: 'close-dpad',
      label: 'Close D-Pad',
      icon: 'x',
      danger: true,
      run: () => {
        const dpad = getDpad();
        if (dpad && typeof dpad.hideDpad === 'function') dpad.hideDpad();
        else if (typeof window.dexHideDpad === 'function') window.dexHideDpad();
      }
    };
  }

  function withGlobalActions(actions) {
    const input = Array.isArray(actions) ? actions : [];
    const result = input.filter((action, index) => {
      if (!action || action.id !== 'close-dpad') return true;
      return input.findIndex((candidate) => candidate && candidate.id === 'close-dpad') === index;
    });
    if (isDpadOpen() && !result.some((action) => action && action.id === 'close-dpad')) {
      while (result.length && result[result.length - 1] && result[result.length - 1].sep) result.pop();
      result.push({ sep: true });
      result.push(closeDpadAction());
    }
    return result;
  }

  function renderMenu(actions, rect, surface) {
    baseActions = Array.isArray(actions) ? actions.slice() : [];
    lastMenuRect = rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    const finalActions = withGlobalActions(baseActions);
    if (!finalActions.length) return false;

    const m = ensureMenu();
    activeActions = finalActions;
    activeSurface = surface || null;

    let html = '';
    finalActions.forEach((action, index) => {
      if (action.sep) {
        html += '<div class="dex-nm-sep"></div>';
        return;
      }
      html += '<button type="button" class="dex-nm-item' +
        (action.danger ? ' dex-nm-danger' : '') +
        '" data-nm-idx="' + index + '">' +
        '<delluna-icon name="' + (action.icon || '') + '"></delluna-icon>' +
        '<span>' + action.label + '</span></button>';
    });

    m.innerHTML = html;
    m.querySelectorAll('[data-nm-idx]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.nmIdx);
        const action = activeActions && activeActions[index];
        closeMenu();
        if (action && typeof action.run === 'function') action.run();
      });
    });

    m.style.visibility = 'hidden';
    m.classList.add('open');

    const mw = m.offsetWidth;
    const mh = m.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect ? rect.left : (vw - mw) / 2;
    let top = rect ? rect.bottom + 8 : (vh - mh) / 2;

    if (rect && top + mh > vh - 8) top = rect.top - mh - 8;
    left = Math.max(8, Math.min(Math.max(8, vw - mw - 8), left));
    top = Math.max(8, Math.min(Math.max(8, vh - mh - 8), top));

    m.style.left = left + 'px';
    m.style.top = top + 'px';
    m.style.visibility = '';
    return true;
  }

  // Single public selection-menu dispatcher. All selection surfaces enter here.
  window.dexRefreshNativeMenu = function () {
    if (!menu || !menu.classList.contains('open') || !baseActions) return false;
    return renderMenu(baseActions, lastMenuRect, activeSurface);
  };

  window.dexOpenSelectionMenu = function (actions, rect, surface) {
    clearPendingMenu();
    menuSerial++;
    return renderMenu(actions, rect, surface);
  };
  window.dexRenderNativeMenu = window.dexOpenSelectionMenu;

  function scheduleMenu(getActionsAndRect) {
    clearPendingMenu();
    if (menu && menu.classList.contains('open')) closeMenu();

    const serial = ++menuSerial;
    selectionTimer = setTimeout(() => {
      selectionTimer = null;
      if (serial !== menuSerial) return;
      const result = typeof getActionsAndRect === 'function' ? getActionsAndRect() : null;
      if (!result || !result.actions || !result.actions.length) return;
      window.dexOpenSelectionMenu(result.actions, result.rect, SURFACE_CODEMIRROR);
    }, MENU_DELAY_MS);
  }

  function getCodeMirror() {
    const ed = window.dexEditor;
    return ed && ed.cm ? ed.cm : null;
  }

  function selectionRect(cm, position) {
    const coords = cm.charCoords(position, 'window');
    return {
      left: coords.right,
      top: coords.top,
      bottom: coords.bottom
    };
  }

  function makeCopyAction(getText) {
    return {
      label: 'Copy',
      icon: 'copy',
      run: async () => {
        notify((await clipboardWrite(getText())) ? 'Copied' : 'Copy failed');
      }
    };
  }

  function makePasteAction(cm, range) {
    return {
      label: 'Paste',
      icon: 'paste',
      run: async () => {
        const text = await clipboardRead();
        if (text === undefined) { notify('Clipboard access denied'); return; }
        if (text === null) { notify('Clipboard unavailable'); return; }
        cm.operation(() => range
          ? cm.replaceRange(text, range.from, range.to)
          : cm.replaceRange(text, cm.getCursor('head'))
        );
        notify('Pasted');
      }
    };
  }

  function makeSelectAllAction(cm) {
    return {
      label: 'Select All',
      icon: 'selectAll',
      run: () => {
        const lastLine = cm.lineCount() - 1;
        cm.setSelection(
          { line: 0, ch: 0 },
          { line: lastLine, ch: cm.getLine(lastLine).length }
        );
      }
    };
  }

  function codeMirrorActions(cm, range) {
    return [
      makeCopyAction(() => range.text),
      {
        label: 'Cut',
        icon: 'content_cut',
        run: async () => {
          if (!(await clipboardWrite(range.text))) {
            notify('Cut failed');
            return;
          }
          cm.operation(() => cm.replaceRange('', range.from, range.to));
          notify('Cut');
        }
      },
      makePasteAction(cm, range),
      makeSelectAllAction(cm),
      {
        label: 'Delete',
        icon: 'delete',
        danger: true,
        run: () => {
          cm.operation(() => cm.replaceRange('', range.from, range.to));
          notify('Deleted');
        }
      }
    ];
  }

  function cursorActions(cm) {
    return [makePasteAction(cm, null), makeSelectAllAction(cm)];
  }

  function openForCurrentSelection() {
    const cm = getCodeMirror();
    if (!cm) {
      notify('Editor not ready');
      return false;
    }

    clearPendingMenu();
    menuSerial++;

    if (!cm.somethingSelected()) {
      const pos = cm.getCursor('head');
      return window.dexOpenSelectionMenu(cursorActions(cm), selectionRect(cm, pos), SURFACE_CODEMIRROR);
    }

    const range = {
      from: cm.getCursor('from'),
      to: cm.getCursor('to'),
      text: cm.getSelection()
    };
    return window.dexOpenSelectionMenu(
      codeMirrorActions(cm, range),
      selectionRect(cm, range.to),
      SURFACE_CODEMIRROR
    );
  }

  window.dexOpenMenuForSelection = openForCurrentSelection;


  function hookCodeMirror() {
    const cm = getCodeMirror();
    if (!cm) return false;
    if (hookCodeMirror._boundCm === cm) return true;

    const previous = hookCodeMirror._boundCm;
    if (previous && typeof previous.off === 'function' && previous.__dexNativeMenuHandler) {
      try { previous.off('cursorActivity', previous.__dexNativeMenuHandler); } catch (_e) {}
      previous.__dexNativeMenuHandler = null;
      previous.__dexNativeMenuHooked = false;
    }

    hookCodeMirror._boundCm = cm;
    // The previous handler is explicitly detached above. Do not use a stale
    // per-instance boolean to suppress reattachment when an editor instance
    // is later reused (A -> B -> A). This module owns exactly one handler on
    // the currently bound CodeMirror instance.

    const handler = () => {
      if (!cm.somethingSelected()) {
        closeMenu();
        return;
      }

      const findMenu = document.getElementById('find-replace-menu');
      if (findMenu && !findMenu.classList.contains('find-replace-hidden')) return;

      const dpad = getDpad();
      if (dpad && typeof dpad.isCenterDragging === 'function' && dpad.isCenterDragging()) return;
      if (dpad && typeof dpad.getCollapsedCenterDrag === 'function' && dpad.getCollapsedCenterDrag()) return;
      if (window.__dexSelHandleDragging) return;

      scheduleMenu(() => {
        if (!cm.somethingSelected()) return null;
        const currentFind = document.getElementById('find-replace-menu');
        if (currentFind && !currentFind.classList.contains('find-replace-hidden')) return null;
        const currentDpad = getDpad();
        if (currentDpad && typeof currentDpad.isCenterDragging === 'function' && currentDpad.isCenterDragging()) return null;
        if (window.__dexSelHandleDragging) return null;

        const range = {
          from: cm.getCursor('from'),
          to: cm.getCursor('to'),
          text: cm.getSelection()
        };
        if (!range.text) return null;
        return {
          actions: codeMirrorActions(cm, range),
          rect: selectionRect(cm, range.to)
        };
      });
    };

    const wrapper = typeof cm.getWrapperElement === 'function' ? cm.getWrapperElement() : null;
    if (wrapper) {
      // Disable the mobile callout without cancelling the browser's native
      // selectstart event. Cancelling selectstart breaks ordinary desktop
      // mouse selection inside CodeMirror.
      wrapper.style.webkitTouchCallout = 'none';
      const scroller = wrapper.querySelector('.CodeMirror-scroll');
      if (scroller) scroller.style.webkitTouchCallout = 'none';
    }

    cm.__dexNativeMenuHooked = true;
    cm.__dexNativeMenuHandler = handler;
    cm.on('cursorActivity', handler);
    return true;
  }

  function isFormField(element) {
    return !!(element && element.closest && element.closest('input, textarea, [contenteditable="true"], [contenteditable=""]'));
  }

  function isDedicatedSurface(element) {
    return !!(element && element.closest && element.closest('.CodeMirror, .diff-view, #dexNativeMenu'));
  }

  function hookGenericSelection() {
    document.addEventListener('selectionchange', () => {
      if (genericSelectionTimer !== null) {
        clearTimeout(genericSelectionTimer);
        genericSelectionTimer = null;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) return;

      const range = selection.getRangeAt(0);
      const element = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer;
      if (isFormField(element) || isDedicatedSurface(element)) return;

      const text = selection.toString();
      if (!text) return;
      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;

      // selectionchange fires repeatedly while a drag is in progress. Wait
      // until the selection settles, then recapture it so the menu represents
      // the final range rather than an intermediate drag state.
      genericSelectionTimer = setTimeout(() => {
        genericSelectionTimer = null;
        const current = window.getSelection();
        if (!current || current.isCollapsed || !current.rangeCount) return;
        const currentRange = current.getRangeAt(0);
        const currentElement = currentRange.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? currentRange.commonAncestorContainer.parentElement
          : currentRange.commonAncestorContainer;
        if (isFormField(currentElement) || isDedicatedSurface(currentElement)) return;
        const currentText = current.toString();
        if (!currentText) return;
        const currentRect = currentRange.getBoundingClientRect();
        if (!currentRect.width && !currentRect.height) return;
        window.dexOpenSelectionMenu(
          [makeCopyAction(() => currentText)],
          { left: currentRect.left, top: currentRect.top, bottom: currentRect.bottom },
          'generic'
        );
      }, MENU_DELAY_MS);
    });
  }

  function suppressBrowserContextMenu() {
    document.addEventListener('contextmenu', (e) => {
      if (isFormField(e.target)) return;
      if (isDedicatedSurface(e.target)) {
        e.preventDefault();
      }
    });
  }

  function init() {
    hookCodeMirror();
    hookGenericSelection();
    suppressBrowserContextMenu();
  }

  window.addEventListener('dexEditorReady', hookCodeMirror);
  window.addEventListener('popstate', closeMenu);
  window.addEventListener('hashchange', closeMenu);
  window.addEventListener('resize', () => {
    if (!menu || !menu.classList.contains('open')) return;
    const left = parseFloat(menu.style.left) || 8;
    const top = parseFloat(menu.style.top) || 8;
    const rect = { left, top, right: left, bottom: top };
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const maxLeft = Math.max(8, window.innerWidth - mw - 8);
    const maxTop = Math.max(8, window.innerHeight - mh - 8);
    menu.style.left = Math.max(8, Math.min(maxLeft, rect.left)) + 'px';
    menu.style.top = Math.max(8, Math.min(maxTop, rect.top)) + 'px';
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
