let notes = [];
let currentNote = null;
let visibleNotes = localStorage.getItem('visibleNotes') ? parseInt(localStorage.getItem('visibleNotes')) : 3;
let isHomepage = true;
let currentApp = 'home';
let fontSize = localStorage.getItem('fontSize') ? parseInt(localStorage.getItem('fontSize')) : 14;
let dob = localStorage.getItem('dob') || '';
const noteBackdrop = document.getElementById('noteBackdrop');
const maxNotes = 400;
const homepage = document.getElementById('homepage');
const noteAppContainer = document.getElementById('noteAppContainer');
const topbar = document.getElementById('topbar');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const sidebar1 = document.getElementById('sidebar1');
const sidebar1Toggle = document.getElementById('sidebar1Toggle');
const noteList = document.getElementById('noteList');
const noteTextarea = document.getElementById('noteTextarea');
const showNextNoteBtn = document.getElementById('showNextNoteBtn');
const hideLastNoteBtn = document.getElementById('hideLastNoteBtn');
const notification = document.getElementById('notification');
const noteAppBtn = document.getElementById('noteAppBtn');
const docsBtn = document.getElementById('docsBtn');
const docsOverlay = document.getElementById('docsOverlay');
const docsCloseBtn = document.getElementById('docsCloseBtn');
const asteroidCloseBtn = document.getElementById('asteroidCloseBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const welcomeMessage = document.getElementById('welcomeMessage');
const infoName = document.getElementById('infoName');
const findBackdrop = document.getElementById("findBackdrop");

function safeAddListener(e, t, n) {
  e ? e.addEventListener(t, n) : console.warn(`Element for ${t} listener not found`);
}

function preserveSelection(e) {
  return () => {
    const t = noteTextarea.selectionStart, n = noteTextarea.selectionEnd;
    e();
    noteTextarea.setSelectionRange(t, n);
  };
}

function showNotification(e) {
  if (!notification) return;
  notification.textContent = e;
  notification.classList.add("show");
  if (notification.__dexHideTimer) clearTimeout(notification.__dexHideTimer);
  if (notification.__dexClearTimer) clearTimeout(notification.__dexClearTimer);
  notification.__dexHideTimer = setTimeout(() => notification.classList.remove("show"), 3000);
  notification.__dexClearTimer = setTimeout(() => { notification.textContent = ""; }, 3600);
}

function capitalizeName(name) {
  if (!name) return 'User';
  return name.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

function debounce(func, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => func.apply(this, args), delay);
  };
}

function parseTimestamp(isoString) {
  if (!isoString) return 0;
  const t = Date.parse(isoString);
  return isNaN(t) ? 0 : t;
}

function openNote(n) {
  if (window.debounceTimer) clearTimeout(window.debounceTimer);
  if (window.updateTimeout) cancelAnimationFrame(window.updateTimeout);
  window.debounceTimer = null;
  window.updateTimeout = null;
  const e = notes.find(t => String(t.id) === String(n));
  if (!e) return;
  const prevNoteId = currentNote ? currentNote.id : null;
  currentNote = e;

  if (prevNoteId != null && String(prevNoteId) !== String(e.id) && window.dexEditor && typeof window.dexEditor.saveHistoryFor === "function") {
    try { window.dexEditor.saveHistoryFor(prevNoteId); } catch (err) {}
  }

  if (typeof window.rebindUndoForNote === "function") {
    window.rebindUndoForNote(e.id, e.content || "");
  } else {
    noteTextarea.value = e.content;
  }

  if (window.dexEditor && typeof window.dexEditor.setLanguage === "function") {
    try { window.dexEditor.setLanguage(e.extension || "txt"); } catch (err) {}
  }

  populateNoteList();
  updateDocumentInfo();
  document.querySelectorAll(".note-item").forEach(t => t.classList.remove("selected"));
  const t = document.querySelector(`.note-item[data-id="${e.id}"]`);
  t && t.classList.add("selected");

  // Restore fold state for this note. The timeout ensures we run AFTER
  // rebindUndoForNote / loadHistoryFor have called cm.setValue(), which
  // clears all TextMarkers (including folds). 80 ms matches the debounce
  // cadence used elsewhere in the editor pipeline.
  const noteIdToRestore = e.id;
  setTimeout(() => {
    if (typeof restoreFoldState === "function") restoreFoldState(noteIdToRestore);
  }, 80);

  try { window.dispatchEvent(new CustomEvent("dexNoteOpened", { detail: { note: e } })); } catch (err) {}
}

async function updateNoteMetadata() {
  if (!currentNote || !noteTextarea) return false;
  const content = noteTextarea.value;
  const now = new Date().toISOString();
  if (currentNote.content !== content) {
    currentNote.content = content;
    currentNote.lastEdited = now;
    currentNote._dirty = true;
  }
  updateDocumentInfo();
  saveNotes();
  populateNoteList();
  return true;
}

function updateDocumentInfo() {
  const e = document.getElementById("infoName"),
        t = document.getElementById("infoStats"),
        n = document.getElementById("infoDexLabs");

  function formatBytes(bytes) {
    const KB = 1024, MB = KB * 1024, GB = MB * 1024;
    if (!bytes) return "0kb";
    if (bytes >= GB) return (bytes / GB).toFixed(2) + "gb";
    if (bytes >= MB) return (bytes / MB).toFixed(2) + "mb";
    return (bytes / KB).toFixed(1) + "kb";
  }

  const signedIn = isSignedIn();

  if (!currentNote) {
    if (n) n.textContent = "Dekxitty | " + (signedIn ? "Drive" : "Local");
    if (e) e.textContent = "-";
    if (t) t.textContent =
      "Char (ex. Spaces): 0\nChar (in. Spaces): 0\nTotal Words: 0\nReading time: 0m\nFile Size: 0kb";
    return;
  }

  const { title = "-", content = "", extension = "" } = currentNote || {};
  const cis = (content || "").length;
  const ces = (content || "").replace(/\s/g, "").length;
  const words = (content || "").trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.ceil(words / 200) || 0;
  const readingTime = minutes < 60 ? minutes + "m" : (minutes / 60).toFixed(1) + "h";
  const bytes = new Blob([content || ""]).size;

  if (n) n.textContent = "Dekxitty | " + (signedIn ? "Drive" : "Local");
  if (e) e.textContent = title + (extension ? "." + extension : "");
  if (t) t.textContent =
    "Char (ex. Spaces): " + ces + "\n" +
    "Char (in. Spaces): " + cis + "\n" +
    "Total Words: " + words + "\n" +
    "Reading time: " + readingTime + "\n" +
    "File Size: " + formatBytes(bytes);
}

function genNoteIdFallback() { return "n" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }

function migrateNotesToCrypto() {
  if (localStorage.getItem("dexIdScheme") === "crypto") return;
  let arr = [];
  try { arr = JSON.parse(localStorage.getItem("notes") || "[]"); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  const mint = (typeof genNoteId === "function") ? genNoteId : genNoteIdFallback;
  const out = [];
  arr.forEach(n => {
    const real = (n.content && String(n.content).trim().length) || n._created || n.folderId;
    if (!real) return;
    out.push({
      id: mint(),
      title: n.title || "untitled",
      content: n.content || "",
      extension: n.extension || "txt",
      folderId: n.folderId || null,
      lastEdited: (n.lastEdited && n.lastEdited !== "1970-01-01T00:00:00.000Z") ? n.lastEdited : new Date().toISOString(),
      _created: true, _dirty: true
    });
  });
  localStorage.setItem("notes", JSON.stringify(out));
  localStorage.removeItem("driveFileIds");
  localStorage.removeItem("dexBaseManifest");
  localStorage.setItem("dexIdScheme", "crypto");
}

async function loadNotes() {
  try {
    const saved = localStorage.getItem('notes');
    let n = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(n)) n = [];
    return n;
  } catch (e) {
    return [];
  }
}

function saveNotes() {
  if (!Array.isArray(notes)) return;
  localStorage.setItem("notes", JSON.stringify(notes));
}
