export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function handleFetchSubmit() {
  closeModal({
    action: "submit",
    fetchUrl: modalScope && modalScope.fetchUrlInput ? modalScope.fetchUrlInput.value.trim() : ""
  });
}

const FETCH_API_URL = "https://fetch-300199660511.us-central1.run.app/fetch";

// Network part only: returns the fetched page as plain text, or throws an Error
// whose message is safe to show the user. Shared by the sidebar function and workflows.
export async function fetchPageText(url) {
  const target = (url || "").trim();
  if (!target) throw new Error("Please enter a URL");
  const resp = await window.fetch(FETCH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: target })
  });
  if (!resp.ok) throw new Error("Fetch failed: " + resp.status + " " + resp.statusText);
  const data = await resp.json();
  const source = data.source_url || data.source || data.html || null;
  if (!source) throw new Error("No source returned");
  const temp = document.createElement("div");
  temp.innerHTML = source;
  return temp.textContent || temp.innerText || "";
}

export const FETCH_APPEND_MARKER = "\n\n<!-- appended from fetch -->\n\n";

export async function fetchUrlToCurrentNote(url) {
  if (!currentNote || !noteTextarea) {
    showNotification("No note selected or editor missing");
    return;
  }
  if (!url) {
    showNotification("Please enter a URL");
    return;
  }
  showNotification("Fetching...");
  try {
    const html = await fetchPageText(url);
    noteTextarea.value = (noteTextarea.value || "") + FETCH_APPEND_MARKER + html;
    currentNote.extension = "html";
    currentNote.lastEdited = new Date().toISOString();
    const idx = notes.findIndex((n) => n.id === currentNote.id);
    if (idx !== -1) {
      notes[idx].extension = currentNote.extension;
      notes[idx].lastEdited = currentNote.lastEdited;
    }
    if (typeof updateNoteMetadata === "function") updateNoteMetadata();
    if (typeof populateNoteList === "function") populateNoteList();
    if (typeof updateDocumentInfo === "function") updateDocumentInfo();
    if (typeof immediatePlainRender === "function") immediatePlainRender();
    if (typeof scheduleUpdate === "function") scheduleUpdate(true);
    showNotification("Fetched and appended. Note extension set to .html");
  } catch (err) {
    showNotification(err && err.message ? err.message : "Request failed: " + err);
  }
}

export function openFetchModal() {
  return preserveSelection(async function () {
    if (!currentNote || !noteTextarea) {
      showNotification("No note selected or editor missing");
      return;
    }
    const r = await showModal({
      header: '<div class="modal-title">Fetch Website Source</div>',
      body:
        '<div style="display:flex;flex-direction:column;gap:8px;"><div><label class="modal-label">URL</label><input type="text" id="fetchUrlInput" placeholder="https://example.com" class="modal-input" /></div></div>',
      footer: '<button onclick="closeModal()">Cancel</button><button onclick="handleFetchSubmit()" class="modal-btn">Fetch</button>',
      html: true
    });
    if (!r || r.action !== "submit") return;
    const url = (r.fetchUrl || "").trim();
    if (!url) {
      showNotification("Please enter a URL");
      return;
    }
    await fetchUrlToCurrentNote(url);
  })();
}
