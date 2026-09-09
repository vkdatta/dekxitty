(function () {
  const ctx = window.__dexDpad;
  if (!ctx || !ctx.cursorControls) {
    console.error('[menu-layout] dpad-layout.js must load first');
    return;
  }
  if (ctx.__menuLayoutLoaded) return;
  ctx.__menuLayoutLoaded = true;

  // Issue 6: the dpad no longer builds or owns its own menu. "native menu"
  // (main/native-menu.js, #dexNativeMenu) is now the single, superior menu
  // for the whole site — reachable either by a real text selection or by the
  // dpad's center-handle double-tap. These ctx hooks are what the rest of
  // the dpad module (dpad-layout.js's showToolMenu/hideToolMenu/toggleToolMenu,
  // handleCenterDoubleTap, collapseDpad, updateToolbarVisibility) already
  // calls, so no other file needs to change to pick up native-menu instead
  // of the old #dexToolbarMenu.

  function menuOpen() {
    const m = document.getElementById('dexNativeMenu');
    return !!(m && m.classList.contains('open'));
  }
  ctx.menuOpen = menuOpen;

  function openMenu() {
    if (typeof window.dexOpenMenuForSelection === 'function') {
      window.dexOpenMenuForSelection('dpad');
    }
  }
  function closeMenu() {
    if (typeof window.dexCloseNativeMenu === 'function') window.dexCloseNativeMenu();
  }
  function toggleMenu() { menuOpen() ? closeMenu() : openMenu(); }

  ctx.openMenu = openMenu;
  ctx.closeMenu = closeMenu;
  ctx.toggleMenu = toggleMenu;

  window.dexOpenToolbar   = openMenu;
  window.dexCloseToolbar  = closeMenu;
  window.dexToggleToolbar = toggleMenu;
})();
