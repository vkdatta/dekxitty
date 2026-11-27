// The one modal engine behind every entry in Tools. Definitions live in modals/*.js.
import { TOOL_MAP } from "./catalog.js";
import { utf8, decodeAs } from "./lib/bytes.js";
import { ENC } from "./modals/shared.js";

const MAX_FILE = 100 * 1024 * 1024;
let session = null;

const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") n.textContent = v;
    else if (k === "style") n.style.cssText = v;
    else if (k === "class") n.className = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids.filter(Boolean));
  return n;
};
const MONO = "font-family:'Source Code Pro',monospace;white-space:pre;overflow:auto;min-height:130px";

function buildField(f) {
  const id = "tool_f_" + f.key;
  if (f.type === "checkbox") {
    const box = el("input", { type: "checkbox", id });
    box.checked = !!f.default;
    return el("div", { class: "modal-element" }, box, el("label", { class: "modal-label", for: id, text: f.label }));
  }
  const wrap = el("div", {}, el("label", { class: "modal-label", text: f.label }));
  let control;
  if (f.type === "select") {
    const options = f.options, cur = options.find((o) => o.value === f.default) || options[0];
    control = el("div", { class: "custom-dropdown-trigger modal-input", id, tabindex: "0", "data-value": cur.value, "data-options": JSON.stringify(options), text: cur.label });
    control.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); control.click(); } });
    wrap.append(el("div", { class: "custom-dropdown" }, control));
    return wrap;
  }
  if (f.type === "textarea") control = el("textarea", { id, spellcheck: "false" });
  else control = el("input", { id, type: f.type, autocomplete: f.type === "password" ? "new-password" : "off", spellcheck: "false" });
  if (f.placeholder) control.placeholder = f.placeholder;
  control.value = f.default ?? "";
  wrap.append(control);
  return wrap;
}

function readValues() {
  const v = {};
  for (const [key, node] of session.controls) {
    const c = node.querySelector("#tool_f_" + key);
    v[key] = c.type === "checkbox" ? c.checked : c.classList.contains("custom-dropdown-trigger") ? c.dataset.value : c.value;
  }
  return v;
}
function refreshVisibility() {
  const v = readValues();
  for (const f of session.fields) if (f.showIf) session.controls.get(f.key).style.display = f.showIf(v) ? "" : "none";
  const src = v._source;
  if (src === undefined) return;
  session.textWrap.style.display = src === "text" ? "" : "none";
  session.fileWrap.style.display = src === "file" ? "" : "none";
  // a picked file is already bytes, so no decoding choice applies
  if (session.controls.has("_inputEnc")) session.controls.get("_inputEnc").style.display = src === "file" ? "none" : "";
}

const readFile = async (file) => {
  if (file.size > MAX_FILE) throw new Error(file.name + " is larger than 100 MB");
  return new Uint8Array(await file.arrayBuffer());
};
function context(tool, v) {
  const picked = () => {
    const list = session.fileInput ? Array.from(session.fileInput.files) : [];
    if (!list.length) throw new Error("Choose a file first");
    return list;
  };
  const source = () => {
    if (v._source === "text") return session.textInput.value;
    const full = noteTextarea.value;
    if (v._source === "selection") { session.range = session.selection; return full.slice(...session.selection); }
    return full;
  };
  const fromFile = v._source === "file" || tool.input === "file";
  const ctx = {
    fileName: "",
    data: async () => {
      if (fromFile) { const f = picked()[0]; ctx.fileName = f.name; return readFile(f); }
      const s = source();
      return decodeAs(s, tool.input === "data" ? v._inputEnc : "utf8");
    },
    text: async () => (fromFile ? new TextDecoder().decode(await ctx.data()) : source()),
    files: async () => {
      const seen = new Map();
      return Promise.all(picked().map(async (f) => {
        let name = f.name;
        const n = seen.get(name) || 0; seen.set(name, n + 1);
        if (n) name = name.replace(/(\.[^.]*)?$/, `-${n}$1`);
        return { name, data: await readFile(f) };
      }));
    },
    rawFile: async () => picked()[0]
  };
  return ctx;
}

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: name.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream" }));
  const a = el("a", { href: url, download: name.split(/[\\/]/).pop() || "download.bin" });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function tree(value, label, depth) {
  if (value === null || typeof value !== "object") return el("div", { style: "padding-left:16px;word-break:break-all", text: `${label}: ${JSON.stringify(value)}` });
  const keys = Object.keys(value);
  const box = el("details", { style: "padding-left:" + (depth ? 16 : 0) + "px" }, el("summary", { style: "cursor:pointer", text: `${label} ${Array.isArray(value) ? "[" + keys.length + "]" : "{" + keys.length + "}"}` }));
  let filled = false;
  const fill = () => {
    if (filled) return; filled = true;
    keys.slice(0, 500).forEach((k) => box.appendChild(tree(value[k], k, depth + 1)));
    if (keys.length > 500) box.appendChild(el("div", { style: "padding-left:16px", text: `… ${keys.length - 500} more` }));
  };
  box.addEventListener("toggle", () => box.open && fill());
  if (depth < 2) { fill(); box.open = true; }
  return box;
}

function setStatus(message, isError) {
  session.status.textContent = message || "";
  session.status.style.color = isError ? "#e5484d" : "";
  session.status.style.display = message ? "" : "none";
}
function clearResult() {
  session.result = null;
  session.range = null;
  session.output.value = "";
  session.output.style.display = "none";
  session.extra.replaceChildren();
}
function showResult(r) {
  session.result = r;
  if (r.text && !r.treeOnly) { session.output.value = r.text; session.output.style.display = ""; }
  if (r.svg) {
    const img = el("img", { alt: "QR code", style: "display:block;margin:0 auto;width:min(100%,280px);background:#fff;border-radius:8px", src: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(r.svg) });
    session.extra.append(img);
  }
  if (r.tree) session.extra.append(el("div", { style: "font-family:'Source Code Pro',monospace;font-size:13px;overflow:auto;max-height:50dvh" }, tree(r.tree.value, "root", 0)));
  if (r.entries) {
    for (const f of r.entries.slice(0, 500)) {
      const b = el("button", { type: "button", class: "modal-btn", style: "margin:0 6px 6px 0", text: "⤓ " + f.name });
      b.addEventListener("click", () => download(f.data, f.name));
      session.extra.append(b);
    }
    session.output.style.display = "none";
  }
  setStatus(r.note || "");
  reveal();
}
// on small screens the result lands below the fold
const reveal = () => {
  const first = [session.status, session.output, session.extra].find((n) => n.style.display !== "none" && (n !== session.extra || n.childElementCount));
  const body = first && first.closest(".modal-body");
  if (body) body.scrollTo({ top: body.scrollTop + first.getBoundingClientRect().top - body.getBoundingClientRect().top - 12, behavior: "smooth" });
};

async function run() {
  const s = session, v = readValues();
  clearResult();
  setStatus("Working…");
  const ticket = (s.ticket = (s.ticket || 0) + 1);
  try {
    await new Promise((r) => setTimeout(r, 30)); // let "Working…" paint before heavy work
    let r = await s.tool.run(context(s.tool, v), v);
    if (session !== s || s.ticket !== ticket) return;
    showResult(typeof r === "string" ? { text: r } : r);
  } catch (e) {
    if (session !== s || s.ticket !== ticket) return;
    setStatus((e && e.message) || String(e), true);
    reveal();
  }
}
async function copy() {
  const t = session.result && session.result.text;
  if (!t) return showNotification("Nothing to copy yet");
  try { await navigator.clipboard.writeText(t); showNotification("Copied"); }
  catch (e) { session.output.select(); document.execCommand("copy"); showNotification("Copied"); }
}
function save() {
  const r = session.result;
  if (!r || (!r.bytes && !r.text)) return showNotification(r && r.entries ? "Tap a file name to download it" : "Run the tool first");
  download(r.bytes || utf8(r.text), r.name || session.tool.id + ".txt");
}
const textResult = () => { const r = session.result; return r && r.text && !r.binaryOnly ? r.text : null; };
function newNote() {
  const text = textResult();
  if (text === null) return showNotification("No text result to put in a note");
  const note = { id: genNoteId(), title: session.tool.name, content: text, extension: /^\s*[\[{]/.test(text) && /json|jwt|cbor|url-parser|keys/.test(session.tool.id) ? "json" : "txt",
    folderId: typeof currentFolderId !== "undefined" && currentFolderId ? currentFolderId : null, lastEdited: new Date().toISOString(), _created: true, _dirty: true };
  notes.push(note);
  saveNotes();
  if (typeof populateNoteList === "function") populateNoteList();
  closeModal();
  showNoteApp(note.id);
}
function replace() {
  const text = textResult();
  if (text === null) return showNotification("No text result to insert");
  if (typeof currentNote === "undefined" || !currentNote || !noteTextarea) return showNotification("Open a note first");
  if (currentNote.id !== session.noteId) return showNotification("The open note changed. Run the tool again.");
  const full = noteTextarea.value;
  if (full !== session.noteText) return showNotification("The note changed since this tool opened. Reopen the tool.");
  noteTextarea.value = session.range ? full.slice(0, session.range[0]) + text + full.slice(session.range[1]) : text;
  updateNoteMetadata();
  closeModal();
  showNotification(session.range ? "Selection replaced" : "Note replaced");
}
const ACTIONS = { run, copy, save, newNote, replace };
window.dexToolAction = (name) => { if (session && ACTIONS[name]) ACTIONS[name](); };

export function openTool(id) {
  const tool = TOOL_MAP.get(id);
  if (!tool) { showNotification("Unknown tool: " + id); return; }
  const hasNote = typeof currentNote !== "undefined" && !!currentNote && !!noteTextarea;
  const noteText = hasNote ? noteTextarea.value : "";
  const selection = hasNote ? [noteTextarea.selectionStart, noteTextarea.selectionEnd] : [0, 0];
  const selected = selection[1] > selection[0];

  const body = el("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const controls = new Map(), fields = [];
  const add = (f, parent = body) => { const node = buildField(f); fields.push(f); controls.set(f.key, node); parent.append(node); return node; };
  session = { tool, controls, fields, selection, noteId: hasNote ? currentNote.id : null, noteText, result: null, range: null };

  if (tool.input === "data" || tool.input === "text") {
    const sources = [selected && { label: "Selected text", value: "selection" }, hasNote && { label: "Current note", value: "note" }, { label: "Type or paste", value: "text" }, { label: "File", value: "file" }].filter(Boolean);
    const def = selected ? "selection" : noteText ? "note" : "text";
    add({ key: "_source", label: "Input", type: "select", options: sources, default: def });
    session.textInput = el("textarea", { id: "tool_input", spellcheck: "false", style: "min-height:110px" });
    session.textWrap = el("div", {}, el("label", { class: "modal-label", text: "Input text" }), session.textInput);
    body.append(session.textWrap);
  }
  if (["data", "text", "file", "files", "image"].includes(tool.input)) {
    const attrs = { type: "file", id: "tool_file" };
    if (tool.input === "files") attrs.multiple = "";
    if (tool.input === "image") attrs.accept = "image/*";
    if (tool.accept) attrs.accept = tool.accept;
    session.fileInput = el("input", attrs);
    session.fileWrap = el("div", {}, el("label", { class: "modal-label", text: tool.input === "files" ? "Files" : tool.input === "image" ? "Image" : "File" }), session.fileInput);
    body.append(session.fileWrap);
  }
  if (tool.input === "data") add({ key: "_inputEnc", label: "Read the input as", type: "select", options: ENC, default: tool.inputEnc || "utf8" });
  tool.fields.forEach((f) => add(f));

  session.status = el("div", { class: "modal-message", role: "status", style: "display:none;white-space:pre-wrap;word-break:break-word" });
  session.output = el("textarea", { id: "tool_output", readonly: "", spellcheck: "false", style: "display:none;" + MONO, "aria-label": "Result" });
  session.extra = el("div", {});
  body.append(session.status, session.output, session.extra);

  const textual = !["zip-create", "tar-create", "zip-extract", "tar-extract", "qr-generator"].includes(tool.id);
  const btn = (action, label) => `<button type="button" onclick="dexToolAction('${action}')">${label}</button>`;
  showModal({
    title: tool.name,
    body,
    footer: [
      '<button type="button" onclick="closeModal()">Close</button>',
      textual ? btn("copy", "Copy") : "",
      btn("save", "Download"),
      textual ? btn("newNote", "New note") : "",
      textual && hasNote && (tool.input === "data" || tool.input === "text") ? btn("replace", "Replace") : "",
      btn("run", tool.action || "Run")
    ].join("")
  });
  // showModal styles the controls and binds the dropdowns; react to their changes
  body.addEventListener("change", (e) => { if (e.target.classList.contains("custom-dropdown-trigger") || e.target.type === "checkbox") refreshVisibility(); });
  body.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); run(); } });
  refreshVisibility();
}
