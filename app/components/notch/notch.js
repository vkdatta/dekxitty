/**
 * notch — floating status notch (replaces the old #notification toast).
 *
 * Same look and behaviour as the delluna admin notch:
 *   - rest   : small smoked-glass circle
 *   - toast  : widens into a pill (two rows / opened panel = rounded card)
 *   - tap    : opens the details panel. Close it with the × button, by tapping the bar again, Esc,
 *              or by touching anything outside it (the touch still goes through, so tapping the editor
 *              closes the notch AND focuses the editor).
 *   - two notches under a Pasito stepper: STATUS (notifications + running jobs) and DEBUG (warnings / errors)
 *   - swipe left / right anywhere on the notch — including inside the opened panel — switches notch
 *
 * Placement:
 *   - starts bottom-right and grows away from the screen edge it is attached to
 *   - dodges controls: if buttons / links / inputs sit under it, it moves to the nearest free spot on the
 *     screen edges, and goes back as soon as its own spot is free again
 *   - HOLD (~0.3s) the circle, the bar or the stepper, then drag it anywhere. On release it snaps to the
 *     nearest left/right edge (and to the top/bottom edge when close). A hand-placed notch stays where you
 *     put it (it no longer dodges) until you press "Auto position" in the panel.
 *
 * API:  window.dexNotch.flash(text, type?)            type: "info" | "success" | "error" (guessed if omitted)
 *       window.dexNotch.start(label, detail?) -> id   running job (spinner row)
 *       window.dexNotch.update(id, label?, done?, total?, detail?)
 *       window.dexNotch.end(id)
 *       window.dexNotch.log(text, level?)             straight into the DEBUG notch
 *       window.dexNotch.open() / close()
 * showNotification(text, type?) (notes-state.js) forwards here.
 */
(function () {
  "use strict";
  if (window.dexNotch) return;

  const HISTORY_MAX = 100, DEBUG_MAX = 300, SHOW_MS = 3600, SHOW_ERR_MS = 7000;
  const M = 10, SNAP_EDGE = 90, HOLD_MS = 300, POS_KEY = "dexNotchPos";
  const tasks = new Map(), history = [], dbg = [];
  let el = null, dock = null, stepper = null, open = false, view = 0, flashMsg = null, flashTimer = 0;
  let seq = 0, dbgSeq = 0, histSeq = 0, tick = null, lastState = "", swipedAt = 0, renderTimer = 0, lastRaise = 0;
  let dragging = false, avoidTimer = 0;
  const unread = [false, false];
  try { view = Number(sessionStorage.getItem("dexNotchView")) === 1 ? 1 : 0; } catch (e) {}

  // position: h = which side edge (l|r), v = top or bottom half (t|b); dx / dy = distance from those edges
  const DEFAULT_POS = { h: "r", v: "b", dx: M, dy: M };
  let pref = Object.assign({}, DEFAULT_POS), pinned = false, cur = pref;
  try {
    const s = JSON.parse(localStorage.getItem(POS_KEY) || "null");
    if (s && (s.h === "l" || s.h === "r") && (s.v === "t" || s.v === "b")) { pref = { h: s.h, v: s.v, dx: M, dy: Math.max(M, +s.dy || M) }; pinned = true; cur = pref; }
  } catch (e) {}

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const span = (ms) => ms < 1000 ? "<1s" : ms < 60000 ? Math.round(ms / 1000) + "s" : Math.floor(ms / 60000) + "m " + Math.round(ms % 60000 / 1000) + "s";
  const cap = (x) => String(x || "").replace(/^./, (c) => c.toUpperCase());
  const bars = '<span class="dex-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
  // Delluna icons, like the rest of the site (variants come from icon-config.js). The site forces every
  // delluna-icon to 20px with !important, so notch.css overrides that size inside the notch.
  const di = (name) => '<delluna-icon name="' + name + '"></delluna-icon>';
  const ICON = { success: di("tick"), info: di("info"), error: di("x"), warn: di("x") };
  const X_ICON = di("x");
  const ERR_RE = /\b(fail(ed|ure)?|error|cannot|can't|could not|couldn't|unable|invalid|not available|not found|no longer|denied|missing|must|does not match|too (large|big))\b/i;
  const OK_RE = /^(created|deleted|saved|renamed|copied|pasted|applied|downloaded|moved|restored|imported|exported|uploaded|synced|done|success)\b/i;
  const infer = (t) => ERR_RE.test(t) ? "error" : OK_RE.test(t) ? "success" : "info";

  function record(type, text) {
    history.unshift({ n: ++histSeq, at: Date.now(), type, text: String(text) });
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
    if (view !== 0) mark(0);
  }

  // ── Debug capture: warnings / errors / uncaught problems (the console still gets everything) ──────────
  function dlog(text, level) {
    dbg.unshift({ n: ++dbgSeq, at: Date.now(), level: level || "info", text: String(text).slice(0, 1500) });
    if (dbg.length > DEBUG_MAX) dbg.length = DEBUG_MAX;
    if (view !== 1) { if (stepper) mark(1); } else schedule();
  }
  const fmtArg = (a) => typeof a === "string" ? a : a instanceof Error ? a.name + ": " + a.message : (() => { try { return JSON.stringify(a); } catch (e) { return String(a); } })();
  ["warn", "error"].forEach((m) => {
    const orig = console[m] && console[m].bind(console);
    console[m] = function () { try { dlog("console." + m + ": " + Array.prototype.map.call(arguments, fmtArg).join(" "), m); } catch (e) {} if (orig) orig.apply(null, arguments); };
  });
  window.addEventListener("error", (e) => dlog("Uncaught " + (e.message || "error") + " @ " + String(e.filename || "").split("/").pop() + ":" + (e.lineno || 0), "error"));
  window.addEventListener("unhandledrejection", (e) => dlog("Unhandled promise rejection: " + fmtArg(e.reason), "error"));

  // ── Position: apply, animate, dodge, drag ─────────────────────────────────────────────────────────────
  const sameAt = (a, b) => a && b && a.h === b.h && a.v === b.v && a.dx === b.dx && a.dy === b.dy;
  function applyPos(p) {
    cur = p; dock.dataset.h = p.h; dock.dataset.v = p.v;
    const sa = (side) => "env(safe-area-inset-" + side + ",0px)";
    dock.style.left = p.h === "l" ? "calc(" + sa("left") + " + " + p.dx + "px)" : "auto";
    dock.style.right = p.h === "r" ? "calc(" + sa("right") + " + " + p.dx + "px)" : "auto";
    dock.style.top = p.v === "t" ? "calc(" + sa("top") + " + " + p.dy + "px)" : "auto";
    dock.style.bottom = p.v === "b" ? "calc(" + sa("bottom") + " + " + p.dy + "px)" : "auto";
  }
  function moveTo(p, animate) {   // FLIP: jump to the new anchors, then slide from where it was
    if (!dock) return;
    const before = dock.getBoundingClientRect();
    applyPos(p);
    if (!animate) return;
    const after = dock.getBoundingClientRect(), dx = before.left - after.left, dy = before.top - after.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    dock.style.transition = "none"; dock.style.transform = "translate(" + dx + "px," + dy + "px)"; void dock.offsetWidth;
    dock.style.transition = "transform .26s cubic-bezier(.2,.9,.25,1)"; dock.style.transform = "";
    setTimeout(() => { if (dock) dock.style.transition = ""; }, 320);
  }
  const rectFor = (p, w, h) => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const left = p.h === "r" ? vw - p.dx - w : p.dx, top = p.v === "b" ? vh - p.dy - h : p.dy;
    return { left, top, right: left + w, bottom: top + h };
  };
  const hit = (a, b) => a.left < b.right + 4 && a.right > b.left - 4 && a.top < b.bottom + 4 && a.bottom > b.top - 4;

  // Things you can tap that the notch must not sit on. Big containers (editor, panes, whole rows) are ignored.
  const OBST = 'button, a[href], input, select, summary, [role="button"], [onclick], [class*="btn"], [class*="button"], .dex-add, .dex-tool, .dex-view-opt, .dex-sort, .dex-chev, .dex-check';
  function obstacles() {
    const vw = window.innerWidth, vh = window.innerHeight, out = [];
    document.querySelectorAll(OBST).forEach((n) => {
      if (dock.contains(n)) return;
      const r = n.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return;
      if (r.width > vw * 0.6 || r.height > vh * 0.3) return;
      const cs = getComputedStyle(n);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0 || cs.pointerEvents === "none") return;
      out.push(r);
    });
    return out;
  }
  function findFree(pf, w, h, obs) {
    const vh = window.innerHeight, pr = rectFor(pf, w, h), pcx = pr.left + w / 2, pcy = pr.top + h / 2;
    let best = null, bd = Infinity;
    for (const hh of [pf.h, pf.h === "r" ? "l" : "r"]) for (const vv of [pf.v, pf.v === "b" ? "t" : "b"]) {
      for (let dy = M; dy <= vh - h - M; dy += 20) {
        const c = { h: hh, v: vv, dx: M, dy }, rc = rectFor(c, w, h);
        if (obs.some((o) => hit(rc, o))) continue;
        const d = Math.hypot(rc.left + w / 2 - pcx, rc.top + h / 2 - pcy);
        if (d < bd) { bd = d; best = c; }
      }
    }
    return best;
  }
  function avoid() {
    if (!dock || dragging || open || pinned || document.hidden) return;
    const w = dock.offsetWidth, h = dock.offsetHeight;
    if (!w || !h) return;
    const obs = obstacles(), free = (p) => !obs.some((o) => hit(rectFor(p, w, h), o));
    let target = pref;
    if (!free(pref)) target = free(cur) ? cur : (findFree(pref, w, h, obs) || pref);
    if (!sameAt(target, cur)) moveTo(target, true);
  }
  function queueAvoid() { clearTimeout(avoidTimer); avoidTimer = setTimeout(avoid, 120); }
  function clampPinned() {   // keep a hand-placed notch on screen after a resize / rotation
    if (!pinned || !dock) return;
    const maxDy = Math.max(M, window.innerHeight - dock.offsetHeight - M);
    if (pref.dy > maxDy) { pref = Object.assign({}, pref, { dy: maxDy }); moveTo(pref, false); }
  }

  let grab = { x: 0, y: 0, w: 0, h: 0 };
  function beginDrag(cx, cy) {
    const r = dock.getBoundingClientRect();
    grab = { x: cx - r.left, y: cy - r.top, w: r.width, h: r.height };
    dragging = true; dock.classList.add("dragging");
    dock.style.transition = "none"; dock.style.transform = "";
    dock.style.left = r.left + "px"; dock.style.top = r.top + "px"; dock.style.right = "auto"; dock.style.bottom = "auto";
    try { navigator.vibrate && navigator.vibrate(12); } catch (e) {}
  }
  function dragMove(cx, cy) {
    const vw = window.innerWidth, vh = window.innerHeight;
    dock.style.left = Math.max(0, Math.min(vw - grab.w, cx - grab.x)) + "px";
    dock.style.top = Math.max(0, Math.min(vh - grab.h, cy - grab.y)) + "px";
  }
  function endDrag() {
    const r = dock.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    dragging = false; dock.classList.remove("dragging"); swipedAt = Date.now();
    const h = r.left + r.width / 2 < vw / 2 ? "l" : "r", dTop = r.top, dBot = vh - r.bottom;
    let v, dy;
    if (Math.min(dTop, dBot) < SNAP_EDGE) { v = dTop < dBot ? "t" : "b"; dy = M; }          // magnet: stick to the top / bottom edge
    else { v = r.top + r.height / 2 < vh / 2 ? "t" : "b"; dy = Math.max(M, v === "t" ? dTop : dBot); }
    pref = { h, v, dx: M, dy }; pinned = true;                                              // always stick to a side edge
    try { localStorage.setItem(POS_KEY, JSON.stringify(pref)); } catch (e) {}
    moveTo(pref, true);
    render();
  }
  function autoPosition() {
    pinned = false; pref = Object.assign({}, DEFAULT_POS);
    try { localStorage.removeItem(POS_KEY); } catch (e) {}
    moveTo(pref, true); render(); queueAvoid();
  }

  // ── Stepper ───────────────────────────────────────────────────────────────────────────────────────────
  function buildStepper() {
    const root = document.createElement("div");
    root.className = "dex-notch-stepper";
    const wrap = document.createElement("div");
    wrap.className = "pasito";
    const slots = ["Status", "Debug"].map((label, i) => {
      const s = document.createElement("div");
      s.className = "pasito-slot"; s.setAttribute("role", "button"); s.setAttribute("aria-label", label + " notch"); s.title = label; s.tabIndex = 0;
      s.innerHTML = '<div class="pasito-dot"></div>';
      s.addEventListener("click", (e) => { e.stopPropagation(); if (Date.now() - swipedAt < 400) return; setView(i); });
      s.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setView(i); } });
      wrap.appendChild(s);
      return s;
    });
    const ind = document.createElement("div");
    ind.className = "pasito-ind";
    wrap.appendChild(ind);
    root.appendChild(wrap);
    const L = 20; let shown = view, timer = 0;
    const place = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); ind.style.left = lo * L + "px"; ind.style.width = (hi - lo + 1) * L + "px"; };
    place(view, view);
    return {
      root,
      set(n) { if (n === shown) return; const prev = shown; shown = n; clearTimeout(timer); place(prev, n); timer = setTimeout(() => place(n, n), 130); },
      mark(i, on) { slots[i].classList.toggle("unread", on); }
    };
  }
  function mark(i) { if (!unread[i]) { unread[i] = true; if (stepper) stepper.mark(i, true); } }
  function setView(i) {
    if (i === view) return;
    view = i; unread[i] = false; stepper.mark(i, false); stepper.set(i);
    try { sessionStorage.setItem("dexNotchView", String(i)); } catch (e) {}
    render();
  }

  // ── Gestures: swipe = switch notch, hold = pick up and drag ───────────────────────────────────────────
  // Swipe works on the closed notch, the stepper AND inside the opened panel (over its log and buttons too).
  // Horizontal-dominant drags of 36px+ switch notch; vertical drags stay native (they scroll the panel).
  // Hold ~0.3s without moving to pick the notch up. While open, hold on the header bar or the stepper
  // (the panel body keeps normal text selection). Only text fields and, for a mouse, the log are left alone.
  function enableGestures(node) {
    node.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest("input, textarea")) return;
      const id = e.pointerId, sx = e.clientX, sy = e.clientY;
      const mouseInLog = e.pointerType === "mouse" && !!e.target.closest(".dex-dbg-log");
      const canHold = !e.target.closest("[data-close]") && (!open || !!e.target.closest(".dex-notch-row, .dex-notch-stepper"));
      let mode = "wait", holdT = 0;
      const cleanup = () => { clearTimeout(holdT); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
      const move = (ev) => {
        if (ev.pointerId !== id) return;
        if (mode === "drag") { dragMove(ev.clientX, ev.clientY); return; }
        if (mode !== "wait") return;
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (Math.hypot(dx, dy) > 8) clearTimeout(holdT);
        if (!mouseInLog && Math.abs(dx) >= 36 && Math.abs(dx) >= Math.abs(dy) * 1.5) {
          mode = "swipe"; swipedAt = Date.now(); cleanup();
          setView(Math.max(0, Math.min(1, view + (dx < 0 ? 1 : -1))));   // swipe left -> next, right -> previous
        }
      };
      const end = (ev) => { if (ev.pointerId !== id) return; if (mode === "drag") endDrag(); mode = "done"; cleanup(); };
      if (canHold && !mouseInLog) holdT = setTimeout(() => { if (mode === "wait") { mode = "drag"; beginDrag(sx, sy); } }, HOLD_MS);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    });
    node.addEventListener("contextmenu", (e) => { if (e.pointerType === "touch" || dragging) e.preventDefault(); });
    // once picked up, the finger must move the notch, not scroll the page
    window.addEventListener("touchmove", (e) => { if (dragging && e.cancelable) e.preventDefault(); }, { passive: false });
  }

  // ── Host ──────────────────────────────────────────────────────────────────────────────────────────────
  function host() {
    if (el) return el;
    dock = document.createElement("div");
    dock.id = "dexNotchDock"; dock.setAttribute("popover", "manual");   // top layer: stays above modals and overlays
    el = document.createElement("div");
    el.id = "dexNotch"; el.className = "dex-notch"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    stepper = buildStepper();
    dock.append(el, stepper.root);
    applyPos(cur);
    enableGestures(dock);
    el.addEventListener("click", (e) => {
      if (Date.now() - swipedAt < 400) return;                      // a swipe / drag must not also toggle the notch
      if (e.target.closest("[data-close]")) { e.stopPropagation(); setOpen(false); return; }
      if (e.target.closest("[data-dismiss]")) { flashMsg = null; clearTimeout(flashTimer); render(); return; }
      if (e.target.closest("[data-unpin]")) { autoPosition(); return; }
      const copy = e.target.closest("[data-copy]");
      if (copy) { copyLog(copy); return; }
      if (e.target.closest("[data-clear]")) { if (view === 1) dbg.length = 0; else history.length = 0; render(); return; }
      if (e.target.closest(".dex-notch-details") && !e.target.closest(".dex-notch-hint")) return;   // reading / scrolling the panel must not close it
      setOpen(!open);
    });
    // Close on the FIRST touch outside, before the page reacts. (A click never arrives when the touch focuses the
    // editor and raises the keyboard, which is why the old "click outside" never closed it.) The touch still goes through.
    document.addEventListener("pointerdown", (e) => { if (open && dock && !dock.contains(e.target)) setOpen(false); }, true);
    document.addEventListener("keydown", (e) => { if (open && e.key === "Escape") setOpen(false); });
    window.addEventListener("resize", () => { clampPinned(); queueAvoid(); });
    window.addEventListener("orientationchange", () => { clampPinned(); queueAvoid(); });
    window.addEventListener("scroll", queueAvoid, true);
    setInterval(() => { if (!document.hidden) queueAvoid(); }, 900);   // the app's own panels open / close without events
    document.body.append(dock);
    try { dock.showPopover && dock.showPopover(); } catch (e) {}
    return el;
  }
  async function copyLog(btn) {
    const label = btn.textContent;
    const text = view === 1
      ? dbg.map((d) => clock(d.at) + " " + d.level.toUpperCase().padEnd(5) + " #" + d.n + " " + d.text).join("\n")
      : history.map((h) => clock(h.at) + " " + String(h.type).toUpperCase().padEnd(7) + " #" + h.n + " " + h.text).join("\n");
    try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; } catch (err) { btn.textContent = "Copy failed"; }
    setTimeout(() => { btn.textContent = label; }, 1400);
  }
  function setOpen(v) {
    open = v; clearInterval(tick); tick = null;
    if (open && tasks.size) tick = setInterval(render, 1000);       // keeps elapsed times live
    render();
    if (!open) queueAvoid();
  }
  function schedule() { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = 0; render(); }, 120); }

  // ── HTML ──────────────────────────────────────────────────────────────────────────────────────────────
  const hint = '<p class="dex-notch-hint">Tap the bar again or press Esc to close · swipe to switch · hold to move</p>';
  const unpinBtn = () => pinned ? '<button type="button" class="dex-notch-btn" data-unpin>Auto position</button>' : "";
  function statusPanel(list) {
    const now = Date.now();
    const running = list.length ? list.slice().reverse().map((t) => {
      const pct = t.total ? Math.min(100, Math.round(t.done / t.total * 100)) : null;
      return '<div class="dex-notch-item"><div class="dex-notch-item-head">' + bars + "<b>" + esc(cap(t.label)) + "</b><small>" + span(now - t.started) + "</small></div>" +
        (t.detail ? "<p>" + esc(t.detail) + "</p>" : "") +
        (t.total ? '<div class="dex-notch-progress"><i style="width:' + pct + '%"></i></div><small>' + t.done + "/" + t.total + " · " + pct + "%</small>" : "") + "</div>";
    }).join("") : '<p class="dex-notch-empty">Nothing is running right now.</p>';
    const recent = history.length ? history.map((h) => '<div class="dex-notch-log ' + h.type + '"><em class="dex-notch-ico">' + (ICON[h.type] || ICON.info) + "</em><span>" + esc(h.text) + "</span><small>" + clock(h.at) + "</small></div>").join("") : '<p class="dex-notch-empty">No recent activity.</p>';
    return '<div class="dex-notch-details"><div class="dex-notch-section"><h4>Running now</h4>' + running + '</div><div class="dex-notch-section"><h4>Recent · ' + history.length + "/" + HISTORY_MAX + ' · newest first</h4>' + recent + "</div>" +
      '<div class="dex-notch-actions">' + (flashMsg ? '<button type="button" class="dex-notch-btn" data-dismiss>Dismiss message</button>' : "") + '<button type="button" class="dex-notch-btn" data-copy>Copy</button>' + (history.length ? '<button type="button" class="dex-notch-btn" data-clear>Clear</button>' : "") + unpinBtn() + "</div>" + hint + "</div>";
  }
  function debugHTML() {
    const last = dbg[0];
    const lvl = last ? (last.level === "error" ? "error" : last.level === "warn" ? "warn" : "") : "";
    const row = last
      ? '<div class="dex-notch-row ' + lvl + '"><em class="dex-notch-ico">' + (lvl ? ICON.error : ICON.info) + '</em><span class="dex-notch-text">' + esc(last.text) + "</span></div>"
      : open ? '<div class="dex-notch-row"><em class="dex-notch-ico">' + ICON.info + '</em><span class="dex-notch-text">Debug</span></div>' : '<div class="dex-notch-row idle" aria-label="Debug notch"></div>';
    const panel = open
      ? '<div class="dex-notch-details"><div class="dex-notch-section"><h4>Debug log · ' + dbg.length + "/" + DEBUG_MAX + ' · newest first</h4><div class="dex-dbg-log">' +
        (dbg.map((d) => '<div class="dex-dbg-line ' + d.level + '">' + esc(clock(d.at) + " " + d.level.toUpperCase().padEnd(5) + " " + d.text) + "</div>").join("") || '<p class="dex-notch-empty">Nothing logged yet.</p>') +
        '</div></div><div class="dex-notch-actions"><button type="button" class="dex-notch-btn" data-copy>Copy log</button><button type="button" class="dex-notch-btn" data-clear>Clear</button>' + unpinBtn() + "</div>" + hint + "</div>"
      : "";
    return { html: row + panel, multi: open, idle: !dbg.length && !open };
  }

  function render() {
    const now = Date.now();
    for (const [id, t] of tasks) if (t.expires && t.expires < now) tasks.delete(id);
    const node = host();
    const list = [...tasks.values()];
    const prevScroll = node.querySelector(".dex-notch-details, .dex-dbg-log");
    const saved = prevScroll ? prevScroll.scrollTop : 0;
    let html, multi, idle = false;
    if (view === 1) {
      const d = debugHTML(); html = d.html; multi = d.multi; idle = d.idle;
    } else {
      const main = list[list.length - 1];
      const pct = main && main.total ? Math.min(100, Math.round(main.done / main.total * 100)) : null;
      const rows = (main ? 1 : 0) + (flashMsg ? 1 : 0);
      idle = !rows && !open;
      html =
        (main ? '<div class="dex-notch-row running">' + bars + '<span class="dex-notch-text">' + esc(main.total ? main.done + "/" + main.total + " " + main.label : main.label) + "</span>" + (list.length > 1 ? '<b class="dex-notch-more">+' + (list.length - 1) + "</b>" : "") + (pct !== null ? '<span class="dex-notch-bar" aria-hidden="true"><i style="width:' + pct + '%"></i></span>' : "") + "</div>" : "") +
        (flashMsg ? '<div class="dex-notch-row ' + flashMsg.type + '"><em class="dex-notch-ico">' + (ICON[flashMsg.type] || ICON.info) + '</em><span class="dex-notch-text">' + esc(flashMsg.text) + "</span></div>" : "") +
        (!rows && !open ? '<div class="dex-notch-row idle" aria-label="Status notch"></div>' : "") +
        (!rows && open ? '<div class="dex-notch-row"><em class="dex-notch-ico">' + ICON.info + '</em><span class="dex-notch-text">Activity</span></div>' : "") +
        (open ? statusPanel(list) : "");
      multi = rows > 1 || open;
    }
    node.innerHTML = html;
    if (open) {   // × lives at the end of the header (first) row
      const first = node.querySelector(".dex-notch-row");
      if (first) first.insertAdjacentHTML("beforeend", '<button type="button" class="dex-notch-close" data-close aria-label="Close">' + X_ICON + "</button>");
    }
    node.classList.toggle("multi", multi);
    node.classList.toggle("expanded", open);
    node.classList.toggle("idle", idle);
    node.setAttribute("aria-expanded", String(open));
    node.classList.add("show");
    const state = view + ":" + (idle ? "rest" : open ? "open" : multi ? "stack" : "pill");
    if (state !== lastState) { if (lastState) { node.classList.remove("pop"); void node.offsetWidth; node.classList.add("pop"); queueAvoid(); } lastState = state; }
    const sc = node.querySelector(".dex-notch-details, .dex-dbg-log");
    if (sc && saved > 4) sc.scrollTop = saved;
    try {
      if (!dock.matches(":popover-open")) dock.showPopover && dock.showPopover();
      else if (Date.now() - lastRaise > 800 && document.querySelector("dialog[open]")) { lastRaise = Date.now(); dock.hidePopover(); dock.showPopover(); }
    } catch (e) {}
  }

  window.dexNotch = {
    flash(text, type) {
      text = String(text == null ? "" : text); if (!text) return;
      type = type === "error" || type === "success" || type === "info" ? type : infer(text);
      flashMsg = { text, type };
      record(type, text);
      if (type === "error") dlog("notification: " + text, "warn");
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flashMsg = null; render(); queueAvoid(); }, type === "error" ? SHOW_ERR_MS : SHOW_MS);
      render();
    },
    start(label, detail) { const id = ++seq; tasks.set(id, { label, detail, done: 0, total: 0, started: Date.now() }); render(); return id; },
    update(id, label, done, total, detail) { const t = tasks.get(id); if (!t) return; if (label) t.label = label; if (detail !== undefined) t.detail = detail; if (done !== undefined) t.done = done; if (total !== undefined) t.total = total; render(); },
    end(id) { const t = tasks.get(id); if (tasks.delete(id)) { if (t) record("success", String(t.label).replace(/…$/, "") + " · took " + span(Date.now() - t.started)); if (!tasks.size) { clearInterval(tick); tick = null; } render(); } },
    log: dlog,
    open() { setOpen(true); },
    close() { setOpen(false); }
  };

  function boot() {
    render();
    const q = window.__dexNotchQueue; window.__dexNotchQueue = null;
    if (q) q.forEach((a) => window.dexNotch.flash(a[0], a[1]));
    queueAvoid();
  }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot);
})();
