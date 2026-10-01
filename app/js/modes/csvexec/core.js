/**
 * csvexec — glue between the grid and the rest of the app.
 *
 *  • A note whose extension is "csvexec" is shown in the spreadsheet grid instead of
 *    the CodeMirror editor. Every other extension is untouched.
 *  • The note's `content` stays a plain CSV string (formulas are cells starting with "="),
 *    so download / sync / zip-export / other sidebar tools keep working on it.
 *  • Column widths and the ENCRYPT/DECRYPT result cache are kept on `note.csvexec`.
 */
import { createGrid } from "./grid.js";

const EXT = "csvexec";
const isCsvexec = (n) => !!n && String(n.extension || "").toLowerCase() === EXT;

function boot() {
  const wrapper = document.getElementById("textAreaWrapper");
  if (!wrapper || typeof window.dexEditor === "undefined" || !window.dexEditor.cm) { setTimeout(boot, 60); return; }
  if (document.getElementById("csvexecPane")) return;

  const pane = document.createElement("div");
  pane.id = "csvexecPane";
  wrapper.appendChild(pane);

  let activeNote = null;     // the note object the grid is currently bound to
  let selfWrite = false;     // true while WE push text into CodeMirror (so we ignore our own change event)

  const grid = createGrid(pane, {
    notify: (m) => { if (typeof showNotification === "function") showNotification(m); },
    getName: () => (activeNote && activeNote.title) || "sheet",
    onChange: (csv) => {
      const note = activeNote;               // always the note the edit belongs to, even mid-switch
      if (!note) return;
      if (note.content !== csv) { note.content = csv; note.lastEdited = new Date().toISOString(); note._dirty = true; }
      if (typeof saveNotes === "function") saveNotes();
      if (typeof updateDocumentInfo === "function" && note === currentNote) updateDocumentInfo();
      if (typeof populateNoteList === "function") populateNoteList();
      if (note === currentNote) {            // keep the hidden editor in step for sidebar tools
        selfWrite = true;
        try { window.dexEditor.setValue(csv, { silent: true }); } catch (e) {}
        selfWrite = false;
      }
    },
    onMeta: (meta) => {
      if (!activeNote) return;
      activeNote.csvexec = meta;
      if (typeof saveNotes === "function") saveNotes();
    }
  });

  function activate(note) {
    activeNote = note;
    document.body.classList.add("csvexec-active");
    grid.load(note.content || "", note.csvexec || null);
    grid.show();
  }
  function deactivate() {
    activeNote = null;
    document.body.classList.remove("csvexec-active");
  }

  /** Make the UI match whichever note is current. Cheap enough to call often. */
  function sync() {
    const note = (typeof currentNote !== "undefined" && currentNote) || null;
    const want = isCsvexec(note) ? note : null;
    if (want === activeNote) return;
    if (activeNote) { grid.hide(); grid.flush(); }   // commit any open cell edit and write it to the OLD note first
    if (!want) deactivate(); else activate(want);
  }

  window.addEventListener("dexNoteOpened", sync);
  setInterval(sync, 400);                    // covers delete / folder changes / rename paths that fire no event

  // text changed from outside the grid (e.g. a sidebar tool edited the hidden editor)
  window.dexEditor.on("change", () => {
    if (selfWrite || !activeNote || activeNote !== currentNote) return;
    const v = window.dexEditor.getValue();
    if (v !== grid.getCsv()) { activeNote.content = v; grid.load(v, activeNote.csvexec || null); grid.show(); }
  });

  // top-bar undo / redo drive the grid while it is showing
  (function wrapUndo() {
    if (typeof window.performUndo !== "function") { setTimeout(wrapUndo, 80); return; }
    if (window.performUndo.__csvexec) return;
    const u = window.performUndo, r = window.performRedo;
    window.performUndo = function () { return grid.isActive() ? grid.undo() : u.apply(this, arguments); };
    window.performRedo = function () { return grid.isActive() ? grid.redo() : r.apply(this, arguments); };
    window.performUndo.__csvexec = true;
  })();

  // lets the Functions list (sidebar 2) open the formula picker
  window.openCsvexecFunctions = function () {
    if (!grid.isActive()) { if (typeof showNotification === "function") showNotification("Open a .csvexec file to use formulas"); return; }
    if (typeof window.closeSidebar === "function") { try { window.closeSidebar(); } catch (e) {} }
    grid.openPicker();
  };
  window.dexCsvexec = grid;

  window.addEventListener("beforeunload", () => { try { grid.flush(); } catch (e) {} });
  sync();
}
boot();
