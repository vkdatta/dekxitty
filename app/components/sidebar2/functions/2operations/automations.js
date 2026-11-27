/**
 * Automation catalog
 * ─────────────────────────────────────────────────────────────────────────────
 * Every function tagged `isAutomatable: true` in the FunctionRegistry has an
 * entry here, keyed by the registry's `function` name.
 *
 *   params : everything the function needs to know BEFORE it runs. The workflow
 *            editor renders these as fields the moment the step is added, so a
 *            workflow never stops to ask a question while it is running.
 *   run    : (text, params) → string | { text, extension } | Promise of either.
 *            Pure with respect to the editor: it never touches the selection,
 *            the textarea or any modal. A workflow runs on the whole document.
 *
 * Field types: text | password | number | checkbox | select | url
 *   select  → options: [{label,value}] or () => [{label,value}]
 *   showIf  → (values) => boolean, to hide fields that don't apply yet
 */

import {
  toUpper, toLower, capitalizeWordsText, capitalizeSentencesText, reverseWordsText,
  reverseAllText, bulletListText, numberedListText, indentText, outdentText
} from "../1formatting/textops.js";
import { applyDesignerFont, listFontChoices } from "../1formatting/fontpicker.js";
import { cleanupText } from "./cleanup.js";
import { addTextToLines } from "./add.js";
import { replaceBetweenDelimiters } from "./pattern.js";
import { generateMD5 } from "../3code/md5.js";
import { sha256Hex } from "../3code/sha256.js";
import { cipherTransform } from "../3code/cipher.js";
import { htmlToPlainText, escapeHtmlText, unescapeHtmlText, textToHtmlTable } from "../3code/html.js";
import { optimiseCssText, minifyCssText } from "../3code/css.js";
import { minifyJsText, optimiseJsText } from "../3code/js.js";
import { fetchPageText, FETCH_APPEND_MARKER } from "../3code/fetch.js";

const LIST_FORMATS = [
  { label: "Markdown", value: "1" },
  { label: "HTML (<li> tags)", value: "2" }
];

const SEPARATORS = { comma: ",", pipe: "|", tab: "\t", space: " " };

export const AUTOMATIONS = {
  // ── Formatting › Basic ────────────────────────────────────────────────────
  handleUppercase:     { params: [], run: (t) => toUpper(t) },
  handleLowercase:     { params: [], run: (t) => toLower(t) },
  capitalizeWords:     { params: [], run: (t) => capitalizeWordsText(t) },
  capitalizeSentences: { params: [], run: (t) => capitalizeSentencesText(t) },
  reverseWords:        { params: [], run: (t) => reverseWordsText(t) },
  reverseText:         { params: [], run: (t) => reverseAllText(t) },

  // ── Formatting › Alignment / Markup ───────────────────────────────────────
  increaseIndentation: { params: [], run: (t) => indentText(t) },
  decreaseIndentation: { params: [], run: (t) => outdentText(t) },
  handleBulletList: {
    params: [{ key: "format", label: "List format", type: "select", options: LIST_FORMATS, default: "1" }],
    run: (t, p) => bulletListText(t, p.format)
  },
  handleNumberedList: {
    params: [{ key: "format", label: "List format", type: "select", options: LIST_FORMATS, default: "1" }],
    run: (t, p) => numberedListText(t, p.format)
  },

  // ── Formatting › Designer Fonts ───────────────────────────────────────────
  openFontPickerModal: {
    params: [
      { key: "textFont", label: "Text font", type: "select", options: () => [{ label: "None", value: "" }, ...listFontChoices()], default: "" },
      { key: "numFont", label: "Numeral font", type: "select", options: () => [{ label: "None", value: "" }, ...listFontChoices()], default: "" }
    ],
    validate: (p) => (!p.textFont && !p.numFont ? "Pick at least one designer font" : null),
    run: (t, p) => applyDesignerFont(t, p.textFont || null, p.numFont || null)
  },

  // ── Operations ────────────────────────────────────────────────────────────
  handleCleanupText: {
    params: [
      {
        key: "cleanupStyle", label: "Cleanup style", type: "select", required: true, default: "",
        options: [
          { label: "Select cleanup style", value: "" },
          { label: "Remove Linebreaks", value: "remove_linebreaks" },
          { label: "Remove Parabreaks", value: "remove_parabreaks" },
          { label: "Remove Both Line & Para Breaks", value: "remove_both" },
          { label: "Whitespace Cleanup", value: "whitespace_cleanup" },
          { label: "Trim Columns", value: "trim_columns" },
          { label: "Tidy Lines", value: "tidy_lines" }
        ]
      },
      { key: "trimNumber", label: "Number of columns", type: "number", default: 1, min: 1, showIf: (v) => v.cleanupStyle === "trim_columns" },
      {
        key: "trimSide", label: "Trim side", type: "select", default: "left", showIf: (v) => v.cleanupStyle === "trim_columns",
        options: [{ label: "Left", value: "left" }, { label: "Right", value: "right" }]
      }
    ],
    run: (t, p) => cleanupText(t, p)
  },
  handlePattern: {
    params: [
      { key: "startDelim", label: "Start delimiter", type: "text", required: true, default: "" },
      { key: "endDelim", label: "End delimiter", type: "text", required: true, default: "" },
      { key: "includeDelims", label: "Include delimiters in replacement", type: "checkbox", default: false },
      { key: "replaceText", label: "Replacement text", type: "text", default: "", allowEmpty: true },
      {
        key: "mode", label: "Which instances to replace?", type: "select", default: "all",
        options: [{ label: "All", value: "all" }, { label: "Single", value: "single" }, { label: "Range", value: "range" }]
      },
      { key: "singleInstance", label: "Instance number (1-based)", type: "number", default: 1, min: 1, showIf: (v) => v.mode === "single" },
      { key: "rangeFrom", label: "From (1-based)", type: "number", default: 1, min: 1, showIf: (v) => v.mode === "range" },
      { key: "rangeTo", label: "To (1-based)", type: "number", default: 1, min: 1, showIf: (v) => v.mode === "range" }
    ],
    run: (t, p) => {
      const out = replaceBetweenDelimiters(t, p);
      if (out.error) throw new Error(out.error);
      return out.text;
    }
  },
  handleAdd: {
    params: [
      { key: "insertText", label: "Insert text (%L = line number, %N = new line)", type: "text", required: true, default: "" },
      {
        key: "insertPosition", label: "Insert position", type: "select", default: "start",
        options: [
          { label: "Insert at start of line", value: "start" },
          { label: "Insert at end of line", value: "end" },
          { label: "Insert at specific column", value: "column" }
        ]
      },
      { key: "columnNumber", label: "Column number (1-based)", type: "number", default: 1, min: 1, showIf: (v) => v.insertPosition === "column" }
    ],
    run: (t, p) => addTextToLines(t, p)
  },

  // ── Code ──────────────────────────────────────────────────────────────────
  cipher: {
    params: [
      { key: "pw1", label: "Key I (stored inside this workflow)", type: "password", required: true, default: "" },
      { key: "pw2", label: "Key II (stored inside this workflow)", type: "password", required: true, default: "" },
      {
        key: "mode", label: "Mode", type: "select", default: "encrypt",
        options: [{ label: "Encrypt", value: "encrypt" }, { label: "Decrypt", value: "decrypt" }]
      }
    ],
    run: (t, p) => cipherTransform(t, p.pw1, p.pw2, p.mode)
  },
  MD5:                { params: [], run: (t) => generateMD5(t) },
  SHA256:             { params: [], run: (t) => sha256Hex(t) },
  handleRemoveHtml:   { params: [], run: (t) => htmlToPlainText(t) },
  handleEscapeHtml:   { params: [], run: (t) => escapeHtmlText(t) },
  handleUnescapeHtml: { params: [], run: (t) => unescapeHtmlText(t) },
  handleTextToTable: {
    params: [
      {
        key: "hasHeader", label: "Does the table have headers?", type: "select", default: "yes",
        options: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }]
      },
      {
        key: "separator", label: "Separator", type: "select", default: "comma",
        options: [
          { label: "Comma", value: "comma" }, { label: "Pipe", value: "pipe" }, { label: "Tab", value: "tab" },
          { label: "Space", value: "space" }, { label: "Other", value: "other" }
        ]
      },
      { key: "customSeparator", label: "Separator character", type: "text", maxLength: 1, default: "", showIf: (v) => v.separator === "other" }
    ],
    validate: (p) => (p.separator === "other" && (p.customSeparator || "").length !== 1 ? "Enter a single separator character" : null),
    run: (t, p) =>
      textToHtmlTable(t, {
        hasHeader: p.hasHeader === "yes",
        separator: p.separator === "other" ? p.customSeparator : SEPARATORS[p.separator]
      })
  },
  optimisecss: { params: [], run: (t) => optimiseCssText(t) },
  minifycss:   { params: [], run: (t) => minifyCssText(t) },
  optimisejs:  { params: [], run: (t) => optimiseJsText(t) },
  minifyjs:    { params: [], run: (t) => minifyJsText(t) },

  // ── Document ──────────────────────────────────────────────────────────────
  openFetchModal: {
    params: [{ key: "url", label: "URL to fetch", type: "url", required: true, default: "", placeholder: "https://example.com" }],
    // Appends the fetched page, same as the sidebar Fetch URL function.
    run: async (t, p) => {
      const html = await fetchPageText(p.url);
      return { text: (t || "") + FETCH_APPEND_MARKER + html, extension: "html" };
    }
  }
};

// ── Tools ─────────────────────────────────────────────────────────────────
// Loaded on the side so a problem there can never take the other operations down.
import("../6tools/automation.js")
  .then((m) => Object.assign(AUTOMATIONS, m.TOOL_AUTOMATIONS))
  .catch((e) => console.warn("Tools automations unavailable:", e));

function resolveOptions(field) {
  return typeof field.options === "function" ? field.options() : field.options || [];
}

export { resolveOptions };

export function defaultParams(fnId) {
  const def = AUTOMATIONS[fnId];
  const out = {};
  if (def) def.params.forEach((f) => { out[f.key] = f.default !== undefined ? f.default : ""; });
  return out;
}

// Returns an error message, or null when every required input is filled in.
export function validateParams(fnId, params) {
  const def = AUTOMATIONS[fnId];
  if (!def) return "Function is not available";
  const values = { ...defaultParams(fnId), ...(params || {}) };
  for (const f of def.params) {
    if (f.showIf && !f.showIf(values)) continue;
    const v = values[f.key];
    if (f.required && (v === "" || v === null || v === undefined)) return '"' + f.label + '" is required';
    if (f.type === "url" && v && !/^https?:\/\/\S+$/i.test(String(v).trim())) return "Enter a full URL starting with http:// or https://";
  }
  return def.validate ? def.validate(values) : null;
}
