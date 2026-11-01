/**
 * notch — bottom-right status notch (replaces the old #notification toast).
 *
 * Same behaviour as the delluna admin notch, anchored bottom-right and growing upward:
 *   - rest   : small smoked-glass circle
 *   - toast  : widens into a pill (two rows / opened panel = rounded card)
 *   - tap    : opens the details panel; tap the bar again / Esc / click outside closes it
 *   - two notches under a Pasito stepper: STATUS (notifications + running jobs) and DEBUG (warnings / errors)
 *   - swipe left / right anywhere on the notch — INCLUDING inside the opened panel — switches notch
 *
 * API:  window.dexNotch.flash(text, type?)            type: "info" | "success" | "error" (auto-detected if omitted)
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
  const tasks = new Map(), history = [], dbg = [];
  let el = null, dock = null, stepper = null, open = false, view = 0, flashMsg = null, flashTimer = 0;
  let seq = 0, dbgSeq = 0, histSeq = 0, tick = null, lastState = "", swipedAt = 0, renderTimer = 0, lastRaise = 0;
  const unread = [false, false];
  try { view = Number(sessionStorage.getItem("dexNotchView")) === 1 ? 1 : 0; } catch (e) {}

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const span = (ms) => ms < 1000 ? "<1s" : ms < 60000 ? Math.round(ms / 1000) + "s" : Math.floor(ms / 60000) + "m " + Math.round(ms % 60000 / 1000) + "s";
  const cap = (x) => String(x || "").replace(/^./, (c) => c.toUpperCase());
  const bars = '<span class="dex-bars" aria-hidden="true"><i></i><i></i><i></i></span>';
  const ICON = {
    success: '<delluna-icon name="tick"></delluna-icon>',
    info: '<delluna-icon name="info"></delluna-icon>',
    error: "!", warn: "!"
  };
  const ERR_RE = /\b(fail(ed|ure)?|error|cannot|can't|could not|couldn't|unable|invalid|not available|not found|no longer|denied|missing|must|cannot be empty|does not match|too (large|big))\b/i;
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

  // ── Swipe between the two notches ─────────────────────────────────────────────────────────────────────
  // Works on the closed notch, the stepper AND inside the opened panel (including over its log and buttons).
  // Horizontal-dominant drags of 36px+ switch notch; vertical drags stay native (they scroll the panel).
  // Only text fields are left alone, and with a mouse the log, so text can still be selected.
  function enableSwipe(node) {
    node.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest("input, textarea")) return;
      if (e.pointerType === "mouse" && e.target.closest(".dex-dbg-log")) return;
      const id = e.pointerId, sx = e.clientX, sy = e.clientY;
      const cleanup = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
      const move = (ev) => {
        if (ev.pointerId !== id) return;
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        cleanup(); swipedAt = Date.now();
        setView(Math.max(0, Math.min(1, view + (dx < 0 ? 1 : -1))));   // swipe left -> next, right -> previous
      };
      const end = (ev) => { if (ev.pointerId === id) cleanup(); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    });
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
    enableSwipe(dock);
    el.addEventListener("click", (e) => {
      if (Date.now() - swipedAt < 400) return;                      // a swipe must not also toggle the notch
      if (e.target.closest("[data-dismiss]")) { flashMsg = null; clearTimeout(flashTimer); render(); return; }
      const copy = e.target.closest("[data-copy]");
      if (copy) { copyLog(copy); return; }
      if (e.target.closest("[data-clear]")) { if (view === 1) dbg.length = 0; else history.length = 0; render(); return; }
      if (e.target.closest(".dex-notch-details") && !e.target.closest(".dex-notch-hint")) return;   // reading / scrolling the panel must not close it
      setOpen(!open);
    });
    document.addEventListener("click", (e) => { if (open && dock && !dock.contains(e.target)) setOpen(false); }, true);
    document.addEventListener("keydown", (e) => { if (open && e.key === "Escape") setOpen(false); });
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
  }
  function schedule() { if (renderTimer) return; renderTimer = setTimeout(() => { renderTimer = 0; render(); }, 120); }

  // ── HTML ──────────────────────────────────────────────────────────────────────────────────────────────
  const hint = '<p class="dex-notch-hint">Tap the bar again or press Esc to close · swipe to switch</p>';
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
      '<div class="dex-notch-actions">' + (flashMsg ? '<button type="button" class="dex-notch-btn" data-dismiss>Dismiss message</button>' : "") + '<button type="button" class="dex-notch-btn" data-copy>Copy</button>' + (history.length ? '<button type="button" class="dex-notch-btn" data-clear>Clear</button>' : "") + "</div>" + hint + "</div>";
  }
  function debugHTML() {
    const last = dbg[0];
    const lvl = last ? (last.level === "error" ? "error" : last.level === "warn" ? "warn" : "") : "";
    const row = last
      ? '<div class="dex-notch-row ' + lvl + '"><em class="dex-notch-ico">' + (lvl ? "!" : ICON.info) + '</em><span class="dex-notch-text">' + esc(last.text) + "</span></div>"
      : open ? '<div class="dex-notch-row"><em class="dex-notch-ico">' + ICON.info + '</em><span class="dex-notch-text">Debug</span></div>' : '<div class="dex-notch-row idle" aria-label="Debug notch"></div>';
    const panel = open
      ? '<div class="dex-notch-details"><div class="dex-notch-section"><h4>Debug log · ' + dbg.length + "/" + DEBUG_MAX + ' · newest first</h4><div class="dex-dbg-log">' +
        (dbg.map((d) => '<div class="dex-dbg-line ' + d.level + '">' + esc(clock(d.at) + " " + d.level.toUpperCase().padEnd(5) + " " + d.text) + "</div>").join("") || '<p class="dex-notch-empty">Nothing logged yet.</p>') +
        '</div></div><div class="dex-notch-actions"><button type="button" class="dex-notch-btn" data-copy>Copy log</button><button type="button" class="dex-notch-btn" data-clear>Clear</button></div>' + hint + "</div>"
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
    node.classList.toggle("multi", multi);
    node.classList.toggle("expanded", open);
    node.classList.toggle("idle", idle);
    node.setAttribute("aria-expanded", String(open));
    node.classList.add("show");
    const state = view + ":" + (idle ? "rest" : open ? "open" : multi ? "stack" : "pill");
    if (state !== lastState) { if (lastState) { node.classList.remove("pop"); void node.offsetWidth; node.classList.add("pop"); } lastState = state; }
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
      flashTimer = setTimeout(() => { flashMsg = null; render(); }, type === "error" ? SHOW_ERR_MS : SHOW_MS);
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
  }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot);
})();
