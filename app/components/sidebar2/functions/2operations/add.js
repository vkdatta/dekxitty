// Pure: string in → string out. Shared by the sidebar function and workflows.
export function addTextToLines(text, { insertText, insertPosition, columnNumber }) {
  const col = parseInt(columnNumber, 10) || 1;
  const lines = text.split("\n");
  let result = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const replacement = (insertText || "").replace(/%L/g, String(i + 1)).replace(/%N/g, "\n");
    if (insertPosition === "start") {
      line = replacement + line;
    } else if (insertPosition === "end") {
      line = line + replacement;
    } else if (insertPosition === "column") {
      const idx = Math.max(0, col - 1);
      if (line.length < idx) line = line.padEnd(idx, " ");
      line = line.slice(0, idx) + replacement + line.slice(idx);
    }
    result += line + (i < lines.length - 1 ? "\n" : "");
  }
  return result;
}

export const handleAdd = async () => {
  if (!currentNote || !noteTextarea) return;
  const r = await showModal({
    header: `<div class="modal-title">Add Text to Lines</div>`,
    body: `<div style="display:flex;flex-direction:column;gap:10px;"><div><label class="modal-label">Insert text</label><input type="text" id="insertText" class="modal-input" placeholder="Text to insert (use %L for line number, %N for new line)" data-skip-validation></div><div><label class="modal-label">Insert position</label><div class="custom-dropdown"><div id="insertPosition" class="custom-dropdown-trigger modal-input" data-options='[{"label":"Insert at start of line","value":"start"},{"label":"Insert at end of line","value":"end"},{"label":"Insert at specific column","value":"column"}]' data-value="start">Insert at start of line</div></div></div><div id="colContainer" style="display:none"><label class="modal-label">Column number</label><input type="number" id="columnNumber" class="modal-input" placeholder="Column number (1-based)" min="1"></div></div>`,
    footer: `<button onclick="closeModal()">Cancel</button><button onclick="handleAddSubmit()">Add</button>`,
    html: true
  });
  if (!r || r.action !== "submit") return;
  const { insertText, insertPosition, columnNumber } = r;
  const result = addTextToLines(noteTextarea.value, { insertText, insertPosition, columnNumber });
  noteTextarea.value = result;
  if (typeof updateNoteMetadata === "function") updateNoteMetadata();
  if (typeof updatecounts === "function") updatecounts();
  showNotification("Text added successfully!");
};

export const handleAddSubmit = function () {
  const insertText = modalScope.insertText ? modalScope.insertText.value : "";
  const insertPosition = modalScope.insertPosition
    ? modalScope.insertPosition.dataset.value
    : "start";
  const columnNumber = modalScope.columnNumber
    ? modalScope.columnNumber.value
    : "";
  closeModal({ action: "submit", insertText, insertPosition, columnNumber });
};

document.addEventListener("click", (e) => {
  if (!modalScope) return;
  const positionElem = modalScope.insertPosition;
  if (!positionElem) return;
  const value = positionElem.dataset.value || "start";
  const colContainer = modalScope.colContainer;
  if (colContainer) {
    colContainer.style.display = value === "column" ? "block" : "none";
  }
});
