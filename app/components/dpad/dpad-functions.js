(function () {
  const ctx = window.__dexDpad;
  if (!ctx || !ctx.cursorControls) {
    console.error('[dpad-functions] dpad-layout.js must load first');
    return;
  }
  if (ctx.__functionsLoaded) return;
  ctx.__functionsLoaded = true;

  const {
    centerHandle, snapIndicator, THEME,
    HOLD_START_DELAY, HOLD_INITIAL_INTERVAL, HOLD_MIN_INTERVAL, HOLD_ACCEL_STEP,
    spawnParticle, ensureAnchor, resetInactivityTimer,
    updateCenterHandle, updateSelectionPreview, setDragDirection, recordCenterTap
  } = ctx;

  const curUp       = document.getElementById('dexCurUp');
  const curDown     = document.getElementById('dexCurDown');
  const curLeft     = document.getElementById('dexCurLeft');
  const curRight    = document.getElementById('dexCurRight');
  const curDblUp    = document.getElementById('dexCurDblUp');
  const curDblDown  = document.getElementById('dexCurDblDown');
  const curDblLeft  = document.getElementById('dexCurDblLeft');
  const curDblRight = document.getElementById('dexCurDblRight');

  function moveCursor(dir, multiplier) {
    resetInactivityTimer();
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (!cm) return;

    const anchor = ensureAnchor(cm);
    const isVertical = (dir === 'up' || dir === 'down');
    const amount = (dir === 'up' || dir === 'left') ? -multiplier : multiplier;

    let head = cm.getCursor('head');
    head = isVertical
      ? cm.findPosV(head, amount, 'line')
      : cm.findPosH(head, amount, 'char');
    cm.setSelection(anchor, head);
    updateCenterHandle();
    updateSelectionPreview();
  }
  ctx.moveCursor = moveCursor;

  function attachHoldRepeat(el, dir, multiplier) {
    if (!el) return;
    let holdState = null;

    function stopHold() {
      if (!holdState) return;
      clearTimeout(holdState.startTimer);
      clearInterval(holdState.intervalId);
      try { el.releasePointerCapture(holdState.pointerId); } catch (_e) {}
      el.classList.remove('holding');
      const wasRepeating = holdState.repeating;
      holdState = null;
      if (wasRepeating) {
        el.__dexSuppressNextClick = true;
        setTimeout(() => { el.__dexSuppressNextClick = false; }, 300);
      }
    }

    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (holdState) stopHold();

      holdState = {
        pointerId: e.pointerId,
        repeating: false,
        interval: HOLD_INITIAL_INTERVAL,
        startTimer: null,
        intervalId: null
      };

      try { el.setPointerCapture(e.pointerId); } catch (_e) {}
      el.classList.add('holding');

      holdState.startTimer = setTimeout(() => {
        if (!holdState) return;
        holdState.repeating = true;
        moveCursor(dir, multiplier);
        const tick = () => {
          if (!holdState) return;
          moveCursor(dir, multiplier);
          const nextInterval = Math.max(HOLD_MIN_INTERVAL, holdState.interval - HOLD_ACCEL_STEP);
          if (nextInterval !== holdState.interval) {
            holdState.interval = nextInterval;
            clearInterval(holdState.intervalId);
            holdState.intervalId = setInterval(tick, holdState.interval);
          }
        };
        holdState.intervalId = setInterval(tick, holdState.interval);
      }, HOLD_START_DELAY);
    });

    el.addEventListener('pointerup',     (e) => { if (holdState && e.pointerId === holdState.pointerId) stopHold(); });
    el.addEventListener('pointercancel', (e) => { if (holdState && e.pointerId === holdState.pointerId) stopHold(); });
    el.addEventListener('pointerleave',  (e) => { if (holdState && e.pointerId === holdState.pointerId) stopHold(); });

    el.addEventListener('click', (e) => {
      if (el.__dexSuppressNextClick) {
        el.__dexSuppressNextClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      moveCursor(dir, multiplier);
    });
  }
  ctx.attachHoldRepeat = attachHoldRepeat;

  attachHoldRepeat(curUp,    'up',    1);
  attachHoldRepeat(curDown,  'down',  1);
  attachHoldRepeat(curLeft,  'left',  1);
  attachHoldRepeat(curRight, 'right', 1);
  attachHoldRepeat(curDblUp,    'up',    10);
  attachHoldRepeat(curDblDown,  'down',  10);
  attachHoldRepeat(curDblLeft,  'left',  10);
  attachHoldRepeat(curDblRight, 'right', 10);

  const JOY_DEAD_ZONE = 15;
  const JOY_MAX_DIST  = 80;
  const JOY_MIN_INTERVAL = 20;
  const JOY_MAX_INTERVAL = 90;

  let centerDrag = null;

  function startCenterDrag(clientX, clientY, pointerId) {
    resetInactivityTimer();
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (!cm) return false;

    if (cm.getSelection()) ctx.setSelectionAnchor(cm.getCursor('anchor'));
    else ensureAnchor(cm);
    ctx._lastDragDir = null;

    centerDrag = {
      pointerId,
      startX: clientX, startY: clientY,
      curX:   clientX, curY:   clientY,
      moved: false,
      tickId: null
    };
    centerHandle.classList.add('dragging');

    for (let i = 0; i < 8; i++) spawnParticle(clientX, clientY, THEME.accent);

    startJoystickLoop();
    return true;
  }

  function startJoystickLoop() {
    if (!centerDrag) return;
    if (centerDrag.tickId) clearTimeout(centerDrag.tickId);

    const tick = () => {
      if (!centerDrag) return;
      const dx = centerDrag.curX - centerDrag.startX;
      const dy = centerDrag.curY - centerDrag.startY;
      const dist = Math.hypot(dx, dy);

      if (dist < JOY_DEAD_ZONE) {
        setDragDirection(null);
        centerDrag.tickId = setTimeout(tick, JOY_MAX_INTERVAL);
        return;
      }

      const absDx = Math.abs(dx), absDy = Math.abs(dy);
      const dir = absDx > absDy ? (dx > 0 ? 'right' : 'left')
                                : (dy > 0 ? 'down'  : 'up');
      setDragDirection(dir);

      const ed = window.dexEditor;
      const cm = ed && ed.cm ? ed.cm : null;
      if (cm) {
        const anchor = ensureAnchor(cm);
        let head = cm.getCursor('head');
        if (dir === 'up' || dir === 'down') head = cm.findPosV(head, dir === 'up' ? -1 : 1, 'line');
        else                                head = cm.findPosH(head, dir === 'left' ? -1 : 1, 'char');
        cm.setSelection(anchor, head);
        centerDrag.moved = true;
        updateCenterHandle();
        updateSelectionPreview();

        try {
          const c = cm.charCoords(head, 'window');
          snapIndicator.style.left = (c.left - 2) + 'px';
          snapIndicator.style.top  = (c.top + c.bottom) / 2 - 2 + 'px';
          snapIndicator.classList.add('visible');
        } catch (_e) {}

        if (Math.random() > 0.7) spawnParticle(centerDrag.curX, centerDrag.curY, THEME.accentDim);
      }

      const t = Math.min(1, (dist - JOY_DEAD_ZONE) / (JOY_MAX_DIST - JOY_DEAD_ZONE));
      const interval = JOY_MAX_INTERVAL - t * (JOY_MAX_INTERVAL - JOY_MIN_INTERVAL);
      centerDrag.tickId = setTimeout(tick, interval);
    };
    centerDrag.tickId = setTimeout(tick, JOY_MAX_INTERVAL);
  }

  function moveCenterDrag(clientX, clientY) {
    if (!centerDrag) return;
    centerDrag.curX = clientX;
    centerDrag.curY = clientY;
  }

  function finishCenterDrag() {
    if (!centerDrag) return;
    if (centerDrag.tickId) clearTimeout(centerDrag.tickId);
    centerDrag = null;
    centerHandle.classList.remove('dragging');
    setDragDirection(null);
    snapIndicator.classList.remove('visible');
  }

  function afterCenterDrag(wasDrag) {
    if (!wasDrag) return;
    const ed = window.dexEditor;
    const cm = ed && ed.cm ? ed.cm : null;
    if (!cm) return;
    const finalSel = cm.getSelection();
    if (finalSel && finalSel.length > 0) {
      ctx.setSavedSelection({
        from: cm.getCursor('from'),
        to:   cm.getCursor('to'),
        text: finalSel
      });
      const rect = centerHandle.getBoundingClientRect();
      for (let i = 0; i < 12; i++) {
        spawnParticle(
          rect.left + rect.width / 2 + (Math.random() - 0.5) * 30,
          rect.top  + rect.height / 2 + (Math.random() - 0.5) * 30,
          THEME.accent
        );
      }
    }
  }

  let centerTouchId = null;

  centerHandle.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();

    if (ctx.dpadState === 'collapsed') {
      if (ctx.getCollapsedCenterDrag()) return;
      ctx.setCollapsedCenterTouchId(t.identifier);
      ctx.startCollapsedCenterDrag(t.clientX, t.clientY);
      return;
    }

    if (centerDrag) return;
    if (!startCenterDrag(t.clientX, t.clientY, t.identifier)) return;
    centerTouchId = t.identifier;
  }, { passive: false, capture: true });

  centerHandle.addEventListener('touchmove', (e) => {
    if (ctx.dpadState === 'collapsed') {
      const cId = ctx.getCollapsedCenterTouchId();
      if (cId === null) return;
      let t = null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === cId) { t = e.changedTouches[i]; break; }
      }
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      ctx.moveCollapsedCenterDrag(t.clientX, t.clientY);
      return;
    }
    if (!centerDrag || centerTouchId === null) return;
    let t = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === centerTouchId) { t = e.changedTouches[i]; break; }
    }
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    moveCenterDrag(t.clientX, t.clientY);
  }, { passive: false, capture: true });

  document.addEventListener('touchmove', (e) => {
    if (ctx.dpadState === 'collapsed') {
      const cDrag = ctx.getCollapsedCenterDrag();
      const cId = ctx.getCollapsedCenterTouchId();
      if (!cDrag || cId === null) return;
      let t = null;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === cId) { t = e.changedTouches[i]; break; }
      }
      if (!t) return;
      e.preventDefault();
      ctx.moveCollapsedCenterDrag(t.clientX, t.clientY);
      return;
    }
    if (!centerDrag || centerTouchId === null) return;
    let t = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === centerTouchId) { t = e.changedTouches[i]; break; }
    }
    if (!t) return;
    e.preventDefault();
    moveCenterDrag(t.clientX, t.clientY);
  }, { passive: false, capture: true });

  function endCenterTouch(e) {
    if (ctx.dpadState === 'collapsed') {
      const cId = ctx.getCollapsedCenterTouchId();
      if (cId === null) return;
      let matched = false;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === cId) { matched = true; break; }
      }
      if (!matched) return;
      e.preventDefault();
      const wasTap = ctx.endCollapsedCenterDrag();
      ctx.setCollapsedCenterTouchId(null);
      if (wasTap) recordCenterTap();
      return;
    }
    if (!centerDrag || centerTouchId === null) return;
    let matched = false;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === centerTouchId) { matched = true; break; }
    }
    if (!matched) return;
    e.preventDefault();
    const wasDrag = centerDrag ? centerDrag.moved : false;
    finishCenterDrag();
    centerTouchId = null;
    afterCenterDrag(wasDrag);
    if (!wasDrag) recordCenterTap();
  }
  centerHandle.addEventListener('touchend',    endCenterTouch, { passive: false, capture: true });
  centerHandle.addEventListener('touchcancel', endCenterTouch, { passive: false, capture: true });
  document.addEventListener('touchend',        endCenterTouch, { passive: false, capture: true });
  document.addEventListener('touchcancel',     endCenterTouch, { passive: false, capture: true });

  centerHandle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    e.preventDefault();
    e.stopPropagation();

    if (ctx.dpadState === 'collapsed') {
      if (ctx.getCollapsedCenterDrag()) return;
      ctx.startCollapsedCenterDrag(e.clientX, e.clientY);
      ctx.setCollapsedPointerId(e.pointerId);
      try { centerHandle.setPointerCapture(e.pointerId); } catch (_e) {}
      return;
    }

    if (centerDrag) return;
    if (!startCenterDrag(e.clientX, e.clientY, e.pointerId)) return;
    try { centerHandle.setPointerCapture(e.pointerId); } catch (_e) {}
  });

  centerHandle.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;

    if (ctx.dpadState === 'collapsed') {
      const cDrag = ctx.getCollapsedCenterDrag();
      if (!cDrag || cDrag.pointerId !== e.pointerId) return;
      ctx.moveCollapsedCenterDrag(e.clientX, e.clientY);
      return;
    }

    if (!centerDrag) return;
    if (e.pointerId !== centerDrag.pointerId) return;
    moveCenterDrag(e.clientX, e.clientY);
  });

  function endCenterDrag(e) {
    if (e.pointerType === 'touch') return;

    if (ctx.dpadState === 'collapsed') {
      const cDrag = ctx.getCollapsedCenterDrag();
      if (!cDrag || cDrag.pointerId !== e.pointerId) return;
      try { centerHandle.releasePointerCapture(e.pointerId); } catch (_e) {}
      const wasTap = ctx.endCollapsedCenterDrag();
      if (wasTap) recordCenterTap();
      return;
    }

    if (!centerDrag) return;
    if (e.pointerId !== centerDrag.pointerId) return;
    try { centerHandle.releasePointerCapture(centerDrag.pointerId); } catch (_e) {}
    if (centerDrag.tickId) clearTimeout(centerDrag.tickId);
    const wasDrag = centerDrag.moved;
    centerDrag = null;
    centerHandle.classList.remove('dragging');
    setDragDirection(null);
    snapIndicator.classList.remove('visible');
    afterCenterDrag(wasDrag);
    if (!wasDrag) recordCenterTap();
  }

  centerHandle.addEventListener('pointerup',     endCenterDrag);
  centerHandle.addEventListener('pointercancel', endCenterDrag);

  ctx.startCenterDrag = startCenterDrag;
  ctx.moveCenterDrag = moveCenterDrag;
  ctx.finishCenterDrag = finishCenterDrag;
  ctx.afterCenterDrag = afterCenterDrag;

  // FIX (bug #7 / Scenario C): expose the normal (expanded) center-drag active
  // flag so that native-menu.js and menu-functions.js can guard against
  // scheduling menu timers or updating D-pad UI while the joystick is dragging.
  // Previously only getCollapsedCenterDrag() was exposed, leaving the normal
  // drag invisible to all external guards — causing the native menu to appear
  // 1 second after a joystick selection began.
  ctx.isCenterDragging = function () { return centerDrag !== null; };
})();
