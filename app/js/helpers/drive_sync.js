const GOOGLE_CLIENT_ID = "724287713033-f60ssdalr8v9st2p7a036p9pvmg96jcr.apps.googleusercontent.com";

const SCOPES = "openid email profile https://www.googleapis.com/auth/drive.appdata";
const DRIVE_API    = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;
let currentUser = null;

function initTokenClient() {
  if (typeof google === "undefined" || !google.accounts || !google.accounts.oauth2) return false;
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.indexOf("PASTE_YOUR") === 0) return false;
  if (tokenClient) return true;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    callback: () => {},
    error_callback: () => {}
  });
  return true;
}

function requestToken(interactive = false) {
  return new Promise((resolve, reject) => {
    if (accessToken && Date.now() < tokenExpiry - 60000) { resolve(accessToken); return; }
    if (!initTokenClient()) {
      reject(new Error(!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.indexOf("PASTE_YOUR") === 0
        ? "Set GOOGLE_CLIENT_ID first"
        : "Google services not loaded yet"));
      return;
    }
    tokenClient.callback = (resp) => {
      if (resp && resp.error) { reject(resp); return; }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + ((resp.expires_in || 3600) * 1000);
      resolve(accessToken);
    };
    tokenClient.error_callback = (err) => reject(err);
    try {
      tokenClient.requestAccessToken({ prompt: "" });
    } catch (e) { reject(e); }
  });
}

function getDriveToken(interactive = false) {
  if (accessToken && Date.now() < tokenExpiry - 60000) return Promise.resolve(accessToken);
  if (!interactive) return Promise.reject(new Error("no-silent-token"));
  return requestToken(true);
}

function isSignedIn() { return !!currentUser; }

async function hydrateUser(token) {
  try {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: "Bearer " + token } });
    if (res.ok) {
      const p = await res.json();
      currentUser = { name: p.name || p.email || "User", email: p.email, picture: p.picture, sub: p.sub };
    } else {
      currentUser = { name: "User" };
    }
  } catch (e) {
    currentUser = { name: "User" };
  }
}

function renderUserAvatar() {
  const el = document.getElementById('infoAvatar');
  if (!el) return;
  el.innerHTML = (currentUser && currentUser.picture)
    ? `<img src="${currentUser.picture}" alt="Profile picture" referrerpolicy="no-referrer" style="width:23px;height:23px;border-radius:50%;object-fit:cover;">`
    : (window.dexIcon ? window.dexIcon('person') : '');
}

function updateAuthUI() {
  if (currentUser) {
    welcomeMessage.textContent = `Welcome to Dekxitty, ${capitalizeName(currentUser.name || "User")}!`;
    if (loginBtn) loginBtn.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "inline-block";
  } else {
    welcomeMessage.textContent = "Welcome to Dekxitty";
    if (loginBtn) loginBtn.style.display = "inline-block";
    if (logoutBtn) logoutBtn.style.display = "none";
  }
  renderUserAvatar();
}

async function afterSignIn(silent) {
  updateAuthUI();
  if (currentUser) {
    localStorage.setItem("dexSignedIn", "1");
    localStorage.setItem("dexUser", JSON.stringify(currentUser));
    if (!silent) showNotification(`Welcome, ${capitalizeName(currentUser.name || "User")}!`);
  }
  notes = await loadNotes();
  if (Array.isArray(notes)) { populateNoteList(); updateNoteVisibility(); saveNotes(); }

  syncWithDrive(!silent);

  if (window.periodicSyncInterval) clearInterval(window.periodicSyncInterval);
  window.periodicSyncInterval = setInterval(() => {
    if (isSignedIn() && navigator.onLine && notes.some(n => n._dirty)) syncWithDrive(false);
  }, 120000);

  if (currentApp === "notes" && currentNote) openNote(currentNote.id);
}

function afterSignOutUI() {
  currentUser = null;
  updateAuthUI();
  sessionStorage.removeItem("loginShown");
  updateDocumentInfo();
}

async function signIn() {
  const ready = await waitForGis();
  if (!ready) { showNotification("Google sign-in unavailable"); return; }
  requestToken()
    .then(async (token) => { await hydrateUser(token); await afterSignIn(false); })
    .catch((e) => {
      console.error("Sign-in failed", e);
      showNotification("Login failed: " + (e && (e.error || e.message) || "denied"));
    });
}

function signOut() {
  localStorage.removeItem("dexSignedIn");
  localStorage.removeItem("dexUser");

  accessToken = null;
  tokenExpiry = 0;
  if (window.periodicSyncInterval) { clearInterval(window.periodicSyncInterval); window.periodicSyncInterval = null; }
  afterSignOutUI();
  showNotification("Signed out");
}

function waitForGis(timeout = 8000) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function check() {
      if (typeof google !== "undefined" && google.accounts && google.accounts.oauth2) { resolve(true); return; }
      if (Date.now() - start > timeout) { resolve(false); return; }
      setTimeout(check, 120);
    })();
  });
}

async function driveList() {
  const token = await getDriveToken();
  const url = DRIVE_API + "/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&pageSize=1000";
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error("Drive list failed: " + res.status);
  const data = await res.json();
  return data.files || [];
}

async function driveDownload(fileId) {
  const token = await getDriveToken();
  const res = await fetch(DRIVE_API + "/files/" + fileId + "?alt=media", {
    headers: { Authorization: "Bearer " + token }
  });
  if (!res.ok) throw new Error("Drive download failed: " + res.status);
  return await res.text();
}

async function driveCreate(name, contentString) {
  const token = await getDriveToken();
  const boundary = "dexlabs" + Math.random().toString(36).slice(2);
  const metadata = { name: name, parents: ["appDataFolder"], mimeType: "application/json" };
  const body =
    "--" + boundary + "\r\n" +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: application/json\r\n\r\n" +
    contentString + "\r\n" +
    "--" + boundary + "--";
  const res = await fetch(DRIVE_UPLOAD + "/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary },
    body
  });
  if (!res.ok) throw new Error("Drive create failed: " + res.status);
  const data = await res.json();
  return data.id;
}

async function driveUpdate(fileId, contentString) {
  const token = await getDriveToken();
  const res = await fetch(DRIVE_UPLOAD + "/files/" + fileId + "?uploadType=media", {
    method: "PATCH",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: contentString
  });
  if (!res.ok) throw new Error("Drive update failed: " + res.status);
  return fileId;
}

function loadFileIdMap() {
  try { return JSON.parse(localStorage.getItem("driveFileIds") || "{}"); } catch (e) { return {}; }
}
function saveFileIdMap(m) { localStorage.setItem("driveFileIds", JSON.stringify(m)); }

function notePayload(n) {
  return JSON.stringify({
    id: String(n.id),
    title: n.title || ("note " + n.id),
    content: n.content || "",
    extension: n.extension || "txt",
    folderId: n.folderId || null,
    created: !!n._created,
    lastEdited: n.lastEdited || new Date().toISOString()
  });
}

function setSyncState(state) {
  const btn = document.getElementById("secondary-sidebar-button");
  if (!btn) return;
  btn.classList.remove("syncing", "synced", "error");
  if (state) btn.classList.add(state);
}

function ensureSyncProgressUI() {
  if (document.getElementById("dexSyncOverlay")) return;
  const st = document.createElement("style");
  st.textContent = `
    #dexSyncOverlay { position:fixed; inset:0; background:color-mix(in srgb, var(--c-black) 55%, transparent); display:none; align-items:center; justify-content:center; z-index:100002; }
    #dexSyncOverlay .card { width:min(360px,86vw); background:var(--c-panel); border:1px solid var(--c-panel-3); border-radius:14px; padding:18px; }
    #dexSyncOverlay .row { display:flex; align-items:center; justify-content:space-between; }
    #dexSyncOverlay .ttl { font-size:15px; color:var(--c-white); }
    #dexSyncOverlay .cls { color:var(--c-text-faint); cursor:pointer; font-size:18px; line-height:1; padding:2px 6px; }
    #dexSyncOverlay .status { font-size:12.5px; color:var(--c-text-faint); margin:8px 0 12px; min-height:16px; }
    #dexSyncOverlay .bar { height:8px; border-radius:6px; background:var(--c-panel-2); overflow:hidden; }
    #dexSyncOverlay .fill { height:100%; width:0%; background:linear-gradient(90deg,var(--c-accent),var(--c-blue)); transition:width .25s ease; }
    #dexSyncOverlay .count { font-size:11px; color:var(--c-text-faint); margin-top:8px; text-align:right; min-height:13px; }
  `;
  document.head.appendChild(st);
  const ov = document.createElement("div");
  ov.id = "dexSyncOverlay";
  ov.innerHTML =
    '<div class="card">' +
    '<div class="row"><span class="ttl">Syncing with Google Drive</span></div>' +
    '<div class="status" id="dexSyncStatus">Starting…</div>' +
    '<div class="bar"><div class="fill" id="dexSyncFill"></div></div>' +
    '<div class="count" id="dexSyncCount"></div>' +
    '</div>';
  document.body.appendChild(ov);
}
function showSyncProgress() { ensureSyncProgressUI(); document.getElementById("dexSyncOverlay").style.display = "flex"; updateSyncProgress(2, "Starting…", ""); }
function updateSyncProgress(pct, status, count) {
  const fill = document.getElementById("dexSyncFill");
  const stx = document.getElementById("dexSyncStatus");
  const c = document.getElementById("dexSyncCount");
  if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
  if (stx && status != null) stx.textContent = status;
  if (c && count != null) c.textContent = count;
}
function hideSyncProgress() { const ov = document.getElementById("dexSyncOverlay"); if (ov) ov.style.display = "none"; }

let syncInFlight = null;
let syncPending = false;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}
function hashNote(n) { return fnv1a((n.title || "") + " " + (n.extension || "txt") + " " + (n.folderId || "") + " " + (n.content || "")); }
function hashFolder(f) { return fnv1a((f.name || "") + " " + (f.parentId || "")); }

function loadBaseManifest() { try { return JSON.parse(localStorage.getItem("dexBaseManifest") || "null"); } catch (e) { return null; } }
function saveBaseManifest(m) { localStorage.setItem("dexBaseManifest", JSON.stringify(m)); }

function noteById(id) { return notes.find(n => String(n.id) === String(id)); }

function buildLocalManifest(ref) {
  const now = new Date().toISOString();
  const out = { version: 2, notes: {}, folders: {} };
  const idmap = loadFileIdMap();
  folders.forEach(f => {
    const h = hashFolder(f);
    const prev = ref && ref.folders ? ref.folders[f.id] : null;
    out.folders[f.id] = { name: f.name, parentId: f.parentId || null, hash: h, mtime: (prev && prev.hash === h) ? prev.mtime : now };
  });
  notes.forEach(n => {
    const h = hashNote(n);
    const prev = ref && ref.notes ? ref.notes[String(n.id)] : null;
    out.notes[String(n.id)] = {
      title: n.title || ("note " + n.id), ext: n.extension || "txt", folderId: n.folderId || null,
      hash: h, mtime: n.lastEdited || now, fileId: (prev && prev.fileId) || idmap[n.id] || null
    };
  });
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); } }
  const ws = []; for (let w = 0; w < Math.min(limit, items.length); w++) ws.push(worker());
  await Promise.all(ws); return out;
}

async function driveListAll() {
  const token = await getDriveToken();
  let files = [], pageToken = null;
  do {
    let url = DRIVE_API + "/files?spaces=appDataFolder&fields=nextPageToken,files(id,name,modifiedTime,version)&pageSize=1000";
    if (pageToken) url += "&pageToken=" + encodeURIComponent(pageToken);
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!res.ok) throw new Error("Drive list failed: " + res.status);
    const data = await res.json();
    files = files.concat(data.files || []);
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return files;
}

async function deleteFilesBatched(files, onProgress) {
  let done = 0;
  await mapLimit(files, 8, async (f) => {
    try { const token = await getDriveToken(); await fetch(DRIVE_API + "/files/" + f.id, { method: "DELETE", headers: { Authorization: "Bearer " + token } }); } catch (e) {}
    done++; if (onProgress) onProgress(done, files.length);
  });
}

async function fetchManifest() {
  const token = await getDriveToken();
  const res = await fetch(DRIVE_API + "/files?spaces=appDataFolder&q=" + encodeURIComponent("name='manifest.json'") + "&fields=files(id,modifiedTime,version)", { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw new Error("Drive query failed: " + res.status);
  const data = await res.json();
  const candidates = (data.files || []).slice();
  if (!candidates.length) return { manifest: null, fileId: null, version: null };
  candidates.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));
  const keep = candidates[0];
  if (candidates.length > 1) { try { await deleteFilesBatched(candidates.slice(1)); } catch (e) {} }
  let manifest = null;
  try { manifest = JSON.parse(await driveDownload(keep.id)); } catch (e) { manifest = null; }
  return { manifest, fileId: keep.id, version: keep.version || null };
}

async function fetchManifestVersion(fileId) {
  if (!fileId) return null;
  const token = await getDriveToken();
  const res = await fetch(DRIVE_API + "/files/" + fileId + "?fields=version", { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) return null;
  const d = await res.json();
  return d.version || null;
}

async function writeManifest(fileId, obj) {
  const payload = JSON.stringify(obj);
  if (fileId) { await driveUpdate(fileId, payload); return fileId; }
  return await driveCreate("manifest.json", payload);
}

function applyRemoteNoteInto(target, meta, content) {
  target.title = meta.title || "untitled";
  target.extension = meta.ext || "txt";
  target.folderId = meta.folderId || null;
  target.content = content || "";
  target.lastEdited = meta.mtime || new Date().toISOString();
  target._created = true;
  target._dirty = false;
}

async function reconcile(base, remote, hooks) {
  const downloads = [];

  if (remote && remote.folders) {
    Object.keys(remote.folders).forEach(fid => {
      const r = remote.folders[fid];
      const b = base && base.folders ? base.folders[fid] : null;
      const l = folderById(fid);
      if (!l) { folders.push({ id: fid, name: r.name, parentId: r.parentId || null }); return; }
      const lh = hashFolder(l);
      if (lh === r.hash) return;
      if (b && b.hash === lh) { l.name = r.name; l.parentId = r.parentId || null; }
      else if (b && b.hash === r.hash) {  }
      else { if (!b || new Date(r.mtime || 0) >= new Date((b && b.mtime) || 0)) { l.name = r.name; l.parentId = r.parentId || null; } }
    });
  }
  if (base && base.folders && remote) {
    Object.keys(base.folders).forEach(fid => {
      if (remote.folders && remote.folders[fid]) return;
      const l = folderById(fid);
      if (l && hashFolder(l) === base.folders[fid].hash) folders = folders.filter(x => x.id !== fid);
    });
  }

  if (remote && remote.notes) {
    Object.keys(remote.notes).forEach(nid => {
      const r = remote.notes[nid];
      const b = base && base.notes ? base.notes[nid] : null;
      const l = noteById(nid);
      if (!l) {
        if (b) return;
        const dup = notes.find(x => hashNote(x) === r.hash);
        if (dup) { dup.id = nid; dup._dirty = false; return; }
        notes.push({ id: nid, title: r.title || "untitled", content: "", extension: r.ext || "txt", folderId: r.folderId || null, lastEdited: r.mtime || new Date().toISOString(), _created: true, _dirty: false });
        downloads.push({ id: nid, meta: r });
        return;
      }
      const lh = hashNote(l);
      if (lh === r.hash) return;
      if (b && b.hash === lh) { downloads.push({ id: nid, meta: r }); return; }
      if (b && b.hash === r.hash) return;
      if (!b || new Date(r.mtime || 0) >= new Date(l.lastEdited || 0)) downloads.push({ id: nid, meta: r });
    });
  }
  if (base && base.notes && remote) {
    Object.keys(base.notes).forEach(nid => {
      if (remote.notes && remote.notes[nid]) return;
      const l = noteById(nid);
      if (!l) return;
      if (hashNote(l) === base.notes[nid].hash) {
        notes = notes.filter(x => String(x.id) !== String(nid));
        if (currentNote && String(currentNote.id) === String(nid)) { currentNote = null; if (noteTextarea) noteTextarea.value = ""; }
      }
    });
  }

  let dc = 0;
  await mapLimit(downloads, 8, async (d) => {
    let content = "";
    try { if (d.meta.fileId) { const raw = await driveDownload(d.meta.fileId); try { content = (JSON.parse(raw).content) || ""; } catch (e) { content = ""; } } } catch (e) { content = ""; }
    const target = noteById(d.id);
    if (target) applyRemoteNoteInto(target, d.meta, content);
    dc++; if (hooks && hooks.download) hooks.download(dc, downloads.length);
  });

  notes.forEach(n => { if (n.folderId && !folderById(n.folderId)) { n.folderId = null; n._dirty = true; } });
  return { downloadCount: downloads.length };
}

async function pushBlobs(remote, local, hooks) {
  const idmap = loadFileIdMap();
  const ids = Object.keys(local.notes);
  let uc = 0;
  await mapLimit(ids, 6, async (nid) => {
    const n = noteById(nid);
    if (!n) return;
    const lmeta = local.notes[nid];
    const rmeta = remote && remote.notes ? remote.notes[nid] : null;
    if (rmeta && rmeta.hash === lmeta.hash && rmeta.fileId) { lmeta.fileId = rmeta.fileId; idmap[nid] = rmeta.fileId; }
    else {
      const payload = notePayload(n);
      let fid = lmeta.fileId || (rmeta && rmeta.fileId) || idmap[nid] || null;
      if (fid) { try { await driveUpdate(fid, payload); } catch (e) { fid = await driveCreate("note_" + nid + ".json", payload); } }
      else { fid = await driveCreate("note_" + nid + ".json", payload); }
      lmeta.fileId = fid; idmap[nid] = fid; n._dirty = false;
    }
    uc++; if (hooks && hooks.upload) hooks.upload(uc, ids.length);
  });
  saveFileIdMap(idmap);
}

async function deleteRemovedBlobs(remote, local) {
  if (!remote || !remote.notes) return;
  const idmap = loadFileIdMap();
  const gone = Object.keys(remote.notes).filter(nid => !local.notes[nid]);
  await mapLimit(gone, 8, async (nid) => {
    const fid = remote.notes[nid].fileId || idmap[nid];
    if (fid) { try { const token = await getDriveToken(); await fetch(DRIVE_API + "/files/" + fid, { method: "DELETE", headers: { Authorization: "Bearer " + token } }); } catch (e) {} }
    delete idmap[nid];
  });
  saveFileIdMap(idmap);
}

async function doSyncOnce(interactive, attempt) {
  attempt = attempt || 0;
  const prog = interactive ? {
    download: (d, t) => updateSyncProgress(15 + Math.round((d / Math.max(t, 1)) * 45), "Downloading changes", d + " / " + t),
    upload: (u, t) => updateSyncProgress(62 + Math.round((u / Math.max(t, 1)) * 30), "Uploading changes", u + " / " + t)
  } : null;

  if (interactive) updateSyncProgress(8, "Reading manifest…", "");
  let { manifest: remote, fileId: manifestFileId, version: startVersion } = await fetchManifest();

  if (!remote || remote.scheme !== "crypto") {
    const all = await driveListAll();
    const legacy = all.filter(f => f.name !== "manifest.json");
    if (legacy.length) {
      if (interactive) updateSyncProgress(12, "Cleaning legacy files…", "0 / " + legacy.length);
      await deleteFilesBatched(legacy, (d, t) => { if (interactive) updateSyncProgress(12, "Cleaning legacy files…", d + " / " + t); });
    }
    saveFileIdMap({});
    saveBaseManifest(null);
    remote = null;
    startVersion = null;
  }

  const base = loadBaseManifest();
  await reconcile(base, remote, prog);

  const local = buildLocalManifest(remote || base);
  await pushBlobs(remote, local, prog);

  if (manifestFileId && startVersion) {
    const nowVersion = await fetchManifestVersion(manifestFileId);
    if (nowVersion && nowVersion !== startVersion && attempt < 3) {
      if (interactive) updateSyncProgress(92, "Remote changed — retrying…", "");
      return doSyncOnce(interactive, attempt + 1);
    }
  }

  if (interactive) updateSyncProgress(94, "Writing manifest…", "");
  local.scheme = "crypto";
  local.rev = ((remote && remote.rev) || 0) + 1;
  local.updatedAt = new Date().toISOString();
  const mFileId = await writeManifest(manifestFileId, local);

  await deleteRemovedBlobs(remote, local);

  saveBaseManifest(local);
  saveNotes();
  if (typeof saveFolders === "function") saveFolders();
  notes.sort((a, b) => parseInt(a.id) - parseInt(b.id));
  if (typeof populateNoteList === "function") populateNoteList();
  if (currentNote) { const cn = noteById(currentNote.id); if (cn) { currentNote = cn; if (noteTextarea && document.activeElement !== noteTextarea) noteTextarea.value = cn.content; } }
  updateDocumentInfo();
}

async function syncWithDrive(interactive) {
  if (!isSignedIn()) { if (interactive) showNotification("Sign in first to sync"); return; }
  if (!navigator.onLine) { if (interactive) showNotification("You are offline"); return; }
  const haveToken = !!(accessToken && Date.now() < tokenExpiry - 60000);
  if (!interactive && !haveToken) return;
  if (syncInFlight) { syncPending = true; return syncInFlight; }
  syncInFlight = (async () => {
    setSyncState("syncing");
    if (interactive) showSyncProgress();
    try {
      if (interactive) updateSyncProgress(4, "Authorizing…", "");
      await getDriveToken(interactive);
      await doSyncOnce(interactive, 0);
      setSyncState("synced"); setTimeout(() => setSyncState(""), 1200);
      if (interactive) { updateSyncProgress(100, "Done", ""); setTimeout(hideSyncProgress, 700); showNotification("Synced to your Google Drive"); }
    } catch (e) {
      console.error("Sync failed", e);
      setSyncState("error"); setTimeout(() => setSyncState(""), 2000);
      if (interactive) { const msg = (e && (e.error || e.message)) || "unknown error"; updateSyncProgress(100, "Sync failed: " + msg, ""); setTimeout(hideSyncProgress, 1800); showNotification("Sync failed: " + msg); }
    } finally {
      syncInFlight = null;
      if (syncPending) { syncPending = false; setTimeout(() => syncWithDrive(false), 60); }
    }
  })();
  return syncInFlight;
}

function forceSyncToCloud() { syncWithDrive(true); }
window.forceSyncToCloud = forceSyncToCloud;

async function trySilentRestore() {
  try {
    const token = await requestToken();
    await hydrateUser(token);
    await afterSignIn(true);
  } catch (e) {
    localStorage.removeItem("dexSignedIn");
    afterSignOutUI();
  }
}
