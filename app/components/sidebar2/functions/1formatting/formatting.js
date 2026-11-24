import { toUpper, toLower, capitalizeWordsText, capitalizeSentencesText, reverseWordsText, reverseAllText, bulletListText, numberedListText, indentText, outdentText } from "./textops.js";

export const handleFormat = function (t) {
  return preserveSelection(async function () {
    if (!currentNote || !noteTextarea) return;
    const s = noteTextarea.selectionStart,
      e = noteTextarea.selectionEnd,
      v = noteTextarea.value;
    if (s === e) {
      showNotification(`Please select text to ${t}!`);
      return;
    }
    const formatOptions =
      t === "italic"
        ? "MarkDown (*text*),MarkUp (<i>text</i>)"
        : t === "underline"
        ? "MarkDown (__text__),MarkUp (<u>text</u>)"
        : t === "bold"
        ? "MarkDown (**text**),MarkUp (<b>text</b>)"
        : "MarkDown (```),MarkUp (<code>)";
    const optionsArray = [
      { label: "Select option", value: "" },
      { label: formatOptions.split(",")[0], value: "1" },
      { label: formatOptions.split(",")[1], value: "2" }
    ];
    const result = await showModal({
      header: `<div class="modal-title">${
        t[0].toUpperCase() + t.slice(1)
      } Text</div>`,
      body: `<div style="display:flex;flex-direction:column;gap:10px;"><div><label class="modal-label">Choose Format</label><div class="custom-dropdown"><div id="formatType" class="custom-dropdown-trigger modal-input" data-options='${JSON.stringify(
        optionsArray
      )}'>Select option</div></div></div></div>`,
      footer: ` <button onclick="closeModal()">Cancel</button> <button onclick="handleFormatSubmit('${t}')" class="modal-btn">OK</button> `
    });
    if (!result || result.action !== "OK") return;
    const formatValue = result.format;
    if (!formatValue) return;
    const sel = v.slice(s, e);
    let formatted = "";
    if (t === "italic")
      formatted = formatValue === "2" ? `<i>${sel}</i>` : `*${sel}*`;
    else if (t === "underline")
      formatted = formatValue === "2" ? `<u>${sel}</u>` : `__${sel}__`;
    else if (t === "bold")
      formatted = formatValue === "2" ? `<b>${sel}</b>` : `**${sel}**`;
    else if (t === "code")
      formatted =
        formatValue === "2" ? `<code>${sel}</code>` : `\`\`\`\n${sel}\n\`\`\``;
    noteTextarea.value = v.slice(0, s) + formatted + v.slice(e);
    updateNoteMetadata();
    showNotification(`Text ${t} applied!`);
  })();
};

export const handleFormatSubmit = function (type) {
  const formatValue = modalScope.formatType
    ? modalScope.formatType.dataset.value
    : null;
  if (!formatValue) {
    showNotification("Please select a format!");
    return;
  }
  closeModal({ action: "OK", format: formatValue, type: type });
};

export const handleBulletList = function () {
  return preserveSelection(async function () {
    if (!currentNote || !noteTextarea) return;
    const s = noteTextarea.selectionStart,
      e = noteTextarea.selectionEnd,
      v = noteTextarea.value;
    if (s === e) {
      showNotification("Please select text for bullet list!");
      return;
    }
    const optionsArray = [
      { label: "Select option", value: "" },
      { label: "MarkDown (- item)", value: "1" },
      { label: "MarkUp (&lt;ul&gt;&lt;li&gt;)", value: "2" }
    ];
    const result = await showModal({
      header: `<div class="modal-title">Bullet List</div>`,
      body: `<div style="display:flex;flex-direction:column;gap:10px;"><div><label class="modal-label">Choose Format</label><div class="custom-dropdown"><div id="listFormat" class="custom-dropdown-trigger modal-input" data-options='${JSON.stringify(
        optionsArray
      )}'>Select option</div></div></div></div>`,
      footer: ` <button onclick="closeModal()">Cancel</button> <button onclick="handleListSubmit('bullet')" class="modal-btn">OK</button> `
    });
    if (!result || result.action !== "OK") return;
    const formatValue = result.format;
    if (!formatValue) return;
    const formatted = bulletListText(v.slice(s, e), formatValue);
    noteTextarea.value = v.slice(0, s) + formatted + v.slice(e);
    updateNoteMetadata();
    showNotification("Bullet list applied!");
  })();
};

export const handleNumberedList = function () {
  return preserveSelection(async function () {
    if (!currentNote || !noteTextarea) return;
    const s = noteTextarea.selectionStart,
      e = noteTextarea.selectionEnd,
      v = noteTextarea.value;
    if (s === e) {
      showNotification("Please select text for numbered list!");
      return;
    }
    const optionsArray = [
      { label: "Select option", value: "" },
      { label: "MarkDown (1. item)", value: "1" },
      { label: "MarkUp (&lt;ol&gt;&lt;li&gt;)", value: "2" }
    ];
    const result = await showModal({
      header: `<div class="modal-title">Numbered List</div>`,
      body: `<div style="display:flex;flex-direction:column;gap:10px;"><div><label class="modal-label">Choose Format</label><div class="custom-dropdown"><div id="listFormat" class="custom-dropdown-trigger modal-input" data-options='${JSON.stringify(
        optionsArray
      )}'>Select option</div></div></div></div>`,
      footer: ` <button onclick="closeModal()">Cancel</button> <button onclick="handleListSubmit('numbered')" class="modal-btn">OK</button> `
    });
    if (!result || result.action !== "OK") return;
    const formatValue = result.format;
    if (!formatValue) return;
    const formatted = numberedListText(v.slice(s, e), formatValue);
    noteTextarea.value = v.slice(0, s) + formatted + v.slice(e);
    updateNoteMetadata();
    showNotification("Numbered list applied!");
  })();
};

export const handleListSubmit = function (type) {
  const formatValue = modalScope.listFormat
    ? modalScope.listFormat.dataset.value
    : null;
  if (!formatValue) {
    showNotification("Please select a format!");
    return;
  }
  closeModal({ action: "OK", format: formatValue, listType: type });
};

export const handleInsertLink = function () {
  return preserveSelection(async function () {
    if (!currentNote || !noteTextarea) return;
    const s = noteTextarea.selectionStart,
      e = noteTextarea.selectionEnd,
      v = noteTextarea.value;
    const formatOptionsArray = [
      { label: "Select option", value: "" },
      { label: "Markdown", value: "markdown" },
      { label: "MarkUp", value: "markup" }
    ];
    const result = await showModal({
      header: `<div class="modal-title">Insert Link</div>`,
      body: ` <div style="display: flex; gap: 10px; align-items: center;"> <div style="flex: 1;"> <label class="modal-label">URL</label> <input type="url" id="linkUrl" placeholder="Enter URL"> </div> </div> <div style="display: flex; gap: 10px; align-items: center;"> <div style="flex: 1;"> <label class="modal-label">Link Text</label> <input type="text" id="linkText" placeholder="Enter link text"> </div> </div> <div style="display: flex; gap: 10px; align-items: center;"> <div style="flex: 1;"> <label class="modal-label">Format</label> <div class="custom-dropdown"> <div id="linkFormat" class="custom-dropdown-trigger modal-input" data-options='${JSON.stringify(
        formatOptionsArray
      )}'>Select option</div> </div> </div> </div> `,
      footer: ` <button onclick="closeModal()">Cancel</button> <button onclick="handleLinkSubmit()" class="modal-btn">Submit</button> `
    });
    if (!result || result.action !== "submit") return;
    const url = result.url;
    const text = result.text;
    const format = result.format;
    if (!url || !text || !format) return;
    const link =
      format === "markup"
        ? `<a href="${url}">${text}</a>`
        : `[${text}](${url})`;
    noteTextarea.value = v.slice(0, s) + link + v.slice(e);
    updateNoteMetadata();
    showNotification("Link inserted!");
  })();
};

export const handleLinkSubmit = function () {
  const url = modalScope.linkUrl ? modalScope.linkUrl.value.trim() : "";
  const text = modalScope.linkText ? modalScope.linkText.value.trim() : "";
  const format = modalScope.linkFormat
    ? modalScope.linkFormat.dataset.value
    : "";
  if (!url || !text || !format) {
    showNotification("Please fill in all fields!");
    return;
  }
  closeModal({ action: "submit", url: url, text: text, format: format });
};

export const handleInsertImage = function () {
  return preserveSelection(async function () {
    if (!currentNote || !noteTextarea) return;
    const s = noteTextarea.selectionStart,
      e = noteTextarea.selectionEnd,
      v = noteTextarea.value;
    const formatOptionsArray = [
      { label: "Select option", value: "" },
      { label: "Markdown", value: "markdown" },
      { label: "MarkUp", value: "markup" }
    ];
    const result = await showModal({
      header: `<div class="modal-title">Insert Image</div>`,
      body: ` <div style="display: flex; gap: 10px; align-items: center;"> <div style="flex: 1;"> <label class="modal-label">Image URL</label> <input type="url" id="imageUrl" placeholder="Enter image URL"> </div> </div> <div style="display: flex; gap: 10px; align-items: center;"> <div style="flex: 1;"> <label class="modal-label">Format</label> <div class="custom-dropdown"> <div id="imageFormat" class="custom-dropdown-trigger modal-input" data-options='${JSON.stringify(
        formatOptionsArray
      )}'>Select option</div> </div> </div> </div> `,
      footer: ` <button onclick="closeModal()">Cancel</button> <button onclick="handleImageSubmit()" class="modal-btn">Insert</button> `
    });
    if (!result || result.action !== "submit") return;
    const url = result.url;
    const format = result.format;
    if (!url || !format) return;
    const image =
      format === "markup"
        ? `<img src="${url}" alt="Image" />`
        : `![Image](${url})`;
    noteTextarea.value =
      s === e ? v + image : v.slice(0, s) + image + v.slice(e);
    updateNoteMetadata();
    showNotification("Image inserted!");
  })();
};

export const handleImageSubmit = function () {
  const url = modalScope.imageUrl ? modalScope.imageUrl.value.trim() : "";
  const format = modalScope.imageFormat
    ? modalScope.imageFormat.dataset.value
    : "";
  if (!url || !format) {
    showNotification("Please fill in all fields!");
    return;
  }
  closeModal({ action: "submit", url: url, format: format });
};

export const handleUppercase = function () {
  const r = preserveSelection(function () {
    if (!currentNote || !noteTextarea) return;
    const s = noteTextarea.selectionStart,
      e = noteTextarea.selectionEnd,
      v = noteTextarea.value;
    if (!v) return;
    const f =
      s === e
        ? toUpper(v)
        : v.slice(0, s) + toUpper(v.slice(s, e)) + v.slice(e);
    noteTextarea.value = f;
    updateNoteMetadata();
    showNotification("Converted to uppercase!");
  });
  return typeof r === "function" ? r() : r;
};

export const handleLowercase = function () {
  const r = preserveSelection(function () {
    if (!currentNote || !noteTextarea) return;
    const s = noteTextarea.selectionStart,
      e = noteTextarea.selectionEnd,
      v = noteTextarea.value;
    if (!v) return;
    const f =
      s === e
        ? toLower(v)
        : v.slice(0, s) + toLower(v.slice(s, e)) + v.slice(e);
    noteTextarea.value = f;
    updateNoteMetadata();
    showNotification("Converted to lowercase!");
  });
  return typeof r === "function" ? r() : r;
};

export const handleAlignLeft = function () {
  if (!noteTextarea) return;
  noteTextarea.style.textAlign = "left";
  showNotification("Text aligned left!");
};

export const handleAlignCenter = function () {
  if (!noteTextarea) return;
  noteTextarea.style.textAlign = "center";
  showNotification("Text aligned center!");
};

export const handleAlignRight = function () {
  if (!noteTextarea) return;
  noteTextarea.style.textAlign = "right";
  showNotification("Text aligned right!");
};

export const increaseIndentation = function () {
  const r = preserveSelection(async function () {
    if (!currentNote || !noteTextarea) return;
    const s = noteTextarea.selectionStart,
      e = noteTextarea.selectionEnd;
    if (s === e) {
      showNotification("Please select text to indent!");
      return;
    }
    const i = indentText(noteTextarea.value.slice(s, e));
    noteTextarea.value =
      noteTextarea.value.slice(0, s) + i + noteTextarea.value.slice(e);
    updateNoteMetadata();
    showNotification("Text indented!");
  });
  return "function" == typeof r ? r() : r;
};

export const decreaseIndentation = function () {
  const r = preserveSelection(async function () {
    if (!currentNote || !noteTextarea) return;
    const s = noteTextarea.selectionStart,
      e = noteTextarea.selectionEnd;
    if (s === e) {
      showNotification("Please select text to un-indent!");
      return;
    }
    const i = outdentText(noteTextarea.value.slice(s, e));
    noteTextarea.value =
      noteTextarea.value.slice(0, s) + i + noteTextarea.value.slice(e);
    updateNoteMetadata();
    showNotification("Indentation removed!");
  });
  return "function" == typeof r ? r() : r;
};

export const handleSelectAll = function () {
  if (!currentNote || !noteTextarea) return;
  noteTextarea.setSelectionRange(0, noteTextarea.value.length);
  noteTextarea.blur();
  showNotification("All text selected!");
};

export const handleCopyNote = function () {
  if (!currentNote || !noteTextarea) return;
  const s = noteTextarea.selectionStart,
    e = noteTextarea.selectionEnd,
    t = s === e ? noteTextarea.value : noteTextarea.value.slice(s, e);
  navigator.clipboard
    .writeText(t)
    .then(() => showNotification("Copied to clipboard!"))
    .catch(() => showNotification("Copy failed (clipboard not available)."));
};

export const handleCutNote = function () {
  if (!currentNote || !noteTextarea) return;
  const s = noteTextarea.selectionStart,
    e = noteTextarea.selectionEnd,
    t = s === e ? noteTextarea.value : noteTextarea.value.slice(s, e);
  navigator.clipboard
    .writeText(t)
    .then(() => {
      noteTextarea.value =
        s === e
          ? ""
          : noteTextarea.value.slice(0, s) + noteTextarea.value.slice(e);
      noteTextarea.selectionStart = noteTextarea.selectionEnd = s;
      updateNoteMetadata();
      showNotification("Cut to clipboard!");
    })
    .catch(() => showNotification("Cut failed (clipboard not available)."));
};

export const handleClearNote = function () {
  const r = preserveSelection(async function () {
    if (!currentNote || !noteTextarea) return;
    const s = noteTextarea.selectionStart,
      e = noteTextarea.selectionEnd,
      v = noteTextarea.value;
    if (s === e) {
      noteTextarea.value = "";
    } else {
      noteTextarea.value = v.slice(0, s) + v.slice(e);
    }
    updateNoteMetadata();
    showNotification("Note cleared!");
  });
  return "function" == typeof r ? r() : r;
};

export const handlePasteNote = function () {
  const r = async function () {
    if (!currentNote || !noteTextarea) return;
    if (!navigator.clipboard || !navigator.permissions) {
      showNotification("Paste not supported in this browser.");
      return;
    }
    try {
      const perm = await navigator.permissions.query({
        name: "clipboard-read"
      });
      if (perm.state === "denied") {
        showNotification(
          "Clipboard access denied. Please allow it in your browser settings."
        );
        return;
      }
      const clip = await navigator.clipboard.readText();
      const s = noteTextarea.selectionStart,
        e = noteTextarea.selectionEnd;
      noteTextarea.value =
        noteTextarea.value.slice(0, s) + clip + noteTextarea.value.slice(e);
      const n = s + clip.length;
      noteTextarea.selectionStart = noteTextarea.selectionEnd = n;
      updateNoteMetadata();
      showNotification("Pasted from clipboard!");
    } catch {
      showNotification("Paste failed (permission denied or empty clipboard).");
    }
  };
  r();
};


export const reverseText = (...a) => preserveSelection(async () => {
  if (!currentNote || !noteTextarea) return;
  let s = noteTextarea.selectionStart,
    e = noteTextarea.selectionEnd;
  if (s === e)
    noteTextarea.value = reverseAllText(noteTextarea.value);
  else {
    let t = noteTextarea.value,
      n = t.substring(s, e),
      r = reverseAllText(n);
    noteTextarea.value = t.substring(0, s) + r + t.substring(e);
  }
  try {
    updateNoteMetadata();
    showNotification("Text reversed!");
  } catch (err) {
    console.error("Error updating note metadata:", err);
    showNotification("Failed to update note metadata");
  }
})(...a);

export const reverseWords = (...a) => preserveSelection(async () => {
  if (!currentNote || !noteTextarea) return;
  const s = noteTextarea.selectionStart;
  const e = noteTextarea.selectionEnd;
  if (s === e) {
    noteTextarea.value = reverseWordsText(noteTextarea.value);
  } else {
    const t = noteTextarea.value;
    const n = t.substring(s, e);
    const r = reverseWordsText(n);
    noteTextarea.value = t.substring(0, s) + r + t.substring(e);
  }
  updateNoteMetadata();
  showNotification("Words reversed!");
})(...a);

export const capitalizeWords = (...a) => preserveSelection(async () => {
  if (!currentNote || !noteTextarea) return;
  const s = noteTextarea.selectionStart;
  const e = noteTextarea.selectionEnd;
  if (s === e) {
    noteTextarea.value = capitalizeWordsText(noteTextarea.value);
  } else {
    const t = noteTextarea.value;
    const n = t.substring(s, e);
    const r = capitalizeWordsText(n);
    noteTextarea.value = t.substring(0, s) + r + t.substring(e);
  }
  updateNoteMetadata();
  showNotification("Words capitalized!");
})(...a);

export const capitalizeSentences = (...a) => preserveSelection(async () => {
  if (!currentNote || !noteTextarea) return;
  const s = noteTextarea.selectionStart;
  const e = noteTextarea.selectionEnd;
  if (s === e) {
    noteTextarea.value = capitalizeSentencesText(noteTextarea.value);
  } else {
    const t = noteTextarea.value;
    const n = t.substring(s, e);
    const r = capitalizeSentencesText(n);
    noteTextarea.value = t.substring(0, s) + r + t.substring(e);
  }
  updateNoteMetadata();
  showNotification("Sentences capitalized!");
})(...a);
