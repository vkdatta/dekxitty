/**
 * csvexec — CSV / TSV helpers (pure, no DOM).
 * Storage format of a .csv note is plain RFC-4180 CSV where a cell that
 * starts with "=" is a formula. Clipboard format (Excel / Sheets) is TSV.
 */

import { parseDelimited, sniffDelimiter, recognise } from "./recogniser.js";
export { parseDelimited, sniffDelimiter, recognise };

/**
 * Stored note text → rows. `cfg` is the note's recogniser settings ({ pattern, delimiter });
 * plain CSV / TSV opens exactly as before, bare-text tables are laid out semantically.
 * recogniseStored returns the full result ({ rows, pattern, label, … }).
 */
export function recogniseStored(text, cfg) {
  return recognise(String(text == null ? "" : text), cfg);
}
export function parseStored(text, cfg) {
  text = String(text == null ? "" : text);
  if (!text.trim()) return [];
  return recogniseStored(text, cfg).rows;
}

/** Clipboard text → full recogniser result. Excel / Google Sheets copy as TSV (the plain fallback); a single line stays one cell. */
export function recogniseClipboard(text, cfg) {
  text = String(text == null ? "" : text);
  if (text === "") return { rows: [], pattern: "plain", label: "Plain", delimiter: "\t", confidence: 1, forced: false };
  return recognise(text, Object.assign({}, cfg, { plainDelimiter: "\t" }));
}
export function parseClipboard(text, cfg) { return recogniseClipboard(text, cfg).rows; }

function esc(v, delim) {
  if (v === "" || v == null) return "";
  const s = String(v);
  if (s.indexOf('"') !== -1 || s.indexOf(delim) !== -1 || s.indexOf("\n") !== -1 || s.indexOf("\r") !== -1 || /^\s|\s$/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function serialize(rows, delim) {
  delim = delim || ",";
  return rows.map((r) => r.map((v) => esc(v, delim)).join(delim)).join("\n");
}

/**
 * Serialise the used range of a grid (array of row arrays) trimming
 * trailing empty rows / columns. Returns "" for an empty sheet.
 */
export function serializeGrid(grid, delim) {
  let maxR = -1, maxC = -1;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== "" && row[c] != null) { if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
    }
  }
  if (maxR < 0) return "";
  const out = [];
  for (let r = 0; r <= maxR; r++) out.push(grid[r].slice(0, maxC + 1));
  return serialize(out, delim);
}

/** Text for the system clipboard: TSV, quoting cells that contain tab/newline/quote (Excel-compatible). */
export function toClipboardText(rows) {
  return rows.map((r) => r.map((v) => {
    const s = v == null ? "" : String(v);
    return /[\t\n\r"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join("\t")).join("\n");
}

/** Total width (px) a copied table gets in Docs / Word; columns share it equally (2 cols → 225px, 3 → 150px). */
export const CLIPBOARD_TABLE_WIDTH = 450;

const escHtml = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * HTML for the system clipboard (text/html). Inline styles only — Google Docs and Word ignore stylesheets.
 *  - every cell has a solid 1px border, so the table is bordered natively once pasted
 *  - fixed layout, 450px total split equally between the copied columns
 *  - no row height set + wrapping enabled, so rows auto-size to wrapped text
 * `fmts` (optional, same shape as rows) carries bold / italic / align / colour / background.
 */
export function toClipboardHtml(rows, fmts) {
  const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (!rows.length || !nCols) return "";
  const colW = Math.floor(CLIPBOARD_TABLE_WIDTH / nCols);
  const tblW = colW * nCols;
  const border = "border:1px solid #000000;";
  const cols = Array.from({ length: nCols }, () => `<col width="${colW}" style="width:${colW}px">`).join("");
  const body = rows.map((r, i) => {
    let tds = "";
    for (let j = 0; j < nCols; j++) {
      const f = (fmts && fmts[i] && fmts[i][j]) || {};
      let st = `${border}width:${colW}px;padding:4px 6px;vertical-align:top;white-space:normal;word-wrap:break-word;overflow-wrap:break-word;word-break:break-word;`;
      const al = { l: "left", c: "center", r: "right" }[f.al];
      if (al) st += `text-align:${al};`;
      if (f.tc) st += `color:${f.tc};`;
      if (f.bg) st += `background-color:${f.bg};`;
      if (f.b) st += "font-weight:bold;";
      if (f.i) st += "font-style:italic;";
      const txt = escHtml(j < r.length ? r[j] : "").replace(/\r\n|\r|\n/g, "<br>");
      tds += `<td width="${colW}" style="${st}">${txt}</td>`;
    }
    return `<tr>${tds}</tr>`;
  }).join("");
  return `<table border="1" cellspacing="0" cellpadding="4" width="${tblW}" style="border-collapse:collapse;border:1px solid #000000;table-layout:fixed;width:${tblW}px;">`
    + `<colgroup>${cols}</colgroup><tbody>${body}</tbody></table>`;
}
