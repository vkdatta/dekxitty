(function () {
  if (window.__dexMenuLayoutLoaded) return;
  window.__dexMenuLayoutLoaded = true;

  function menuOpen() {
    const m = document.getElementById('dexNativeMenu');
    return !!(m && m.classList.contains('open'));
  }
  function openMenu(source) {
    if (typeof window.dexOpenMenuForSelection === 'function') {
      window.dexOpenMenuForSelection(source || 'toolbar');
    }
  }
  function closeMenu() {
    if (typeof window.dexCloseNativeMenu === 'function') window.dexCloseNativeMenu();
  }
  function toggleMenu() { menuOpen() ? closeMenu() : openMenu(); }

  window.dexMenuOpen      = menuOpen;
  window.dexOpenToolbar   = openMenu;
  window.dexCloseToolbar  = closeMenu;
  window.dexToggleToolbar = toggleMenu;
})();
