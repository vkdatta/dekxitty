/**
 * csvexec — semantic text → table recogniser (pure, no DOM, no ML).
 *
 * "csv" here really means *intelligent semantic-based separated value*: bare text a
 * user pastes (markdown pipe tables, space-flattened tables, tables with the
 * separators lost, one-cell-per-line dumps, …) is read by STRUCTURE and SEMANTICS
 * (what is a number, what is a phrase, how many columns the header implies) and
 * laid out as rows × columns.
 *
 * Every pattern lives in the PRO-FORMA below (DEFAULT_PROFORMA). The pro-forma is
 * plain JSON: each pattern has an `engine` (the algorithm) and `params` (its rules —
 * regexes, thresholds, boundary rules). The user can edit / disable / reorder / add
 * patterns in Settings → App → Table pro-forma; the edited copy is stored in
 * localStorage and used instead of the default.
 *
 *   recognise(text, cfg?, proforma?) → { rows, pattern, label, delimiter, confidence, forced }
 *     cfg.pattern    "auto" (default) | "plain" | <pattern id from the pro-forma>
 *     cfg.delimiter  "" (auto) | any string — forces the delimited reader with it
 *     cfg.plainDelimiter  delimiter used by the "plain" fallback (clipboard uses "\t")
 */

/* ───────────────────────────── pro-forma ───────────────────────────── */

export const DEFAULT_PROFORMA = {
  version: 1,
  common: {
    // what counts as a numeric cell (a single token): 42, 3.14159, 1,250, 88,500, -7, 45%
    numberRegex: "^[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?%?$",
    // a cell that is exactly one of these means "empty" (only for patterns with blankEmpty: true)
    emptyMarkers: ["—", "–"],
    // fewest lines before auto-detect may transform text (a single line stays a single cell)
    minRows: 2,
    // auto-detect only transforms when a pattern scores at least this (0..1)
    minConfidence: 0.75
  },
  patterns: [
    {
      id: "pipe",
      label: "Pipe table",
      description: "| a | b | c | rows, with or without the |---|---| separator line (Markdown tables).",
      engine: "pipe",
      enabled: true,
      params: { dropSeparator: true, blankEmpty: true }
    },
    {
      id: "delimited",
      label: "Delimited (tab / ; / ,)",
      description: "Rows whose separator count is consistent: TSV from Excel, CSV, semicolon CSV. Quotes are honoured.",
      engine: "delimited",
      enabled: true,
      params: { candidates: ["\t", ";", ","], minColumns: 2, minAgreement: 0.8, blankEmpty: false }
    },
    {
      id: "spaced",
      label: "Aligned columns",
      description: "Columns separated by 2+ spaces or a tab (text-aligned tables).",
      engine: "regex",
      enabled: true,
      params: { splitRegex: "\\t| {2,}", minAgreement: 0.8, blankEmpty: true }
    },
    {
      id: "runs",
      label: "Flattened table (words & numbers)",
      description: "No separators at all: header like 'Column A Column B …'; numbers are cells, runs of words are cells.",
      engine: "runs",
      enabled: true,
      params: { headerLeader: true, minAgreement: 0.7, blankEmpty: true }
    },
    {
      id: "glued",
      label: "Glued table (separators lost)",
      description: "'042Average rainfall1,200 mm' — cells touch each other; boundaries are found at digit↔letter and lower→Upper changes.",
      engine: "glued",
      enabled: true,
      params: {
        minAgreement: 0.8,
        blankEmpty: true,
        // a boundary is a zero-width position matched by `regex`; higher strength wins when a row has too many
        rules: [
          { id: "digitLetter", regex: "(?<=\\d)(?=[A-Za-z])", strength: 2 },
          { id: "letterDigit", regex: "(?<=[A-Za-z]{2})(?=\\d)", strength: 2 },
          { id: "lowerUpper", regex: "(?<=[a-z])(?=[A-Z])", strength: 1 }
        ]
      }
    },
    {
      id: "vertical",
      label: "One cell per line",
      description: "Header cells, then every cell on its own line. Column count is found from the data (numeric vs text columns).",
      engine: "vertical",
      enabled: true,
      params: { maxColumns: 12, minDataRows: 3, minPurity: 0.8, blankEmpty: true }
    }
  ]
};

const LS_PROFORMA = "dexCsvProforma";
export const ENGINE_IDS = ["pipe", "delimited", "regex", "runs", "glued", "vertical"];

const clone = (o) => JSON.parse(JSON.stringify(o));

function rx(src, flags) {
  try { return new RegExp(src, flags || ""); } catch (e) { return null; }
}

/** Check a pro-forma object. Returns { ok:true } or { ok:false, error }. */
export function validateProforma(pf) {
  if (!pf || typeof pf !== "object") return { ok: false, error: "Pro-forma must be a JSON object" };
  const c = pf.common;
  if (!c || typeof c !== "object") return { ok: false, error: "Missing \"common\" section" };
  if (!rx(c.numberRegex)) return { ok: false, error: "common.numberRegex is not a valid regular expression" };
  if (!Array.isArray(pf.patterns) || !pf.patterns.length) return { ok: false, error: "\"patterns\" must be a non-empty list" };
  const seen = new Set();
  for (const p of pf.patterns) {
    if (!p || typeof p.id !== "string" || !p.id.trim()) return { ok: false, error: "Every pattern needs an \"id\"" };
    if (p.id === "auto" || p.id === "plain") return { ok: false, error: `"${p.id}" is a reserved pattern id` };
    if (seen.has(p.id)) return { ok: false, error: `Duplicate pattern id "${p.id}"` };
    seen.add(p.id);
    if (!ENGINE_IDS.includes(p.engine)) return { ok: false, error: `Pattern "${p.id}": engine must be one of ${ENGINE_IDS.join(", ")}` };
    if (!p.params || typeof p.params !== "object") return { ok: false, error: `Pattern "${p.id}": missing "params"` };
    if (p.engine === "regex" && !rx(p.params.splitRegex)) return { ok: false, error: `Pattern "${p.id}": splitRegex is not a valid regular expression` };
    if (p.engine === "glued") {
      const rules = p.params.rules;
      if (!Array.isArray(rules) || !rules.length) return { ok: false, error: `Pattern "${p.id}": needs at least one boundary rule` };
      for (const r of rules) if (!rx(r && r.regex, "g")) return { ok: false, error: `Pattern "${p.id}": rule "${r && r.id}" has an invalid regex` };
    }
  }
  return { ok: true };
}

/** The active pro-forma: the user's edited copy if valid, otherwise the default. */
export function getProforma() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_PROFORMA) : null;
    if (raw) { const pf = JSON.parse(raw); if (validateProforma(pf).ok) return pf; }
  } catch (e) {}
  return clone(DEFAULT_PROFORMA);
}
export function saveProforma(pf) {
  const v = validateProforma(pf);
  if (!v.ok) return v;
  try { localStorage.setItem(LS_PROFORMA, JSON.stringify(pf)); } catch (e) { return { ok: false, error: "Could not save (storage unavailable)" }; }
  return { ok: true };
}
export function resetProforma() { try { localStorage.removeItem(LS_PROFORMA); } catch (e) {} return clone(DEFAULT_PROFORMA); }

/** Patterns the user can pick in note settings (enabled ones, pro-forma order). */
export function listPatterns(pf) {
  return (pf || getProforma()).patterns.filter((p) => p.enabled !== false).map((p) => ({ id: p.id, label: p.label || p.id, description: p.description || "" }));
}

/* ───────────────────────── delimited primitives ───────────────────────── */

/** Parse delimited text into a 2-D array of strings. Handles quotes, "" escapes, CRLF, multi-character delimiters. */
export function parseDelimited(text, delim) {
  const rows = [];
  let row = [], cell = "", i = 0, inQ = false;
  const n = text.length;
  const dl = delim.length;
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
    if (dl === 1 ? ch === delim : text.startsWith(delim, i)) { row.push(cell); cell = ""; i += dl; continue; }
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

const DELIM_NAMES = { "\t": "Tab", ",": "Comma", ";": "Semicolon", "|": "Pipe", " ": "Space", ":": "Colon" };
export function describeDelimiter(d) { return !d ? "Auto" : (DELIM_NAMES[d] || `“${d}”`); }
/** Turn what the user typed into a delimiter: names (tab, comma …) and \t escapes are understood. */
export function parseDelimiterInput(s) {
  s = String(s == null ? "" : s);
  const k = s.trim().toLowerCase();
  if (!k || k === "auto") return "";
  const byName = { tab: "\t", comma: ",", semicolon: ";", pipe: "|", space: " ", colon: ":" };
  if (byName[k]) return byName[k];
  return s.replace(/\\t/g, "\t").replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

/* ───────────────────────────── shared helpers ───────────────────────────── */

function mkCtx(text, common) {
  const lines = text.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim() !== "");
  return {
    text: text.replace(/\n+$/, ""),
    lines,
    common,
    num: rx(common.numberRegex) || /^\d+$/,
    markers: new Set(common.emptyMarkers || [])
  };
}
const isNum = (ctx, t) => ctx.num.test(t);

function modeOf(arr) {
  const m = new Map();
  let best = 0, bc = 0;
  for (const v of arr) {
    const c = (m.get(v) || 0) + 1; m.set(v, c);
    if (c > bc || (c === bc && v > best)) { best = v; bc = c; }
  }
  return { value: best, count: bc };
}

function clean(ctx, rows, blankEmpty) {
  return rows.map((r) => r.map((c) => {
    c = String(c == null ? "" : c).trim();
    return blankEmpty && ctx.markers.has(c) ? "" : c;
  }));
}

/* ───────────────────────────── engines ─────────────────────────────
 * engine(ctx, params, force, delimiterOverride) → { rows, score, delimiter? } | null
 * `score` is 0 when the text does not look like this pattern; `force` returns the
 * best-effort rows anyway (used when the user picked the pattern in note settings).
 */

function eDelimited(ctx, p, force, override) {
  const cands = override ? [override] : (p.candidates || ["\t", ";", ","]);
  let best = null;
  for (const d of cands) {
    if (!d) continue;
    const rows = parseDelimited(ctx.text, d);
    if (!rows.length) continue;
    const cols = modeOf(rows.map((r) => r.length));
    const agree = cols.count / rows.length;
    const ok = cols.value >= (p.minColumns || 2) && rows.length >= (override ? 1 : ctx.common.minRows) && agree >= (p.minAgreement == null ? 0.8 : p.minAgreement);
    const score = ok ? 0.9 * agree + 0.05 : 0;
    if (!best || score > best.score || (score === best.score && cols.value > best.cols)) best = { rows, score, cols: cols.value, delimiter: d };
  }
  if (!best || (!force && !best.score)) return null;
  return { rows: p.blankEmpty ? clean(ctx, best.rows, true) : best.rows, score: best.score, delimiter: best.delimiter };
}

function splitPipe(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out = []; let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "|") { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
const isPipeSep = (l) => /^[\s|:\-]+$/.test(l) && l.includes("-") && l.includes("|");

function ePipe(ctx, p, force) {
  const L = ctx.lines;
  if (!L.length) return null;
  const hasSep = L.some(isPipeSep);
  const frac = L.filter((l) => l.includes("|")).length / L.length;
  const data = L.filter((l) => !(p.dropSeparator !== false && isPipeSep(l)));
  if (!data.length) return null;
  const rows = data.map(splitPipe);
  const cols = modeOf(rows.map((r) => r.length));
  const agree = cols.count / rows.length;
  const ok = frac >= 0.8 && cols.value >= (hasSep ? 1 : 2) && agree >= 0.8 && data.length >= (hasSep ? 1 : ctx.common.minRows);
  const score = ok ? 0.8 * agree + (hasSep ? 0.2 : 0.12) : 0;
  if (!force && !score) return null;
  return { rows: clean(ctx, rows, p.blankEmpty !== false), score };
}

function eRegex(ctx, p, force) {
  const sp = rx(p.splitRegex);
  if (!sp || !ctx.lines.length) return null;
  const rows = ctx.lines.map((l) => l.trim().split(sp));
  const cols = modeOf(rows.map((r) => r.length));
  const agree = cols.count / rows.length;
  const ok = cols.value >= 2 && agree >= (p.minAgreement == null ? 0.8 : p.minAgreement) && rows.length >= ctx.common.minRows;
  const score = ok ? 0.8 * agree + 0.07 : 0;
  if (!force && !score) return null;
  return { rows: clean(ctx, rows, p.blankEmpty !== false), score };
}

/* ── runs: numbers are cells, runs of words are cells ── */

function segment(ctx, tokens) {
  const segs = []; let words = [];
  const flush = () => { if (words.length) { segs.push({ text: words.join(" "), num: false }); words = []; } };
  for (const t of tokens) {
    if (isNum(ctx, t)) { flush(); segs.push({ text: t, num: true }); } else words.push(t);
  }
  flush();
  return segs;
}

/** "Column A Column B Column C" → ["Column A","Column B","Column C"] (a leader word repeating before distinct labels). */
function findLeader(tokens) {
  if (tokens.length < 4 || tokens.length % 2) return null;
  const w = tokens[0];
  const labels = [];
  for (let i = 0; i < tokens.length; i += 2) {
    if (tokens[i] !== w || tokens[i + 1] === w) return null;
    labels.push(tokens[i + 1]);
  }
  if (new Set(labels).size !== labels.length) return null;
  return labels.map((l) => w + " " + l);
}

/** Re-cut a row whose natural segmentation has the wrong cell count, using what the good rows taught about each column. */
function fitRow(ctx, tokens, K, kinds) {
  const n = tokens.length;
  if (n > 150) { const s = segment(ctx, tokens).map((x) => x.text); while (s.length < K) s.push(""); return s.slice(0, K - 1).concat([s.slice(K - 1).join(" ")]); }
  const isN = tokens.map((t) => isNum(ctx, t));
  const cost = (a, b, k) => {
    if (a === b) return 4;
    let nn = 0; for (let i = a; i < b; i++) if (isN[i]) nn++;
    if (b - a === 1 && nn === 1) return k === "text" ? 2 : 0;
    if (nn === 0) return k === "num" ? 6 : 0;
    return k === "text" ? 1 : (k === "mixed" ? 2 : 8);
  };
  const INF = 1e9;
  const f = Array.from({ length: n + 1 }, () => new Array(K + 1).fill(INF));
  const from = Array.from({ length: n + 1 }, () => new Array(K + 1).fill(0));
  f[0][0] = 0;
  for (let j = 1; j <= K; j++) for (let i = 0; i <= n; i++) for (let a = 0; a <= i; a++) {
    if (f[a][j - 1] >= INF) continue;
    const c = f[a][j - 1] + cost(a, i, kinds[j - 1] || "mixed");
    if (c < f[i][j]) { f[i][j] = c; from[i][j] = a; }
  }
  const cells = new Array(K);
  let i = n;
  for (let j = K; j >= 1; j--) { const a = from[i][j]; cells[j - 1] = tokens.slice(a, i).join(" "); i = a; }
  return cells;
}

function eRuns(ctx, p, force) {
  const L = ctx.lines;
  if (!L.length || (L.length < 2 && !force)) return null;
  const toks = L.map((l) => l.trim().split(/\s+/));
  let K = 0, header = null, start = 0, leader = false;
  if (p.headerLeader !== false) {
    const h = findLeader(toks[0]);
    if (h) { K = h.length; header = h; start = 1; leader = true; }
  }
  const segs = toks.map((t) => segment(ctx, t));
  if (!K) K = modeOf(segs.map((s) => s.length)).value;
  if (K < 2 && !force) return null;
  K = Math.max(K, 1);
  const body = toks.slice(start), bsegs = segs.slice(start);
  const good = bsegs.filter((s) => s.length === K);
  const agree = bsegs.length ? good.length / bsegs.length : 0;
  const kinds = [];
  for (let j = 0; j < K; j++) {
    const nn = good.filter((s) => s[j].num).length;
    kinds.push(!good.length ? "mixed" : nn === good.length ? "num" : nn === 0 ? "text" : "mixed");
  }
  const rows = body.map((t, i) => (bsegs[i].length === K ? bsegs[i].map((s) => s.text) : fitRow(ctx, t, K, kinds)));
  if (header) rows.unshift(header);
  const minA = p.minAgreement == null ? 0.7 : p.minAgreement;
  // without a header label the evidence is weak (prose looks alike too): never auto-chosen, only when forced
  const score = leader ? (agree >= minA && body.length >= 1 ? 0.95 : 0) : (agree >= 0.8 && body.length >= 2 ? 0.7 : 0);
  if (!force && !score) return null;
  return { rows: clean(ctx, rows, p.blankEmpty !== false), score };
}

/* ── glued: cells touch; find the boundaries ── */

function boundaries(line, rules) {
  const at = new Map();
  for (const r of rules) {
    r.rx.lastIndex = 0;
    let m;
    while ((m = r.rx.exec(line))) {
      if (m.index > 0 && m.index < line.length) at.set(m.index, Math.max(at.get(m.index) || 0, r.strength));
      if (m.index === r.rx.lastIndex) r.rx.lastIndex++;       // zero-width match: advance
    }
  }
  return [...at].map(([pos, strength]) => ({ pos, strength })).sort((a, b) => a.pos - b.pos);
}

function cutAt(line, cuts) {
  const out = []; let last = 0;
  for (const c of cuts) { out.push(line.slice(last, c.pos)); last = c.pos; }
  out.push(line.slice(last));
  return out;
}

function eGlued(ctx, p, force) {
  const L = ctx.lines;
  const rules = (p.rules || []).map((r) => ({ rx: rx(r.regex, "g"), strength: +r.strength || 1 })).filter((r) => r.rx);
  if (!rules.length || L.length < 2) return null;
  const all = L.map((l) => boundaries(l, rules));
  let cuts = all[0].length;                                   // the header tells how many columns there are
  if (!cuts) cuts = modeOf(all.slice(1).map((b) => b.length)).value;
  if (!cuts && !force) return null;
  const data = all.slice(1);
  const agree = data.length ? data.filter((b) => b.length === cuts).length / data.length : 0;
  const rows = L.map((line, i) => {
    let b = all[i];
    if (b.length > cuts) b = b.slice().sort((x, y) => y.strength - x.strength || x.pos - y.pos).slice(0, cuts).sort((x, y) => x.pos - y.pos);
    const cells = cutAt(line, b);
    while (cells.length < cuts + 1) cells.push("");
    return cells;
  });
  const ok = cuts >= 1 && data.length >= 2 && agree >= (p.minAgreement == null ? 0.8 : p.minAgreement);
  const score = ok ? 0.85 * agree + 0.07 : 0;
  if (!force && !score) return null;
  return { rows: clean(ctx, rows, p.blankEmpty !== false), score };
}

/* ── vertical: one cell per line ── */

function eVertical(ctx, p, force) {
  const L = ctx.lines.map((l) => l.trim());
  const n = L.length;
  const maxK = p.maxColumns || 12, minData = p.minDataRows || 3, minPurity = p.minPurity == null ? 0.8 : p.minPurity;
  let best = null;
  for (let K = 2; K <= maxK; K++) {
    if (n % K || n / K < minData + 1) continue;
    const head = L.slice(0, K);
    if (head.some((h) => isNum(ctx, h))) continue;            // a header row is made of labels, not numbers
    const R = n / K - 1;
    let pur = 0, numCols = 0, textCols = 0;
    for (let j = 0; j < K; j++) {
      const vals = [];
      for (let r = 0; r < R; r++) { const v = L[(r + 1) * K + j]; if (v !== "" && !ctx.markers.has(v)) vals.push(v); }
      if (!vals.length) { pur += 1; continue; }
      const nn = vals.filter((v) => isNum(ctx, v)).length / vals.length;
      pur += Math.max(nn, 1 - nn);
      if (nn === 1 && vals.length >= 2) numCols++; else if (nn === 0) textCols++;
    }
    pur /= K;
    const ok = pur >= minPurity && numCols >= 1 && textCols >= 1;
    const score = ok ? 0.7 + 0.1 * pur : 0;   // weakest evidence of all patterns: stays below the others
    if (!best || score > best.score) best = { K, score };
  }
  if (!best) return null;
  if (!force && !best.score) return null;
  const rows = [];
  for (let i = 0; i < n; i += best.K) rows.push(L.slice(i, i + best.K));
  return { rows: clean(ctx, rows, p.blankEmpty !== false), score: best.score };
}

const ENGINES = { pipe: ePipe, delimited: eDelimited, regex: eRegex, runs: eRuns, glued: eGlued, vertical: eVertical };

/* ───────────────────────────── entry point ───────────────────────────── */

export function recognise(text, cfg, proforma) {
  text = String(text == null ? "" : text).replace(/\r\n?/g, "\n");
  cfg = cfg || {};
  const want = cfg.pattern || "auto";
  const delim = cfg.delimiter || "";
  if (!text.trim()) return { rows: [], pattern: "plain", label: "Plain", delimiter: cfg.plainDelimiter || ",", confidence: 1, forced: false };

  const pf = proforma || getProforma();
  const ctx = mkCtx(text, pf.common || DEFAULT_PROFORMA.common);
  const plain = () => {
    const d = cfg.plainDelimiter || sniffDelimiter(text);
    return { rows: parseDelimited(text, d), pattern: "plain", label: "Plain CSV / TSV", delimiter: d, confidence: 1, forced: want === "plain" };
  };
  const make = (pat, res, forced) => ({ rows: res.rows, pattern: pat.id, label: pat.label || pat.id, delimiter: res.delimiter || "", confidence: res.score, forced });

  if (want === "plain" && !delim) return plain();

  // the user's choice in note settings wins, even when the text does not fit it well
  if (want !== "auto" && want !== "plain") {
    const pat = pf.patterns.find((x) => x.id === want);
    if (pat) {
      const res = ENGINES[pat.engine](ctx, pat.params || {}, true, pat.engine === "delimited" ? delim : "");
      if (res && res.rows.length) return make(pat, res, true);
    }
    return plain();
  }

  // a delimiter typed in note settings: read it with exactly that delimiter
  if (delim) {
    const pat = pf.patterns.find((x) => x.engine === "delimited") || { id: "delimited", label: "Delimited", params: {} };
    const res = eDelimited(ctx, pat.params || {}, true, delim);
    if (res) return make(pat, res, true);
    return plain();
  }

  let best = null;
  for (const pat of pf.patterns) {
    if (pat.enabled === false || !ENGINES[pat.engine]) continue;
    const res = ENGINES[pat.engine](ctx, pat.params || {}, false, "");
    if (res && res.score > 0 && (!best || res.score > best.res.score)) best = { pat, res };   // ties keep pro-forma order
  }
  if (best && best.res.score >= (ctx.common.minConfidence == null ? 0.75 : ctx.common.minConfidence)) return make(best.pat, best.res, false);
  return plain();
}
