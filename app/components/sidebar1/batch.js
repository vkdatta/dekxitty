import { listWorkflowNotes, parseWorkflow, getAutomatableFunctions, applyWorkflowToEditor, promptFunctionParams } from "../sidebar2/functions/2operations/workflow.js";

// Workflows carry all of their inputs, so a batch run never prompts per file.
// A single function chosen directly is the one exception: its inputs are asked
// once, up front, and reused for every selected file.

async function pickBatchAction() {
  const entries = listWorkflowNotes()
    .map((n) => parseWorkflow(n))
    .filter((wf) => wf && !wf.dropped.length);

  const wfRows = entries
    .map((wf) =>
      '<div class="workflow-row batch-action-row" data-kind="workflow" data-id="' + escapeHtml(wf.name) + '" data-search="' + escapeHtml(wf.name.toLowerCase()) + '">' +
        '<div class="workflow-info">' +
          '<div class="workflow-name">' + escapeHtml(wf.name) + "</div>" +
          '<div class="workflow-meta">Workflow · ' + wf.steps.length + " step" + (wf.steps.length === 1 ? "" : "s") + "</div>" +
        "</div>" +
      "</div>"
    ).join("");

  const fnRows = getAutomatableFunctions()
    .map((f) =>
      '<div class="workflow-row batch-action-row" data-kind="fn" data-id="' + f.value + '" data-search="' + escapeHtml((f.label + " " + f.path).toLowerCase()) + '">' +
        '<div class="workflow-info">' +
          '<div class="workflow-name">' + escapeHtml(f.label) + "</div>" +
          '<div class="workflow-meta">Single function</div>' +
        "</div>" +
      "</div>"
    ).join("");

  const rows = wfRows + fnRows || '<div class="workflow-empty">No workflows or automatable functions found.</div>';

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
  if (sel.kind === "workflow") return entries.find((wf) => wf.name === sel.id) || null;

  const fn = getAutomatableFunctions().find((f) => f.value === sel.id);
  if (!fn) return null;
  const params = await promptFunctionParams(fn.value);
  if (!params) return null;
  return { name: fn.label, dropped: [], steps: [{ kind: "fn", fn: fn.value, label: fn.label, params }] };
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

async function runBatch(fileIds, workflow) {
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
      await applyWorkflowToEditor(workflow, { quiet: true });
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

  const workflow = await pickBatchAction();
  if (!workflow) return;

  runBatch(fileIds, workflow);
}

window.openBatchApply = openBatchApply;
