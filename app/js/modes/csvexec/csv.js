/**
 * csvexec — CSV / TSV helpers (pure, no DOM).
 * Storage format of a .csvexec note is plain RFC-4180 CSV where a cell that
 * starts with "=" is a formula. Clipboard format (Excel / Sheets) is TSV.
 */

/** Parse delimited text into a 2-D array of strings. Handles quotes, "" escapes, CRLF. */
export function parseDelimited(text, delim) {
  const rows = [];
  let row = [], cell = "", i = 0, inQ = false;
  const n = text.length;
  if (n === 0) return [];
  while (i < n) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === "") { inQ = true; i++; continue; }
    if (ch === delim) { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += ch; i++;
  }
  // last cell / row (ignore a single trailing newline)
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** Pick comma vs tab for stored content (a plain tab-separated note still opens correctly). */
export function sniffDelimiter(text) {
  const head = text.slice(0, 4000);
  const tabs = (head.match(/\t/g) || []).length;
  const commas = (head.match(/,/g) || []).length;
  return tabs > 0 && tabs >= commas ? "\t" : ",";
}

export function parseStored(text) {
  text = String(text == null ? "" : text);
  if (!text.trim()) return [];
  return parseDelimited(text, sniffDelimiter(text));
}

/** Parse clipboard text. Excel / Google Sheets copy as TSV; a single column is just lines. */
export function parseClipboard(text) {
  text = String(text == null ? "" : text);
  if (text === "") return [];
  return parseDelimited(text, "\t");
}

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
