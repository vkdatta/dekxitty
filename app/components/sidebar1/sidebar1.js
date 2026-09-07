let folders = loadFolders();
let selectMode = false;
const selected = new Set();
let currentFolderId = normalizeFolderId(localStorage.getItem("dexCurrentFolder"));
let clipboard = null;
let pathFolderIds = new Set();
let searchQuery = "";
let sortMode = localStorage.getItem("dexSortMode") || "date_new";
let sortMixed = localStorage.getItem("dexSortMixed") === "1";
let expanded = loadExpanded();
function loadExpanded() { try { return new Set(JSON.parse(localStorage.getItem("dexExpanded") || "[]")); } catch (e) { return new Set(); } }
function saveExpanded() { localStorage.setItem("dexExpanded", JSON.stringify([...expanded])); }
function toggleExpand(id) { if (expanded.has(id)) expanded.delete(id); else expanded.add(id); saveExpanded(); renderSidebar(); }

function normalizeFolderId(v) { return (v && v !== "null") ? v : null; }

function loadFolders() {
  try { const a = JSON.parse(localStorage.getItem("folders") || "[]"); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function saveFolders() {
  localStorage.setItem("folders", JSON.stringify(folders));
  localStorage.setItem("foldersLastEdited", new Date().toISOString());
}
function isVisibleFile(n) {
  return !!n;
}
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function isSel(k) { return selected.has(k); }
function toggleSel(k) { selected.has(k) ? selected.delete(k) : selected.add(k); renderSidebar(); }

function folderById(id) { return folders.find(f => f.id === id) || null; }
function foldersInFolder(pid) { return folders.filter(f => (f.parentId || null) === (pid || null)); }
function notesInFolder(pid) { return notes.filter(n => isVisibleFile(n) && (n.folderId || null) === (pid || null)); }
function folderPath(id) {
  const path = []; let cur = id, guard = 0;
  while (cur && guard++ < 100) { const f = folderById(cur); if (!f) break; path.unshift(f); cur = f.parentId || null; }
  return path;
}
function getDescendantFolderIds(id) {
  let out = [id];
  foldersInFolder(id).forEach(sf => { out = out.concat(getDescendantFolderIds(sf.id)); });
  return out;
}
function isDescendant(candidateId, ancestorId) {
  let cur = candidateId, guard = 0;
  while (cur && guard++ < 100) { if (cur === ancestorId) return true; const f = folderById(cur); cur = f ? (f.parentId || null) : null; }
  return false;
}
function genFolderId() { return "fld_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function genNoteId() { return "n" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); }
function randomBase(kind) { return (kind === "folder" ? "folder" : "file") + "-" + Math.random().toString(36).slice(2, 6); }

const SORT_LABELS = {
  az: "Name A \u2192 Z", za: "Name Z \u2192 A",
  date_new: "Modified \u2014 new to old", date_old: "Modified \u2014 old to new",
  size_hi: "Size \u2014 large to small", size_lo: "Size \u2014 small to large"
};
function noteSize(n) { return (n.content || "").length; }
function applySortFiles(arr) {
  const a = arr.slice();
  a.sort((x, y) => {
    switch (sortMode) {
      case "az": return (x.title || "").localeCompare(y.title || "");
      case "za": return (y.title || "").localeCompare(x.title || "");
      case "date_old": return parseTimestamp(x.lastEdited) - parseTimestamp(y.lastEdited);
      case "size_hi": return noteSize(y) - noteSize(x) || (x.title || "").localeCompare(y.title || "");
      case "size_lo": return noteSize(x) - noteSize(y) || (x.title || "").localeCompare(y.title || "");
      case "date_new": default: return parseTimestamp(y.lastEdited) - parseTimestamp(x.lastEdited);
    }
  });
  return a;
}
function applySortFolders(arr) {
  const a = arr.slice();
  a.sort((x, y) => sortMode === "za" ? (y.name || "").localeCompare(x.name || "") : (x.name || "").localeCompare(y.name || ""));
  return a;
}
function pathLabel(folderId) {
  const p = folderPath(folderId).map(f => f.name);
  return p.length ? "root / " + p.join(" / ") : "root";
}

function openSortMenu(anchor) {
  const existing = document.getElementById("dexSortMenu");
  if (existing) { existing.remove(); return; }
  const menu = document.createElement("div");
  menu.id = "dexSortMenu";
  menu.className = "dex-sort-menu";
  Object.keys(SORT_LABELS).forEach(key => {
    const it = document.createElement("div");
    it.className = "dex-sort-item" + (key === sortMode ? " on" : "");
    it.textContent = SORT_LABELS[key];
    it.onclick = () => { sortMode = key; localStorage.setItem("dexSortMode", key); menu.remove(); renderSidebar(); };
    menu.appendChild(it);
  });
  const sep = document.createElement("div"); sep.className = "dex-sort-sep"; menu.appendChild(sep);
  const chk = document.createElement("div");
  chk.className = "dex-sort-item dex-sort-toggle" + (sortMixed ? " on" : "");
  chk.innerHTML = '<span class="dex-mini-check">' + (sortMixed ? IC.tick : "") + "</span>Files &amp; folders at same level";
  chk.onclick = (e) => {
    e.stopPropagation();
    sortMixed = !sortMixed;
    localStorage.setItem("dexSortMixed", sortMixed ? "1" : "0");
    chk.classList.toggle("on", sortMixed);
    chk.querySelector(".dex-mini-check").innerHTML = sortMixed ? IC.tick : "";
    renderSidebar();
  };
  menu.appendChild(chk);
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = (r.bottom + 4) + "px";
  menu.style.right = Math.max(8, (window.innerWidth - r.right)) + "px";
  setTimeout(() => {
    const off = (e) => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener("click", off); } };
    document.addEventListener("click", off);
  }, 0);
}

function clearSearch() {
  searchQuery = "";
  const si = document.getElementById("dexSearch");
  if (si) si.value = "";
}

function buildSidebar() {
  const sb = document.getElementById("sidebar1");
  if (!sb) return;
  sb.innerHTML =
    '<div class="dex-head"><div class="dex-crumbs" id="dexCrumbs"></div><div class="dex-tools" id="dexTools"></div></div>' +
    '<div class="dex-subhead">' +
      '<input class="dex-search" id="dexSearch" placeholder="Search files & folders" autocomplete="off" spellcheck="false" />' +
      '<div class="dex-sort" id="dexSortBtn" title="Sort">' + IC.sort + '</div>' +
    '</div>' +
    '<div class="dex-tree" id="noteTree"></div>';
  const si = document.getElementById("dexSearch");
  if (si) { si.value = searchQuery; si.oninput = () => { searchQuery = si.value; renderSidebar(); }; }
  const sbtn = document.getElementById("dexSortBtn");
  if (sbtn) sbtn.onclick = () => openSortMenu(sbtn);
  renderSidebar();
}

function renderCrumbs() {
  const c = document.getElementById("dexCrumbs");
  if (!c) return;
  const path = folderPath(currentFolderId);
  let html = '<span class="dex-crumb" data-cid="">root</span>';
  path.forEach(f => { html += '<span class="dex-sep">/</span><span class="dex-crumb" data-cid="' + f.id + '">' + escapeHtml(f.name) + '</span>'; });
  c.innerHTML = html;
  c.querySelectorAll(".dex-crumb").forEach(el => { el.onclick = () => navigateTo(el.dataset.cid || null); });
}

function renderTools() {
  const t = document.getElementById("dexTools");
  if (!t) return;
  let html = "";
  if (clipboard) {
    const n = (clipboard.noteIds.length + clipboard.folderIds.length);
    html += '<div class="dex-tool accent" title="Paste ' + n + ' here" onclick="sidebarPaste()">' + IC.paste + '</div>';
    html += '<div class="dex-tool" title="New file or folder" onclick="sidebarAddItems()">' + IC.plus + '</div>';
    if (currentFolderId) html += '<div class="dex-tool" title="Up one level" onclick="dexMoveOut()">' + IC.up + '</div>';
    html += '<div class="dex-tool" title="Cancel" onclick="sidebarCancelClipboard()">' + IC.x + '</div>';
  } else if (selectMode) {
    html += '<div class="dex-tool" title="Select all" onclick="sidebarSelectAll()">' + IC.selectAll + '</div>';
    html += '<div class="dex-tool" title="Move (cut)" onclick="sidebarStartMove()">' + IC.move + '</div>';
    html += '<div class="dex-tool" title="Copy" onclick="sidebarStartCopy()">' + IC.copy + '</div>';
    html += '<div class="dex-tool" title="Batch apply" onclick="window.openBatchApply && window.openBatchApply()">' + IC.bolt + '</div>';
    html += '<div class="dex-tool" title="Download" onclick="sidebarDownloadSelected()">' + IC.download + '</div>';
    html += '<div class="dex-tool danger" title="Delete" onclick="sidebarDeleteSelected()">' + IC.trash + '</div>';
    html += '<div class="dex-tool" title="Cancel" onclick="sidebarToggleSelect()">' + IC.x + '</div>';
  } else {
    html += '<div class="dex-tool" title="New file or folder" onclick="sidebarAddItems()">' + IC.plus + '</div>';
    html += '<div class="dex-tool" title="Select" onclick="sidebarToggleSelect()">' + IC.select + '</div>';
    if (currentFolderId) html += '<div class="dex-tool" title="Up one level" onclick="dexMoveOut()">' + IC.up + '</div>';
  }
  t.innerHTML = html;
}

function closeSidebar() {
  const sb = document.getElementById("sidebar1");
  const tog = document.getElementById("sidebar1Toggle");
  if (sb) sb.classList.remove("open");
  if (tog) tog.innerHTML = '<delluna-icon name="view_object_track"></delluna-icon>';
  const m = document.getElementById("dexSortMenu"); if (m) m.remove();
  clipboard = null;
}

function renderFileRow(n) {
  const item = document.createElement("div");
  item.className = "dex-item";
  const row = document.createElement("div");
  const cur = currentNote && String(currentNote.id) === String(n.id);
  const pickActive = window.__dexNotePick && String(window.__dexPickActiveNoteId) === String(n.id);
  row.className = "dex-row" + (isSel("n:" + n.id) ? " sel" : "") + (cur ? " dex-current" : "") + (pickActive ? " dex-pick-active" : "");
  let html = "";
  if (selectMode) html += '<div class="dex-check' + (isSel("n:" + n.id) ? " on" : "") + '">' + (isSel("n:" + n.id) ? IC.tick : "") + "</div>";
  html += '<div class="dex-ic">' + IC.file + "</div>";
  html += '<div class="dex-name">' + escapeHtml(n.title || ("note " + n.id)) + "</div>";
  html += '<div class="dex-badge">' + (n.content || "").length + "c \u00b7 ." + (n.extension || "txt") + "</div>";
  if (!selectMode) {
    html += '<div class="dex-add" data-rename="1" title="Rename">' + IC.edit + "</div>";
    html += '<div class="dex-add" data-dl="1" title="Download">' + IC.download + "</div>";
  }
  row.innerHTML = html;
  row.onclick = (e) => {
    if (e.target.closest("[data-rename]")) { sidebarRename("file", n.id); return; }
    if (e.target.closest("[data-dl]")) { downloadFile(n); return; }
    if (selectMode) { toggleSel("n:" + n.id); return; }
    if (window.__dexNotePick) { window.__dexNotePick(n.id); return; }
    const isActive = currentNote && String(currentNote.id) === String(n.id);
    const inFileManager = document.body.classList.contains("mode-filemanager");
    // On /filemanager, sidebar1 IS the main content (docked, not a slide-in
    // overlay) \u2014 closing it doesn't navigate anywhere, so clicking the
    // already-active note must still open it. The close-shortcut only makes
    // sense when sidebar1 is the slide-in variant floating over an open note.
    if (isActive && !inFileManager) { closeSidebar(); return; }
    window.currentHighlightLanguage = "none";
    if (typeof window.immediatePlainRender === "function") window.immediatePlainRender();
    showNoteApp(n.id);
  };
  item.appendChild(row);
  return item;
}

function renderFolderNode(f) {
  const item = document.createElement("div");
  item.className = "dex-item";
  const row = document.createElement("div");
  row.className = "dex-row" + (isSel("f:" + f.id) ? " sel" : "");
  const isOpen = expanded.has(f.id);
  const count = foldersInFolder(f.id).length + notesInFolder(f.id).length;
  let html = "";
  if (selectMode) html += '<div class="dex-check' + (isSel("f:" + f.id) ? " on" : "") + '">' + (isSel("f:" + f.id) ? IC.tick : "") + "</div>";
  else html += '<div class="dex-chev' + (isOpen ? " open" : "") + (pathFolderIds.has(f.id) ? " onpath" : "") + '" data-chev="1">' + IC.chev + "</div>";
  html += '<div class="dex-ic dex-ic-folder">' + IC.folder + "</div>";
  html += '<div class="dex-name folder">' + escapeHtml(f.name) + "</div>";
  html += '<div class="dex-badge">' + count + "</div>";
  if (!selectMode) {
    html += '<div class="dex-add" data-rename="1" title="Rename folder">' + IC.edit + "</div>";
    html += '<div class="dex-add" data-dl="1" title="Download folder">' + IC.download + "</div>";
  }
  html += '<div class="dex-add" data-enter="1" title="Open folder">' + IC.enter + "</div>";
  row.innerHTML = html;
  row.onclick = (e) => {
    if (e.target.closest("[data-rename]")) { sidebarRename("folder", f.id); return; }
    if (e.target.closest("[data-dl]")) { downloadFolder(f); return; }
    if (e.target.closest("[data-enter]")) { navigateTo(f.id); return; }
    if (selectMode) { toggleSel("f:" + f.id); return; }
    toggleExpand(f.id);
  };
  item.appendChild(row);
  if (isOpen && !selectMode) {
    const ch = document.createElement("div");
    ch.className = "dex-children";
    const subs = foldersInFolder(f.id);
    const files = notesInFolder(f.id);
    orderItems(subs, files, renderFolderNode, renderFileRow).forEach(node => ch.appendChild(node));
    if (!subs.length && !files.length) { const e = document.createElement("div"); e.className = "dex-empty"; e.textContent = "Empty"; ch.appendChild(e); }
    item.appendChild(ch);
  }
  return item;
}

function mixedComparator(a, b) {
  switch (sortMode) {
    case "az": return a.name.localeCompare(b.name);
    case "za": return b.name.localeCompare(a.name);
    case "date_old": return a.mtime - b.mtime || a.name.localeCompare(b.name);
    case "size_hi": return b.size - a.size || a.name.localeCompare(b.name);
    case "size_lo": return a.size - b.size || a.name.localeCompare(b.name);
    case "date_new": default: return b.mtime - a.mtime || a.name.localeCompare(b.name);
  }
}
function orderItems(subs, files, folderRenderer, fileRenderer) {
  if (sortMixed) {
    const all = subs.map(f => ({ t: "f", o: f, name: f.name || "", mtime: 0, size: foldersInFolder(f.id).length + notesInFolder(f.id).length }))
      .concat(files.map(n => ({ t: "n", o: n, name: n.title || "", mtime: parseTimestamp(n.lastEdited), size: (n.content || "").length })));
    all.sort(mixedComparator);
    return all.map(x => x.t === "f" ? folderRenderer(x.o) : fileRenderer(x.o));
  }
  return applySortFolders(subs).map(folderRenderer).concat(applySortFiles(files).map(fileRenderer));
}

function renderSidebar() {
  if (currentFolderId && !folderById(currentFolderId)) currentFolderId = null;
  pathFolderIds = new Set();
  if (currentNote) {
    let fid = currentNote.folderId || null, g = 0;
    while (fid && g++ < 100) { pathFolderIds.add(fid); const pf = folderById(fid); fid = pf ? (pf.parentId || null) : null; }
  }
  renderCrumbs();
  renderTools();
  const tree = document.getElementById("noteTree");
  if (!tree) return;
  tree.innerHTML = "";
  const frag = document.createDocumentFragment();

  const q = searchQuery.trim().toLowerCase();
  if (q) {
    const mFolders = folders.filter(f => (f.name || "").toLowerCase().indexOf(q) !== -1);
    const mNotes = notes.filter(n => (n.title || "").toLowerCase().indexOf(q) !== -1);
    orderItems(mFolders, mNotes, renderFolderMatchRow, renderFileRow).forEach(node => frag.appendChild(node));
    tree.appendChild(frag);
    if (!mFolders.length && !mNotes.length) {
      const e = document.createElement("div"); e.className = "dex-empty"; e.textContent = "No matches"; tree.appendChild(e);
    }
    return;
  }

  const subs = foldersInFolder(currentFolderId);
  const files = notesInFolder(currentFolderId);
  orderItems(subs, files, renderFolderNode, renderFileRow).forEach(node => frag.appendChild(node));
  tree.appendChild(frag);
  if (!subs.length && !files.length) {
    const e = document.createElement("div");
    e.className = "dex-empty";
    e.textContent = clipboard ? "Empty \u2014 Paste here or go up" : "Empty \u2014 tap + to add";
    tree.appendChild(e);
  }
}

function renderFolderMatchRow(f) {
  const item = document.createElement("div");
  item.className = "dex-item";
  const row = document.createElement("div");
  row.className = "dex-row" + (isSel("f:" + f.id) ? " sel" : "");
  row.title = pathLabel(f.parentId || null);
  let html = "";
  if (selectMode) html += '<div class="dex-check' + (isSel("f:" + f.id) ? " on" : "") + '">' + (isSel("f:" + f.id) ? IC.tick : "") + "</div>";
  html += '<div class="dex-ic">' + IC.folder + "</div><div class=\"dex-name folder\">" + escapeHtml(f.name) + "</div>";
  if (!selectMode) html += '<div class="dex-add" title="Open">' + IC.enter + "</div>";
  row.innerHTML = html;
  row.onclick = () => { if (selectMode) { toggleSel("f:" + f.id); return; } navigateTo(f.id); };
  item.appendChild(row);
  return item;
}

function populateNoteList() { renderSidebar(); }

function saveCurrentFolder() {
  localStorage.setItem("dexCurrentFolder", currentFolderId || "");
}

function navigateTo(id) {
  currentFolderId = id || null;
  saveCurrentFolder();
  clearSearch();
  renderSidebar();
}
function dexMoveOut() {
  const f = folderById(currentFolderId);
  navigateTo(f ? (f.parentId || null) : null);
}
window.dexMoveOut = dexMoveOut;

function sidebarToggleSelect() {
  selectMode = !selectMode;
  if (!selectMode) selected.clear();
  renderSidebar();
}

function sidebarSelectAll() {
  const q = searchQuery.trim().toLowerCase();
  const keys = q
    ? folders.filter(f => (f.name || "").toLowerCase().indexOf(q) !== -1).map(f => "f:" + f.id)
        .concat(notes.filter(n => (n.title || "").toLowerCase().indexOf(q) !== -1).map(n => "n:" + n.id))
    : foldersInFolder(currentFolderId).map(f => "f:" + f.id)
        .concat(notesInFolder(currentFolderId).map(n => "n:" + n.id));
  const allOn = keys.length > 0 && keys.every(k => selected.has(k));
  if (allOn) keys.forEach(k => selected.delete(k));
  else keys.forEach(k => selected.add(k));
  renderSidebar();
}
window.sidebarSelectAll = sidebarSelectAll;

function sidebarRename(kind, id) {
  const isFolder = kind === "folder";
  let cur;
  if (isFolder) { const f = folderById(id); if (!f) return; cur = f.name; }
  else { const n = notes.find(x => String(x.id) === String(id)); if (!n) return; cur = (n.title || ("note " + n.id)) + (n.extension ? "." + n.extension : ""); }
  window.__dexRename = { kind, id };
  showModal({
    header: `<div class="modal-title">Rename ${isFolder ? "folder" : "file"}</div>`,
    body: `
      <div>
        <label class="modal-label">New name</label>
        <input type="text" id="dexRenameInput" class="modal-input" value="${escapeHtml(cur)}" autocomplete="off">
      </div>
    `,
    footer: `
      <button onclick="closeModal()">Cancel</button>
      <button onclick="dexRenameSubmit()" class="modal-btn">Rename</button>
    `
  });
}
window.sidebarRename = sidebarRename;

window.dexRenameSubmit = function () {
  const info = window.__dexRename;
  if (!info) { closeModal(); return; }
  const val = modalScope.dexRenameInput ? modalScope.dexRenameInput.value.trim() : "";
  if (!val) { if (modalScope.dexRenameInput) modalScope.dexRenameInput.style.borderColor = "#ff4444"; showNotification("Name cannot be empty"); return; }
  window.__dexRename = null;
  closeModal();
  if (info.kind === "folder") {
    const f = folderById(info.id);
    if (f) { f.name = val; saveFolders(); }
  } else {
    const n = notes.find(x => String(x.id) === String(info.id));
    if (n) {
      let title = val, ext = n.extension || "txt";
      const dot = val.lastIndexOf(".");
      if (dot > 0) { title = val.slice(0, dot); ext = val.slice(dot + 1) || ext; }
      n.title = title; n.extension = ext; n._dirty = true; n.lastEdited = new Date().toISOString();
    }
  }
  saveNotes();
  renderSidebar();
  showNotification("Renamed");
  if (isSignedIn()) syncWithDrive(false);
};

function revealCurrentNote() {
  if (!currentNote) return;
  let fid = currentNote.folderId || null, g = 0;
  while (fid && g++ < 100) { expanded.add(fid); const f = folderById(fid); fid = f ? (f.parentId || null) : null; }
  saveExpanded();
  currentFolderId = null;
  saveCurrentFolder();
  clearSearch();
  renderSidebar();
  setTimeout(() => {
    const el = document.querySelector(".dex-row.dex-current");
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 40);
}

function sidebarAddItems() {
  const here = currentFolderId ? (" in " + ((folderById(currentFolderId) || {}).name || "")) : "";
  showModal({
    header: `<div class="modal-title">New item${here}</div>`,
    body: `
      <div>
        <label class="modal-label">Names (comma-separated) &mdash; or paste a folder tree</label>
        <textarea id="dexNames" class="modal-textarea" rows="4"
          placeholder="todo, ideas, drafts&#10;&#10;or a tree:&#10;project&#10;\u251c\u2500\u2500 src&#10;\u2502   \u2514\u2500\u2500 main.js&#10;\u2514\u2500\u2500 readme.md"
          data-skip-validation></textarea>
      </div>

      <div id="dexCountWrap">
        <label class="modal-label">Number of items to create</label>
        <input type="number" id="dexCount" class="modal-input" min="1" value="1" data-skip-validation>
      </div>

      <div id="dexKindWrap">
        <label class="modal-label">Create as</label>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button type="button" id="dexKindFile" class="modal-btn active" data-kind="file">File</button>
          <button type="button" id="dexKindFolder" class="modal-btn" data-kind="folder">Folder</button>
        </div>
      </div>
    `,
    footer: `
      <button onclick="closeModal()">Cancel</button>
      <button onclick="dexCreateSubmit()" class="modal-btn">Create</button>
    `
  });
}

window.dexCreateSubmit = function () {
  const raw = modalScope.dexNames ? modalScope.dexNames.value : "";
  const kind = (modalScope.dexKindFolder && modalScope.dexKindFolder.classList.contains("active")) ? "folder" : "file";
  const count = modalScope.dexCount ? parseInt(modalScope.dexCount.value, 10) : 1;
  closeModal();
  const looksLikeTree = /[\n\u2502\u251c\u2514]/.test(raw) || raw.split(/\r?\n/).filter(l => l.trim()).length > 1;
  if (looksLikeTree) createFromTreeText(raw);
  else createItems(raw, kind, count);
};

function parseTreeToStructure(text) {
  const items = [];
  text.split(/\r?\n/).forEach(line => {
    if (!line.trim()) return;
    const expanded = line.replace(/\t/g, "    ");
    let i = 0;
    while (i < expanded.length && " \t\u2502\u251c\u2514\u2500".indexOf(expanded[i]) !== -1) i++;
    let name = expanded.slice(i).replace(/^[-\u2500]+\s*/, "").trim();
    if (!name) return;
    let isFolder = false;
    if (name.endsWith("/")) { isFolder = true; name = name.slice(0, -1).trim(); }
    if (name) items.push({ indent: i, name, isFolder, children: [] });
  });
  const root = { children: [] };
  const stack = [{ indent: -1, node: root }];
  items.forEach(it => {
    while (stack.length > 1 && stack[stack.length - 1].indent >= it.indent) stack.pop();
    stack[stack.length - 1].node.children.push(it);
    stack.push({ indent: it.indent, node: it });
  });
  return root.children;
}

function createFromTree(nodes, parentFolderId) {
  let f = 0, fi = 0, limit = false;
  nodes.forEach(node => {
    const hasKids = node.children && node.children.length;
    if (node.isFolder || hasKids) {
      const fid = genFolderId();
      folders.push({ id: fid, name: node.name, parentId: parentFolderId || null });
      f++;
      const r = createFromTree(node.children || [], fid);
      f += r.folders; fi += r.files; if (r.limit) limit = true;
    } else {
      let title = node.name, ext = "txt";
      const dot = node.name.lastIndexOf(".");
      if (dot > 0) { title = node.name.slice(0, dot); ext = node.name.slice(dot + 1) || "txt"; }
      notes.push({ id: genNoteId(), title, content: "", extension: ext, folderId: parentFolderId || null, lastEdited: new Date().toISOString(), _created: true, _dirty: true });
      fi++;
    }
  });
  return { folders: f, files: fi, limit };
}

function createFromTreeText(raw) {
  const nodes = parseTreeToStructure(raw);
  if (!nodes.length) { showNotification("Nothing to create"); return; }
  const r = createFromTree(nodes, currentFolderId || null);
  saveFolders();
  saveNotes();
  renderSidebar();
  showNotification("Created " + r.folders + " folder(s), " + r.files + " file(s)");
  if (isSignedIn()) syncWithDrive(false);
}

function createItems(namesRaw, kind, count) {
  let names = (namesRaw || "").split(",").map(s => s.trim()).filter(Boolean);
  if (!names.length) {
    const c = Math.max(1, Math.min(parseInt(count, 10) || 1, 1000));
    const used = {};
    names = [];
    for (let i = 0; i < c; i++) { let nm; do { nm = randomBase(kind); } while (used[nm]); used[nm] = 1; names.push(nm); }
  }
  let created = 0, firstNote = null;
  names.forEach(name => {
    if (kind === "folder") {
      folders.push({ id: genFolderId(), name, parentId: currentFolderId || null });
      created++;
    } else {
      const note = { id: genNoteId(), title: name, content: "", extension: "txt", folderId: currentFolderId || null, lastEdited: new Date().toISOString(), _created: true, _dirty: true };
      notes.push(note);
      created++; if (!firstNote) firstNote = note;
    }
  });
  if (kind === "folder") saveFolders();
  saveNotes();
  renderSidebar();
  if (kind === "file" && firstNote && created === 1) showNoteApp(firstNote.id);
  showNotification("Created " + created);
  if (isSignedIn()) syncWithDrive(false);
}

document.addEventListener("click", function (e) {
  const id = e.target && e.target.id;
  if (id === "dexKindFile" || id === "dexKindFolder") {
    if (modalScope.dexKindFile) modalScope.dexKindFile.classList.toggle("active", id === "dexKindFile");
    if (modalScope.dexKindFolder) modalScope.dexKindFolder.classList.toggle("active", id === "dexKindFolder");
  }
});
document.addEventListener("input", function (e) {
  if (e.target && e.target.id === "dexNames") {
    const v = e.target.value;
    const hasText = v.trim().length > 0;
    const isTree = /[\n\u2502\u251c\u2514]/.test(v) || v.split(/\r?\n/).filter(l => l.trim()).length > 1;
    if (modalScope.dexCountWrap) modalScope.dexCountWrap.style.display = hasText ? "none" : "";
    if (modalScope.dexKindWrap) modalScope.dexKindWrap.style.display = isTree ? "none" : "";
  }
});

function safeName(x) { return String(x || "untitled").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80); }
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function downloadFile(n) {
  downloadBlob(safeName(n.title || ("note " + n.id)) + "." + (n.extension || "txt"), new Blob([n.content || ""], { type: "text/plain" }));
}
function addFolderToZip(zfolder, fid) {
  notesInFolder(fid).forEach(n => zfolder.file(safeName(n.title || ("note " + n.id)) + "." + (n.extension || "txt"), n.content || ""));
  foldersInFolder(fid).forEach(sf => addFolderToZip(zfolder.folder(safeName(sf.name)), sf.id));
}
function waitForJSZip(timeoutMs) {
  return new Promise((resolve) => {
    if (window.JSZip) { resolve(true); return; }
    const start = Date.now();
    const iv = setInterval(() => {
      if (window.JSZip) { clearInterval(iv); resolve(true); }
      else if (Date.now() - start > timeoutMs) { clearInterval(iv); resolve(false); }
    }, 200);
  });
}
async function downloadFolder(f) {
  if (!window.JSZip) {
    showNotification("Waiting for zip tool to load…");
    if (!(await waitForJSZip(5000))) { showNotification("Zip tool failed to load — try again"); return; }
  }
  const zip = new window.JSZip();
  addFolderToZip(zip.folder(safeName(f.name)), f.id);
  downloadBlob(safeName(f.name) + ".zip", await zip.generateAsync({ type: "blob" }));
}
async function sidebarDownloadSelected() {
  const noteList = [...selected].filter(k => k[0] === "n").map(k => notes.find(n => String(n.id) === k.slice(2))).filter(Boolean);
  const folderList = [...selected].filter(k => k[0] === "f").map(k => folderById(k.slice(2))).filter(Boolean);
  const total = noteList.length + folderList.length;
  if (!total) { showNotification("Nothing selected"); return; }
  if (total === 1 && noteList.length === 1) { downloadFile(noteList[0]); }
  else {
    if (!window.JSZip) {
      showNotification("Waiting for zip tool to load…");
      if (!(await waitForJSZip(5000))) { showNotification("Zip tool failed to load — try again"); return; }
    }
    const zip = new window.JSZip();
    noteList.forEach(n => zip.file(safeName(n.title || ("note " + n.id)) + "." + (n.extension || "txt"), n.content || ""));
    folderList.forEach(f => addFolderToZip(zip.folder(safeName(f.name)), f.id));
    downloadBlob("dexlabs-export.zip", await zip.generateAsync({ type: "blob" }));
  }
  selected.clear(); selectMode = false; renderSidebar();
}
window.sidebarDownloadSelected = sidebarDownloadSelected;

function sidebarStartMove() {
  if (!selected.size) { showNotification("Select items first"); return; }
  clipboard = { mode: "move", noteIds: [...selected].filter(k => k[0] === "n").map(k => k.slice(2)), folderIds: [...selected].filter(k => k[0] === "f").map(k => k.slice(2)) };
  selectMode = false; selected.clear();
  renderSidebar();
  showNotification("Navigate to a folder and tap Paste");
}
function sidebarStartCopy() {
  if (!selected.size) { showNotification("Select items first"); return; }
  clipboard = { mode: "copy", noteIds: [...selected].filter(k => k[0] === "n").map(k => k.slice(2)), folderIds: [...selected].filter(k => k[0] === "f").map(k => k.slice(2)) };
  selectMode = false; selected.clear();
  renderSidebar();
  showNotification("Navigate to a folder and tap Paste");
}
function sidebarCancelClipboard() { clipboard = null; renderSidebar(); }

function copyFileInto(src, folderId) {
  notes.push({
    id: genNoteId(),
    title: src.title || "untitled",
    content: src.content || "",
    extension: src.extension || "txt",
    folderId: folderId !== undefined ? folderId : (src.folderId || null),
    lastEdited: new Date().toISOString(),
    _created: true, _dirty: true
  });
  return true;
}
function copyFolderSubtree(srcId, newParentId, top) {
  const src = folderById(srcId);
  if (!src) return true;
  const newId = genFolderId();
  folders.push({ id: newId, name: src.name + (top ? " copy" : ""), parentId: newParentId });
  let ok = true;
  notesInFolder(srcId).forEach(n => { if (!copyFileInto(n, newId)) ok = false; });
  foldersInFolder(srcId).forEach(sf => { if (!copyFolderSubtree(sf.id, newId, false)) ok = false; });
  return ok;
}

function sidebarPaste() {
  if (!clipboard) return;
  let blocked = 0, applied = 0;
  if (clipboard.mode === "move") {
    clipboard.noteIds.forEach(id => {
      const n = notes.find(x => String(x.id) === String(id));
      if (n) { n.folderId = currentFolderId || null; n._dirty = true; n.lastEdited = new Date().toISOString(); applied++; }
    });
    clipboard.folderIds.forEach(fid => {
      if (currentFolderId && (fid === currentFolderId || isDescendant(currentFolderId, fid))) { blocked++; return; }
      const f = folderById(fid);
      if (f) { f.parentId = currentFolderId || null; applied++; }
    });
    saveFolders(); saveNotes();
  } else {
    clipboard.noteIds.forEach(id => { const n = notes.find(x => String(x.id) === String(id)); if (n && copyFileInto(n, currentFolderId || null)) applied++; });
    clipboard.folderIds.forEach(fid => { if (copyFolderSubtree(fid, currentFolderId || null, true)) applied++; });
    saveFolders(); saveNotes();
  }
  clipboard = null;
  renderSidebar();
  if (!applied) showNotification("Nothing to paste — items no longer exist");
  else showNotification(blocked ? ("Pasted (" + blocked + " skipped)") : "Pasted");
  if (isSignedIn()) syncWithDrive(false);
}

async function deleteNoteBlob(n) {
  const map = loadFileIdMap();
  const fid = map[n.id];
  if (fid) {
    if (isSignedIn() && navigator.onLine) { try { await driveDelete(fid); } catch (e) {} }
    delete map[n.id];
    saveFileIdMap(map);
  }
}

async function sidebarDeleteSelected() {
  if (!selected.size) { showNotification("Nothing selected"); return; }
  const noteIds = [...selected].filter(k => k[0] === "n").map(k => k.slice(2));
  const folderIds = [...selected].filter(k => k[0] === "f").map(k => k.slice(2));
  let allFolderIds = [];
  folderIds.forEach(fid => { allFolderIds = allFolderIds.concat(getDescendantFolderIds(fid)); });
  allFolderIds = [...new Set(allFolderIds)];
  let doomedNotes = notes.filter(n => noteIds.indexOf(String(n.id)) !== -1 || allFolderIds.indexOf(n.folderId) !== -1);
  if (doomedNotes.length >= notes.length && notes.length > 0) {
    doomedNotes = doomedNotes.slice().sort((a, b) => parseTimestamp(b.lastEdited) - parseTimestamp(a.lastEdited));
    doomedNotes.shift();
    if (!doomedNotes.length && !allFolderIds.length) { showNotification("There should be at least one active note"); return; }
  }
  const summary = "Deleting " + doomedNotes.length + " file(s)" + (folderIds.length ? " and " + folderIds.length + " folder(s)" : "") + ".";
  confirmDeleteWithKey(() => performDelete(doomedNotes.slice(), allFolderIds.slice()), summary);
}

async function performDelete(doomedNotes, allFolderIds) {
  for (const n of doomedNotes) await deleteNoteBlob(n);
  const doomedIds = new Set(doomedNotes.map(n => String(n.id)));
  if (currentNote && doomedIds.has(String(currentNote.id))) { currentNote = null; if (noteTextarea) noteTextarea.value = ""; }
  notes = notes.filter(n => !doomedIds.has(String(n.id)));
  folders = folders.filter(f => allFolderIds.indexOf(f.id) === -1);
  if (allFolderIds.length) saveFolders();
  saveNotes();
  if (currentFolderId && allFolderIds.indexOf(currentFolderId) !== -1) { currentFolderId = null; saveCurrentFolder(); }
  selected.clear(); selectMode = false;
  renderSidebar();
  showNotification("Deleted");
  if (isSignedIn()) syncWithDrive(false);
}

function confirmDeleteWithKey(onConfirm, summary) {
  const key = String(Math.floor(10000000 + Math.random() * 90000000));
  window.__dexDelKey = key;
  window.__dexDelAction = onConfirm;

  showModal({
    header: `<div class="modal-title">Confirm delete</div>`,
    body: `
      <div>
        <label class="modal-label">${escapeHtml(summary || "This cannot be undone.")}</label>

        <div class="dex-delkey">${key}</div>

        <label class="modal-label">Type the key above to confirm</label>

        <input
          type="text"
          id="dexDelKey"
          class="modal-input"
          inputmode="numeric"
          autocomplete="off"
          placeholder="8-digit key"
        >
      </div>
    `,
    footer: `
      <button onclick="closeModal()">Cancel</button>
      <button onclick="dexDeleteConfirm()" class="modal-btn">Delete</button>
    `
  });
}

window.dexDeleteConfirm = function () {
  const val = modalScope.dexDelKey ? modalScope.dexDelKey.value.trim() : "";
  if (val !== window.__dexDelKey) {
    if (modalScope.dexDelKey) modalScope.dexDelKey.style.borderColor = "#ff4444";
    showNotification("Key does not match");
    return;
  }
  const act = window.__dexDelAction;
  window.__dexDelAction = null; window.__dexDelKey = null;
  closeModal();
  if (typeof act === "function") act();
};

async function driveDelete(fileId) {
  const token = await getDriveToken();
  const res = await fetch(DRIVE_API + "/files/" + fileId, { method: "DELETE", headers: { Authorization: "Bearer " + token } });
  if (!res.ok && res.status !== 404) throw new Error("Drive delete failed: " + res.status);
}

async function syncFoldersManifest(fileIdMap, byName) {
  const name = "folders.json";
  const cloudFile = byName[name];
  const localEdited = localStorage.getItem("foldersLastEdited") || "1970-01-01T00:00:00.000Z";
  let cloudMeta = null;
  if (cloudFile) {
    try { cloudMeta = JSON.parse(await driveDownload(cloudFile.id)); } catch (e) {}
    fileIdMap["__folders__"] = cloudFile.id;
  }
  const cloudTime = cloudMeta ? new Date(cloudMeta.lastEdited || 0).getTime() : -1;
  const localTime = new Date(localEdited).getTime();
  if (cloudMeta && cloudTime > localTime) {
    folders = Array.isArray(cloudMeta.folders) ? cloudMeta.folders : [];
    localStorage.setItem("folders", JSON.stringify(folders));
    localStorage.setItem("foldersLastEdited", cloudMeta.lastEdited || new Date().toISOString());
  } else {
    const payload = JSON.stringify({ folders, lastEdited: localEdited });
    if (cloudFile) await driveUpdate(cloudFile.id, payload);
    else fileIdMap["__folders__"] = await driveCreate(name, payload);
  }
}

window.sidebarAddItems = sidebarAddItems;
window.sidebarToggleSelect = sidebarToggleSelect;
window.sidebarStartMove = sidebarStartMove;
window.sidebarStartCopy = sidebarStartCopy;
window.sidebarPaste = sidebarPaste;
window.sidebarCancelClipboard = sidebarCancelClipboard;
window.sidebarDeleteSelected = sidebarDeleteSelected;

window.__dexSidebarReady = true;
