(function () {
  if (window.__dexSelHandlesLoaded) return;
  window.__dexSelHandlesLoaded = true;

  const LONG_PRESS_MS = 450;
  const MOVE_CANCEL_PX = 14;
  const DBL_TAP_MS = 360;
  const DBL_TAP_DISTANCE = 30;

  let handleStart = null;
  let handleEnd = null;
  let handleEditor = null;
  let handleRafId = null;
  let dragging = null;
  let dragPointerId = null;
  let dragFixedPoint = null;

  let pressTimer = null;
  let pressStart = null;
  let suppressNextPointerUp = false;
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let lastPointerType = '';
  let lastDoubleHandledAt = 0;

  // Shared guard: native-menu must not race mobile double-tap/long-press.
  window.__dexTouchSelectionGesture = false;

  function isTouchLike(e) {
    return e.pointerType === 'touch' || e.pointerType === 'pen';
  }

  function getCm() {
    const ed = window.dexEditor;
    return ed && ed.cm ? ed.cm : null;
  }

  function hideHandles() {
    if (handleRafId !== null) {
      cancelAnimationFrame(handleRafId);
      handleRafId = null;
    }
    if (handleStart) handleStart.style.display = 'none';
    if (handleEnd) handleEnd.style.display = 'none';
  }
  window.dexHideSelectionHandles = hideHandles;

  function ensureHandles(cm) {
    if (handleStart && handleEditor === cm) return;

    if (handleStart) {
      handleStart.remove();
      handleEnd.remove();
    }

    const host = document.body || document.documentElement;
    if (!host) return;

    handleEditor = cm;
    handleStart = document.createElement('div');
    handleStart.className = 'dex-sel-handle dex-sel-handle-start';
    handleEnd = document.createElement('div');
    handleEnd.className = 'dex-sel-handle dex-sel-handle-end';
    host.appendChild(handleStart);
    host.appendChild(handleEnd);

    [[handleStart, 'from'], [handleEnd, 'to']].forEach(([el, which]) => {
      el.addEventListener('pointerdown', (e) => {
        if (!isTouchLike(e)) return;
        e.preventDefault();
        e.stopPropagation();
        try { el.setPointerCapture(e.pointerId); } catch (_e) {}
        beginHandleDrag(which, e.pointerId);
      }, { passive: false });
    });
  }

  function editorRect(cm) {
    try {
      const wrapper = cm.getWrapperElement();
      return wrapper ? wrapper.getBoundingClientRect() : null;
    } catch (_e) {
      return null;
    }
  }

  function placeHandle(el, coords, rect, edge) {
    if (!rect) {
      el.style.display = 'none';
      return;
    }

    const stemHeight = Math.max(4, coords.bottom - coords.top);
    const handleHeight = stemHeight + 22;
    // Start handle belongs to the left edge of the selected range; end handle
    // belongs to the right edge. At editor boundaries clamp the visual handle
    // into the editor instead of hiding it.
    const rawX = edge === 'end' ? coords.right : coords.left;
    const rawY = coords.top;
    const halfWidth = Math.max(1, (el.offsetWidth || 32) / 2);
    const clampedX = Math.max(rect.left + halfWidth, Math.min(rect.right - halfWidth, rawX));
    const clampedY = Math.max(rect.top, Math.min(rect.bottom - handleHeight, rawY));

    if (clampedX < rect.left || clampedX > rect.right || clampedY < rect.top || clampedY > rect.bottom) {
      el.style.display = 'none';
      return;
    }

    el.style.left = clampedX + 'px';
    el.style.top = clampedY + 'px';
    el.style.setProperty('--dex-sel-stem-h', stemHeight + 'px');
    el.style.display = 'block';
  }

  function positionHandles() {
    const cm = getCm();
    if (!cm || !cm.somethingSelected()) {
      hideHandles();
      return;
    }

    const findMenu = document.getElementById('find-replace-menu');
    if (findMenu && !findMenu.classList.contains('find-replace-hidden')) {
      hideHandles();
      return;
    }

    ensureHandles(cm);
    const rect = editorRect(cm);
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      hideHandles();
      return;
    }

    try {
      const from = cm.getCursor('from');
      const to = cm.getCursor('to');
      placeHandle(handleStart, cm.charCoords(from, 'window'), rect, 'start');
      placeHandle(handleEnd, cm.charCoords(to, 'window'), rect, 'end');
    } catch (_e) {
      hideHandles();
    }
  }

  function scheduleHandles() {
    if (handleRafId !== null) return;
    handleRafId = requestAnimationFrame(() => {
      handleRafId = null;
      positionHandles();
    });
  }

  function beginHandleDrag(which, pointerId) {
    const cm = getCm();
    if (!cm || !cm.somethingSelected()) return;
    dragging = which;
    dragPointerId = pointerId;
    dragFixedPoint = which === 'from' ? cm.getCursor('to') : cm.getCursor('from');
    window.__dexSelHandleDragging = true;
  }

  function onHandleDragMove(e) {
    if (!dragging || e.pointerId !== dragPointerId) return;
    e.preventDefault();

    const cm = getCm();
    if (!cm) return;

    const rect = editorRect(cm);
    if (!rect) return;

    const handle = dragging === 'from' ? handleStart : handleEnd;
    const halfWidth = Math.max(1, (handle && handle.offsetWidth || 32) / 2);
    const x = Math.max(rect.left + halfWidth, Math.min(rect.right - halfWidth, e.clientX));
    const y = Math.max(rect.top, Math.min(rect.bottom, e.clientY));

    try {
      const pos = cm.coordsChar({ left: x, top: y }, 'window');
      cm.setSelection(dragFixedPoint, pos);
      positionHandles();
    } catch (_e) {}
  }

  function endHandleDrag(e) {
    if (!dragging || e.pointerId !== dragPointerId) return;

    dragging = null;
    dragPointerId = null;
    dragFixedPoint = null;
    window.__dexSelHandleDragging = false;

    const cm = getCm();
    if (cm && cm.somethingSelected()) {
      openSelectionMenu();
    }
  }

  document.addEventListener('pointermove', onHandleDragMove, { passive: false });
  document.addEventListener('pointerup', endHandleDrag, { passive: false });
  document.addEventListener('pointercancel', endHandleDrag, { passive: false });
  document.addEventListener('pointerup', (e) => {
    if (pressStart && e.pointerId === pressStart.id) cancelPress();
    suppressNextPointerUp = false;
  }, { passive: true });
  document.addEventListener('pointercancel', (e) => {
    if (pressStart && e.pointerId === pressStart.id) cancelPress();
    suppressNextPointerUp = false;
  }, { passive: true });

  function cancelPress() {
    if (pressTimer !== null) clearTimeout(pressTimer);
    pressTimer = null;
    pressStart = null;
  }

  function samePos(a, b) {
    return a.line === b.line && a.ch === b.ch;
  }

  function openSelectionMenu() {
    if (typeof window.dexRequestCurrentSelectionMenu === 'function') {
      return window.dexRequestCurrentSelectionMenu();
    }
    if (typeof window.dexOpenMenuForSelection === 'function') return window.dexOpenMenuForSelection();
    return false;
  }

  function firePress(clientX, clientY) {
    const cm = getCm();
    if (!cm) return;

    let pos;
    try {
      pos = cm.coordsChar({ left: clientX, top: clientY }, 'window');
    } catch (_e) {
      return;
    }

    const word = cm.findWordAt(pos);
    cm.focus();

    if (samePos(word.anchor, word.head)) {
      cm.setCursor(pos);
    } else {
      cm.setSelection(word.anchor, word.head);
      scheduleHandles();
    }

    suppressNextPointerUp = true;
    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (_e) {}
    }
    openSelectionMenu();
  }

  function fireDblTap(clientX, clientY) {
    const cm = getCm();
    if (!cm) return;
    lastDoubleHandledAt = Date.now();

    let pos;
    try {
      pos = cm.coordsChar({ left: clientX, top: clientY }, 'window');
    } catch (_e) {
      return;
    }

    const word = cm.findWordAt(pos);
    cm.focus();
    if (samePos(word.anchor, word.head)) cm.setCursor(pos);
    else cm.setSelection(word.anchor, word.head);

    scheduleHandles();
    if (navigator.vibrate) {
      try { navigator.vibrate(10); } catch (_e) {}
    }
    openSelectionMenu();
  }

  let gestureWrapper = null;
  let gestureHandlers = null;

  function detachGestureHandling() {
    if (!gestureWrapper || !gestureHandlers) return;
    gestureWrapper.removeEventListener('pointerdown', gestureHandlers.down);
    gestureWrapper.removeEventListener('pointermove', gestureHandlers.move);
    gestureWrapper.removeEventListener('pointerup', gestureHandlers.up, true);
    gestureWrapper.removeEventListener('pointercancel', gestureHandlers.cancel);
    gestureWrapper.removeEventListener('dblclick', gestureHandlers.dblclick, true);
    gestureWrapper = null;
    gestureHandlers = null;
    cancelPress();
  }

  function attachGestureHandling(cm) {
    const wrapper = cm && cm.getWrapperElement ? cm.getWrapperElement() : null;
    if (!wrapper) return false;
    if (gestureWrapper === wrapper) return true;

    detachGestureHandling();
    gestureWrapper = wrapper;

    const down = (e) => {
      if (e.isPrimary === false) return;
      if (!isTouchLike(e)) {
        lastPointerType = e.pointerType || 'mouse';
        return;
      }

      window.__dexTouchSelectionGesture = true;
      lastPointerType = e.pointerType || 'touch';
      const now = Date.now();
      const nearSameSpot = Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < DBL_TAP_DISTANCE;
      if (nearSameSpot && now - lastTapTime < DBL_TAP_MS) {
        lastTapTime = 0;
        cancelPress();
        e.preventDefault();
        e.stopPropagation();
        fireDblTap(e.clientX, e.clientY);
        window.__dexTouchSelectionGesture = false;
        return;
      }

      lastTapTime = now;
      lastTapX = e.clientX;
      lastTapY = e.clientY;
      cancelPress();
      pressStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
      pressTimer = setTimeout(() => {
        if (!pressStart || pressStart.id !== e.pointerId) return;
        const point = { x: pressStart.x, y: pressStart.y };
        pressTimer = null;
        lastTapTime = 0;
        firePress(point.x, point.y);
        window.__dexTouchSelectionGesture = false;
      }, LONG_PRESS_MS);
    };

    const move = (e) => {
      if (!pressStart || e.pointerId !== pressStart.id) return;
      if (Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > MOVE_CANCEL_PX) {
        cancelPress();
      }
    };

    const up = (e) => {
      if (!pressStart || e.pointerId !== pressStart.id) return;
      cancelPress();
      window.__dexTouchSelectionGesture = false;
      if (suppressNextPointerUp) {
        suppressNextPointerUp = false;
        e.preventDefault();
        e.stopPropagation();
      }
      lastPointerType = e.pointerType || lastPointerType;
    };

    const cancel = (e) => {
      if (pressStart && e.pointerId === pressStart.id) cancelPress();
      window.__dexTouchSelectionGesture = false;
      suppressNextPointerUp = false;
    };

    const dblclick = (e) => {
      // Desktop mouse fallback. Touch/pen uses the pointer state machine above
      // so a browser-synthesized dblclick cannot trigger a second menu.
      if (e.detail !== 2 || lastPointerType === 'touch' || lastPointerType === 'pen') return;
      if (Date.now() - lastDoubleHandledAt < 600) return;
      e.preventDefault();
      e.stopPropagation();
      fireDblTap(e.clientX, e.clientY);
    };

    gestureHandlers = { down, move, up, cancel, dblclick };
    wrapper.addEventListener('pointerdown', down, { passive: false, capture: true });
    wrapper.addEventListener('pointermove', move, { passive: true });
    wrapper.addEventListener('pointerup', up, { passive: false, capture: true });
    wrapper.addEventListener('pointercancel', cancel, { passive: true });
    wrapper.addEventListener('dblclick', dblclick, { passive: false, capture: true });
    return true;
  }

  let syncedCm = null;
  function attachCursorSync(cm) {
    if (!cm || syncedCm === cm) return;

    if (syncedCm && typeof syncedCm.off === 'function') {
      try {
        if (syncedCm.__dexSelHandleActivity) syncedCm.off('cursorActivity', syncedCm.__dexSelHandleActivity);
        if (syncedCm.__dexSelHandleScroll) syncedCm.off('scroll', syncedCm.__dexSelHandleScroll);
      } catch (_e) {}
      if (window.__dexDpad && typeof window.__dexDpad.clearSelectionAnchor === 'function') {
        window.__dexDpad.clearSelectionAnchor();
      }
    }

    syncedCm = cm;
    const activity = () => {
      if (!cm.somethingSelected() && window.__dexDpad && typeof window.__dexDpad.clearSelectionAnchor === 'function') {
        window.__dexDpad.clearSelectionAnchor();
      }
      scheduleHandles();
    };
    const scroll = () => scheduleHandles();
    cm.__dexSelHandleActivity = activity;
    cm.__dexSelHandleScroll = scroll;
    cm.on('cursorActivity', activity);
    cm.on('scroll', scroll);

    attachGestureHandling(cm);
    scheduleHandles();
  }

  function attachToEditor() {
    const cm = getCm();
    if (!cm) return false;
    attachCursorSync(cm);
    return true;
  }

  window.addEventListener('dexEditorReady', attachToEditor);
  window.addEventListener('resize', scheduleHandles);
  window.addEventListener('scroll', scheduleHandles, { passive: true });
  window.addEventListener('popstate', hideHandles);
  window.addEventListener('hashchange', hideHandles);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachToEditor, { once: true });
  } else {
    attachToEditor();
  }
})();
