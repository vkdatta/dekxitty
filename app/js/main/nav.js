/**
 * Dekxitty - page navigation (homepage / file manager / note app), history
 * routing, and the top-bar open/close toggle.
 *
 * Classic script on purpose: these are globals other modules call by bare
 * name (showNoteApp, showFileManager, handlePopState, ...). Loaded first by
 * loader.js, so everything here exists before any other module runs.
 */


let navGeneration = 0;

function exitActiveMode() {
  navGeneration++;
  if (window.dexMode && window.dexMode.enabled && typeof window.exitDiffusionMode === "function") {
    try { window.exitDiffusionMode(); } catch (e) {}
  }
  if (window.dexMermaidMode && window.dexMermaidMode.enabled && typeof window.exitMermaidMode === "function") {
    try { window.exitMermaidMode(); } catch (e) {}
  }
  if (typeof window.dexCloseNativeMenu === "function") window.dexCloseNativeMenu();
  if (typeof window.dexHideSelectionHandles === "function") window.dexHideSelectionHandles();
}

function waitThenEnterMode(mode, myGen) {
  if (myGen !== navGeneration) return;
  const fnName = mode === "diffusion" ? "enterDiffusionMode" : mode === "mermaid" ? "enterMermaidMode" : null;
  if (!fnName) return;
  if (typeof window[fnName] === "function") { window[fnName](); return; }
  setTimeout(() => waitThenEnterMode(mode, myGen), 40);
}

function refreshDpadVisibility() {
  if (window.__dexDpad && typeof window.__dexDpad.updateToolbarVisibility === "function") {
    window.__dexDpad.updateToolbarVisibility();
  }
}

function showHomepage() {
  exitActiveMode();
  if (homepage && noteAppContainer) {
    homepage.style.display = "flex";
    noteAppContainer.style.display = "none";
    topbar.style.display = "none";
    isHomepage = true;
    currentApp = "home";
    history.pushState({ page: "home" }, "", "/");
  }
  document.body.classList.remove("mode-diffusion", "diff-fullscreen", "mode-filemanager", "fm-sidebar-collapsed");
  const _bb = document.getElementById("diffBottombar");
  if (_bb) _bb.style.display = "none";
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (ex) try { ex.call(document); } catch (e) {}
  }
  if (typeof closeSidebar === "function") closeSidebar();
  if (window.periodicSyncInterval) { clearInterval(window.periodicSyncInterval); window.periodicSyncInterval = null; }
  refreshDpadVisibility();
  showNotification("Homepage");
}

function showFileManager() {
  exitActiveMode();
  if (homepage && noteAppContainer) {
    homepage.style.display = "none";
    noteAppContainer.style.display = "flex";
    topbar.style.display = "flex";
    isHomepage = false;
    currentApp = "filemanager";
    history.pushState({ page: "filemanager" }, "", "/filemanager");
  }
  document.body.classList.remove("mode-diffusion", "diff-fullscreen");
  document.body.classList.add("mode-filemanager");
  const _bb = document.getElementById("diffBottombar");
  if (_bb) _bb.style.display = "none";
  refreshDpadVisibility();
  showNotification("File manager");
}

function showNoteApp(noteId = null, mode = "base") {
  exitActiveMode();
  document.body.classList.remove("mode-filemanager", "fm-sidebar-collapsed");
  if (homepage && noteAppContainer) {
    homepage.style.display = "none";
    noteAppContainer.style.display = "flex";
    topbar.style.display = "flex";
    isHomepage = false;
    currentApp = "notes";
    if (noteId) {
      history.pushState({ page: "note", noteId, mode }, "", `/note/${noteId}/${mode}`);
      openNote(noteId);
    } else if (!currentNote && notes && notes.length > 0 && visibleNotes > 0) {
      const firstNote = notes.find(n => (n.content || "").length > 0) || notes[0];
      if (firstNote && firstNote.id) {
        history.pushState({ page: "note", noteId: firstNote.id, mode }, "", `/note/${firstNote.id}/${mode}`);
        openNote(firstNote.id);
      } else {
        history.pushState({ page: "note" }, "", "/note");
      }
    } else {
      history.pushState({ page: "note" }, "", "/note");
    }
    updateDocumentInfo();
  }
  if (isSignedIn()) {
    if (window.periodicSyncInterval) clearInterval(window.periodicSyncInterval);
    window.periodicSyncInterval = setInterval(() => {
      if (isSignedIn() && navigator.onLine && notes.some(n => n._dirty)) syncWithDrive(false);
    }, 120000);
  }
  if (mode === "diffusion" || mode === "mermaid") waitThenEnterMode(mode, navGeneration);
  refreshDpadVisibility();
}

function handlePopState() {
  const path = window.location.pathname;
  if (path === "/" || path === "") { showHomepage(); return; }
  if (path === "/filemanager" || path.startsWith("/filemanager/")) { showFileManager(); return; }
  const noteMatch = path.match(/^\/note\/([^/]+)(?:\/([a-zA-Z0-9_-]+))?\/?$/);
  if (noteMatch) {
    const noteId = noteMatch[1];
    const mode = noteMatch[2] || "base";
    if (notes.find(e => String(e.id) === String(noteId))) showNoteApp(noteId, mode);
    else showNoteApp(null, mode);
    return;
  }
  if (path.startsWith("/website/Note")) {
    const noteId = path.split("/").pop();
    if (notes.find(e => String(e.id) === String(noteId))) showNoteApp(noteId);
    else showNoteApp();
    return;
  }
  if (path.startsWith("/website/DiffChecker")) { showNoteApp(); return; }
  showHomepage();
}

function updateNoteVisibility() { populateNoteList(); }

/* -- Topbar close / reopen --------------------------------------- */
function setTopbarOpen(open){
  if(open){document.body.classList.remove("topbar-closed");}else{document.body.classList.add("topbar-closed");}
  try{localStorage.setItem("dex-topbar-closed",open?"0":"1");}catch(e){}
}
(function(){try{if(localStorage.getItem("dex-topbar-closed")==="1")document.body.classList.add("topbar-closed");}catch(e){}})();
