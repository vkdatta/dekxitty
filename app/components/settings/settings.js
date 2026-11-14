import { getProforma, saveProforma, resetProforma, validateProforma, listPatterns, recognise, DEFAULT_PROFORMA, describeDelimiter, parseDelimiterInput } from "../../js/modes/csvexec/recogniser.js";

/**
 * Settings are split in two:
 *   App  — general, for every note (editor look, theme, the table pattern pro-forma).
 *   Note — specific to the note that is open (exclusive modes; for a .csv note the
 *          semantic table recogniser: pattern + delimiter, stored on note.csvSettings).
 */
export function createSettingsManager() {
  if (window.settingsInitialized) {
    // Must return the same callable opener as the fresh-init path below,
    // not the plain API object — callers always invoke this as a function.
    return window.__dexOpenSettingsManager || null;
  }

  const LS = {
    LINENUM:   'showLineNumbers',
    PRISM:     'prismEnabled',
    WRAP:      'wrapText',
    THEME:     'appTheme',
    CMTHEME:   'cmTheme',
    DIFFUSION: 'diffusionEnabled',
    MERMAID:   'mermaidEnabled'
  };

  // Themes are defined in app/css/cm-themes.css. Keep ids in sync with
  // editor.js. `id` is what is stored and used as the CSS class (cm-s-<id>).
  const THEME_LABELS = {
    'mint-night': 'Mint Night', 'cream-ink': 'Cream Ink', 'deep-teal': 'Deep Teal',
    'midnight-indigo': 'Midnight Indigo', 'ember-moss': 'Ember Moss',
    'deep-ocean': 'Deep Ocean', 'peacock-lagoon': 'Peacock Lagoon',
    'mint-paper': 'Mint Paper', 'sea-glass': 'Sea Glass', 'pistachio': 'Pistachio',
    'frost-lilac': 'Frost Lilac', 'linen-mint': 'Linen Mint',
    'sea-breeze': 'Sea Breeze', 'turquoise-shore': 'Turquoise Shore'
  };
  const DARK_THEMES = [
    'mint-night','cream-ink','deep-teal','midnight-indigo','ember-moss',
    'deep-ocean','peacock-lagoon'
  ];
  const LIGHT_THEMES = [
    'mint-paper','sea-glass','pistachio','frost-lilac','linen-mint',
    'sea-breeze','turquoise-shore'
  ];
  const ALL_THEMES = new Set([...DARK_THEMES, ...LIGHT_THEMES]);
  const DEFAULT_CM_DARK  = 'mint-night';
  const DEFAULT_CM_LIGHT = 'mint-paper';
  const themeLabel = (id) => THEME_LABELS[id] || id;

  function lsRead(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsWrite(k, v) {
    try { if (v == null || v === '') localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) {}
  }
  function lsBool(k, def) {
    const v = lsRead(k);
    if (v == null) return !!def;
    return v === '1' || v === 'true';
  }
  // FIX (defaults): was writing null (removing the key) for false. With the
  // new defaults-ON behaviour, a missing key now means ON, so we must write
  // an explicit '0' when the user turns a feature off — otherwise the
  // preference is indistinguishable from "never set" and would snap back to
  // ON on the next page load.
  function lsSet(k, v) { lsWrite(k, v ? '1' : '0'); }
  // FIX (exclusive modes never opened): this used to delegate to
  // window.dexParseNoteRoute, documented as living in dpad/dpad-layout.js. That
  // file no longer exists, so the function was undefined, the route was always
  // null, and every toggle bailed out with "Open a note first" even with a note
  // open. The parser is now defined here (and published on window for anyone
  // else who wants it) so settings no longer depends on another component.
  //
  // Matches "/note/<id>" and "/note/<id>/<mode>" — the same shape that
  // handlePopState() in index.html understands.
  function parseNoteRoute(pathname) {
    const m = String(pathname || '').match(/^\/note\/([^/]+)(?:\/([a-zA-Z0-9_-]+))?\/?$/);
    if (!m) return null;
    let id = m[1];
    try { id = decodeURIComponent(id); } catch (e) {}
    return { id, mode: m[2] || 'base' };
  }
  if (typeof window.dexParseNoteRoute !== 'function') window.dexParseNoteRoute = parseNoteRoute;

  function currentNoteRoute() { return parseNoteRoute(location.pathname); }

  // The note the user is looking at. The URL is the primary source, but the app
  // can be showing a note without a /note/<id> URL (e.g. opened from the
  // sidebar before pushState settles, or a host that rewrites paths), so fall
  // back to the live `currentNote` binding instead of refusing to work.
  function currentNoteIdFromUrl() {
    const route = currentNoteRoute();
    if (route && route.id) return route.id;
    try {
      if (typeof currentNote !== 'undefined' && currentNote && currentNote.id != null) return String(currentNote.id);
    } catch (e) {}
    return null;
  }
  function currentModeFromUrl() {
    const route = currentNoteRoute();
    return route ? route.mode : null;
  }
  // Truth about which exclusive mode is live comes from the modes themselves;
  // the URL / localStorage are only fallbacks for before the modes finish loading.
  function exclusiveModeActive(which) {
    if (which === 'diffusion' && window.dexMode) return !!window.dexMode.enabled;
    if (which === 'mermaid' && window.dexMermaidMode) return !!window.dexMermaidMode.enabled;
    const urlMode = currentModeFromUrl();
    return urlMode ? (urlMode === which) : lsBool(which === 'diffusion' ? LS.DIFFUSION : LS.MERMAID);
  }

  function fire(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (e) {
      console.error('[settings] event dispatch failed:', name, e);
    }
  }

  function applyTheme(theme) {
    const html = document.documentElement;
    if (!html) return;
    if (theme === 'light') {
      html.setAttribute('data-theme', 'light');
      html.setAttribute('data-cm-tone', 'light');
    } else {
      html.removeAttribute('data-theme');
      html.setAttribute('data-cm-tone', 'dark');
    }
  }

  applyTheme(lsRead(LS.THEME) === 'dark' ? 'dark' : 'light');

  // Single source of truth for "does the explicit CM theme still match the
  // active tone, and if not, reset it to the tone's default" — used by both
  // the settings-changed event handler and the direct click handler below,
  // so the two can't drift apart.
  function ensureCmThemeMatchesTone(tone) {
    const cmExplicit = lsRead(LS.CMTHEME);
    const validSet = (tone === 'light') ? LIGHT_THEMES : DARK_THEMES;
    if (!cmExplicit || !validSet.includes(cmExplicit)) {
      const followTheme = (tone === 'light' ? DEFAULT_CM_LIGHT : DEFAULT_CM_DARK);
      lsWrite(LS.CMTHEME, followTheme);
      applyCmThemeToEditor(followTheme);
      fire('dexSettingsChanged', { key: LS.CMTHEME, value: followTheme });
    }
  }

  function onDexSettingsChanged(e) {
    if (!e || !e.detail) return;
    const k = e.detail.key;
    if (k === LS.THEME) {
      const next = e.detail.value === 'dark' ? 'dark' : 'light';
      applyTheme(next);
      ensureCmThemeMatchesTone(next);
      paint();
    }
    if (k === LS.LINENUM) {
      applyLineNumbersToEditor(!!e.detail.value);
      paint();
    }
    if (k === LS.WRAP) {
      applyWrapToEditor(!!e.detail.value);
      paint();
    }
    if (k === LS.PRISM) {
      applyPrismToEditor(!!e.detail.value);
      paint();
    }
    if (k === LS.CMTHEME) {
      applyCmThemeToEditor(e.detail.value);
      paint();
    }
  }
  window.addEventListener('dexSettingsChanged', onDexSettingsChanged);
  // the Note tab follows whichever note is open (only repaint while the panel is on screen)
  const NOTE_EVENTS = ['dexNoteOpened', 'dexViewModeChanged', 'dexCsvRecognised'];
  function onNoteEvent() { if (overlay && overlay.style.display !== 'none') paint(); }
  NOTE_EVENTS.forEach((ev) => window.addEventListener(ev, onNoteEvent));


  function applyLineNumbersToEditor(on) {
    if (window.dexEditor && typeof window.dexEditor.setLineNumbers === 'function') {
      try { window.dexEditor.setLineNumbers(!!on); } catch (e) {}
    }
  }

  function applyWrapToEditor(on) {
    if (window.dexEditor && typeof window.dexEditor.setWrap === 'function') {
      try { window.dexEditor.setWrap(!!on); } catch (e) {}
    }
  }

  function applyPrismToEditor(on) {
    if (window.dexEditor && typeof window.dexEditor.applyLanguageForCurrentNote === 'function') {
      try { window.dexEditor.applyLanguageForCurrentNote(); } catch (e) {}
    }
    document.body.classList.toggle('prism-off', !on);
  }

  function applyCmThemeToEditor(name) {
    if (!name) return;
    if (window.dexEditor && typeof window.dexEditor.setTheme === 'function') {
      try { window.dexEditor.setTheme(name); } catch (e) {}
    }
  }

  function restoreAllSettingsToEditor() {
    // FIX (defaults): pass true as the second arg so lsBool returns true when
    // the key is absent (first visit / cleared storage) — matching the new
    // default-ON behaviour in editor.js.
    applyLineNumbersToEditor(lsBool(LS.LINENUM, true));
    applyWrapToEditor(lsBool(LS.WRAP, true));
    applyPrismToEditor(lsBool(LS.PRISM, true));
    const cmTheme = currentCmTheme();
    applyCmThemeToEditor(cmTheme);
  }

  restoreAllSettingsToEditor();
  window.addEventListener('dexEditorReady', restoreAllSettingsToEditor);

  const overlay = document.createElement('div');
  overlay.id = 'settingsoverlay';
  overlay.style.display = 'none';
  overlay.innerHTML = `
    <div id="settingsheader">
      <div id="settingstitle">Settings</div>
      <button id="settingsclose">Close</button>
    </div>
    <div id="settingsbody">
      <div class="settings-tabs">
        <button class="settings-tab active" data-tab="app" type="button">App</button>
        <button class="settings-tab" data-tab="note" type="button">Note</button>
      </div>
      <div class="settings-tab-panel active" data-panel="app">
        <div class="settings-section-hint">General settings — they apply to every note.</div>
        <div class="settings-section">
          <div class="settings-section-title">Syntax</div>
          <div class="settings-item" data-key="CMTHEME" id="cmThemeRow">
            <div class="settings-item-text">
              <div class="settings-item-label">Editor theme</div>
              <div class="settings-item-desc">CodeMirror colour scheme. Editor background stays uniform (#000 for dark themes, #cacaca for light).</div>
            </div>
            <div class="settings-row-value" id="cmThemeCurrent">Mint Night</div>
            <div class="settings-row-chevron">›</div>
          </div>
          <div class="settings-item" data-key="PRISM">
            <div class="settings-item-text">
              <div class="settings-item-label">Enable syntax highlighting</div>
              <div class="settings-item-desc">Colors code based on the note's file extension. When off, notes render as plain text.</div>
            </div>
            <div class="settings-toggle" aria-hidden="true"></div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">Text</div>
          <div class="settings-item" data-key="LINENUM">
            <div class="settings-item-text">
              <div class="settings-item-label">Show line numbers</div>
              <div class="settings-item-desc">Renders a native CodeMirror gutter beside the editor.</div>
            </div>
            <div class="settings-toggle" aria-hidden="true"></div>
          </div>
          <div class="settings-item" data-key="WRAP">
            <div class="settings-item-text">
              <div class="settings-item-label">Wrap text</div>
              <div class="settings-item-desc">When off, long lines scroll horizontally (best for code). When on, lines wrap to the viewport (best for prose).</div>
            </div>
            <div class="settings-toggle" aria-hidden="true"></div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">Theme</div>
          <div class="settings-item" data-key="THEME">
            <div class="settings-item-text">
              <div class="settings-item-label">Light theme</div>
              <div class="settings-item-desc">Switches the app between dark (default) and light appearance. Editor theme adjusts automatically if you haven't picked one.</div>
            </div>
            <div class="settings-toggle" aria-hidden="true"></div>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-title">Tables</div>
          <div class="settings-item" data-key="PROFORMA">
            <div class="settings-item-text">
              <div class="settings-item-label">Table pattern pro-forma</div>
              <div class="settings-item-desc">Every pattern the csv recogniser knows — its engine, regexes, boundary rules and thresholds — as editable JSON. Disable, reorder, tune or add patterns. Applies to all notes.</div>
            </div>
            <div class="settings-row-value" id="proformaCount"></div>
            <div class="settings-row-chevron">›</div>
          </div>
        </div>
      </div>
      <div class="settings-tab-panel" data-panel="note">
        <div class="settings-note-head" id="noteSettingsHead"></div>
        <div class="settings-section-hint" id="noteSettingsEmpty">Open a note to see its settings.</div>
        <div id="noteSettingsBody">
          <div class="settings-section-hint">Specific to this note only.</div>
          <div class="settings-section" id="noteModesSection">
            <div class="settings-section-title">Exclusive modes</div>
            <div class="settings-section-hint">Only one exclusive mode can be active.</div>
            <div class="settings-item" data-key="DIFFUSION">
              <div class="settings-item-text">
                <div class="settings-item-label">Enable Diffusion algorithm</div>
                <div class="settings-item-desc">Adds Raw / Morph / Diff 1 / Diff 2 / Options to a bottom bar. Raw is seeded from the current note; Morph is chosen via the file picker.</div>
              </div>
              <div class="settings-toggle" aria-hidden="true"></div>
            </div>
            <div class="settings-item" data-key="MERMAID">
              <div class="settings-item-text">
                <div class="settings-item-label">Enable Mermaid Flow</div>
                <div class="settings-item-desc">Adds Code / Flow / Tune to a bottom bar. Code is typed directly or picked from a note via the file picker; Flow renders it live; Tune adjusts diagram colors and font.</div>
              </div>
              <div class="settings-toggle" aria-hidden="true"></div>
            </div>
          </div>
          <div class="settings-section" id="noteCsvSection">
            <div class="settings-section-title">Table recogniser</div>
            <div class="settings-section-hint">Reads bare text in this .csv note as a table (semantic and structural, no AI). Used in exec view; the note's text is rewritten as CSV when you first edit the grid.</div>
            <div class="settings-item" data-key="CSVPATTERN">
              <div class="settings-item-text">
                <div class="settings-item-label">Recogniser pattern</div>
                <div class="settings-item-desc">Auto-detect picks the best-fitting pattern. If it guesses wrong, choose the pattern yourself.</div>
              </div>
              <div class="settings-row-value" id="csvPatternCurrent">Auto-detect</div>
              <div class="settings-row-chevron">›</div>
            </div>
            <div class="settings-item" data-key="CSVDELIM">
              <div class="settings-item-text">
                <div class="settings-item-label">Delimiter</div>
                <div class="settings-item-desc">Auto, or your own separator (tab, comma, ;, |, ::, …). A delimiter set here is used exactly.</div>
              </div>
              <div class="settings-row-value" id="csvDelimCurrent">Auto</div>
              <div class="settings-row-chevron">›</div>
            </div>
            <div class="settings-item settings-item-info" data-key="CSVDETECT">
              <div class="settings-item-text">
                <div class="settings-item-label">Read as</div>
                <div class="settings-item-desc">What the recogniser made of this note's text right now.</div>
              </div>
              <div class="settings-row-value" id="csvDetectCurrent">—</div>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-footnote">Changes save automatically.</div>
    </div>
  `;
  if (document.body) document.body.appendChild(overlay);
  else {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { if (document.body) document.body.appendChild(overlay); });
    }
  }

  const tabListeners = [];
  overlay.querySelectorAll('.settings-tab').forEach(tab => {
    const fn = () => {
      const target = tab.getAttribute('data-tab');
      overlay.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === tab));
      overlay.querySelectorAll('.settings-tab-panel').forEach(p => {
        p.classList.toggle('active', p.getAttribute('data-panel') === target);
      });
    };
    tab.addEventListener('click', fn);
    tabListeners.push({ el: tab, fn });
  });

  const closeBtn = overlay.querySelector('#settingsclose');
  const onCloseClick = () => { overlay.style.display = 'none'; };
  closeBtn.addEventListener('click', onCloseClick);

  function onKeydown(e) {
    if (e.key === 'Escape' && overlay.style.display !== 'none') overlay.style.display = 'none';
  }
  document.addEventListener('keydown', onKeydown);

  function onRouteChange() { overlay.style.display = 'none'; }
  window.addEventListener('popstate', onRouteChange);
  window.addEventListener('hashchange', onRouteChange);

  function currentAppTheme() {
    // Light is the default: an absent key means light; only 'dark' is stored.
    return lsRead(LS.THEME) === 'dark' ? 'dark' : 'light';
  }

  function currentCmTheme() {
    const explicit = lsRead(LS.CMTHEME);
    const tone = currentAppTheme(); 
    const validSet = (tone === 'light') ? LIGHT_THEMES : DARK_THEMES;
    if (explicit && ALL_THEMES.has(explicit) && validSet.includes(explicit)) return explicit;
    return (tone === 'light' ? DEFAULT_CM_LIGHT : DEFAULT_CM_DARK);
  }

  function paint() {
    overlay.querySelectorAll('.settings-item').forEach(item => {
      const key = item.getAttribute('data-key');
      if (key === 'CMTHEME' || key === 'PROFORMA' || key.indexOf('CSV') === 0) return;   // value rows, painted below

      let on = false;
      if (key === 'THEME') {
        on = currentAppTheme() === 'light';
      } else if (key === 'LINENUM' && window.dexEditor && window.dexEditor.cm) {
        on = !!window.dexEditor.cm.getOption('lineNumbers');
      } else if (key === 'LINENUM') {
        on = lsBool(LS.LINENUM, true); // fallback: absent key → ON
      } else if (key === 'WRAP' && window.dexEditor && window.dexEditor.cm) {
        on = !!window.dexEditor.cm.getOption('lineWrapping');
      } else if (key === 'WRAP') {
        on = lsBool(LS.WRAP, true);    // fallback: absent key → ON
      } else if (key === 'PRISM') {
        on = lsBool(LS.PRISM, true); // FIX (defaults): absent key → default ON
      } else if (key === 'DIFFUSION') {
        on = exclusiveModeActive('diffusion');
      } else if (key === 'MERMAID') {
        on = exclusiveModeActive('mermaid');
      } else {
        on = lsBool(LS[key]);
      }
      item.classList.toggle('on', on);
    });

    const cur = overlay.querySelector('#cmThemeCurrent');
    if (cur) {
      let displayed = currentCmTheme();
      if (window.dexEditor && window.dexEditor.cm) {
        const actualTheme = window.dexEditor.cm.getOption('theme');
        if (actualTheme) displayed = actualTheme;
      }
      cur.textContent = themeLabel(displayed);
    }
    paintNote();
    paintProforma();
  }

  /* ───────────────────────── note settings (this note only) ───────────────────────── */

  function noteNow() {
    try { if (typeof currentNote !== 'undefined' && currentNote) return currentNote; } catch (e) {}
    return null;
  }
  const isCsvNote = (n) => !!n && String(n.extension || '').toLowerCase() === 'csv';

  function patternLabel(id) {
    if (!id || id === 'auto') return 'Auto-detect';
    if (id === 'plain') return 'Plain CSV / TSV';
    const hit = listPatterns(getProforma()).find((p) => p.id === id);
    return hit ? hit.label : id + ' (not in pro-forma)';
  }

  /** Change this note's recogniser settings. "auto" + no delimiter is the default, so nothing is stored for it. */
  function setNoteCsv(patch) {
    const n = noteNow();
    if (!n) return;
    const cur = Object.assign({ pattern: 'auto', delimiter: '' }, n.csvSettings || {}, patch);
    if (cur.pattern === 'auto' && !cur.delimiter) delete n.csvSettings;
    else n.csvSettings = { pattern: cur.pattern, delimiter: cur.delimiter };
    try { if (typeof saveNotes === 'function') saveNotes(); } catch (e) {}
    fire('dexNoteSettingsChanged', { note: n, key: 'csv', value: n.csvSettings || null });
    paint();
  }

  function paintNote() {
    const n = noteNow();
    const $ = (id) => overlay.querySelector(id);
    const head = $('#noteSettingsHead'), empty = $('#noteSettingsEmpty'), body = $('#noteSettingsBody'), csv = $('#noteCsvSection');
    if (!head || !body) return;
    head.style.display = n ? '' : 'none';
    empty.style.display = n ? 'none' : '';
    body.style.display = n ? '' : 'none';
    if (!n) return;
    head.textContent = (n.title || 'untitled') + (n.extension ? '.' + n.extension : '');
    csv.style.display = isCsvNote(n) ? '' : 'none';
    if (!isCsvNote(n)) return;
    const c = n.csvSettings || {};
    $('#csvPatternCurrent').textContent = patternLabel(c.pattern);
    $('#csvDelimCurrent').textContent = describeDelimiter(c.delimiter);
    let rec = null;
    const info = typeof window.dexCsvInfo === 'function' ? window.dexCsvInfo() : null;
    if (info && info.note && String(info.note.id) === String(n.id)) rec = info.rec;
    if (!rec) { try { rec = recognise(n.csvSrc ? n.csvSrc.raw : (n.content || ''), n.csvSettings || null); } catch (e) {} }
    $('#csvDetectCurrent').textContent = rec
      ? `${rec.label}${rec.forced ? ' (your choice)' : ''} · ${rec.rows.length} × ${rec.rows.reduce((m, r) => Math.max(m, r.length), 0)}`
      : '—';
  }

  function paintProforma() {
    const el = overlay.querySelector('#proformaCount');
    if (!el) return;
    const pf = getProforma();
    el.textContent = `${pf.patterns.filter((p) => p.enabled !== false).length} patterns`;
  }

  /** Show a modal above the settings overlay (which steps aside while it is open). */
  async function modalOver(options, onOpen) {
    if (typeof window.showModal !== 'function') { console.warn('[settings] showModal not available'); return null; }
    const prevDisplay = overlay.style.display;
    overlay.style.display = 'none';
    try {
      const p = window.showModal(options);
      if (onOpen) onOpen();
      return await p;
    } finally {
      if (overlay.style.display === 'none') overlay.style.display = prevDisplay;
    }
  }
  const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const footerButtons = (defs) => {
    const f = document.createElement('div');
    f.style.display = 'contents';
    defs.forEach((d) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = d.label;
      b.setAttribute('onclick', 'void 0');            // keeps the modal's own default handler off this button
      b.addEventListener('click', d.fn);
      f.appendChild(b);
    });
    return f;
  };

  async function openPatternModal() {
    const n = noteNow();
    if (!isCsvNote(n)) return;
    const cur = (n.csvSettings && n.csvSettings.pattern) || 'auto';
    const items = [{ id: 'auto', label: 'Auto-detect', description: 'Picks the best-fitting pattern from the pro-forma.' }]
      .concat(listPatterns(getProforma()))
      .concat([{ id: 'plain', label: 'Plain CSV / TSV', description: 'No transformation — read the text as ordinary separated values.' }]);
    const body = items.map((it) =>
      `<button class="theme-pick pick-item${it.id === cur ? ' theme-pick-active' : ''}" data-pattern="${escHtml(it.id)}"><span class="pick-label">${escHtml(it.label)}</span><span class="pick-desc">${escHtml(it.description || '')}</span></button>`).join('');
    const onPick = (e) => {
      const btn = e.target.closest('.pick-item');
      if (!btn) return;
      e.stopPropagation();
      if (typeof window.closeModal === 'function') window.closeModal({ action: 'submit', pattern: btn.getAttribute('data-pattern') });
    };
    document.addEventListener('click', onPick, true);
    let r = null;
    try {
      r = await modalOver({
        header: `<div class="modal-title">Recogniser pattern</div>`,
        body: `<div id="theme-picker-container">${body}</div>`,
        footer: `<button id="pattern-picker-cancel">Cancel</button>`,
        html: true
      });
    } finally { document.removeEventListener('click', onPick, true); }
    if (!r || r.action !== 'submit' || !r.pattern) return;
    setNoteCsv({ pattern: r.pattern });
  }

  async function openDelimiterModal() {
    const n = noteNow();
    if (!isCsvNote(n)) return;
    const cur = (n.csvSettings && n.csvSettings.delimiter) || '';
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="pf-hint">Leave empty for Auto. Type a name (tab, comma, semicolon, pipe, space, colon), an escape like \\t, or any text such as :: or ->.</div>
      <div class="csv-delim-chips">
        ${['Auto', 'Tab', 'Comma', 'Semicolon', 'Pipe', 'Space'].map((c) => `<button type="button" class="csv-delim-chip">${c}</button>`).join('')}
      </div>
      <input type="text" class="modal-input" id="csvDelimInput" placeholder="Auto" autocomplete="off" spellcheck="false" data-skip-validation>`;
    const input = wrap.querySelector('#csvDelimInput');
    input.value = cur === '\t' ? 'Tab' : cur;
    wrap.querySelectorAll('.csv-delim-chip').forEach((chip) => chip.addEventListener('click', () => { input.value = chip.textContent === 'Auto' ? '' : chip.textContent; input.focus(); }));
    const save = () => { if (typeof window.closeModal === 'function') window.closeModal({ action: 'submit', delimiter: parseDelimiterInput(input.value) }); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    const r = await modalOver({
      header: `<div class="modal-title">Delimiter</div>`,
      body: wrap,
      footer: footerButtons([{ label: 'Cancel', fn: () => window.closeModal && window.closeModal(null) }, { label: 'Save', fn: save }]),
    }, () => setTimeout(() => input.focus(), 30));
    if (!r || r.action !== 'submit') return;
    setNoteCsv({ delimiter: r.delimiter });
  }

  /* ───────────────────────── app settings: the pro-forma ───────────────────────── */

  async function openProformaModal() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="pf-hint">One entry per pattern, tried by score (ties: top first). <b>engine</b> = algorithm (pipe, delimited, regex, runs, glued, vertical); <b>params</b> = its rules. Set <code>"enabled": false</code> to switch a pattern off, reorder entries to change priority, or add your own (e.g. engine <code>delimited</code> with another delimiter, or engine <code>regex</code> with your own splitRegex). <b>common</b> holds the number rule, empty-cell markers and thresholds.</div>
      <textarea class="pf-textarea" id="pfText" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
      <div class="pf-error" id="pfError"></div>`;
    const ta = wrap.querySelector('#pfText'), err = wrap.querySelector('#pfError');
    ta.value = JSON.stringify(getProforma(), null, 2);
    const save = () => {
      let pf;
      try { pf = JSON.parse(ta.value); } catch (e) { err.textContent = 'Not valid JSON: ' + e.message; return; }
      const v = validateProforma(pf);
      if (!v.ok) { err.textContent = v.error; return; }
      const w = saveProforma(pf);
      if (!w.ok) { err.textContent = w.error; return; }
      if (typeof window.closeModal === 'function') window.closeModal({ action: 'submit' });
    };
    const r = await modalOver({
      header: `<div class="modal-title">Table pattern pro-forma</div>`,
      body: wrap,
      footer: footerButtons([
        { label: 'Cancel', fn: () => window.closeModal && window.closeModal(null) },
        { label: 'Reset to default', fn: () => { ta.value = JSON.stringify(DEFAULT_PROFORMA, null, 2); err.textContent = 'Default restored — press Save to apply.'; } },
        { label: 'Save', fn: save }
      ]),
    });
    if (!r || r.action !== 'submit') return;
    // saving the untouched default means "no custom pro-forma": drop the stored copy so future default improvements apply
    if (JSON.stringify(getProforma()) === JSON.stringify(DEFAULT_PROFORMA)) resetProforma();
    fire('dexProformaChanged', {});
    paint();
  }

  function makeThemePickerHtml(current, tone) {
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const buildRows = (arr) => arr.map(t => {
      const active = (t === current);
      return `<button class="theme-pick${active ? ' theme-pick-active' : ''}" data-theme="${esc(t)}">${esc(themeLabel(t))}</button>`;
    }).join('');
    const themesToShow = (tone === 'light') ? LIGHT_THEMES : DARK_THEMES;
    const groupTitle = (tone === 'light') ? 'Light' : 'Dark';
    return `
      <div id="theme-picker-container">
        <div class="theme-group-title">${groupTitle}</div>
        ${buildRows(themesToShow)}
      </div>
    `;
  }

  async function openThemeModal() {
    if (typeof window.showModal !== 'function') {
      console.warn('[settings] showModal not available; cannot open theme picker');
      return;
    }
    const cur = currentCmTheme();
    const tone = currentAppTheme(); 
    const bodyHtml = makeThemePickerHtml(cur, tone);

    const prevDisplay = overlay.style.display;
    overlay.style.display = 'none';
    let r = null;

    function onThemePick(e) {
      const btn = e.target.closest('.theme-pick');
      if (!btn) return;
      const theme = btn.getAttribute('data-theme');
      if (!theme) return;
      e.stopPropagation();
      if (typeof window.closeModal === 'function') {
        window.closeModal({ action: 'submit', theme });
      }
    }
    document.addEventListener('click', onThemePick, true);

    try {
      r = await window.showModal({
        header: `<div class="modal-title">Editor theme</div>`,
        body: bodyHtml,
        footer: `<button id="theme-picker-cancel">Cancel</button>`,
        html: true
      });
    } finally {
      document.removeEventListener('click', onThemePick, true);
      if (overlay.style.display === 'none') {
        overlay.style.display = prevDisplay;
      }
    }
    if (!r || r.action !== 'submit' || !r.theme) return;

    const chosen = String(r.theme).trim();
    if (!ALL_THEMES.has(chosen)) {
      console.warn('[settings] Ignoring unknown theme:', chosen);
      return;
    }

    lsWrite(LS.CMTHEME, chosen);
    applyCmThemeToEditor(chosen);
    fire('dexSettingsChanged', { key: LS.CMTHEME, value: chosen });
    paint();
  }

  function onOverlayClick(e) {
    const item = e.target.closest('.settings-item');
    if (!item) return;
    const key = item.getAttribute('data-key');

    if (key === 'CMTHEME') {
      openThemeModal();
      return;
    }
    if (key === 'CSVPATTERN') { openPatternModal(); return; }
    if (key === 'CSVDELIM') { openDelimiterModal(); return; }
    if (key === 'PROFORMA') { openProformaModal(); return; }
    if (key === 'CSVDETECT') return;

    if (key === 'DIFFUSION' || key === 'MERMAID') {
      if (typeof window.showNoteApp !== 'function') {
        console.warn('[settings] showNoteApp not available');
        if (typeof showNotification === 'function') showNotification('Not available right now');
        return;
      }
      const nid = currentNoteIdFromUrl();
      if (!nid) {
        console.warn('[settings] no note open to toggle an exclusive mode on');
        if (typeof showNotification === 'function') showNotification('Open a note first');
        return;
      }
      const wantMode = key === 'DIFFUSION' ? 'diffusion' : 'mermaid';
      const active = exclusiveModeActive(wantMode);
      const targetMode = active ? 'base' : wantMode;
      window.showNoteApp(nid, targetMode);
      paint();

    } else if (key === 'THEME') {
      const cur = currentAppTheme();
      const next = cur === 'light' ? 'dark' : 'light';
      lsWrite(LS.THEME, next === 'dark' ? 'dark' : null);
      applyTheme(next);
      ensureCmThemeMatchesTone(next);
      fire('dexSettingsChanged', { key: LS.THEME, value: next });

    } else if (key === 'LINENUM') {
      const cur = lsBool(LS.LINENUM, true); // FIX (defaults): absent key → ON
      const next = !cur;
      lsSet(LS.LINENUM, next);
      applyLineNumbersToEditor(next);
      fire('dexSettingsChanged', { key: LS.LINENUM, value: next });

    } else if (key === 'WRAP') {
      const cur = lsBool(LS.WRAP, true); // FIX (defaults): absent key → ON
      const next = !cur;
      lsSet(LS.WRAP, next);
      applyWrapToEditor(next);
      fire('dexSettingsChanged', { key: LS.WRAP, value: next });

    } else if (key === 'PRISM') {
      const cur = lsBool(LS.PRISM, true); // FIX (defaults): absent key → ON
      const next = !cur;
      lsSet(LS.PRISM, next);
      applyPrismToEditor(next);
      fire('dexSettingsChanged', { key: LS.PRISM, value: next });
    }

    paint();
  }
  overlay.addEventListener('click', onOverlayClick);

  function destroy() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    window.removeEventListener('dexSettingsChanged', onDexSettingsChanged);
    NOTE_EVENTS.forEach((ev) => window.removeEventListener(ev, onNoteEvent));
    window.removeEventListener('dexEditorReady', restoreAllSettingsToEditor);
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('popstate', onRouteChange);
    window.removeEventListener('hashchange', onRouteChange);
    overlay.removeEventListener('click', onOverlayClick);
    tabListeners.forEach(({ el, fn }) => el.removeEventListener('click', fn));
    closeBtn.removeEventListener('click', onCloseClick);
    window.settingsInitialized = false;
    window.__settingsManagerAPI = null;
    window.__dexOpenSettingsManager = null;
  }

  const api = {
    hide: () => { overlay.style.display = 'none'; },
    show: () => { overlay.style.display = 'flex'; paint(); },
    destroy,
    paint,
    restoreAllSettingsToEditor
  };
  window.__settingsManagerAPI = api;

  window.settingsInitialized = true;

  function openSettingsManager() {
    paint();
    overlay.style.display = 'flex';
    return api;
  }
  window.__dexOpenSettingsManager = openSettingsManager;
  return openSettingsManager;
}
