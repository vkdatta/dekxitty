(function () {
  const ctx = window.__dexDpad;
  if (!ctx || !ctx.cursorControls) {
    console.error('[menu-functions] dpad-layout.js must load first');
    return;
  }
  if (ctx.__menuFunctionsLoaded) return;
  ctx.__menuFunctionsLoaded = true;
  const { menuOpen, closeMenu, updateCenterHandle, updateSelectionPreview, updateToolbarVisibility } = ctx;
  function attachCursorActivity() {
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (!cm) { setTimeout(attachCursorActivity, 300); return; }
    const prevCm = attachCursorActivity._boundCm;
    if (prevCm && prevCm !== cm && typeof prevCm.off === 'function'
        && prevCm.__dexMenuFnHandler) {
      try { prevCm.off('cursorActivity', prevCm.__dexMenuFnHandler); } catch (_e) {}
      prevCm.__dexMenuFnHandler = null;
      prevCm.__dexCursorActivityBound = false;
    }
    attachCursorActivity._boundCm = cm;
    if (cm.__dexCursorActivityBound) return;
    cm.__dexCursorActivityBound = true;
    const menuFnHandler = () => {
      const hasSel = cm.somethingSelected();
      if (!hasSel) {
        if (menuOpen()) closeMenu('codemirror');
        ctx.setSelectionAnchor(cm.getCursor('head'));
        if (typeof ctx.hideSelectionPreview === 'function') {
          ctx.hideSelectionPreview();
        } else {
          updateSelectionPreview();
        }
        return;
      }
      const findMenu = document.getElementById('find-replace-menu');
      if (findMenu && !findMenu.classList.contains('find-replace-hidden')) return;
      const dpad = window.__dexDpad;
      if (dpad) {
        const collapsedDragging = typeof dpad.getCollapsedCenterDrag === 'function'
          && dpad.getCollapsedCenterDrag();
        const normalDragging = typeof dpad.isCenterDragging === 'function'
          && dpad.isCenterDragging();
        if (collapsedDragging || normalDragging) return;
      }
      updateCenterHandle();
      updateSelectionPreview();
    };
    cm.on('cursorActivity', menuFnHandler);
    cm.__dexMenuFnHandler = menuFnHandler;
  }
  function suppressNativeSelectionUI() {
    const attach = () => {
      const cmEl = document.querySelector('.CodeMirror');
      if (!cmEl) { setTimeout(attach, 200); return; }
      if (cmEl.__dexNoNativeUI) return;
      cmEl.__dexNoNativeUI = true;
      cmEl.style.webkitTouchCallout = 'none';
      const scroller = cmEl.querySelector('.CodeMirror-scroll');
      if (scroller) scroller.style.webkitTouchCallout = 'none';
      cmEl.addEventListener('contextmenu', (e) => e.preventDefault());
      cmEl.addEventListener('selectstart', (e) => e.preventDefault());
    };
    attach();
  }
  function init() {
    updateToolbarVisibility();
    attachCursorActivity();
    suppressNativeSelectionUI();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
  window.addEventListener('popstate',   updateToolbarVisibility);
  window.addEventListener('hashchange', updateToolbarVisibility);
  window.addEventListener('dexEditorReady', attachCursorActivity);
  setInterval(() => {
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (cm && attachCursorActivity._boundCm !== cm) attachCursorActivity();
  }, 1000);
})();
