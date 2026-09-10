(function () {
  function boot() {
    const nt = document.getElementById('noteTextarea');
    if (!nt) { setTimeout(boot, 40); return; }
    if (typeof CodeMirror === 'undefined') { setTimeout(boot, 40); return; }
    // FIX (fold race): loadScript() uses dynamic <script> injection. Despite
    // async=false being set, that flag only enforces order for parser-inserted
    // (markup) scripts — for dynamically injected ones the browser ignores it
    // and fetches/executes them in arrival order. foldcode.min.js and
    // foldgutter.min.js can therefore lose the race against editor.js, leaving
    // CodeMirror.prototype.foldCode undefined when hasFoldGutter is evaluated
    // below. The CM instance is then created without gutters/foldGutter, and
    // those options cannot be added after fromTextArea() without destroying and
    // recreating the editor. Waiting here until foldCode is present guarantees
    // the addon has fully executed before we commit to a CM configuration.
    if (typeof CodeMirror.prototype.foldCode !== 'function') { setTimeout(boot, 40); return; }
    if (window.dexEditor) return; 

    const proto = HTMLTextAreaElement.prototype;
    const valueDesc = Object.getOwnPropertyDescriptor(proto, 'value') || {};
    const nativeSetValue = valueDesc.set ? valueDesc.set.bind(nt) : (v) => { proto.value = v; };

    CodeMirror.modeURL = "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/%N/%N.min.js";

    const THEME_BASE = "https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/";
    const loadedThemes = new Set(['dracula']);
    const pendingThemeCallbacks = {};

    const LIGHT_CM_THEMES = new Set([
      '3024-day','base16-light','duotone-light','eclipse','elegant','idea','mdn-like',
      'neat','neo','paraiso-light','solarized light','ssms','ttcn','xq-light','yeti'
    ]);
    function applyCmToneAttr(themeName) {
      const tone = LIGHT_CM_THEMES.has(String(themeName || '').trim()) ? 'light' : 'dark';
      document.documentElement.dataset.cmTone = tone;
    }

    function cssFileForTheme(name) {
      const n = String(name || '').trim();
      if (n === 'solarized dark' || n === 'solarized light') return 'solarized.min.css';
      return n.replace(/\s+/g, '-') + '.min.css';
    }
    function ensureThemeLoaded(name, cb) {
      const key = String(name || '').trim();
      if (!key || loadedThemes.has(key)) { if (cb) cb(); return; }
      if (pendingThemeCallbacks[key]) { if (cb) pendingThemeCallbacks[key].push(cb); return; }
      pendingThemeCallbacks[key] = cb ? [cb] : [];
      const href = THEME_BASE + cssFileForTheme(key);
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      const done = () => {
        loadedThemes.add(key);
        const cbs = pendingThemeCallbacks[key] || [];
        delete pendingThemeCallbacks[key];
        cbs.forEach((fn) => { if (fn) fn(); });
      };
      link.onload = done;
      link.onerror = done;
      document.head.appendChild(link);
    }
    function pickInitialCmTheme() {
      const explicit = localStorage.getItem('cmTheme');
      if (explicit) return explicit;
      return localStorage.getItem('appTheme') === 'light' ? 'eclipse' : 'dracula';
    }
    const initialTheme = pickInitialCmTheme();
    if (initialTheme && initialTheme !== 'dracula') ensureThemeLoaded(initialTheme);
    applyCmToneAttr(initialTheme);

    // Defaults: wrap, line numbers, and syntax highlighting are ON out of the
    // box. A stored '0' means the user explicitly turned the feature off and
    // that choice is respected; any other value (including absent) means ON.
    // FIX (line-numbers default): use explicit null-check — localStorage returns
    // null when the key is absent. null !== '0' is true, so a first-visit user
    // correctly gets lineNumbers:true. A stored '0' means the user turned it off.
    const rawLineNum         = localStorage.getItem('showLineNumbers');
    const initialLineNumbers = rawLineNum === null ? true : rawLineNum !== '0';
    const initialWrap        = localStorage.getItem('wrapText') !== '0';

    // FIX (fold gutter): foldcode/foldgutter addons are loaded in index.html
    // but were never activated in the CM config. Without gutters:[] and
    // foldGutter:true the fold arrows never appear even though the addon JS is
    // present. We add them here, and also wire Ctrl-Q / Cmd-Q as the fold key
    // so keyboard users can fold without a mouse.
    // foldcode.min.js adds CodeMirror.prototype.foldCode; foldgutter.min.js
    // reads that. Both must be present for the gutter to work.
    const hasFoldGutter = typeof CodeMirror.prototype.foldCode === 'function';

    const cmConfig = {
      theme: initialTheme,
      mode: 'text/plain',
      lineNumbers: initialLineNumbers,
      lineWrapping: initialWrap,
      matchBrackets: false,
      styleActiveLine: false,
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      autofocus: false,
      inputStyle: 'textarea',
      spellcheck: false,
      autocorrect: false,
      autocapitalize: false,
      // FIX (perf): was 50 (5× the default). At 50, CM renders 100 extra lines
      // outside the viewport at all times and re-renders them on every scroll.
      // 10 is the CM default and is sufficient for smooth scrolling.
      viewportMargin: 10
    };

    // FIX (fold gutter): only enable foldGutter when the addon is actually
    // present — avoids a CM console error on environments where the CDN
    // request for foldgutter.min.js failed.
    if (hasFoldGutter) {
      cmConfig.foldGutter = true;
      cmConfig.gutters = ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'];
      cmConfig.extraKeys = {
        'Ctrl-Q': function (cm) { cm.foldCode(cm.getCursor()); },
        'Cmd-Q':  function (cm) { cm.foldCode(cm.getCursor()); }
      };
    }

    const cm = CodeMirror.fromTextArea(nt, cmConfig);

    const savedFont = parseInt(localStorage.getItem('fontSize') || '14', 10);
    cm.getWrapperElement().style.fontFamily = "'Source Code Pro', monospace";
    cm.getWrapperElement().style.fontSize = savedFont + 'px';

    // FIX (gutter collision): CM calculates gutter width during fromTextArea()
    // using whatever font is active at that instant — typically the browser's
    // fallback monospace, not Source Code Pro (a web font set two lines above).
    // The result: the gutter is sized for the wrong font, the lines container is
    // offset by that stale measurement, and they overlap on open.
    //
    // We fix this with two complementary refresh passes:
    //   1. A requestAnimationFrame pass runs immediately after the current
    //      paint, catching the case where the font was already cached and
    //      applied synchronously (warm page loads, repeat visits).
    //   2. A document.fonts.ready pass runs once the font stack has fully
    //      resolved, covering cold loads where Source Code Pro arrives late.
    //      A second RAF is nested inside it so the refresh fires after the
    //      browser has actually applied the new font metrics to the layout.
    //
    // Both passes are cheap no-ops if the layout is already correct, so
    // the double-refresh on warm loads has no visible cost.
    requestAnimationFrame(() => { try { cm.refresh(); } catch (e) {} });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        requestAnimationFrame(() => { try { cm.refresh(); } catch (e) {} });
      });
    }

    // FIX (underlines): Android IME marks recently-typed text with a grammar/
    // autocorrect underline on the CM content div even though CM uses a hidden
    // textarea underneath and spellcheck:false is set. The browser-rendered
    // content layer still gets decorated. A CSS override kills it globally.
    (function injectAntiUnderline() {
      if (document.getElementById('dex-anti-underline')) return;
      const s = document.createElement('style');
      s.id = 'dex-anti-underline';
      s.textContent =
        '.CodeMirror-line span{text-decoration:none!important;' +
        '-webkit-text-decorations-in-effect:none!important}';
      document.head.appendChild(s);
    })();

    let suppress = false;

    cm.on('change', () => {
      if (suppress) return;
      try { nativeSetValue(cm.getValue()); } catch (e) {}
      try { nt.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    });

    cm.on('cursorActivity', () => {
      if (suppress) return;
      try { nt.dispatchEvent(new Event('select', { bubbles: true })); } catch (e) {}
    });

    Object.defineProperty(nt, 'value', {
      configurable: true,
      enumerable: true,
      get() { return cm.getValue(); },
      set(v) {
        const str = v == null ? '' : String(v);
        if (str === cm.getValue()) return;
        cm.operation(() => { cm.setValue(str); });
        try { nativeSetValue(str); } catch (e) {}
      }
    });

    Object.defineProperty(nt, 'selectionStart', {
      configurable: true,
      get() { return cm.indexFromPos(cm.getCursor('from')); },
      set(v) {
        const pos = cm.posFromIndex(Math.max(0, v | 0));
        cm.setSelection(pos, pos);
      }
    });
    Object.defineProperty(nt, 'selectionEnd', {
      configurable: true,
      get() { return cm.indexFromPos(cm.getCursor('to')); },
      set(v) {
        const from = cm.getCursor('from');
        cm.setSelection(from, cm.posFromIndex(Math.max(0, v | 0)));
      }
    });
    Object.defineProperty(nt, 'selectionDirection', {
      configurable: true,
      get() { return 'forward'; },
      set() {}
    });

    nt.setSelectionRange = function (start, end) {
      cm.setSelection(cm.posFromIndex(start | 0), cm.posFromIndex(end | 0));
    };

    nt.setRangeText = function (text, start, end, selMode) {
      const cur = cm.getValue();
      if (start == null) start = cm.indexFromPos(cm.getCursor('from'));
      if (end == null)   end   = cm.indexFromPos(cm.getCursor('to'));
      const s = Math.max(0, Math.min(cur.length, start | 0));
      const e = Math.max(s,  Math.min(cur.length, end   | 0));
      const from = cm.posFromIndex(s), to = cm.posFromIndex(e);
      const insertStr = text == null ? '' : String(text);
      const origSelStart = cm.indexFromPos(cm.getCursor('from'));
      const origSelEnd = cm.indexFromPos(cm.getCursor('to'));
      cm.replaceRange(insertStr, from, to);
      const newEnd = s + insertStr.length;
      const applyRange = (a, b) => cm.setSelection(cm.posFromIndex(a), cm.posFromIndex(b));
      const shiftForPreserve = (idx) => {
        if (idx <= s) return idx;
        if (idx >= e) return idx + (insertStr.length - (e - s));
        return newEnd;
      };
      switch ((selMode || 'preserve').toLowerCase()) {
        case 'select':   applyRange(s, newEnd); break;
        case 'start':    applyRange(s, s); break;
        case 'end':      applyRange(newEnd, newEnd); break;
        case 'preserve':
        default:
          applyRange(shiftForPreserve(origSelStart), shiftForPreserve(origSelEnd));
      }
    };

    nt.focus = function () { cm.focus(); };

    const histories = {}; 

    function extToMode(ext) {
      const key = String(ext || '').toLowerCase().replace(/^\./, '');
      const aliases = { txt: 'text/plain', log: 'text/plain', ini: 'properties' };
      if (aliases[key]) return { mode: aliases[key] === 'text/plain' ? 'null' : aliases[key], mime: aliases[key] };
      if (typeof CodeMirror.findModeByExtension === 'function') {
        const info = CodeMirror.findModeByExtension(key);
        if (info) return { mode: info.mode, mime: info.mime };
      }
      return { mode: 'null', mime: 'text/plain' };
    }

    function applyLanguageForCurrentNote() {
      const prismOn = localStorage.getItem('prismEnabled') !== '0';
      const ext = (typeof currentNote !== 'undefined' && currentNote && currentNote.extension) || 'txt';
      if (!prismOn) { cm.setOption('mode', 'text/plain'); return; }
      const { mode, mime } = extToMode(ext);
      cm.setOption('mode', mime);
      if (mode !== 'null' && typeof CodeMirror.autoLoadMode === 'function') {
        try { CodeMirror.autoLoadMode(cm, mode); } catch (e) {}
      }
    }

    window.dexEditor = {
      cm: cm,
      textarea: nt,

      getValue: () => cm.getValue(),

      setValue: function (str, opts) {
        const silent = !!(opts && opts.silent);
        const s = str == null ? '' : String(str);
        if (silent) suppress = true;
        cm.operation(() => { cm.setValue(s); });
        try { nativeSetValue(s); } catch (e) {}
        if (silent) suppress = false;
      },

      getSelection: () => ({
        start: cm.indexFromPos(cm.getCursor('from')),
        end:   cm.indexFromPos(cm.getCursor('to')),
        text:  cm.getSelection()
      }),

      setSelection: (start, end) => {
        cm.setSelection(cm.posFromIndex(start | 0), cm.posFromIndex((end == null ? start : end) | 0));
      },

      replaceSelection: (s) => { cm.replaceSelection(s == null ? '' : String(s)); },

      insertAt: (pos, s) => { cm.replaceRange(String(s || ''), cm.posFromIndex(pos | 0)); },

      focus: () => cm.focus(),

      refresh: () => cm.refresh(),

      on: (event, fn) => { cm.on(event, fn); return () => cm.off(event, fn); },

      setLanguage: function (ext) {
        const prismOn = localStorage.getItem('prismEnabled') !== '0';
        if (!prismOn || !ext) { cm.setOption('mode', 'text/plain'); return; }
        const { mode, mime } = extToMode(ext);
        cm.setOption('mode', mime);
        if (mode !== 'null' && typeof CodeMirror.autoLoadMode === 'function') {
          try { CodeMirror.autoLoadMode(cm, mode); } catch (e) {}
        }
      },

      applyLanguageForCurrentNote: applyLanguageForCurrentNote,

      setLineNumbers: (on) => {
        cm.setOption('lineNumbers', !!on);
        // FIX (fold gutter + line numbers): when foldGutter is active the
        // gutters array must include 'CodeMirror-linenumbers' for CM to render
        // the number column. Removing lineNumbers without also removing it from
        // gutters[] leaves a blank gutter; adding it back without re-adding to
        // gutters[] makes the gutter re-appear but mis-sized. Sync them here.
        if (hasFoldGutter) {
          const g = on
            ? ['CodeMirror-linenumbers', 'CodeMirror-foldgutter']
            : ['CodeMirror-foldgutter'];
          cm.setOption('gutters', g);
        }
      },

      setWrap: (on) => cm.setOption('lineWrapping', !!on),

      setTheme: function (name) {
        if (!name) return;
        ensureThemeLoaded(name, () => {
          cm.setOption('theme', name);
          applyCmToneAttr(name);
        });
      },

      saveHistoryFor: (noteId) => {
        if (noteId == null) return;
        histories[String(noteId)] = cm.getHistory();
      },
      loadHistoryFor: function (noteId, content) {
        const id = noteId == null ? null : String(noteId);
        const str = content == null ? '' : String(content);
        suppress = true;
        cm.operation(() => {
          cm.setValue(str);
        });
        try { nativeSetValue(str); } catch (e) {}
        const saved = id ? histories[id] : null;
        if (saved) { try { cm.setHistory(saved); } catch (e) { cm.clearHistory(); } }
        else       { cm.clearHistory(); }
        suppress = false;
        // Restore fold state. cm.setValue() clears all TextMarkers so this
        // must run last. foldedLines is stored on the note object itself
        // (persisted via saveNotes) so it survives a browser refresh.
        // We use CodeMirror.Pos() — required by foldCode; a plain {line,ch}
        // object is not equivalent and will silently fail.
        try {
          const note = (typeof currentNote !== 'undefined') ? currentNote : null;
          const lines = (note && Array.isArray(note.foldedLines)) ? note.foldedLines : [];
          lines.forEach(line => {
            try { cm.foldCode(CodeMirror.Pos(line, 0), null, 'fold'); } catch (_) {}
          });
        } catch (_) {}
      },
      clearHistoryFor: (noteId) => {
        if (noteId != null) delete histories[String(noteId)];
      },

      _internal: { suppressFlagSetter: (v) => { suppress = !!v; } }
    };

    // Save fold state when the user clicks a gutter fold arrow.
    // 'gutterClick' is the real CodeMirror 5 event; 'fold'/'unfold' do not
    // exist in CM5 and silently do nothing. We defer by one tick so CM has
    // finished updating the TextMarkers before we read them.
    cm.on('gutterClick', () => {
      setTimeout(() => { if (typeof saveFoldState === 'function') saveFoldState(); }, 0);
    });

    try { window.dispatchEvent(new Event('dexEditorReady')); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
