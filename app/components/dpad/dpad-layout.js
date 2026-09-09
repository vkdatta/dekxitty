if (window.__dexToolbar2Loaded) {
} else {
  window.__dexToolbar2Loaded = true;

  const ctx = (window.__dexDpad = window.__dexDpad || {});

  ctx.LS_KEY = 'dexToolbarPos';
  ctx.CURSOR_KEY = 'dexCursorPos';
  ctx.CENTER_KEY = 'dexCenterPos';
  ctx.TRIGGER_SIZE = 40;
  ctx.DRAG_THRESHOLD = 8;
  ctx.EDGE_MARGIN = 8;
  ctx.MENU_GAP = 12;
  ctx.DBL_TAP_WINDOW = 300;          
  ctx.INACTIVITY_TIMEOUT = 10000;    

  ctx.HOLD_START_DELAY = 350;
  ctx.HOLD_INITIAL_INTERVAL = 90;
  ctx.HOLD_MIN_INTERVAL = 20;
  ctx.HOLD_ACCEL_STEP = 4;

  ctx.ICONS = {
    down: 'expand_more', up: 'expand_less',
    left: 'chevron_left', right: 'chevron_right',
    copy: 'copy', paste: 'paste', cut: 'content_cut',
    delete: 'delete',
    close: 'x',
    close_fullscreen: 'close_fullscreen', 
    dbl_up: 'keyboard_double_arrow_up',
    dbl_down: 'keyboard_double_arrow_down',
    dbl_left: 'keyboard_double_arrow_left',
    dbl_right: 'keyboard_double_arrow_right',
    drag: 'drag_indicator',
    select_all: 'selectAll',
    chevron_right: 'chevron_right',
    back: 'arrow_back',
    swap: 'swap_horiz',
    save: 'save'
  };

  ctx.THEME = {
    matte: '#181C1F',
    accent: '#00D4AA',
    accentGlow: 'rgba(0, 212, 170, 0.35)',
    accentDim: 'rgba(0, 212, 170, 0.12)',
    text: '#E8ECF0'
  };
  const THEME = ctx.THEME;
  const ICONS = ctx.ICONS;

  const particleCanvas = document.createElement('canvas');
  particleCanvas.id = 'dexParticleCanvas';
  (document.body || document.documentElement).appendChild(particleCanvas);
  const pCtx = particleCanvas.getContext('2d');
  const particles = [];

  function resizeParticleCanvas() {
    const dpr = window.devicePixelRatio || 1;
    particleCanvas.width = window.innerWidth * dpr;
    particleCanvas.height = window.innerHeight * dpr;
    particleCanvas.style.width = window.innerWidth + 'px';
    particleCanvas.style.height = window.innerHeight + 'px';
    pCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeParticleCanvas();
  window.addEventListener('resize', resizeParticleCanvas);

  let particleLoopRunning = false;

  function spawnParticle(x, y, color) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2 - 1,
      life: 1,
      decay: 0.03 + Math.random() * 0.03,
      size: 2 + Math.random() * 3,
      color: color || THEME.accent
    });
    if (!particleLoopRunning) {
      particleLoopRunning = true;
      requestAnimationFrame(updateParticles);
    }
  }

  function updateParticles() {
    pCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      p.vy += 0.05;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      pCtx.globalAlpha = p.life * 0.6;
      pCtx.fillStyle = p.color;
      pCtx.beginPath();
      pCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      pCtx.fill();
    }
    pCtx.globalAlpha = 1;
    if (particles.length > 0) requestAnimationFrame(updateParticles);
    else particleLoopRunning = false;
  }

  ctx.spawnParticle = spawnParticle;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'dexToolbarBtn';
  btn.setAttribute('aria-label', 'Open editor toolbar');
  function icoSpan(name, id) { return '<delluna-icon name="' + name + '" ' + (id ? ' id="' + id + '"' : '') + '></delluna-icon>'; }

  btn.innerHTML = icoSpan(ICONS.down, 'dexToolbarBtnIcon');
  btn.style.display = 'none';
  (document.body || document.documentElement).appendChild(btn);
  ctx.btn = btn;
  const cursorControls = document.createElement('div');
  cursorControls.id = 'dexCursorControls';
  cursorControls.innerHTML =
    '<button type="button" class="dex-cursor-btn cmp-n"  id="dexCurUp"       aria-label="Up">'         + icoSpan(ICONS.up)        + '</button>' +
    '<button type="button" class="dex-cursor-btn cmp-ne" id="dexCurDblUp"    aria-label="Fast up">'    + icoSpan(ICONS.dbl_up)    + '</button>' +
    '<button type="button" class="dex-cursor-btn cmp-e"  id="dexCurRight"    aria-label="Right">'      + icoSpan(ICONS.right)     + '</button>' +
    '<button type="button" class="dex-cursor-btn cmp-se" id="dexCurDblRight" aria-label="Fast right">' + icoSpan(ICONS.dbl_right) + '</button>' +
    '<button type="button" class="dex-cursor-btn cmp-s"  id="dexCurDown"     aria-label="Down">'       + icoSpan(ICONS.down)      + '</button>' +
    '<button type="button" class="dex-cursor-btn cmp-sw" id="dexCurDblDown"  aria-label="Fast down">'  + icoSpan(ICONS.dbl_down)  + '</button>' +
    '<button type="button" class="dex-cursor-btn cmp-w"  id="dexCurLeft"     aria-label="Left">'       + icoSpan(ICONS.left)      + '</button>' +
    '<button type="button" class="dex-cursor-btn cmp-nw" id="dexCurDblLeft"  aria-label="Fast left">'  + icoSpan(ICONS.dbl_left)  + '</button>' +
    '<div class="dex-center-drag" id="dexCenterDrag" aria-label="Drag to select"></div>';
  (document.body || document.documentElement).appendChild(cursorControls);

  const centerHandle = document.getElementById('dexCenterDrag');
  ctx.cursorControls = cursorControls;
  ctx.centerHandle = centerHandle;

  const snapIndicator = document.createElement('div');
  snapIndicator.id = 'dexSnapIndicator';
  (document.body || document.documentElement).appendChild(snapIndicator);
  ctx.snapIndicator = snapIndicator;

  // Canonical parser for the "/note/<id>/<mode>" URL scheme — the single
  // source of truth other modules (settings, menu-layout) should read from
  // instead of re-deriving their own regex.
  function parseNoteRoute(pathname) {
    const m = /^\/note\/([^/]+)\/([a-z]+)/.exec(pathname || '');
    return m ? { id: m[1], mode: m[2] } : null;
  }
  ctx.parseNoteRoute = parseNoteRoute;
  window.dexParseNoteRoute = parseNoteRoute;

  function isHomepage() {
    const path = window.location.pathname;
    return path === '/' || path === '/index.html' || path === '/home' || path === '';
  }

  function shouldHideDpad() {
    if (isHomepage()) return true;
    const path = window.location.pathname;
    if (path === '/filemanager' || path.startsWith('/filemanager/')) return true;
    const sb1 = document.getElementById('sidebar1');
    if (sb1 && sb1.classList.contains('open')) return true;
    const sb2 = document.getElementById('secondary-sidebar');
    if (sb2 && sb2.classList.contains('open')) return true;
    return false;
  }

  function updateToolbarVisibility() {
    if (shouldHideDpad()) {
      hideDpad();
      cursorControls.style.display = 'none';
      if (typeof window.dexHideSelectionHandles === 'function') window.dexHideSelectionHandles();
      return;
    }
    cursorControls.style.display = 'flex';
  }
  ctx.isHomepage = isHomepage;
  ctx.shouldHideDpad = shouldHideDpad;
  ctx.updateToolbarVisibility = updateToolbarVisibility;
  window.addEventListener('popstate', updateToolbarVisibility);
  window.addEventListener('hashchange', updateToolbarVisibility);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateToolbarVisibility, { once: true });
  } else {
    updateToolbarVisibility();
  }

  (function watchSidebarVisibility() {
    function onSidebarChange() {
      updateToolbarVisibility();
      if (typeof window.dexCloseNativeMenu === 'function') window.dexCloseNativeMenu();
    }
    const attrMo = new MutationObserver(onSidebarChange);
    const attached = { sb1: false, sb2: false };
    function tryAttach() {
      if (!attached.sb1) {
        const sb1 = document.getElementById('sidebar1');
        if (sb1) { attrMo.observe(sb1, { attributes: true, attributeFilter: ['class'] }); attached.sb1 = true; }
      }
      if (!attached.sb2) {
        const sb2 = document.getElementById('secondary-sidebar');
        if (sb2) { attrMo.observe(sb2, { attributes: true, attributeFilter: ['class'] }); attached.sb2 = true; }
      }
    }
    tryAttach();
    if (!attached.sb1 || !attached.sb2) {
      const bodyMo = new MutationObserver(() => {
        tryAttach();
        if (attached.sb1 && attached.sb2) bodyMo.disconnect();
      });
      bodyMo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }
  })();

  function loadCursorPos() {
    try {
      const raw = localStorage.getItem(ctx.CURSOR_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p.left === 'number' && typeof p.top === 'number') return p;
    } catch (e) {}
    return null;
  }
  function saveCursorPos(left, top) {
    try { localStorage.setItem(ctx.CURSOR_KEY, JSON.stringify({ left, top })); } catch (e) {}
  }
  function clampCursor(left, top) {
    const cw = cursorControls.offsetWidth || 165;
    const ch = cursorControls.offsetHeight || 165;
    const maxLeft = window.innerWidth  - cw - ctx.EDGE_MARGIN;
    const maxTop  = window.innerHeight - ch - ctx.EDGE_MARGIN;
    return {
      left: Math.max(ctx.EDGE_MARGIN, Math.min(maxLeft, left)),
      top:  Math.max(ctx.EDGE_MARGIN, Math.min(maxTop,  top))
    };
  }
  function defaultCursorPos() {
    return clampCursor(
      window.innerWidth  - 185,
      Math.round(window.innerHeight * 0.5)
    );
  }
  function applyCursorPos(pos) {
    cursorControls.style.left = pos.left + 'px';
    cursorControls.style.top  = pos.top  + 'px';
  }
  function positionCursorControls() {
    const pos = loadCursorPos() || defaultCursorPos();
    applyCursorPos(clampCursor(pos.left, pos.top));
  }
  ctx.saveCursorPos = saveCursorPos;
  ctx.clampCursor = clampCursor;
  ctx.applyCursorPos = applyCursorPos;

  ctx.dpadState = 'collapsed';
  let inactivityTimer = null;
  let centerLastTap = 0;

  cursorControls.classList.add('dpad-collapsed');
  positionCursorControls();

  function clearInactivityTimer() {
    if (inactivityTimer) { clearTimeout(inactivityTimer); inactivityTimer = null; }
  }
  function resetInactivityTimer() {
    clearInactivityTimer();
    if (ctx.dpadState === 'expanded') {
      inactivityTimer = setTimeout(collapseDpad, ctx.INACTIVITY_TIMEOUT);
    }
  }

  const CENTER_SHIFT = 62.5;

  function collapseDpad() {
    if (ctx.dpadState === 'collapsed') return;
    ctx.dpadState = 'collapsed';
    const shifted = {
      left: cursorControls.offsetLeft + CENTER_SHIFT,
      top:  cursorControls.offsetTop  + CENTER_SHIFT
    };
    cursorControls.classList.add('dpad-collapsed');
    clearInactivityTimer();
    if (ctx.menuOpen && ctx.menuOpen()) ctx.closeMenu();
    if (ctx.clearSelectionAnchor) ctx.clearSelectionAnchor();
    const clamped = clampCursor(shifted.left, shifted.top);
    applyCursorPos(clamped);
    saveCursorPos(clamped.left, clamped.top);
  }

  function expandDpad() {
    if (ctx.dpadState === 'expanded') { resetInactivityTimer(); return; }
    ctx.dpadState = 'expanded';
    const shifted = {
      left: cursorControls.offsetLeft - CENTER_SHIFT,
      top:  cursorControls.offsetTop  - CENTER_SHIFT
    };
    cursorControls.classList.remove('dpad-collapsed');
    requestAnimationFrame(() => {
      const clamped = clampCursor(shifted.left, shifted.top);
      applyCursorPos(clamped);
      saveCursorPos(clamped.left, clamped.top);
    });
    resetInactivityTimer();
    if (typeof window.dexRefreshNativeMenu === 'function') window.dexRefreshNativeMenu();
  }

  function hideDpad() {
    if (ctx.menuOpen && ctx.menuOpen()) ctx.closeMenu();
    collapseDpad();
    cursorControls.style.display = 'none';
    if (typeof window.dexHideSelectionHandles === 'function') window.dexHideSelectionHandles();
  }
  function showDpad() {
    if (shouldHideDpad()) {
      hideDpad();
      return;
    }
    cursorControls.style.display = 'flex';
    if (ctx.dpadState !== 'expanded') {
      ctx.dpadState = 'collapsed';
      cursorControls.classList.add('dpad-collapsed');
    }
    const clamped = clampCursor(cursorControls.offsetLeft, cursorControls.offsetTop);
    applyCursorPos(clamped);
  }
  ctx.isDpadOpen = () => (ctx.dpadState === 'expanded' && cursorControls.style.display !== 'none' && !shouldHideDpad());

  ctx.collapseDpad = collapseDpad;
  ctx.expandDpad = expandDpad;
  ctx.hideDpad = hideDpad;
  ctx.showDpad = showDpad;
  ctx.resetInactivityTimer = resetInactivityTimer;
  ctx.clearInactivityTimer = clearInactivityTimer;

  window.dexHideDpad = hideDpad;
  window.dexShowDpad = showDpad;

  function handleCenterDoubleTap() {
    if (ctx.dpadState === 'collapsed') {
      expandDpad();
    } else if (ctx.menuOpen && ctx.openMenu && ctx.closeMenu) {
      ctx.menuOpen() ? ctx.closeMenu() : ctx.openMenu();
    }
  }

  function recordCenterTap() {
    const now = Date.now();
    if (now - centerLastTap < ctx.DBL_TAP_WINDOW) {
      centerLastTap = 0;
      handleCenterDoubleTap();
      return true;
    }
    centerLastTap = now;
    return false;
  }
  ctx.recordCenterTap = recordCenterTap;
  ctx.handleCenterDoubleTap = handleCenterDoubleTap;

  ctx.showToolMenu = function () { if (ctx.openMenu) ctx.openMenu(); };
  ctx.hideToolMenu = function () { if (ctx.closeMenu) ctx.closeMenu(); };
  ctx.toggleToolMenu = function () {
    if (ctx.toggleMenu) ctx.toggleMenu();
    else if (ctx.menuOpen && ctx.menuOpen()) ctx.closeMenu();
    else if (ctx.openMenu) ctx.openMenu();
  };

  let collapsedCenterDrag = null;
  let collapsedCenterTouchId = null;

  function startCollapsedCenterDrag(clientX, clientY) {
    collapsedCenterDrag = {
      startX: clientX,
      startY: clientY,
      startLeft: cursorControls.offsetLeft,
      startTop:  cursorControls.offsetTop,
      moved: false,
      pointerId: null
    };
  }
  function moveCollapsedCenterDrag(clientX, clientY) {
    if (!collapsedCenterDrag) return;
    const dx = clientX - collapsedCenterDrag.startX;
    const dy = clientY - collapsedCenterDrag.startY;
    if (!collapsedCenterDrag.moved && Math.hypot(dx, dy) < ctx.DRAG_THRESHOLD) return;
    collapsedCenterDrag.moved = true;
    const next = clampCursor(collapsedCenterDrag.startLeft + dx, collapsedCenterDrag.startTop + dy);
    applyCursorPos(next);
    centerHandle.classList.add('dragging');
  }
  function endCollapsedCenterDrag() {
    if (!collapsedCenterDrag) return false;
    const wasDrag = collapsedCenterDrag.moved;
    collapsedCenterDrag = null;
    centerHandle.classList.remove('dragging');
    if (wasDrag) saveCursorPos(cursorControls.offsetLeft, cursorControls.offsetTop);
    return !wasDrag; 
  }

  ctx.startCollapsedCenterDrag = startCollapsedCenterDrag;
  ctx.moveCollapsedCenterDrag = moveCollapsedCenterDrag;
  ctx.endCollapsedCenterDrag = endCollapsedCenterDrag;
  ctx.getCollapsedCenterDrag = () => collapsedCenterDrag;
  ctx.setCollapsedPointerId = (id) => { if (collapsedCenterDrag) collapsedCenterDrag.pointerId = id; };
  ctx.getCollapsedCenterTouchId = () => collapsedCenterTouchId;
  ctx.setCollapsedCenterTouchId = (id) => { collapsedCenterTouchId = id; };

  let cursorDrag = null;

  cursorControls.addEventListener('pointerdown', (e) => {
    if (ctx.dpadState !== 'expanded') return; 
    if (e.target.closest('.dex-cursor-btn')) return;
    if (e.target.closest('.dex-center-drag')) return;
    cursorDrag = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: cursorControls.offsetLeft,
      startTop:  cursorControls.offsetTop,
      moved: false
    };
    try { cursorControls.setPointerCapture(e.pointerId); } catch (_e) {}
  });

  cursorControls.addEventListener('pointermove', (e) => {
    if (!cursorDrag || e.pointerId !== cursorDrag.pointerId) return;
    const dx = e.clientX - cursorDrag.startX;
    const dy = e.clientY - cursorDrag.startY;
    if (!cursorDrag.moved && Math.hypot(dx, dy) < ctx.DRAG_THRESHOLD) return;
    if (!cursorDrag.moved) {
      cursorDrag.moved = true;
      cursorControls.classList.add('dragging');
    }
    const next = clampCursor(cursorDrag.startLeft + dx, cursorDrag.startTop + dy);
    applyCursorPos(next);
  });

  function endCursorDrag(e) {
    if (!cursorDrag || e.pointerId !== cursorDrag.pointerId) return;
    const wasDrag = cursorDrag.moved;
    try { cursorControls.releasePointerCapture(cursorDrag.pointerId); } catch (_e) {}
    cursorDrag = null;
    cursorControls.classList.remove('dragging');
    if (wasDrag) {
      saveCursorPos(cursorControls.offsetLeft, cursorControls.offsetTop);
    }
  }
  cursorControls.addEventListener('pointerup',     endCursorDrag);
  cursorControls.addEventListener('pointercancel', endCursorDrag);

  window.addEventListener('resize', () => {
    // FIX (bug #8): when find is open the soft keyboard firing a resize event
    // would shrink window.innerHeight and re-clamp the dpad to a new position.
    // Skip the re-clamp entirely while find is open — the dpad is collapsed
    // during find anyway (collapsed by find.js on open).
    const findMenu = document.getElementById('find-replace-menu');
    if (findMenu && !findMenu.classList.contains('find-replace-hidden')) return;
    const clamped = clampCursor(cursorControls.offsetLeft, cursorControls.offsetTop);
    applyCursorPos(clamped);
    saveCursorPos(clamped.left, clamped.top);
  });

  let selectionAnchor = null;
  let selectionAnchorEditor = null;
  ctx.getSelectionAnchor = () => selectionAnchor;
  ctx.setSelectionAnchor = (v, cm) => {
    selectionAnchor = v ? { line: v.line, ch: v.ch } : null;
    if (cm) selectionAnchorEditor = cm;
  };
  ctx.clearSelectionAnchor = () => {
    selectionAnchor = null;
    selectionAnchorEditor = null;
  };
  ctx.ensureAnchor = function (cm) {
    if (!cm) return null;
    if (selectionAnchor && selectionAnchorEditor === cm) {
      try {
        const maxLine = Math.max(0, cm.lineCount() - 1);
        const line = Math.max(0, Math.min(maxLine, selectionAnchor.line));
        const maxCh = cm.getLine(line).length;
        const ch = Math.max(0, Math.min(maxCh, selectionAnchor.ch));
        selectionAnchor = { line, ch };
        return selectionAnchor;
      } catch (_e) {
        selectionAnchor = null;
      }
    }
    selectionAnchorEditor = cm;
    selectionAnchor = cm.somethingSelected() ? cm.getCursor('anchor') : cm.getCursor('head');
    return selectionAnchor;
  };

  function setDragDirection(dir) {
    centerHandle.classList.remove('dragging-right', 'dragging-left', 'dragging-up', 'dragging-down');
    if (dir) centerHandle.classList.add('dragging-' + dir);
    if (dir && dir !== ctx._lastDragDir) {
      const rect = centerHandle.getBoundingClientRect();
      for (let i = 0; i < 5; i++) {
        spawnParticle(rect.left + rect.width / 2, rect.top + rect.height / 2, THEME.accent);
      }
      ctx._lastDragDir = dir;
    }
  }
  ctx.setDragDirection = setDragDirection;

  ctx.notify = function (m) {
    if (typeof window.showNotification === 'function') window.showNotification(m);
  };

  let savedSelection = null;
  ctx.getSavedSelection = () => savedSelection;
  ctx.setSavedSelection = (v) => { savedSelection = v; };
  ctx.clearSavedSelection = () => { savedSelection = null; };
}
