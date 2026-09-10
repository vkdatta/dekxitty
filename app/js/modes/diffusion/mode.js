(function () {
  const LS = {
    ENABLED:   'diffusionEnabled',
    ACTIVE:    'diffusionActivePane',
    RAW_ID:    'diffRawNoteId',
    MORPH_ID:  'diffMorphNoteId',
    LINENUM:   'showLineNumbers',
    PRISM:     'prismEnabled'
  };

  const state = {
    enabled:   false,
    activePane:'raw',        
    rawNoteId: null,
    morphNoteId: null,
    activeDiffView: null     
  };
  window.dexMode = state;

  function $(id) { return document.getElementById(id); }
  function noteById(id) { return (typeof notes !== 'undefined' && Array.isArray(notes)) ? notes.find(n => String(n.id) === String(id)) : null; }
  function lsSet(k, v) { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, String(v)); }
  function lsGet(k) { return localStorage.getItem(k); }

  function shadowFor(pane) {
    if (typeof diffElements === 'undefined') return null;
    return pane === 'raw' ? diffElements.raw : diffElements.morph;
  }

  function seedShadow(pane) {
    const sh = shadowFor(pane);
    if (!sh) return;
    const nid = pane === 'raw' ? state.rawNoteId : state.morphNoteId;
    const n = nid ? noteById(nid) : null;
    sh.value = n ? (n.content || '') : '';
  }

  function syncActiveShadowFromEditor() {
    if (!state.enabled) return;
    const nt = $('noteTextarea');
    const sh = shadowFor(state.activePane);
    if (nt && sh && sh !== nt) sh.value = nt.value;
  }

  let diffusionTimer = null;
  function scheduleDiffusion(immediate) {
    if (!state.enabled) return;
    if (typeof diffusion !== 'function') return;
    if (immediate) {
      clearTimeout(diffusionTimer); diffusionTimer = null;
      try { diffusion(); } catch (e) {}
      highlightVisibleDiffView();
      return;
    }
    clearTimeout(diffusionTimer);
    diffusionTimer = setTimeout(() => {
      diffusionTimer = null;
      try { diffusion(); } catch (e) {}
      highlightVisibleDiffView();
    }, 120);
  }
  window.scheduleDiffusion = scheduleDiffusion;

  function highlightVisibleDiffView() {
    if (typeof CodeMirror === 'undefined' || typeof CodeMirror.runMode !== 'function') return;
    if (localStorage.getItem('prismEnabled') !== '1') return;
    if (!state.activeDiffView) return;
    if (state.activeDiffView !== 'diffDiff1View' && state.activeDiffView !== 'diffDiff2View') return;
    const view = $(state.activeDiffView);
    if (!view) return;

    if (window.dexEditor && window.dexEditor.cm) {
      const theme = window.dexEditor.cm.getOption('theme') || 'dracula';
      Array.from(view.classList).forEach(c => { if (c.startsWith('cm-s-')) view.classList.remove(c); });
      view.classList.add('cm-s-' + theme.replace(/\s+/g, '-'));
    }

    const rawNote   = state.rawNoteId   ? noteById(state.rawNoteId)   : null;
    const morphNote = state.morphNoteId ? noteById(state.morphNoteId) : null;
    const ext = (rawNote && rawNote.extension) || (morphNote && morphNote.extension) || 'txt';
    let mode = 'text/plain';
    if (typeof CodeMirror.findModeByExtension === 'function') {
      const info = CodeMirror.findModeByExtension(String(ext).replace(/^\./, '').toLowerCase());
      if (info) {
        mode = info.mime || info.mode;
        if (info.mode && info.mode !== 'null' && typeof CodeMirror.autoLoadMode === 'function' && window.dexEditor && window.dexEditor.cm) {
          try { CodeMirror.autoLoadMode(window.dexEditor.cm, info.mode); } catch (e) {}
        }
      }
    }
    if (mode === 'null' || mode === 'text/plain') return;
    const cells = view.querySelectorAll('.diff-content-cell');
    cells.forEach(cell => {
      if (cell.querySelector('.tok-add, .tok-del')) return; 
      const text = cell.textContent;
      if (!text) return;
      if (cell.dataset.dexHl === text + '::' + mode) return;
      cell.textContent = '';
      try { CodeMirror.runMode(text, mode, cell); } catch (e) { cell.textContent = text; }
      cell.dataset.dexHl = text + '::' + mode;
    });
  }
  window.highlightVisibleDiffView = highlightVisibleDiffView;

  function wireEditor() {
    const nt = $('noteTextarea');
    if (!nt || nt.__dexModeWired) return;
    nt.__dexModeWired = true;
    nt.addEventListener('input', () => {
      if (!state.enabled) return;
      syncActiveShadowFromEditor();
      scheduleDiffusion();
    });
  }

  function hideAllDiffViews() {
    document.querySelectorAll('.diff-view').forEach(v => v.classList.remove('active'));
    const vp = $('diffViewport');
    if (vp) vp.style.display = 'none';
  }

  function showDiffView(viewId) {
    hideAllDiffViews();
    const vp = $('diffViewport');
    const v = $(viewId);
    if (vp) vp.style.display = 'block';
    if (v) v.classList.add('active');
    state.activeDiffView = viewId;
    document.body.classList.add('diff-fullscreen');
    const nc = document.querySelector('.note-container');
    if (nc) nc.style.display = 'none';
    if (typeof closeSidebar === 'function') closeSidebar();
    if (viewId === 'diffDiff1View' || viewId === 'diffDiff2View') scheduleDiffusion(true);
  }

  function showEditor() {
    hideAllDiffViews();
    state.activeDiffView = null;
    document.body.classList.remove('diff-fullscreen');
    const nc = document.querySelector('.note-container');
    if (nc) nc.style.display = '';
  }

  function paintBottomBar() {
    document.querySelectorAll('#diffBottombar .diff-topbar-button').forEach(b => b.classList.remove('active'));
    let selector;
    if (state.activeDiffView) selector = '#diffBottombar .diff-topbar-button[data-target="' + state.activeDiffView + '"]';
    else selector = '#diffBottombar .diff-topbar-button[data-target="' + state.activePane + '"]';
    const btn = document.querySelector(selector);
    if (btn) btn.classList.add('active');
  }

  // Raw/morph topbar + "no active selection" empty state (issues 4/5a). Only
  // relevant while editing raw/morph directly — diff1/diff2/options have
  // their own fullscreen views and hide this header entirely.
  function paintPaneHeader() {
    const header = $('diffPaneHeader');
    const label  = $('diffPaneHeaderLabel');
    const fileEl = $('diffPaneHeaderFile');
    const empty  = $('diffPaneEmpty');
    const wrap   = $('textAreaWrapper');
    if (!header) return;

    const showHeader = state.enabled && !state.activeDiffView;
    header.classList.toggle('active', showHeader);
    if (!showHeader) { if (empty) empty.classList.remove('show'); if (wrap) wrap.classList.remove('pane-empty'); return; }

    const pane = state.activePane;
    const targetId = pane === 'raw' ? state.rawNoteId : state.morphNoteId;
    const n = targetId ? noteById(targetId) : null;
    if (label) label.textContent = pane === 'raw' ? 'Raw' : 'Morph';
    if (fileEl) fileEl.textContent = n ? (n.title || ('note ' + n.id)) : 'No active selection';

    const isEmpty = !n;
    if (empty) empty.classList.toggle('show', isEmpty);
    if (wrap) wrap.classList.toggle('pane-empty', isEmpty);
    if (window.dexEditor && window.dexEditor.cm) {
      try { window.dexEditor.cm.setOption('readOnly', isEmpty); } catch (e) {}
    }
  }
  window.dexDiffPickFile = function () { if (state.enabled && !state.activeDiffView) openPicker(state.activePane); };

  function switchPane(pane) {
    if (!state.enabled) return;
    if (pane !== 'raw' && pane !== 'morph') return;

    if (typeof updateNoteMetadata === 'function') try { updateNoteMetadata(); } catch (e) {}
    syncActiveShadowFromEditor();

    state.activePane = pane;
    lsSet(LS.ACTIVE, pane);

    const targetId = pane === 'raw' ? state.rawNoteId : state.morphNoteId;
    if (!targetId) {
      paintBottomBar();
      showEditor();
      paintPaneHeader();
      return;
    }

    const n = noteById(targetId);
    if (!n) {
      if (pane === 'raw') { state.rawNoteId = null; lsSet(LS.RAW_ID, ''); }
      else                { state.morphNoteId = null; lsSet(LS.MORPH_ID, ''); }
      paintBottomBar();
      showEditor();
      paintPaneHeader();
      return;
    }

    if (typeof openNote === 'function') openNote(n.id);

    const inactive = pane === 'raw' ? 'morph' : 'raw';
    seedShadow(inactive);
    syncActiveShadowFromEditor();

    showEditor();
    paintBottomBar();
    paintPaneHeader();
    scheduleDiffusion(true);
  }
  window.switchDiffusionPane = switchPane;

  function showPickBanner(pane) {
    hidePickBanner();
    const sb = $('sidebar1');
    if (!sb) return;
    const b = document.createElement('div');
    b.id = 'diffPickBanner';
    b.className = 'diff-pick-banner';
    b.innerHTML = '<span>Pick a note for <b>' + (pane === 'raw' ? 'Raw' : 'Morph') + '</b></span>' +
                  '<button onclick="dexCancelPick()">Cancel</button>';
    sb.insertBefore(b, sb.firstChild);
  }
  function hidePickBanner() { const b = $('diffPickBanner'); if (b) b.remove(); }

  function openPicker(pane) {
    window.__dexNotePick = function (noteId) { bindPicked(pane, noteId); };
    // Issue 5c: sidebar1 highlights whichever note is currently bound to the
    // pane being picked for, in addition to the "Pick a note" banner.
    window.__dexPickActiveNoteId = pane === 'raw' ? state.rawNoteId : state.morphNoteId;
    const sb = $('sidebar1');
    if (sb) sb.classList.add('open');
    if (typeof renderSidebar === 'function') try { renderSidebar(); } catch (e) {}
    showPickBanner(pane);
    if (typeof showNotification === 'function') showNotification('Pick a note for ' + (pane === 'raw' ? 'Raw' : 'Morph'));
  }

  function bindPicked(pane, noteId) {
    if (!state.enabled) return;
    window.__dexNotePick = null;
    window.__dexPickActiveNoteId = null;
    hidePickBanner();
    const sb = $('sidebar1');
    if (sb) sb.classList.remove('open');
    const n = noteById(noteId);
    if (!n) return;
    if (pane === 'raw')  { state.rawNoteId   = String(n.id); lsSet(LS.RAW_ID,   n.id); }
    else                 { state.morphNoteId = String(n.id); lsSet(LS.MORPH_ID, n.id); }
    state.activePane = pane;
    lsSet(LS.ACTIVE, pane);
    if (typeof openNote === 'function') openNote(n.id);
    const inactive = pane === 'raw' ? 'morph' : 'raw';
    seedShadow(inactive);
    syncActiveShadowFromEditor();
    showEditor();
    paintBottomBar();
    paintPaneHeader();
    scheduleDiffusion(true);
    if (typeof showNotification === 'function') showNotification((pane === 'raw' ? 'Raw' : 'Morph') + ' ← ' + (n.title || 'note'));
  }

  window.dexCancelPick = function () {
    window.__dexNotePick = null;
    window.__dexPickActiveNoteId = null;
    hidePickBanner();
    const sb = $('sidebar1');
    if (sb) sb.classList.remove('open');
  };

  function enter() {
    if (state.enabled) return;
    if (typeof window.exitMermaidMode === 'function') try { window.exitMermaidMode(); } catch (e) {}
    if (typeof updateNoteMetadata === 'function') try { updateNoteMetadata(); } catch (e) {}

    const liveId    = (typeof currentNote !== 'undefined' && currentNote) ? String(currentNote.id) : null;
    const savedRaw   = lsGet(LS.RAW_ID);
    const savedMorph = lsGet(LS.MORPH_ID);
    const savedActive = lsGet(LS.ACTIVE);

    state.rawNoteId   = liveId || ((savedRaw && noteById(savedRaw)) ? savedRaw : null);
    state.morphNoteId = (savedMorph && noteById(savedMorph)) ? savedMorph : null;
    state.activePane  = (savedActive === 'morph' && state.morphNoteId) ? 'morph' : 'raw';
    state.enabled     = true;
    state.activeDiffView = null;

    lsSet(LS.ENABLED, '1');
    lsSet(LS.ACTIVE, state.activePane);
    lsSet(LS.RAW_ID, state.rawNoteId || '');
    lsSet(LS.MORPH_ID, state.morphNoteId || '');

    document.body.classList.add('mode-diffusion');
    const bb = $('diffBottombar');
    if (bb) bb.style.display = 'flex';
    ensureBottomBarWired();

    seedShadow('raw');
    seedShadow('morph');
    syncActiveShadowFromEditor();
    showEditor();
    paintBottomBar();
    paintPaneHeader();
    scheduleDiffusion(true);

    if (typeof showNotification === 'function') showNotification('Diffusion mode enabled — pick Morph to compare');
  }

  function exit() {
    if (!state.enabled) return;
    if (typeof updateNoteMetadata === 'function') try { updateNoteMetadata(); } catch (e) {}

    state.rawNoteId   = null;
    state.morphNoteId = null;
    state.enabled     = false;
    state.activePane  = 'raw';
    state.activeDiffView = null;

    lsSet(LS.ENABLED, '');
    lsSet(LS.ACTIVE, '');
    lsSet(LS.RAW_ID, '');
    lsSet(LS.MORPH_ID, '');

    document.body.classList.remove('mode-diffusion', 'diff-fullscreen');
    const bb = $('diffBottombar');
    if (bb) bb.style.display = 'none';
    if (window.__dexNotePick) window.__dexNotePick = null;
    window.__dexPickActiveNoteId = null;
    hidePickBanner();
    hideAllDiffViews();
    const header = $('diffPaneHeader');
    if (header) header.classList.remove('active');
    const empty = $('diffPaneEmpty');
    if (empty) empty.classList.remove('show');
    const wrap = $('textAreaWrapper');
    if (wrap) wrap.classList.remove('pane-empty');
    if (window.dexEditor && window.dexEditor.cm) {
      try { window.dexEditor.cm.setOption('readOnly', false); } catch (e) {}
    }
    const nc = document.querySelector('.note-container');
    if (nc) nc.style.display = '';

    if (typeof notes !== 'undefined' && Array.isArray(notes) && notes.length) {
      const sorted = notes.slice().sort((a, b) => {
        const ta = new Date(a.lastEdited || 0).getTime();
        const tb = new Date(b.lastEdited || 0).getTime();
        return tb - ta;
      });
      const latest = sorted[0];
      if (latest && typeof openNote === 'function') openNote(latest.id);
    }

    if (typeof showNotification === 'function') showNotification('Diffusion mode disabled');
  }

  window.enterDiffusionMode = enter;
  window.exitDiffusionMode = exit;

  function ensureBottomBarWired() {
    const bb = $('diffBottombar');
    if (!bb || bb.__dexWired) return;
    bb.__dexWired = true;
    bb.addEventListener('click', (e) => {
      const btn = e.target.closest('.diff-topbar-button');
      if (!btn) return;
      const target = btn.getAttribute('data-target');
      if (!target) return;
      handleBottomClick(target, btn);
    });
  }

  window.dexBottomClick = function (target, btn) {
    handleBottomClick(target, btn);
  };

  function handleBottomClick(target, btn) {
    if (!state.enabled) return;
    if (target === 'raw' || target === 'morph') {
      // Issue 5: clicking the already-active Raw/Morph tab no longer
      // auto-opens the integrated file manager. Switching the bound note now
      // goes through the pane header's "Select file" button, the empty-state
      // button, or sidebar1 (opened via the topbar toggle).
      switchPane(target);
      return;
    }
    showDiffView(target);
    paintBottomBar();
    paintPaneHeader();
  }

  function applyLineNumberState(on) {
    document.body.classList.toggle('show-line-numbers', !!on);
    if (window.dexEditor && typeof window.dexEditor.setLineNumbers === 'function') {
      window.dexEditor.setLineNumbers(!!on);
    }
  }

  // Scroll-sync between raw/morph/diff views is handled entirely by syncscroll.js;
  // this file no longer runs a second, competing sync-scroll implementation.

  function commitShadowToNote(type) {
    if (!state.enabled) return;
    const shadow = type === 'raw' ? (typeof diffElements !== 'undefined' && diffElements.raw)
                                  : (typeof diffElements !== 'undefined' && diffElements.morph);
    if (!shadow) return;
    const nid = type === 'raw' ? state.rawNoteId : state.morphNoteId;
    if (!nid) return;
    const n = noteById(nid);
    if (!n) return;
    if (n.content === shadow.value) return;
    n.content = shadow.value;
    n.lastEdited = new Date().toISOString();
    n._dirty = true;
    if (typeof saveNotes === 'function') try { saveNotes(); } catch (e) {}
    if (typeof populateNoteList === 'function') try { populateNoteList(); } catch (e) {}
    if (state.activePane === type) {
      if (window.dexEditor && typeof window.dexEditor.loadHistoryFor === 'function') {
        try { window.dexEditor.loadHistoryFor(n.id, n.content); } catch (e) {}
      } else if (window.dexEditor && typeof window.dexEditor.setValue === 'function') {
        try { window.dexEditor.setValue(n.content); } catch (e) {}
      }
    }
  }

  window.diffCommitPane = function (type) { commitShadowToNote(type); };

  window.diffSwapBindings = function () {
    if (!state.enabled) return;
    const tmp = state.rawNoteId;
    state.rawNoteId = state.morphNoteId;
    state.morphNoteId = tmp;
    lsSet(LS.RAW_ID, state.rawNoteId || '');
    lsSet(LS.MORPH_ID, state.morphNoteId || '');
    commitShadowToNote('raw');
    commitShadowToNote('morph');
    const activeId = state.activePane === 'raw' ? state.rawNoteId : state.morphNoteId;
    if (activeId && typeof openNote === 'function') try { openNote(activeId); } catch (e) {}
    paintBottomBar();
    paintPaneHeader();
  };

  function init() {
    wireEditor();
    ensureBottomBarWired();

    window.addEventListener('dexEditorReady', () => {
      if (window.dexEditor && typeof window.dexEditor.applyLanguageForCurrentNote === 'function') {
        try { window.dexEditor.applyLanguageForCurrentNote(); } catch (e) {}
      }
    });

    // FIX (line-numbers default): was using === '1', which treats an absent key
    // as false.  On a first visit localStorage.getItem() returns null, so the
    // old expression always evaluated to false and overrode the correct ON state
    // that editor.js and settings.js had already established via dexEditorReady.
    // Match the null-safe convention used everywhere else: absent key → ON,
    // stored '0' → OFF, anything else → ON.
    const _rawLineNum     = localStorage.getItem(LS.LINENUM);
    const wantLineNumbers = _rawLineNum === null ? true : _rawLineNum !== '0';
    applyLineNumberState(wantLineNumbers);

    const prismEnabled = localStorage.getItem('prismEnabled') === '1';
    document.body.classList.toggle('prism-off', !prismEnabled);

    const appThemeInit = localStorage.getItem('appTheme') === 'light' ? 'light' : 'dark';
    document.body.dataset.theme = appThemeInit;

    window.addEventListener('dexSettingsChanged', (e) => {
      if (!e || !e.detail) return;
      const k = e.detail.key;
      if (k === LS.LINENUM) {
        applyLineNumberState(!!e.detail.value);
      }
      if (k === 'prismEnabled') {
        document.body.classList.toggle('prism-off', !e.detail.value);
        if (window.dexEditor && typeof window.dexEditor.applyLanguageForCurrentNote === 'function') {
          try { window.dexEditor.applyLanguageForCurrentNote(); } catch (err) {}
        }
        if (!e.detail.value && state.activeDiffView) {
          const view = $(state.activeDiffView);
          if (view) view.querySelectorAll('.diff-content-cell').forEach(c => { delete c.dataset.dexHl; });
          try { if (typeof diffusion === 'function') diffusion(); } catch (err) {}
        } else {
          highlightVisibleDiffView();
        }
      }
      if (k === 'wrapText') {
        if (window.dexEditor && typeof window.dexEditor.setWrap === 'function') {
          window.dexEditor.setWrap(!!e.detail.value);
        }
      }
      if (k === 'cmTheme') {
        if (window.dexEditor && typeof window.dexEditor.setTheme === 'function') {
          window.dexEditor.setTheme(e.detail.value);
        }
      }
      if (k === 'appTheme') {
        const next = e.detail.value === 'light' ? 'light' : 'dark';
        document.body.dataset.theme = next;
        const cmExplicit = localStorage.getItem('cmTheme');
        if (!cmExplicit && window.dexEditor && typeof window.dexEditor.setTheme === 'function') {
          window.dexEditor.setTheme(next === 'light' ? 'eclipse' : 'dracula');
        }
      }
    });

    const t = $('sidebar1Toggle');
    if (t && !t.__dexInterceptWired) {
      t.__dexInterceptWired = true;
      t.addEventListener('click', (e) => {
        if (state.enabled && !state.activeDiffView) {
          const sb = $('sidebar1');
          if (sb && !sb.classList.contains('open')) {
            e.stopImmediatePropagation();
            openPicker(state.activePane);
          }
        }
      }, true);
    }
  }

  function waitForNotesThenInit() {
    let tries = 0;
    (function c() {
      if (typeof notes !== 'undefined' && Array.isArray(notes) && document.getElementById('noteTextarea')) return init();
      if (tries++ > 200) return init();
      setTimeout(c, 40);
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitForNotesThenInit);
  else waitForNotesThenInit();
})();
