function setupEventListeners() {
  safeAddListener(sidebar1Toggle, "click", e => {
    e.stopPropagation();
    if (document.body.classList.contains("mode-filemanager")) {
      document.body.classList.toggle("fm-sidebar-collapsed");
      refreshDpadVisibility();
      return;
    }
    const willOpen = !sidebar1.classList.contains("open");
    if (willOpen) {
      sidebar1.classList.add("open");
      sidebar1Toggle.innerHTML = '<delluna-icon name="x"></delluna-icon>';
    } else if (typeof closeSidebar === "function") {
      closeSidebar();
    }
    refreshDpadVisibility();
  });

  const debouncedUpdate = debounce(updateNoteMetadata, 100);
  // FIX (perf): populateNoteList() was firing on every single keystroke,
  // rebuilding the entire sidebar note list DOM synchronously each time.
  // It is now debounced at the same cadence as updateNoteMetadata so the
  // list refreshes shortly after the user pauses typing rather than on
  // every character. The debounced instances are kept separate so one
  // never delays the other.
  const debouncedPopulate = debounce(populateNoteList, 100);
  safeAddListener(noteTextarea, "input", debouncedUpdate);
  safeAddListener(noteTextarea, "input", debouncedPopulate);
  safeAddListener(noteTextarea, "focus", () => { if (currentNote) updateNoteMetadata(); });

  safeAddListener(noteAppBtn, "click", () => { showFileManager(); });
  safeAddListener(docsBtn, "click", () => { if (docsOverlay) docsOverlay.classList.add("open"); });
  safeAddListener(docsCloseBtn, "click", () => { if (docsOverlay) docsOverlay.classList.remove("open"); });
  safeAddListener(asteroidCloseBtn, "click", () => { if (typeof window.closeAsteroidBelt === "function") window.closeAsteroidBelt(); });

  document.querySelectorAll('input').forEach(input => {
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('spellcheck', 'false');
  });

  safeAddListener(loginBtn, 'click', () => signIn());
  safeAddListener(logoutBtn, 'click', () => signOut());

  window.addEventListener("popstate", handlePopState);
}

function waitForSidebar(timeout = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function c() {
      if (window.__dexSidebarReady) return resolve(true);
      if (Date.now() - start > timeout) return resolve(false);
      setTimeout(c, 30);
    })();
  });
}

async function init() {
  if (!(await waitForSidebar())) {
    // sidebar1.js (buildSidebar, populateNoteList, ...) is near the end of a
    // long chain of sequential <script> loads and hasn't shown up within the
    // timeout — most likely a cold first-visit with no HTTP cache yet.
    // Calling into it now would throw and silently abort the rest of init(),
    // including setupEventListeners() below, leaving every homepage button
    // dead until a refresh (which warms the cache and finishes in time).
    // Keep waiting instead of proceeding on a false promise.
    return init();
  }
  migrateNotesToCrypto();
  folders = loadFolders();
  notes = await loadNotes();
  if (!Array.isArray(notes)) notes = [];
  buildSidebar();
  if (Array.isArray(notes)) { populateNoteList(); updateNoteVisibility(); updateDocumentInfo(); }

  setupEventListeners();
  handlePopState();
  updateAuthUI();

  const savedUser = localStorage.getItem("dexUser");
  if (localStorage.getItem("dexSignedIn") === "1" && savedUser) {
    try { currentUser = JSON.parse(savedUser); } catch (e) { currentUser = null; }
    if (currentUser) {
      updateAuthUI();
      waitForGis().then(() => afterSignIn(true));
    }
  }
}

function runInit() {
  init().catch((err) => {
    // Defense in depth: if anything else in init() throws unexpectedly,
    // still wire up the homepage/topbar buttons rather than leaving the
    // whole site inert on first load.
    console.error('App init failed', err);
    try { setupEventListeners(); } catch (e) {}
  });
}

// bootstrap.js loads last in a long chain of dynamically-injected <script>
// tags (see the loadScript/loadModule calls in the main HTML). Dynamically
// inserted scripts don't delay DOMContentLoaded, so on a fast/warm-cache
// load that event can fire before this listener is even attached — leaving
// init() (and therefore every click handler and the router) never called.
// Every other module in this app guards against exactly this race; this one
// has to as well.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runInit, { once: true });
} else {
  runInit();
}
