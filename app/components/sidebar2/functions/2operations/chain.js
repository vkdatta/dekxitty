const ASSETS_FOLDER_NAME = "dexlabs assets";
const PANE_EXTENSION = "pane";

function ensureAssetsFolder() {
  let f = folders.find((x) => !x.parentId && x.name === ASSETS_FOLDER_NAME);
  if (f) return f.id;
  const id = genFolderId();
  folders.push({ id, name: ASSETS_FOLDER_NAME, parentId: null });
  saveFolders();
  return id;
}

export function listPaneNotes() {
  const folderId = ensureAssetsFolder();
  return notes.filter((n) => n.folderId === folderId && n.extension === PANE_EXTENSION);
}

export function parsePane(note) {
  try {
    const data = JSON.parse(note.content || "{}");
    if (!Array.isArray(data.steps)) return null;
    return { name: data.name || note.title, steps: data.steps };
  } catch (e) {
    return null;
  }
}

function paneNameTaken(name, excludeNoteId) {
  return listPaneNotes().some((n) => n.title === name && String(n.id) !== String(excludeNoteId));
}

function savePane(name, steps, existingNoteId) {
  const payload = JSON.stringify({ type: "dexlabs-chain-pane", name: name, steps: steps }, null, 2);
  if (existingNoteId) {
    const n = notes.find((x) => String(x.id) === String(existingNoteId));
    if (n) {
      n.title = name;
      n.content = payload;
      n._dirty = true;
      n.lastEdited = new Date().toISOString();
    }
  } else {
    const folderId = ensureAssetsFolder();
    notes.push({
      id: genNoteId(),
      title: name,
      content: payload,
      extension: PANE_EXTENSION,
      folderId: folderId,
      lastEdited: new Date().toISOString(),
      _created: true,
      _dirty: true
    });
  }
  saveNotes();
  if (typeof isSignedIn === "function" && isSignedIn()) syncWithDrive(false);
}

function stepKind(step) { return step && step.kind === "fn" ? "fn" : "replace"; }
function isPureReplaceChain(steps) { return steps.every((s) => stepKind(s) !== "fn"); }

function applyChainTextPure(text, steps) {
  let out = text;
  steps.forEach((step) => {
    if (!step || !step.find) return;
    out = out.split(step.find).join(step.replace || "");
  });
  return out;
}

function replaceWholeDoc(cm, text) {
  const lastLine = cm.lineCount() - 1;
  cm.operation(() => {
    cm.replaceRange(text, { line: 0, ch: 0 }, { line: lastLine, ch: cm.getLine(lastLine).length });
  });
  if (typeof updateNoteMetadata === "function") updateNoteMetadata();
}

async function runStep(step, cm) {
  if (stepKind(step) === "fn") {
    const fn = window[step.fnName];
    if (typeof fn !== "function") {
      showNotification('Chain: "' + (step.label || step.fnName) + '" is not available');
      return;
    }
    const result = fn();
    if (result && typeof result.then === "function") await result;
    return;
  }
  if (!step.find) return;
  const before = cm.getValue();
  const after = before.split(step.find).join(step.replace || "");
  if (after !== before) replaceWholeDoc(cm, after);
}

export async function applyPaneToEditor(pane) {
  const cm = window.dexEditor && window.dexEditor.cm;
  if (!cm) { showNotification("Editor not ready"); return; }

  if (isPureReplaceChain(pane.steps)) {
    const before = cm.getValue();
    const after = applyChainTextPure(before, pane.steps);
    if (after === before) { showNotification("No changes — nothing matched"); return; }
    replaceWholeDoc(cm, after);
    showNotification('Applied "' + pane.name + '"');
    return;
  }

  for (const step of pane.steps) { await runStep(step, cm); }
  showNotification('Applied "' + pane.name + '"');
}

function scanRegisteredItems(predicate) {
  const items = document.querySelectorAll(".secondary-sidebar-sub-item");
  const seen = new Set();
  const out = [];
  items.forEach((el) => {
    const onclick = el.getAttribute("onclick");
    if (!onclick) return;
    const m = /^(\w+)\(\)$/.exec(onclick.trim());
    if (!m) return;
    const fnName = m[1];
    if (seen.has(fnName)) return;
    if (predicate && !predicate(el, fnName)) return;
    seen.add(fnName);
    const labelNode = el.childNodes[1];
    const label = (labelNode ? labelNode.textContent : fnName).trim();
    out.push({ value: fnName, label: label || fnName, batch: el.dataset.batch || "" });
  });
  return out;
}

export function getRegisteredFunctions() {
  return scanRegisteredItems();
}

// Batch/zap mode only ever gets file-level functions (app-level entries like
// Open File or Force Sync to Cloud never operate on "one selected file" and
// crash the batch runner) plus file-level functions with a registered
// "prompt once, apply to every selected file" handler (see batch.js).
export function getBatchEligibleFunctions() {
  return scanRegisteredItems((el) => {
    const batch = el.dataset.batch || "";
    return batch === "file" || batch.indexOf("once:") === 0;
  }).map((f) => ({
    value: f.value,
    label: f.label,
    once: f.batch.indexOf("once:") === 0 ? f.batch.slice(5) : null
  }));
}

function wireDropdownTrigger(trigger, opts) {
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    renderDropdownMenuPortal(trigger, opts, (selected) => {
      trigger.textContent = selected.label;
      trigger.dataset.value = selected.value;
    });
  });
}

export async function openChainPanel() {
  const panes = listPaneNotes()
    .map((n) => ({ note: n, pane: parsePane(n) }))
    .filter((x) => x.pane);

  const rows = panes.length
    ? panes.map(({ note, pane }) =>
        '<div class="chain-pane-row" data-note-id="' + note.id + '">' +
          '<div class="chain-pane-info">' +
            '<div class="chain-pane-name">' + escapeHtml(pane.name) + "</div>" +
            '<div class="chain-pane-steps">' + pane.steps.length + " step" + (pane.steps.length === 1 ? "" : "s") + "</div>" +
          "</div>" +
          '<button type="button" class="chain-pane-edit" data-edit-id="' + note.id + '" title="Edit pane">' +
            '<delluna-icon name="edit"></delluna-icon>' +
          "</button>" +
        "</div>"
      ).join("")
    : '<div class="chain-empty">No saved panes yet — create one below.</div>';

  const modalPromise = showModal({
    header: '<div class="modal-title">Find/Replace Chains</div>',
    body: '<div id="chainPaneList">' + rows + "</div>",
    footer:
      '<button onclick="closeModal()">Close</button>' +
      '<button onclick="closeModal({action:\'new\'})" class="modal-btn">New pane</button>'
  });

  document.querySelectorAll("#chainPaneList .chain-pane-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-edit-id]");
      closeModal(editBtn ? { action: "edit", id: editBtn.dataset.editId } : { action: "apply", id: row.dataset.noteId });
    });
  });

  const r = await modalPromise;
  if (!r) return;
  if (r.action === "new") { openChainEditor(); return; }
  if (r.action === "edit") { openChainEditor(r.id); return; }
  if (r.action === "apply") {
    const note = notes.find((n) => String(n.id) === String(r.id));
    const pane = note ? parsePane(note) : null;
    if (pane) await applyPaneToEditor(pane);
    else showNotification("Could not read that pane");
  }
}

function stepRowHtml(step, fnOptions) {
  if (step && step.kind === "fn") {
    const opts = fnOptions || getRegisteredFunctions();
    const current = opts.find((o) => o.value === step.fnName) || opts[0] || { value: "", label: "No chainable functions found" };
    return (
      '<div class="chain-step-row chain-step-row-fn">' +
        '<delluna-icon name="bolt" class="chain-step-kind-icon" title="Function step"></delluna-icon>' +
        '<div class="custom-dropdown">' +
          '<div class="custom-dropdown-trigger modal-input chain-step-fn-select" data-value="' + current.value + '" data-options=\'' + JSON.stringify(opts) + "'>" + escapeHtml(current.label) + "</div>" +
        "</div>" +
        '<button type="button" class="chain-step-remove" title="Remove step"><delluna-icon name="x"></delluna-icon></button>' +
      "</div>"
    );
  }
  const find = step ? escapeHtml(step.find || "") : "";
  const replace = step ? escapeHtml(step.replace || "") : "";
  return (
    '<div class="chain-step-row">' +
      '<input type="text" class="modal-input chain-step-find" placeholder="Text to find" value="' + find + '">' +
      '<delluna-icon name="arrow_forward" class="chain-step-arrow"></delluna-icon>' +
      '<input type="text" class="modal-input chain-step-replace" placeholder="Replace with" value="' + replace + '">' +
      '<button type="button" class="chain-step-remove" title="Remove step"><delluna-icon name="x"></delluna-icon></button>' +
    "</div>"
  );
}

function openChainEditor(existingNoteId) {
  const existingNote = existingNoteId ? notes.find((n) => String(n.id) === String(existingNoteId)) : null;
  const existingPane = existingNote ? parsePane(existingNote) : null;
  const initialSteps = existingPane && existingPane.steps.length ? existingPane.steps : [{ find: "", replace: "" }];
  const fnOptions = getRegisteredFunctions();

  const modalPromise = showModal({
    header: '<div class="modal-title">' + (existingNote ? "Edit" : "New") + " chain pane</div>",
    body:
      "<div>" +
        '<label class="modal-label">Pane name</label>' +
        '<input type="text" id="chainPaneName" class="modal-input" value="' + (existingPane ? escapeHtml(existingPane.name) : "") + '" autocomplete="off">' +
      "</div>" +
      '<div style="margin-top:10px;">' +
        '<label class="modal-label">Steps — applied in order, each one .then()s the last</label>' +
        '<div id="chainStepsList">' + initialSteps.map((s) => stepRowHtml(s, fnOptions)).join("") + "</div>" +
        '<div class="chain-add-row">' +
          '<button type="button" id="chainAddStep" class="modal-btn chain-add-btn"><delluna-icon name="plus"></delluna-icon>Find/replace step</button>' +
          '<button type="button" id="chainAddFnStep" class="modal-btn chain-add-btn"><delluna-icon name="plus"></delluna-icon>Function step</button>' +
        "</div>" +
      "</div>",
    footer:
      '<button onclick="closeModal()">Cancel</button>' +
      '<button onclick="window.chainPaneSaveSubmit()" class="modal-btn">Save pane</button>'
  });

  const stepsList = document.getElementById("chainStepsList");

  document.getElementById("chainAddStep").addEventListener("click", () => {
    stepsList.insertAdjacentHTML("beforeend", stepRowHtml({ find: "", replace: "" }));
  });
  document.getElementById("chainAddFnStep").addEventListener("click", () => {
    if (!fnOptions.length) { showNotification("No chainable functions found"); return; }
    stepsList.insertAdjacentHTML("beforeend", stepRowHtml({ kind: "fn", fnName: fnOptions[0].value }, fnOptions));
    const newTrigger = stepsList.lastElementChild.querySelector(".custom-dropdown-trigger");
    if (newTrigger) wireDropdownTrigger(newTrigger, fnOptions);
  });
  stepsList.addEventListener("click", (e) => {
    const rm = e.target.closest(".chain-step-remove");
    if (rm) rm.closest(".chain-step-row").remove();
  });

  window.chainPaneSaveSubmit = function () {
    const nameInput = document.getElementById("chainPaneName");
    const name = nameInput ? nameInput.value.trim() : "";
    if (!name) {
      if (nameInput) nameInput.style.borderColor = "#ff4444";
      showNotification("Pane needs a name");
      return;
    }
    if (paneNameTaken(name, existingNoteId)) {
      showNotification('A pane named "' + name + '" already exists');
      return;
    }
    const steps = Array.from(document.querySelectorAll("#chainStepsList .chain-step-row"))
      .map((row) => {
        if (row.classList.contains("chain-step-row-fn")) {
          const trigger = row.querySelector(".chain-step-fn-select");
          const fnName = trigger ? trigger.dataset.value : "";
          const label = trigger ? trigger.textContent.trim() : "";
          return fnName ? { kind: "fn", fnName: fnName, label: label } : null;
        }
        return { find: row.querySelector(".chain-step-find").value, replace: row.querySelector(".chain-step-replace").value };
      })
      .filter((s) => s && (s.kind === "fn" ? s.fnName : s.find));
    if (!steps.length) {
      showNotification("Add at least one step");
      return;
    }
    savePane(name, steps, existingNoteId);
    closeModal({ action: "saved" });
    showNotification('Saved "' + name + '"');
  };

  return modalPromise;
}
