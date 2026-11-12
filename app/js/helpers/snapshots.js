/**
 * Version snapshots - a safety net that lives OUTSIDE the notes JSON.
 * Stored in IndexedDB (separate, much larger quota than localStorage), so even if a note is overwritten
 * by a bug, another tab or a full-storage failure, earlier text can still be restored.
 *
 *   dexSnapshots.snap(note, reason, force)   - called by notes-state.js (autosave / note switch / failures)
 *   openVersionRecovery()                    - Sidebar 2 > Document > Recover Versions
 */
(function () {
  "use strict";
  const DB = "dexSnapshots", ST = "snaps", MIN_GAP = 45000;
  const last = new Map();               // noteId -> { t, content } (what we last stored; avoids duplicates)
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error("no indexedDB"));
      const rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => {
        const st = rq.result.createObjectStore(ST, { keyPath: "id", autoIncrement: true });
        st.createIndex("noteId", "noteId"); st.createIndex("ts", "ts");
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }

  function put(rec) {
    return open().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(ST, "readwrite");
      tx.objectStore(ST).add(rec);
      tx.oncomplete = () => { prune(db, rec.noteId, rec.content.length); res(); };
      tx.onerror = () => rej(tx.error);
    }));
  }

  /** Keep the newest KEEP per note (fewer for very large notes). */
  function prune(db, noteId, len) {
    const KEEP = len > 500000 ? 20 : 80;
    try {
      const tx = db.transaction(ST, "readwrite");
      const keys = [];
      tx.objectStore(ST).index("noteId").openKeyCursor(IDBKeyRange.only(noteId)).onsuccess = (e) => {
        const c = e.target.result;
        if (c) { keys.push(c.primaryKey); c.continue(); return; }
        keys.sort((a, b) => a - b);
        keys.slice(0, Math.max(0, keys.length - KEEP)).forEach((k) => tx.objectStore(ST).delete(k));
      };
    } catch (e) {}
  }

  function snap(note, reason, force) {
    try {
      if (!note || note.id == null || typeof note.content !== "string" || !note.content) return;
      const id = String(note.id), prev = last.get(id), now = Date.now();
      if (prev && prev.content === note.content) return;
      // A big drop in length is the signature of "something replaced my text": keep the old text too.
      if (prev && prev.content.length > 200 && note.content.length < prev.content.length * 0.5) {
        put({ noteId: id, title: note.title || "", ts: now - 1, reason: "before-shrink", content: prev.content }).catch(() => {});
      }
      if (!force && prev && now - prev.t < MIN_GAP) return;
      last.set(id, { t: now, content: note.content });
      put({ noteId: id, title: note.title || "", ts: now, reason: reason || "", content: note.content }).catch(() => {});
    } catch (e) {}
  }

  function all(limit) {
    return open().then((db) => new Promise((res, rej) => {
      const out = [];
      const rq = db.transaction(ST).objectStore(ST).index("ts").openCursor(null, "prev");
      rq.onsuccess = () => {
        const c = rq.result;
        if (c && out.length < (limit || 150)) { out.push(c.value); c.continue(); } else res(out);
      };
      rq.onerror = () => rej(rq.error);
    }));
  }

  // ── Recovery screen ──────────────────────────────────────────────────────
  function el(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
  const btn = (t, f) => { const b = el("button", "padding:8px 12px;border-radius:10px;border:1px solid #888;background:transparent;color:inherit;font:inherit", t); b.onclick = f; return b; };

  window.openVersionRecovery = async function () {
    const old = document.getElementById("dexRecover"); if (old) old.remove();
    const ov = el("div", "position:fixed;inset:0;z-index:100000;background:var(--c-panel,#111);color:var(--color,#eee);overflow:auto;padding:16px;font-family:inherit");
    ov.id = "dexRecover";
    const head = el("div", "display:flex;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px");
    head.appendChild(el("b", "font-size:18px", "Recover Versions"));
    head.appendChild(btn("Close", () => ov.remove()));
    ov.appendChild(head);
    const list = el("div"); ov.appendChild(list); document.body.appendChild(ov);
    let rows = [];
    try { rows = await all(200); } catch (e) { list.textContent = "Snapshots are unavailable in this browser."; return; }
    if (!rows.length) { list.textContent = "No snapshots yet. They are taken while you edit and whenever you switch notes."; return; }
    for (const r of rows) {
      const card = el("div", "border:1px solid #8884;border-radius:12px;padding:10px;margin-bottom:10px");
      card.appendChild(el("div", "font-weight:600", (r.title || "Untitled") + "  ·  " + new Date(r.ts).toLocaleString()));
      card.appendChild(el("div", "opacity:.7;font-size:12px;margin:2px 0 6px", r.content.length + " chars · " + r.reason));
      card.appendChild(el("div", "opacity:.85;font-size:13px;white-space:pre-wrap;max-height:4.5em;overflow:hidden", r.content.slice(0, 220)));
      const row = el("div", "display:flex;gap:8px;margin-top:8px;flex-wrap:wrap");
      row.appendChild(btn("Copy", async () => { try { await navigator.clipboard.writeText(r.content); showNotification("Copied"); } catch (e) { showNotification("Copy failed", "error"); } }));
      row.appendChild(btn("Restore into this note", () => {
        if (typeof currentNote === "undefined" || !currentNote) { showNotification("Open a note first", "error"); return; }
        if (!confirm("Replace the open note with this version? The current text is kept as a snapshot first.")) return;
        snap(currentNote, "before-restore", true);
        currentNote.content = r.content; currentNote.lastEdited = new Date().toISOString(); currentNote._dirty = true;
        saveNotes(); openNote(currentNote.id); ov.remove(); showNotification("Version restored");
      }));
      card.appendChild(row); list.appendChild(card);
    }
  };

  window.dexSnapshots = { snap, all };
})();
