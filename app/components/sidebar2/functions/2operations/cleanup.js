// Pure: string in → string out. Shared by the sidebar function and workflows.
export function cleanupText(input, { cleanupStyle, trimNumber, trimSide }) {
  let text = input;
  if (cleanupStyle === "remove_linebreaks") {
    text = text.replace(/\r\n|\r|\n/g, " ");
  } else if (cleanupStyle === "remove_parabreaks") {
    text = text.replace(/\n{3,}/g, "\n\n");
  } else if (cleanupStyle === "remove_both") {
    text = text.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
  } else if (cleanupStyle === "whitespace_cleanup") {
    text = text
      .replace(/\t+/g, " ")
      .replace(/ {2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+|\n+$/g, "");
  } else if (cleanupStyle === "trim_columns") {
    const n = parseInt(trimNumber, 10) || 0;
    text = text
      .split("\n")
      .map((line) => {
        if (n < 1) return line;
        if (trimSide === "left") return line.slice(n);
        if (trimSide === "right") return line.slice(0, -n);
        return line;
      })
      .join("\n");
  } else if (cleanupStyle === "tidy_lines") {
    text = text.split("\n").map((line) => line.trim()).join("\n");
  }
  return text;
}

export const handleCleanupText = async () => {
  if (!currentNote || !noteTextarea) return;
  const r = await showModal({
    header: `<div class="modal-title">Cleanup Text</div>`,
    body: `<div style="display:flex;flex-direction:column;gap:10px;"><div><label class="modal-label">Choose Cleanup Style</label><div class="custom-dropdown"><div id="cleanupStyle" class="custom-dropdown-trigger modal-input" data-options='[{"label":"Select CleanUp Style","value":""},{"label":"Remove Linebreaks","value":"remove_linebreaks"},{"label":"Remove Parabreaks","value":"remove_parabreaks"},{"label":"Remove Both Line & Para Breaks","value":"remove_both"},{"label":"Whitespace Cleanup","value":"whitespace_cleanup"},{"label":"Trim Columns","value":"trim_columns"},{"label":"Tidy Lines","value":"tidy_lines"}]' data-value="">Select CleanUp Style</div></div></div><div id="trimContainer" style="display:none;flex-direction:column;gap:10px;"><div><label class="modal-label">Number of Columns</label><input type="number" id="trimNumber" class="modal-input" value="1" min="1"></div><div><label class="modal-label">Trim Side</label><div class="custom-dropdown"><div id="trimSide" class="custom-dropdown-trigger modal-input" data-options='[{"label":"Left","value":"left"},{"label":"Right","value":"right"}]' data-value="left">Left</div></div></div></div></div>`,
    footer: `<button onclick="closeModal()">Cancel</button><button onclick="handleCleanupSubmit()">Cleanup</button>`,
    html: true
  });
  if (!r || r.action !== "submit") return;
  const { cleanupStyle, trimNumber, trimSide } = r;
  const text = cleanupText(noteTextarea.value, { cleanupStyle, trimNumber, trimSide });
  noteTextarea.value = text;
  if (typeof updateNoteMetadata === "function") updateNoteMetadata();
  showNotification("Text cleaned successfully!");
};

export const handleCleanupSubmit = function () {
  const cleanupStyle = modalScope.cleanupStyle
    ? modalScope.cleanupStyle.dataset.value
    : "";
  const trimNumber = modalScope.trimNumber ? modalScope.trimNumber.value : "1";
  const trimSide = modalScope.trimSide
    ? modalScope.trimSide.dataset.value
    : "left";
  if (!cleanupStyle) return showNotification("Please select a cleanup style!");
  closeModal({ action: "submit", cleanupStyle, trimNumber, trimSide });
};

document.addEventListener("click", (e) => {
  if (!modalScope) return;
  const styleElem = modalScope.cleanupStyle;
  if (!styleElem) return;
  const value = styleElem.dataset.value || "";
  const trimContainer = modalScope.trimContainer;
  if (trimContainer) {
    trimContainer.style.display = value === "trim_columns" ? "flex" : "none";
  }
});
