(function () {
  if (window.__menuFunctionsLoaded) return;
  window.__menuFunctionsLoaded = true;

  // ── Cursor-activity hook ──────────────────────────────────────────────────
  // Closes the native menu whenever the CodeMirror selection is cleared.
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
      if (!cm.somethingSelected()) {
        if (typeof window.dexCloseNativeMenu === 'function') {
          window.dexCloseNativeMenu('codemirror');
        }
      }
    };
    cm.on('cursorActivity', menuFnHandler);
    cm.__dexMenuFnHandler = menuFnHandler;
  }

  // ── Suppress native browser selection UI inside CodeMirror ────────────────
  // CodeMirror manages its own touch selection; let it win on mobile.
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
    attachCursorActivity();
    suppressNativeSelectionUI();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Close menu on page navigation
  const closeMenu = () => {
    if (typeof window.dexCloseNativeMenu === 'function') window.dexCloseNativeMenu();
  };
  window.addEventListener('popstate',   closeMenu);
  window.addEventListener('hashchange', closeMenu);
  window.addEventListener('dexEditorReady', attachCursorActivity);

  // Re-bind if the editor instance is replaced
  setInterval(() => {
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (cm && attachCursorActivity._boundCm !== cm) attachCursorActivity();
  }, 1000);
})();
