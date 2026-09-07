import { listPaneNotes, parsePane, getBatchEligibleFunctions, applyPaneToEditor } from "../sidebar2/functions/2operations/chain.js";
import { cipherTransform } from "../sidebar2/functions/3code/cipher.js";
import { applyDesignerFont, listFontChoices } from "../sidebar2/functions/1formatting/fontpicker.js";
import { textToHtmlTable, showTextToTableOptionsModal } from "../sidebar2/functions/3code/html.js";

const ONCE_HANDLERS = {
  cipher: {
    async prompt() { return promptCipherKeyOnce(); },
    async apply(text, settings) { return cipherTransform(text, settings.pw1, settings.pw2, settings.mode); }
  },
  font: {
    async prompt() { return promptFontOnce(); },
    async apply(text, settings) { return applyDesignerFont(text, settings.textFont, settings.numFont); }
  },
  tabletext: {
    async prompt() { return showTextToTableOptionsModal(); },
    async apply(text, settings) { return textToHtmlTable(text, settings); }
  }
};

function paneOnceKind(pane) {
  if (pane.steps.length !== 1 || pane.steps[0].kind !== "fn") return null;
  const fn = getBatchEligibleFunctions().find((f) => f.value === pane.steps[0].fnName);
  return fn ? fn.once : null;
}

function paneStepsAreBatchSafe(pane) {
  const eligibleNames = new Set(getBatchEligibleFunctions().map((f) => f.value));
  return pane.steps.every((s) => s.kind !== "fn" || eligibleNames.has(s.fnName));
}

async function pickBatchAction() {
  const paneEntries = listPaneNotes()
    .map((n) => ({ note: n, pane: parsePane(n) }))
    .filter((x) => x.pane && paneStepsAreBatchSafe(x.pane));

  const paneRows = paneEntries
    .map(({ pane }) =>
      '<div class="chain-pane-row batch-action-row" data-kind="pane" data-id="' + escapeHtml(pane.name) + '" data-search="' + escapeHtml(pane.name.toLowerCase()) + '">' +
        '<div class="chain-pane-info">' +
          '<div class="chain-pane-name">' + escapeHtml(pane.name) + "</div>" +
          '<div class="chain-pane-steps">' + pane.steps.length + " step" + (pane.steps.length === 1 ? "" : "s") + "</div>" +
        "</div>" +
      "</div>"
    ).join("");

  const fnRows = getBatchEligibleFunctions()
    .map((f) =>
      '<div class="chain-pane-row batch-action-row" data-kind="fn" data-id="' + f.value + '" data-search="' + escapeHtml(f.label.toLowerCase()) + '">' +
        '<div class="chain-pane-info">' +
          '<div class="chain-pane-name">' + escapeHtml(f.label) + "</div>" +
          '<div class="chain-pane-steps">' + (f.once ? "Prompts once, applies to every file" : "Single function") + "</div>" +
        "</div>" +
      "</div>"
    ).join("");

  const rows = paneRows + fnRows || '<div class="chain-empty">No chainable panes or functions found.</div>';

  const modalPromise = showModal({
    header: '<div class="modal-title">Batch apply — choose an action</div>',
    body:
      '<input type="text" id="batchActionSearch" class="sidebar2-search" placeholder="Search actions…" autocomplete="off" spellcheck="false">' +
      '<div id="batchActionList">' + rows + "</div>",
    footer: '<button onclick="closeModal()">Cancel</button>'
  });

  const searchInput = document.getElementById("batchActionSearch");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const q = searchInput.value.trim().toLowerCase();
      document.querySelectorAll("#batchActionList .batch-action-row").forEach((row) => {
        row.style.display = !q || (row.dataset.search || "").indexOf(q) !== -1 ? "" : "none";
      });
    });
  }

  document.querySelectorAll("#batchActionList .batch-action-row").forEach((row) => {
    row.addEventListener("click", () => closeModal({ kind: row.dataset.kind, id: row.dataset.id }));
  });

  const sel = await modalPromise;
  if (!sel) return null;
  if (sel.kind === "pane") {
    const note = listPaneNotes().find((n) => { const p = parsePane(n); return p && p.name === sel.id; });
    return note ? parsePane(note) : null;
  }
  const fn = getBatchEligibleFunctions().find((f) => f.value === sel.id);
  return fn ? { name: fn.label, steps: [{ kind: "fn", fnName: fn.value, label: fn.label }] } : null;
}

function promptCipherKeyOnce() {
  const modalPromise = showModal({
    header: '<div class="modal-title">Cipher key — applied to every selected file</div>',
    body:
      "<div><label class=\"modal-label\">Key I</label><input id=\"batchCipherPw1\" class=\"modal-input\" placeholder=\"Key I\"></div>" +
      "<div style=\"margin-top:8px;\"><label class=\"modal-label\">Key II</label><input id=\"batchCipherPw2\" class=\"modal-input\" placeholder=\"Key II\"></div>" +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
        '<button type="button" id="batchCipherEnc" class="modal-btn active" onclick="window.__dexBatchCipherMode(\'encrypt\')">Encrypt</button>' +
        '<button type="button" id="batchCipherDec" class="modal-btn" onclick="window.__dexBatchCipherMode(\'decrypt\')">Decrypt</button>' +
      "</div>",
    footer: '<button onclick="closeModal()">Cancel</button><button onclick="window.__dexBatchCipherSubmit()" class="modal-btn">Continue</button>'
  });

  window.__dexBatchCipherMode = function (mode) {
    const enc = document.getElementById("batchCipherEnc");
    const dec = document.getElementById("batchCipherDec");
    if (enc) enc.classList.toggle("active", mode === "encrypt");
    if (dec) dec.classList.toggle("active", mode === "decrypt");
  };
  window.__dexBatchCipherSubmit = function () {
    const pw1 = (document.getElementById("batchCipherPw1") || {}).value || "";
    const pw2 = (document.getElementById("batchCipherPw2") || {}).value || "";
    if (!pw1 || !pw2) { showNotification("Both keys are required"); return; }
    const mode = (document.getElementById("batchCipherEnc") || {}).classList.contains("active") ? "encrypt" : "decrypt";
    closeModal({ pw1, pw2, mode });
  };

  return modalPromise;
}

function promptFontOnce() {
  const choices = listFontChoices();
  const optionsHtml = choices.map((c) => '<option value="' + escapeHtml(c.value) + '">' + escapeHtml(c.label) + '</option>').join("");
  const modalPromise = showModal({
    header: '<div class="modal-title">Designer font — applied to every selected file</div>',
    body:
      '<div><label class="modal-label">Text font</label>' +
      '<select id="batchFontText" class="modal-select"><option value="">None</option>' + optionsHtml + '</select></div>' +
      '<div style="margin-top:8px;"><label class="modal-label">Numeral font</label>' +
      '<select id="batchFontNum" class="modal-select"><option value="">None</option>' + optionsHtml + '</select></div>',
    footer: '<button onclick="closeModal()">Cancel</button><button onclick="window.__dexBatchFontSubmit()" class="modal-btn">Continue</button>'
  });

  window.__dexBatchFontSubmit = function () {
    const textFont = (document.getElementById("batchFontText") || {}).value || "";
    const numFont = (document.getElementById("batchFontNum") || {}).value || "";
    if (!textFont && !numFont) { showNotification("Pick at least one font"); return; }
    closeModal({ textFont: textFont || null, numFont: numFont || null });
  };

  return modalPromise;
}

function showBatchProgress(total) {
  const el = document.createElement("div");
  el.className = "batch-progress-overlay";
  el.innerHTML =
    '<div class="batch-progress-card">' +
      '<div class="batch-progress-title">Applying…</div>' +
      '<div class="batch-progress-bar"><div class="batch-progress-fill" id="batchProgressFill"></div></div>' +
      '<div class="batch-progress-status" id="batchProgressStatus">0 / ' + total + "</div>" +
      '<div class="batch-progress-log" id="batchProgressLog"></div>' +
    "</div>";
  document.body.appendChild(el);
  const fill = el.querySelector("#batchProgressFill");
  const status = el.querySelector("#batchProgressStatus");
  const log = el.querySelector("#batchProgressLog");

  return {
    update(done, fileName) {
      fill.style.width = Math.round((done / total) * 100) + "%";
      status.textContent = done + " / " + total + " — " + fileName;
    },
    logError(msg) {
      const line = document.createElement("div");
      line.className = "batch-progress-log-line";
      line.textContent = msg;
      log.appendChild(line);
    },
    done(results) {
      status.textContent = "Done — " + results.ok + " succeeded" + (results.fail ? ", " + results.fail + " failed" : "");
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "modal-btn batch-progress-close";
      closeBtn.textContent = "Close";
      closeBtn.addEventListener("click", () => el.remove());
      el.querySelector(".batch-progress-card").appendChild(closeBtn);
    }
  };
}

async function runBatch(fileIds, pane, onceHandler, onceSettings) {
  const results = { ok: 0, fail: 0 };
  const prevNoteId = typeof currentNote !== "undefined" && currentNote ? currentNote.id : null;
  const progress = showBatchProgress(fileIds.length);

  for (let i = 0; i < fileIds.length; i++) {
    const id = fileIds[i];
    const note = notes.find((n) => String(n.id) === String(id));
    if (!note) { results.fail++; progress.update(i + 1, "(missing file)"); continue; }
    progress.update(i + 1, note.title || ("note " + note.id));
    try {
      openNote(id);
      if (onceHandler) {
        const cm = window.dexEditor && window.dexEditor.cm;
        const before = cm ? cm.getValue() : (typeof noteTextarea !== "undefined" && noteTextarea ? noteTextarea.value : "");
        const after = await onceHandler.apply(before, onceSettings);
        if (cm) {
          const lastLine = cm.lineCount() - 1;
          cm.operation(() => { cm.replaceRange(after, { line: 0, ch: 0 }, { line: lastLine, ch: cm.getLine(lastLine).length }); });
        } else if (typeof noteTextarea !== "undefined" && noteTextarea) {
          noteTextarea.value = after;
        }
      } else {
        await applyPaneToEditor(pane);
      }
      if (typeof updateNoteMetadata === "function") updateNoteMetadata();
      results.ok++;
    } catch (err) {
      results.fail++;
      progress.logError((note.title || note.id) + ": " + (err && err.message ? err.message : "failed"));
    }
  }

  if (prevNoteId) openNote(prevNoteId);
  else if (typeof renderSidebar === "function") renderSidebar();
  if (typeof isSignedIn === "function" && isSignedIn()) syncWithDrive(false);

  progress.done(results);
}

export async function openBatchApply() {
  if (!selected || !selected.size) { showNotification("Select files first"); return; }
  const fileIds = [...selected].filter((k) => k[0] === "n").map((k) => k.slice(2));
  if (!fileIds.length) { showNotification("Select files (not folders) to batch-apply to"); return; }

  const pane = await pickBatchAction();
  if (!pane) return;

  const onceKind = paneOnceKind(pane);
  let onceHandler = null;
  let onceSettings = null;
  if (onceKind) {
    onceHandler = ONCE_HANDLERS[onceKind];
    onceSettings = await onceHandler.prompt();
    if (!onceSettings) return;
  } else if (pane.steps.length > 1) {
    const onceStepNames = new Set(getBatchEligibleFunctions().filter((f) => f.once).map((f) => f.value));
    const hasEmbeddedOnceStep = pane.steps.some((s) => s.kind === "fn" && onceStepNames.has(s.fnName));
    if (hasEmbeddedOnceStep) {
      showNotification("A step that needs its own prompt can't be combined with others in a batch run — save it as its own pane");
      return;
    }
  }

  runBatch(fileIds, pane, onceHandler, onceSettings);
}

window.openBatchApply = openBatchApply;
