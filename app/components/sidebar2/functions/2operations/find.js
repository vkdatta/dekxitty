export function openfindbackdrop() {  }

export function createFindAndReplace() {
  let isOpen = false;
  // FIX (bug #16 / Scenario F): dpadWasExpanded must survive the open→close
  // round trip. Previously it was a local const inside the if(isOpen) block —
  // it was correctly captured on open but died at the closing brace, so the
  // else(close) branch never saw it and the D-pad was never restored.
  // Moving it to closure scope means: open sets it, close reads it.
  let dpadWasExpanded = false;
  const state = {
    matches: [],
    currentIndex: -1,
    searchText: "",
    isCaseSensitive: false,
    isRegex: false,
    mode: "find",
    replaceMode: 0,
    metrics: {},
    suspendSearch: false,
    preferredAnchor: null
  };
  const modeIconMap = { find: "location_searching", replace: "cached" };
  const replaceBtnTexts = ["Replace", "Range", "Replace All"];
  let searchDebounceTimer = null;
  let contentDebounceTimer = null;
  let lastSearchRunId = 0;
  let queuedPerform = false;

  const cmMarks = [];

  function cm() { return window.dexEditor && window.dexEditor.cm; }
  function doc() { const c = cm(); return c ? c.getDoc() : null; }

  function clearMarks() {
    while (cmMarks.length) {
      const m = cmMarks.pop();
      try { m.clear(); } catch (e) {}
    }
  }

  function getElements() {
    return {
      menu: document.getElementById("find-replace-menu"),
      backdrop: document.getElementById("findBackdrop"),
      noteBackdrop: document.getElementById("noteBackdrop"),
      textarea: document.getElementById("noteTextarea"),
      overlay: document.getElementById("find-replace-overlay"),
      findInput: document.getElementById("find-replace-find-input"),
      replaceInput: document.getElementById("find-replace-replace-input"),
      modeSwitch: document.getElementById("find-replace-mode-switch-button"),
      modeIcon: document.getElementById("find-replace-icon-mode"),
      closeButton: document.getElementById("find-replace-close-button"),
      prevButton: document.getElementById("find-replace-prev-match-button"),
      nextButton: document.getElementById("find-replace-next-match-button"),
      prevReplaceButton: document.getElementById("find-replace-prev-replace-button"),
      nextReplaceButton: document.getElementById("find-replace-next-replace-button"),
      matchCount: document.getElementById("find-replace-match-count"),
      replaceCount: document.getElementById("find-replace-replace-count"),
      findControls: document.getElementById("find-replace-find-controls"),
      replaceControls: document.getElementById("find-replace-replace-controls"),
      replaceInstanceControls: document.getElementById("find-replace-replace-instance-controls"),
      replaceRangeControls: document.getElementById("find-replace-replace-range-controls"),
      replaceAllControls: document.getElementById("find-replace-replace-all-controls"),
      rangeInput: document.getElementById("find-replace-range-input"),
      matchCaseBtn: document.getElementById("find-replace-match-case-button"),
      regexBtn: document.getElementById("find-replace-regex-button"),
      replaceSettingsBtn: document.getElementById("find-replace-replace-settings-button"),
      executeReplaceBtn: document.getElementById("find-replace-execute-replace-button"),
      menuContainer: document.getElementById("find-replace-menu")
    };
  }

  function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function performSearch(opts) {
    if (state.suspendSearch) { queuedPerform = true; return; }
    const runId = ++lastSearchRunId;
    const els = getElements();
    if (!els.textarea || !els.findInput) return;
    const content = els.textarea.value;
    const query = els.findInput.value;
    state.searchText = query;
    if (!query) {
      state.matches = [];
      state.currentIndex = -1;
      renderMatches();
      return;
    }
    let matches = [];
    try {
      let flags = "g";
      if (!state.isCaseSensitive) flags += "i";
      const pattern = state.isRegex ? query : escapeRegExp(query);
      const re = new RegExp(pattern, flags);
      let match;
      while ((match = re.exec(content)) !== null) {
        matches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
        if (match.index === re.lastIndex) re.lastIndex++;
      }
    } catch (err) {
      console.error("Regex error:", err);
      matches = [];
    }
    if (runId !== lastSearchRunId) return;
    const prevAnchor = state.matches[state.currentIndex] ? state.matches[state.currentIndex].start : null;
    state.matches = matches;
    let newIndex = -1;
    if (state.preferredAnchor != null) {
      newIndex = matches.findIndex((m) => m.start >= state.preferredAnchor);
      state.preferredAnchor = null;
    } else if (prevAnchor != null) {
      newIndex = matches.findIndex((m) => m.start >= prevAnchor);
    }
    if (newIndex === -1) newIndex = matches.length ? 0 : -1;
    state.currentIndex = newIndex;
    renderMatches();
    if (state.currentIndex >= 0 && !(opts && opts.dontFocus)) focusCurrentMatch();
  }

  function renderMatches() {
    const els = getElements();
    if (!els.textarea) return;
    const total = state.matches.length;
    const currentDisplay = state.currentIndex >= 0 ? state.currentIndex + 1 : 0;
    if (els.matchCount)   els.matchCount.textContent   = currentDisplay + "/" + total;
    if (els.replaceCount) els.replaceCount.textContent = currentDisplay + "/" + total;

    const c = cm();
    const d = doc();
    if (!c || !d) return;
    c.operation(() => {
      clearMarks();
      state.matches.forEach((m, idx) => {
        const from = d.posFromIndex(m.start);
        const to   = d.posFromIndex(m.end);
        const cls  = idx === state.currentIndex ? "hl-match hl-current" : "hl-match";
        try {
          const marker = d.markText(from, to, { className: cls });
          cmMarks.push(marker);
        } catch (e) {}
      });
    });
  }

  function focusCurrentMatch() {
    if (state.currentIndex < 0 || !state.matches.length) return;
    const d = doc();
    const c = cm();
    if (!d || !c) return;
    const cur = state.matches[state.currentIndex];
    const fromPos = d.posFromIndex(cur.start);
    const toPos   = d.posFromIndex(cur.end);
    try { d.setSelection(fromPos, toPos); } catch (e) {}
    try { c.scrollIntoView({ from: fromPos, to: toPos }, 80); } catch (e) {}
  }

  function updateCaretColor() {  }

  function clearPendingDebounces() {
    if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
    if (contentDebounceTimer) { clearTimeout(contentDebounceTimer); contentDebounceTimer = null; }
  }

  function moveIndex(delta) {
    if (!state.matches.length) return;
    clearPendingDebounces();
    state.suspendSearch = true;
    queuedPerform = false;
    const SUSPEND_MS = 350;
    setTimeout(() => {
      state.suspendSearch = false;
      if (queuedPerform) { queuedPerform = false; setTimeout(performSearch, 0); }
    }, SUSPEND_MS);
    state.currentIndex += delta;
    if (state.currentIndex >= state.matches.length) state.currentIndex = 0;
    else if (state.currentIndex < 0) state.currentIndex = state.matches.length - 1;
    renderMatches();
    focusCurrentMatch();
  }

  function updateReplaceModeUI() {
    const els = getElements();
    if (!els.replaceInstanceControls || !els.replaceRangeControls || !els.replaceAllControls || !els.executeReplaceBtn) return;
    els.replaceInstanceControls.classList.toggle("find-replace-hidden", state.replaceMode !== 0);
    els.replaceRangeControls.classList.toggle("find-replace-hidden", state.replaceMode !== 1);
    els.replaceAllControls.classList.toggle("find-replace-hidden", state.replaceMode !== 2);
    els.executeReplaceBtn.textContent = replaceBtnTexts[state.replaceMode];
  }

  function toggleMode() {
    state.mode = state.mode === "find" ? "replace" : "find";
    updateUI();
    const els = getElements();
    if (state.mode === "find" && els.findInput) { try { els.findInput.focus(); } catch (e) {} }
    else if (els.replaceInput) { try { els.replaceInput.focus(); } catch (e) {} }
  }

  function executeReplace() {
    const els = getElements();
    if (!els.textarea || !els.replaceInput || !state.matches.length || !state.searchText) return;
    const c = cm();
    const d = doc();
    if (!c || !d) return;

    const replacement = els.replaceInput.value;
    let targets = [];
    if (state.replaceMode === 0) {
      if (state.currentIndex >= 0) targets.push(state.currentIndex);
    } else if (state.replaceMode === 2) {
      targets = state.matches.map((_, i) => i);
    } else if (state.replaceMode === 1) {
      const raw = els.rangeInput && els.rangeInput.value ? els.rangeInput.value.trim() : "";
      if (!raw) return;
      const parts = raw.split(",").map((p) => p.trim());
      const desired = new Set();
      parts.forEach((p) => {
        if (p.includes("-")) {
          const [sRaw, eRaw] = p.split("-").map((v) => v.trim());
          const s = parseInt(sRaw, 10);
          const e = parseInt(eRaw, 10);
          if (!isNaN(s) && !isNaN(e) && s <= e) { for (let k = s; k <= e; k++) desired.add(k); }
        } else {
          const n = parseInt(p, 10);
          if (!isNaN(n)) desired.add(n);
        }
      });
      state.matches.forEach((m, idx) => { if (desired.has(idx + 1)) targets.push(idx); });
    }
    if (targets.length === 0) return;

    if (state.replaceMode === 0 && state.currentIndex >= 0 && state.matches[state.currentIndex]) {
      const curMatch = state.matches[state.currentIndex];
      const replLen = els.replaceInput.value ? els.replaceInput.value.length : (curMatch.end - curMatch.start);
      state.preferredAnchor = curMatch.start + replLen;
    } else {
      state.preferredAnchor = null;
    }

    targets.sort((a, b) => b - a);
    c.operation(() => {
      targets.forEach((idx) => {
        const m = state.matches[idx];
        let repl = replacement;
        if (state.isRegex) {
          try {
            const flags = state.isCaseSensitive ? "g" : "gi";
            const regex = new RegExp(state.searchText, flags);
            repl = m.text.replace(regex, replacement);
          } catch (e) {}
        }
        const from = d.posFromIndex(m.start);
        const to   = d.posFromIndex(m.end);
        d.replaceRange(repl, from, to);
      });
    });
    performSearch();
  }

  function updateUI() {
    const els = getElements();
    if (!els.menuContainer) return;
    els.menuContainer.classList.toggle("find-replace-mode-find",    state.mode === "find");
    els.menuContainer.classList.toggle("find-replace-mode-replace", state.mode === "replace");
    if (els.modeIcon) {
      const name = modeIconMap[state.mode];
      els.modeIcon.setAttribute("name", name);
    }
    if (els.findControls)     els.findControls.classList.toggle("find-replace-hidden", state.mode === "replace");
    if (els.replaceControls)  els.replaceControls.classList.toggle("find-replace-hidden", state.mode === "find");
    if (els.matchCaseBtn)     els.matchCaseBtn.classList.toggle("find-replace-hidden", state.mode === "replace");
    if (els.regexBtn)         els.regexBtn.classList.toggle("find-replace-hidden", state.mode === "replace");
    if (els.replaceSettingsBtn) els.replaceSettingsBtn.classList.toggle("find-replace-hidden", state.mode === "find");
    updateReplaceModeUI();
  }

  function attachEventListeners() {
    const els = getElements();
    if (!els.textarea) { console.warn("Find/replace: #noteTextarea not found"); return; }
    if (els.findInput) {
      els.findInput.addEventListener("input", () => {
        clearPendingDebounces();
        searchDebounceTimer = setTimeout(performSearch, 50);
      });
    }
    if (els.prevButton)         els.prevButton.addEventListener("click", () => moveIndex(-1));
    if (els.nextButton)         els.nextButton.addEventListener("click", () => moveIndex(1));
    if (els.prevReplaceButton)  els.prevReplaceButton.addEventListener("click", () => moveIndex(-1));
    if (els.nextReplaceButton)  els.nextReplaceButton.addEventListener("click", () => moveIndex(1));
    if (els.closeButton)        els.closeButton.addEventListener("click", () => window.findandreplace());
    if (els.modeSwitch)         els.modeSwitch.addEventListener("click", toggleMode);
    if (els.matchCaseBtn) {
      els.matchCaseBtn.addEventListener("click", () => {
        state.isCaseSensitive = !state.isCaseSensitive;
        els.matchCaseBtn.classList.toggle("active", state.isCaseSensitive);
        performSearch();
      });
    }
    if (els.regexBtn) {
      els.regexBtn.addEventListener("click", () => {
        state.isRegex = !state.isRegex;
        els.regexBtn.classList.toggle("active", state.isRegex);
        performSearch();
      });
    }
    if (els.replaceSettingsBtn) {
      els.replaceSettingsBtn.addEventListener("click", () => {
        state.replaceMode = (state.replaceMode + 1) % 3;
        updateReplaceModeUI();
      });
    }
    if (els.executeReplaceBtn) els.executeReplaceBtn.addEventListener("click", executeReplace);

    els.textarea.addEventListener("input", () => {
      if (!isOpen) return;
      clearPendingDebounces();
      contentDebounceTimer = setTimeout(() => performSearch({ dontFocus: true }), 250);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "f" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const els = getElements();
        if (!els.menu) return;
        const isCurrentlyOpen = !els.menu.classList.contains("find-replace-hidden");
        if (!isCurrentlyOpen) {
          window.findandreplace();
        } else {
          const inputToFocus = state.mode === "find" ? els.findInput : els.replaceInput;
          if (inputToFocus) {
            try { inputToFocus.focus(); if (inputToFocus === els.findInput) inputToFocus.select(); } catch (err) {}
          }
        }
      }
    });
  }

  attachEventListeners();
  window.__findandreplace_renderMatches = renderMatches;

  return function () {
    const els = getElements();
    if (!els.menu) { console.debug("[find] toggle called but #find-replace-menu not found"); return; }
    isOpen = !isOpen;
    els.menu.classList.toggle("find-replace-hidden", !isOpen);
    els.menu.classList.toggle("find-replace-on-top", isOpen);

    if (isOpen) {
      document.querySelectorAll(".sidebar, .secondary-sidebar, .topbar").forEach((el) => (el.style.display = "none"));
      clearPendingDebounces();
      state.suspendSearch = false;
      queuedPerform = false;

      // FIX (bug #5 / #8): close the native menu and collapse the dpad when
      // find opens — the dpad floats on top of the find overlay and dpad
      // selection moves trigger the menu schedule via cursorActivity.
      // FIX (bug #16): save the dpad state BEFORE collapsing so we can restore
      // it when Find closes. If the dpad was expanded the user expects it to
      // still be there when they return to editing; if it was already collapsed
      // there's nothing to restore.
      if (typeof window.dexCloseNativeMenu === 'function') window.dexCloseNativeMenu();
      const dpad = window.__dexDpad;
      // Write to the closure-level variable (not a new const) so the close
      // branch can read it to decide whether to restore the D-pad.
      dpadWasExpanded = dpad && dpad.dpadState === 'expanded';
      if (dpad && typeof dpad.collapseDpad === 'function') dpad.collapseDpad();

      const c = cm();
      if (c && els.findInput) {
        const sel = c.getSelection();
        if (sel && sel.trim().length > 0) els.findInput.value = sel;
      }
      performSearch();
      updateUI();
      if (state.mode === "find" && els.findInput) {
        try { els.findInput.focus(); els.findInput.select(); } catch (e) {}
      } else if (els.replaceInput) {
        try { els.replaceInput.focus(); } catch (e) {}
      }
    } else {
      document.querySelectorAll(".sidebar, .secondary-sidebar, .topbar").forEach((el) => (el.style.display = ""));
      // FIX (bug #17): bump lastSearchRunId so any in-flight debounced search
      // callback sees a stale runId and bails out early. Without this, a
      // delayed performSearch() can fire after Find has closed and repopulate
      // state.matches / CM marks — and those CM selection changes then propagate
      // into menu-functions.js and the D-pad preview, reactivating UI that
      // was supposed to be gone.
      lastSearchRunId++;
      // Also cancel the timer handles themselves so they don't fire at all.
      clearPendingDebounces();
      clearMarks();
      state.matches = [];
      state.currentIndex = -1;
      if (els.overlay) els.overlay.innerHTML = "";
      // FIX (bug #15 / Scenario F): when Find closes, selection handles stayed
      // hidden indefinitely because selection.js hides them while Find is open
      // and only repositions on CM events — none of which fire on Find close.
      // Trigger a repositioning pass here: if a CM selection still exists the
      // handles will reappear; if not they stay hidden.
      const ed = window.dexEditor;
      const c = ed && ed.cm ? ed.cm : null;
      if (c && c.somethingSelected()) {
        // Trigger CM's event pipeline with a no-op operation so all
        // cursorActivity listeners (including selection.js's scheduleHandles)
        // run and reposition the handles.
        try { c.operation(() => {}); } catch (_e) {}
      } else if (typeof window.dexHideSelectionHandles === 'function') {
        window.dexHideSelectionHandles();
      }
      // FIX (bug #16): restore the D-pad to its pre-Find state. Find.open()
      // always collapses the D-pad; if it was expanded before the user opened
      // Find they expect it back when they close it. expandDpad() is a no-op
      // when the dpad is already expanded, so this is safe to call freely.
      if (dpadWasExpanded) {
        const dpad = window.__dexDpad;
        if (dpad && typeof dpad.expandDpad === 'function') dpad.expandDpad();
      }
      dpadWasExpanded = false; // reset so the next open starts clean
    }
  };
}
