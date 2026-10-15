/**
 * viewmode — per-note "raw / exec" choice.
 *
 *  raw  → the normal CodeMirror text editor (what every note has always had)
 *  exec → the file rendered / executed: a spreadsheet grid for .csv, a live
 *         rendered preview for .md
 *
 * The choice lives on the note itself (`note.view`), so each file remembers its
 * own mode. Nothing here depends on the file extension being special: a plain
 * `.csv` or `.md` note simply has a view mode. Notes of any other extension have
 * no mode and are never touched.
 *
 * This file is deliberately DOM-free apart from dispatching one event, so the
 * sidebar (which draws the toggle) and the exec modes (which react to it) can
 * both depend on it without depending on each other.
 *
 *   window.dexView.kind(note)        → "csv" | "md" | null
 *   window.dexView.supports(note)    → boolean
 *   window.dexView.get(note)         → "raw" | "exec"
 *   window.dexView.isExec(note, k)   → boolean (optionally only for kind k)
 *   window.dexView.set(note, mode)   → persists + fires "dexViewModeChanged"
 *   window.dexView.exclusiveActive() → true while Diffusion / Mermaid owns the editor
 */
(function () {
  if (window.dexView) return;

  const KIND_BY_EXT = { csv: "csv", md: "md", markdown: "md" };

  function kind(note) {
    if (!note) return null;
    const ext = String(note.extension || "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(KIND_BY_EXT, ext) ? KIND_BY_EXT[ext] : null;
  }
  const supports = (note) => kind(note) !== null;
  const get = (note) => (supports(note) && note.view === "exec" ? "exec" : "raw");
  const isExec = (note, k) => get(note) === "exec" && (k == null || kind(note) === k);

  // Diffusion and Mermaid take over the editor surface (they need the plain
  // text editor for their own panes), so an exec view must stand down while
  // either of them is on.
  function exclusiveActive() {
    return !!((window.dexMode && window.dexMode.enabled) || (window.dexMermaidMode && window.dexMermaidMode.enabled));
  }

  function set(note, mode) {
    if (!supports(note)) return false;
    const next = mode === "exec" ? "exec" : "raw";
    const prev = get(note);
    if (prev === next) return true;

    // Leaving raw: make sure anything typed in the editor but not yet committed
    // to note.content (it is debounced) is committed, so the exec view opens on
    // what the user actually sees.
    const isCurrent = typeof currentNote !== "undefined" && currentNote && String(currentNote.id) === String(note.id);
    if (prev === "raw" && isCurrent && typeof updateNoteMetadata === "function") {
      try { updateNoteMetadata(); } catch (e) {}
    }

    if (next === "exec") note.view = "exec";
    else delete note.view;               // raw is the default — keep note objects clean

    // `view` is a local display preference: it is not part of the synced
    // payload (see drive_sync.js), so it must not bump _dirty / lastEdited.
    if (typeof saveNotes === "function") { try { saveNotes(); } catch (e) {} }
    try { window.dispatchEvent(new CustomEvent("dexViewModeChanged", { detail: { note, mode: next, kind: kind(note) } })); } catch (e) {}
    return true;
  }

  window.dexView = { kind, supports, get, isExec, set, exclusiveActive };
})();
