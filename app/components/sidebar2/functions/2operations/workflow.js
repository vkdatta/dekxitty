/**
 * Automated Workflows
 * ─────────────────────────────────────────────────────────────────────────────
 * A workflow performs its steps sequentially on the whole document.
 *   • Find & replace step : { kind: "replace", find, replace }
 *   • Function step       : { kind: "fn", fn, label, params }
 * Every function step stores ALL of its inputs (the URL to fetch, the designer
 * font, the cipher keys …) at the moment the step is added, so running a
 * workflow never opens a prompt. Only functions tagged `isAutomatable` in the
 * FunctionRegistry (and present in automations.js) can be added.
 *
 * Steps run in memory and the document is written once at the end, so a failing
 * step leaves the note untouched and the whole run is one undo.
 */
import { AUTOMATIONS, defaultParams, validateParams, resolveOptions } from "./automations.js";

const ASSETS_FOLDER_NAME = "dexlabs assets";
const WORKFLOW_EXTENSION = "workflow";
const LEGACY_EXTENSION = "pane";              // notes saved before the rename
const WORKFLOW_TYPE = "dexlabs-workflow";
const LEGACY_TYPE = "dexlabs-chain-pane";

// ── storage ─────────────────────────────────────────────────────────────────

function ensureAssetsFolder() {
  let f = folders.find((x) => !x.parentId && x.name === ASSETS_FOLDER_NAME);
  if (f) return f.id;
  const id = genFolderId();
  folders.push({ id, name: ASSETS_FOLDER_NAME, parentId: null });
  saveFolders();
  return id;
}

export function listWorkflowNotes() {
  const folderId = ensureAssetsFolder();
  return notes.filter(
    (n) => n.folderId === folderId && (n.extension === WORKFLOW_EXTENSION || n.extension === LEGACY_EXTENSION)
  );
}

// ── automatable function catalogue (registry-driven) ────────────────────────

export function getAutomatableFunctions() {
  const reg = window.FunctionRegistry;
  if (!reg) return [];
  return reg.getAutomatableFunctions()
    .filter((f) => {
      if (AUTOMATIONS[f.fn]) return true;
      console.warn('Workflow: "' + f.fn + '" is tagged isAutomatable but has no entry in automations.js');
      return false;
    })
    .map((f) => ({ value: f.fn, label: f.name, path: f.under.join(" › ") }));
}

function fnLabel(fnId) {
  const f = getAutomatableFunctions().find((x) => x.value === fnId);
  return f ? f.label : fnId;
}

// ── parsing (with migration of pre-rename "chain pane" notes) ───────────────

export function parseWorkflow(note) {
  try {
    const data = JSON.parse(note.content || "{}");
    if (!Array.isArray(data.steps)) return null;
    const automatable = new Set(getAutomatableFunctions().map((f) => f.value));
    const steps = [];
    const dropped = [];
    data.steps.forEach((s) => {
      if (s && s.kind === "fn") {
        const fn = s.fn || s.fnName;            // legacy steps used fnName
        if (!automatable.has(fn)) { dropped.push(s.label || fn); return; }
        steps.push({ kind: "fn", fn, label: fnLabel(fn), params: { ...defaultParams(fn), ...(s.params || {}) } });
      } else if (s && s.find) {
        steps.push({ kind: "replace", find: s.find, replace: s.replace || "" });
      }
    });
    return { name: data.name || note.title, steps, dropped, legacy: data.type === LEGACY_TYPE };
  } catch (e) {
    return null;
  }
}

function workflowNameTaken(name, excludeNoteId) {
  return listWorkflowNotes().some((n) => n.title === name && String(n.id) !== String(excludeNoteId));
}

function saveWorkflow(name, steps, existingNoteId) {
  const payload = JSON.stringify({ type: WORKFLOW_TYPE, name, steps }, null, 2);
  if (existingNoteId) {
    const n = notes.find((x) => String(x.id) === String(existingNoteId));
    if (n) {
      n.title = name;
      n.content = payload;
      n.extension = WORKFLOW_EXTENSION;
      n._dirty = true;
      n.lastEdited = new Date().toISOString();
    }
  } else {
    notes.push({
      id: genNoteId(),
      title: name,
      content: payload,
      extension: WORKFLOW_EXTENSION,
      folderId: ensureAssetsFolder(),
      lastEdited: new Date().toISOString(),
      _created: true,
      _dirty: true
    });
  }
  saveNotes();
  if (typeof isSignedIn === "function" && isSignedIn()) syncWithDrive(false);
}

// ── running ─────────────────────────────────────────────────────────────────

function replaceWholeDoc(cm, text) {
  const lastLine = cm.lineCount() - 1;
  cm.operation(() => {
    cm.replaceRange(text, { line: 0, ch: 0 }, { line: lastLine, ch: cm.getLine(lastLine).length });
  });
}

function readDoc(cm) {
  if (cm) return cm.getValue();
  return typeof noteTextarea !== "undefined" && noteTextarea ? noteTextarea.value : "";
}

function writeDoc(cm, text) {
  if (cm) replaceWholeDoc(cm, text);
  else if (typeof noteTextarea !== "undefined" && noteTextarea) noteTextarea.value = text;
  if (typeof updateNoteMetadata === "function") updateNoteMetadata();
}

function setNoteExtension(ext) {
  if (typeof currentNote === "undefined" || !currentNote) return;
  currentNote.extension = ext;
  const n = notes.find((x) => String(x.id) === String(currentNote.id));
  if (n) { n.extension = ext; n.lastEdited = new Date().toISOString(); }
  if (typeof populateNoteList === "function") populateNoteList();
  if (typeof updateDocumentInfo === "function") updateDocumentInfo();
}

// Runs every step on `text`. Returns { text, extension } or throws with the failing step named.
export async function runWorkflowOnText(workflow, text) {
  let out = text;
  let extension = null;
  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const where = "Step " + (i + 1) + (step.kind === "fn" ? " (" + step.label + ")" : " (find & replace)");
    try {
      if (step.kind === "fn") {
        const err = validateParams(step.fn, step.params);
        if (err) throw new Error(err + " — edit the workflow to set it up");
        const res = await AUTOMATIONS[step.fn].run(out, { ...defaultParams(step.fn), ...step.params });
        if (res && typeof res === "object") { out = res.text; if (res.extension) extension = res.extension; }
        else out = res;
      } else if (step.find) {
        out = out.split(step.find).join(step.replace || "");
      }
    } catch (e) {
      throw new Error(where + ": " + (e && e.message ? e.message : "failed"));
    }
  }
  return { text: out, extension };
}

export async function applyWorkflowToEditor(workflow, opts) {
  const quiet = opts && opts.quiet;
  if (workflow.dropped && workflow.dropped.length) {
    const msg = '"' + workflow.name + '" had steps that can\'t be automated (' + workflow.dropped.join(", ") + ") — edit and re-save it first";
    if (quiet) throw new Error(msg);
    showNotification(msg);
    return false;
  }
  const cm = window.dexEditor && window.dexEditor.cm;
  if (!cm && !(typeof noteTextarea !== "undefined" && noteTextarea)) {
    if (quiet) throw new Error("Editor not ready");
    showNotification("Editor not ready");
    return false;
  }
  try {
    const before = readDoc(cm);
    const { text, extension } = await runWorkflowOnText(workflow, before);
    if (text === before && !extension) {
      if (!quiet) showNotification("No changes — nothing matched");
      return true;
    }
    if (text !== before) writeDoc(cm, text);
    if (extension) setNoteExtension(extension);
    if (!quiet) showNotification('Ran "' + workflow.name + '"');
    return true;
  } catch (e) {
    if (quiet) throw e;
    showNotification(e.message);
    return false;
  }
}

// ── list modal ──────────────────────────────────────────────────────────────

function stepCountLabel(n) { return n + " step" + (n === 1 ? "" : "s"); }

export async function openWorkflowPanel() {
  const items = listWorkflowNotes().map((n) => ({ note: n, wf: parseWorkflow(n) })).filter((x) => x.wf);

  const rows = items.length
    ? items.map(({ note, wf }) =>
        '<div class="workflow-row" data-note-id="' + note.id + '">' +
          '<div class="workflow-info">' +
            '<div class="workflow-name">' + escapeHtml(wf.name) + "</div>" +
            '<div class="workflow-meta">' + stepCountLabel(wf.steps.length) + (wf.dropped.length ? " · needs review" : "") + "</div>" +
          "</div>" +
          '<button type="button" class="workflow-edit" data-edit-id="' + note.id + '" title="Edit workflow">' +
            '<delluna-icon name="edit"></delluna-icon>' +
          "</button>" +
        "</div>"
      ).join("")
    : '<div class="workflow-empty">No saved workflows yet — create one below.</div>';

  const modalPromise = showModal({
    header: '<div class="modal-title">Automated Workflows</div>',
    body: '<div id="workflowList">' + rows + "</div>",
    footer:
      '<button onclick="closeModal()">Close</button>' +
      '<button onclick="closeModal({action:\'new\'})" class="modal-btn">New workflow</button>'
  });

  document.querySelectorAll("#workflowList .workflow-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-edit-id]");
      closeModal(editBtn ? { action: "edit", id: editBtn.dataset.editId } : { action: "apply", id: row.dataset.noteId });
    });
  });

  const r = await modalPromise;
  if (!r) return;
  if (r.action === "new") { openWorkflowEditor(); return; }
  if (r.action === "edit") { openWorkflowEditor(r.id); return; }
  if (r.action === "apply") {
    const note = notes.find((n) => String(n.id) === String(r.id));
    const wf = note ? parseWorkflow(note) : null;
    if (wf) await applyWorkflowToEditor(wf);
    else showNotification("Could not read that workflow");
  }
}

// ── editor modal ────────────────────────────────────────────────────────────

function attr(v) { return escapeHtml(String(v === undefined || v === null ? "" : v)); }

function fieldHtml(field, value) {
  const label = '<label class="modal-label">' + escapeHtml(field.label) + "</label>";
  const common = ' data-param="' + field.key + '"';
  if (field.type === "select") {
    const opts = resolveOptions(field);
    const current = opts.find((o) => String(o.value) === String(value)) || opts[0] || { label: "", value: "" };
    return (
      '<div class="workflow-param" data-param-wrap="' + field.key + '">' + label +
        '<div class="custom-dropdown"><div class="custom-dropdown-trigger modal-input"' + common +
          ' data-value="' + attr(current.value) + "\" data-options='" + JSON.stringify(opts).replace(/'/g, "&#39;") + "'>" +
          escapeHtml(current.label) + "</div></div></div>"
    );
  }
  if (field.type === "checkbox") {
    return (
      '<div class="workflow-param workflow-param-check" data-param-wrap="' + field.key + '">' +
        '<input type="checkbox" class="modal-input"' + common + (value ? " checked" : "") + ">" + label + "</div>"
    );
  }
  const type = field.type === "number" ? "number" : field.type === "password" ? "password" : "text";
  return (
    '<div class="workflow-param" data-param-wrap="' + field.key + '">' + label +
      '<input type="' + type + '" class="modal-input"' + common + ' value="' + attr(value) + '"' +
      (field.placeholder ? ' placeholder="' + attr(field.placeholder) + '"' : "") +
      (field.min !== undefined ? ' min="' + field.min + '"' : "") +
      (field.maxLength ? ' maxlength="' + field.maxLength + '"' : "") +
      ' autocomplete="off" data-skip-validation></div>'
  );
}

function readParams(container, fnId) {
  const def = AUTOMATIONS[fnId];
  const out = {};
  def.params.forEach((f) => {
    const el = container.querySelector('[data-param="' + f.key + '"]');
    if (!el) { out[f.key] = f.default !== undefined ? f.default : ""; return; }
    if (f.type === "checkbox") out[f.key] = el.checked;
    else if (f.type === "select") out[f.key] = el.dataset.value || "";
    else if (f.type === "number") out[f.key] = el.value === "" ? "" : Number(el.value);
    else out[f.key] = f.type === "url" ? el.value.trim() : el.value;
  });
  return out;
}

function refreshVisibility(container, fnId) {
  const def = AUTOMATIONS[fnId];
  const values = readParams(container, fnId);
  def.params.forEach((f) => {
    const wrap = container.querySelector('[data-param-wrap="' + f.key + '"]');
    if (wrap) wrap.style.display = !f.showIf || f.showIf(values) ? "" : "none";
  });
}

function wireDropdownTrigger(trigger, opts, onChange) {
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    renderDropdownMenuPortal(trigger, opts, (selected) => {
      trigger.textContent = selected.label;
      trigger.dataset.value = selected.value;
      if (onChange) onChange(selected);
    });
  });
}

function renderParams(row, fnId, values) {
  const box = row.querySelector(".workflow-step-params");
  const def = AUTOMATIONS[fnId];
  row.dataset.fn = fnId;
  box.innerHTML = def.params.map((f) => fieldHtml(f, values[f.key])).join("");
  box.querySelectorAll(".custom-dropdown-trigger").forEach((t) => {
    wireDropdownTrigger(t, JSON.parse(t.dataset.options || "[]"), () => refreshVisibility(box, fnId));
  });
  refreshVisibility(box, fnId);
}

function replaceRowHtml(step) {
  return (
    '<div class="workflow-step-row" data-kind="replace">' +
      '<input type="text" class="modal-input workflow-step-find" placeholder="Text to find" value="' + attr(step.find) + '">' +
      '<delluna-icon name="arrow_forward" class="workflow-step-arrow"></delluna-icon>' +
      '<input type="text" class="modal-input workflow-step-replace" placeholder="Replace with" value="' + attr(step.replace) + '" data-skip-validation>' +
      '<button type="button" class="workflow-step-remove" title="Remove step"><delluna-icon name="x"></delluna-icon></button>' +
    "</div>"
  );
}

function fnRowHtml(fnOptions, fnId) {
  const current = fnOptions.find((o) => o.value === fnId) || fnOptions[0];
  return (
    '<div class="workflow-step-row workflow-step-row-fn" data-kind="fn" data-fn="' + attr(current.value) + '">' +
      '<delluna-icon name="bolt" class="workflow-step-kind-icon" title="Function step"></delluna-icon>' +
      '<div class="custom-dropdown"><div class="custom-dropdown-trigger modal-input workflow-step-fn-select" data-value="' +
        attr(current.value) + '">' + escapeHtml(current.label) + "</div></div>" +
      '<button type="button" class="workflow-step-remove" title="Remove step"><delluna-icon name="x"></delluna-icon></button>' +
      '<div class="workflow-step-params"></div>' +
    "</div>"
  );
}

function mountFnRow(list, fnOptions, step) {
  list.insertAdjacentHTML("beforeend", fnRowHtml(fnOptions, step.fn));
  const row = list.lastElementChild;
  const trigger = row.querySelector(".workflow-step-fn-select");
  const initialFn = row.dataset.fn;
  row.querySelector(".workflow-step-params").addEventListener("input", (e) => refreshVisibility(e.currentTarget, row.dataset.fn));
  renderParams(row, initialFn, { ...defaultParams(initialFn), ...(step.params || {}) });
  wireDropdownTrigger(trigger, fnOptions.map((o) => ({ label: o.label, value: o.value })), (sel) => {
    renderParams(row, sel.value, defaultParams(sel.value));   // new function → ask for its inputs right away
  });
  return row;
}

function openWorkflowEditor(existingNoteId) {
  const existingNote = existingNoteId ? notes.find((n) => String(n.id) === String(existingNoteId)) : null;
  const existing = existingNote ? parseWorkflow(existingNote) : null;
  const fnOptions = getAutomatableFunctions();
  const initialSteps = existing && existing.steps.length ? existing.steps : [{ kind: "replace", find: "", replace: "" }];

  const modalPromise = showModal({
    header: '<div class="modal-title">' + (existingNote ? "Edit" : "New") + " workflow</div>",
    body:
      "<div>" +
        '<label class="modal-label">Workflow name</label>' +
        '<input type="text" id="workflowName" class="modal-input" value="' + (existing ? attr(existing.name) : "") + '" autocomplete="off">' +
      "</div>" +
      '<div style="margin-top:10px;">' +
        '<label class="modal-label">Steps — performed in order, top to bottom, on the whole document</label>' +
        '<div id="workflowStepsList"></div>' +
        '<div class="workflow-add-row">' +
          '<button type="button" id="workflowAddReplace" class="modal-btn workflow-add-btn"><delluna-icon name="plus"></delluna-icon>Find/replace step</button>' +
          '<button type="button" id="workflowAddFn" class="modal-btn workflow-add-btn"><delluna-icon name="plus"></delluna-icon>Function step</button>' +
        "</div>" +
      "</div>",
    footer:
      '<button onclick="closeModal()">Cancel</button>' +
      '<button onclick="window.workflowSaveSubmit()" class="modal-btn">Save workflow</button>'
  });

  const list = document.getElementById("workflowStepsList");
  initialSteps.forEach((s) => {
    if (s.kind === "fn") mountFnRow(list, fnOptions, s);
    else list.insertAdjacentHTML("beforeend", replaceRowHtml(s));
  });
  if (existing && existing.dropped.length) {
    showNotification("Removed steps that can't be automated: " + existing.dropped.join(", ") + ". Save to confirm.");
  }

  document.getElementById("workflowAddReplace").addEventListener("click", () => {
    list.insertAdjacentHTML("beforeend", replaceRowHtml({ find: "", replace: "" }));
  });
  document.getElementById("workflowAddFn").addEventListener("click", () => {
    if (!fnOptions.length) { showNotification("No automatable functions found"); return; }
    mountFnRow(list, fnOptions, { fn: fnOptions[0].value });
  });
  list.addEventListener("click", (e) => {
    const rm = e.target.closest(".workflow-step-remove");
    if (rm) rm.closest(".workflow-step-row").remove();
  });

  window.workflowSaveSubmit = function () {
    const nameInput = document.getElementById("workflowName");
    const name = nameInput ? nameInput.value.trim() : "";
    if (!name) {
      if (nameInput) nameInput.style.borderColor = "#ff4444";
      showNotification("Workflow needs a name");
      return;
    }
    if (workflowNameTaken(name, existingNoteId)) {
      showNotification('A workflow named "' + name + '" already exists');
      return;
    }
    const steps = [];
    const rows = Array.from(list.querySelectorAll(".workflow-step-row"));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.dataset.kind === "fn") {
        const fnId = row.dataset.fn;
        const params = readParams(row.querySelector(".workflow-step-params"), fnId);
        const err = validateParams(fnId, params);
        if (err) { showNotification("Step " + (i + 1) + " (" + fnLabel(fnId) + "): " + err); return; }
        steps.push({ kind: "fn", fn: fnId, label: fnLabel(fnId), params });
      } else {
        const find = row.querySelector(".workflow-step-find").value;
        if (find) steps.push({ kind: "replace", find, replace: row.querySelector(".workflow-step-replace").value });
      }
    }
    if (!steps.length) { showNotification("Add at least one step"); return; }
    saveWorkflow(name, steps, existingNoteId);
    closeModal({ action: "saved" });
    showNotification('Saved "' + name + '"');
  };

  return modalPromise;
}

// Asks for a single function's inputs once (used by batch apply). Resolves to the params or null.
export async function promptFunctionParams(fnId) {
  const def = AUTOMATIONS[fnId];
  if (!def) return null;
  if (!def.params.length) return {};
  const values = defaultParams(fnId);
  const modalPromise = showModal({
    header: '<div class="modal-title">' + escapeHtml(fnLabel(fnId)) + " — applied to every selected file</div>",
    body: '<div id="workflowFnParams" class="workflow-step-params">' + def.params.map((f) => fieldHtml(f, values[f.key])).join("") + "</div>",
    footer: '<button onclick="closeModal()">Cancel</button><button onclick="window.workflowParamsSubmit()" class="modal-btn">Continue</button>'
  });
  const box = document.getElementById("workflowFnParams");
  box.querySelectorAll(".custom-dropdown-trigger").forEach((t) => {
    wireDropdownTrigger(t, JSON.parse(t.dataset.options || "[]"), () => refreshVisibility(box, fnId));
  });
  box.addEventListener("input", () => refreshVisibility(box, fnId));
  refreshVisibility(box, fnId);
  window.workflowParamsSubmit = function () {
    const params = readParams(box, fnId);
    const err = validateParams(fnId, params);
    if (err) { showNotification(err); return; }
    closeModal({ params });
  };
  const r = await modalPromise;
  return r && r.params ? r.params : null;
}
