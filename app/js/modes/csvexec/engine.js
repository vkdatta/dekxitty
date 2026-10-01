/**
 * csvexec — formula engine (pure, no DOM).
 *
 *   • Sheet        fixed 1000 × 100 grid of raw strings; "=..." cells are formulas
 *   • tokenize / parseFormula / shiftFormula   A1 / $A$1 / A1:B9 / A:A syntax
 *   • Sheet.recalc()  dependency-ordered, async-aware, cancellable
 *   • fillCells()     Excel-style fill (relative refs shift, $ stays, numeric series)
 */
import { FUNCS, CellError, FormulaError, Range, isRange, toStr, toNum, toBool, numToStr, beginPass, endPass } from "./functions.js";

export const ROWS = 1000;
export const COLS = 100;

/* ───────────────────────────── addressing ───────────────────────────── */

export function colName(i) {
  let s = ""; i++;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}
export function colIndex(name) {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function addr(r, c, absR, absC) { return (absC ? "$" : "") + colName(c) + (absR ? "$" : "") + (r + 1); }
export function parseAddr(s) {
  const m = /^\$?([A-Za-z]{1,2})\$?(\d{1,4})$/.exec(String(s).trim());
  if (!m) return null;
  const c = colIndex(m[1]), r = parseInt(m[2], 10) - 1;
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
  return { r, c };
}
export const isFormula = (raw) => typeof raw === "string" && raw.length > 1 && raw.charCodeAt(0) === 61; // "="

/* ───────────────────────────── tokenizer ───────────────────────────── */

const RE_NUM = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const RE_COLS = /(\$?)([A-Za-z]{1,2}):(\$?)([A-Za-z]{1,2})(?![A-Za-z0-9_(])/y;
const RE_REF = /(\$?)([A-Za-z]{1,2})(\$?)(\d{1,4})(?![A-Za-z0-9_.(])/y;
const RE_WORD = /[A-Za-z_][A-Za-z0-9_.]*/y;
const OPS2 = ["<>", "<=", ">="];
const OPS1 = "+-*/^&=<>%";

export function tokenize(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i++; continue; }
    if (ch === '"') {
      let j = i + 1, s = "";
      for (;;) {
        if (j >= n) throw new FormulaError("#ERROR!", "unterminated string");
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += src[j++];
      }
      out.push({ t: "str", v: s, s: i, e: j + 1 });
      i = j + 1; continue;
    }
    let m;
    RE_COLS.lastIndex = i;
    if ((m = RE_COLS.exec(src))) {
      out.push({ t: "cols", aC1: !!m[1], c1: m[2], aC2: !!m[3], c2: m[4], s: i, e: i + m[0].length });
      i += m[0].length; continue;
    }
    RE_REF.lastIndex = i;
    if ((m = RE_REF.exec(src))) {
      out.push({ t: "ref", aC: !!m[1], col: m[2], aR: !!m[3], row: m[4], s: i, e: i + m[0].length });
      i += m[0].length; continue;
    }
    RE_NUM.lastIndex = i;
    if ((m = RE_NUM.exec(src))) { out.push({ t: "num", v: parseFloat(m[0]), s: i, e: i + m[0].length }); i += m[0].length; continue; }
    RE_WORD.lastIndex = i;
    if ((m = RE_WORD.exec(src))) { out.push({ t: "word", v: m[0], s: i, e: i + m[0].length }); i += m[0].length; continue; }
    const two = src.substr(i, 2);
    if (OPS2.includes(two)) { out.push({ t: "op", v: two, s: i, e: i + 2 }); i += 2; continue; }
    if (ch === "(") { out.push({ t: "lp", s: i, e: i + 1 }); i++; continue; }
    if (ch === ")") { out.push({ t: "rp", s: i, e: i + 1 }); i++; continue; }
    if (ch === "," || ch === ";") { out.push({ t: "comma", s: i, e: i + 1 }); i++; continue; }
    if (ch === ":") { out.push({ t: "colon", s: i, e: i + 1 }); i++; continue; }
    if (OPS1.includes(ch)) { out.push({ t: "op", v: ch, s: i, e: i + 1 }); i++; continue; }
    throw new FormulaError("#ERROR!", `unexpected "${ch}"`);
  }
  return out;
}

/**
 * Shift every relative reference in a formula (text after the "=") by (dr, dc),
 * exactly like Excel's fill / paste. Absolute ($) parts stay. A reference that
 * would leave the sheet becomes #REF!.
 */
export function shiftFormula(raw, dr, dc) {
  if (!isFormula(raw) || (dr === 0 && dc === 0)) return raw;
  const body = raw.slice(1);
  let toks;
  try { toks = tokenize(body); } catch (e) { return raw; }
  let out = "", last = 0;
  for (const t of toks) {
    let rep = null;
    if (t.t === "ref") {
      const c = colIndex(t.col) + (t.aC ? 0 : dc);
      const r = parseInt(t.row, 10) - 1 + (t.aR ? 0 : dr);
      rep = (c < 0 || c >= COLS || r < 0 || r >= ROWS) ? "#REF!" : addr(r, c, t.aR, t.aC);
    } else if (t.t === "cols") {
      const c1 = colIndex(t.c1) + (t.aC1 ? 0 : dc), c2 = colIndex(t.c2) + (t.aC2 ? 0 : dc);
      rep = (c1 < 0 || c2 < 0 || c1 >= COLS || c2 >= COLS) ? "#REF!" : (t.aC1 ? "$" : "") + colName(c1) + ":" + (t.aC2 ? "$" : "") + colName(c2);
    }
    if (rep !== null) { out += body.slice(last, t.s) + rep; last = t.e; }
  }
  return "=" + out + body.slice(last);
}

/* ───────────────────────────── parser ───────────────────────────── */

const PREC = { "=": 1, "<>": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 5 };
const astCache = new Map();

export function parseFormula(raw) {
  if (astCache.has(raw)) return astCache.get(raw);
  const toks = tokenize(raw.slice(1));
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];

  function cellFrom(t) {
    const c = colIndex(t.col), r = parseInt(t.row, 10) - 1;
    return { k: "ref", r, c, ok: r >= 0 && r < ROWS && c >= 0 && c < COLS };
  }
  function primary() {
    const t = next();
    if (!t) throw new FormulaError("#ERROR!", "unexpected end");
    switch (t.t) {
      case "num": return { k: "num", v: t.v };
      case "str": return { k: "str", v: t.v };
      case "cols": {
        const a = colIndex(t.c1), b = colIndex(t.c2);
        return { k: "range", r1: 0, c1: Math.min(a, b), r2: ROWS - 1, c2: Math.max(a, b), ok: a < COLS && b < COLS };
      }
      case "ref": {
        const a = cellFrom(t);
        if (peek() && peek().t === "colon") {
          next();
          const t2 = next();
          if (!t2 || t2.t !== "ref") throw new FormulaError("#ERROR!", "bad range");
          const b = cellFrom(t2);
          return { k: "range", r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c), ok: a.ok && b.ok };
        }
        return a;
      }
      case "lp": { const e = expr(0); const c = next(); if (!c || c.t !== "rp") throw new FormulaError("#ERROR!", "missing )"); return e; }
      case "word": {
        const up = t.v.toUpperCase();
        if (peek() && peek().t === "lp") {
          next();
          const args = [];
          if (peek() && peek().t === "rp") { next(); }
          else {
            for (;;) {
              if (peek() && (peek().t === "comma" || peek().t === "rp")) args.push({ k: "str", v: "", empty: true });
              else args.push(expr(0));
              const d = next();
              if (!d) throw new FormulaError("#ERROR!", "missing )");
              if (d.t === "rp") break;
              if (d.t !== "comma") throw new FormulaError("#ERROR!", "expected , or )");
            }
          }
          return { k: "call", name: up, args };
        }
        if (up === "TRUE") return { k: "bool", v: true };
        if (up === "FALSE") return { k: "bool", v: false };
        return { k: "word", v: t.v };          // bare word -> literal text (e.g. =DECRYPT(A1,key1,key2))
      }
      case "op":
        if (t.v === "-") return { k: "neg", x: unary() };
        if (t.v === "+") return unary();
      // fallthrough
      default: throw new FormulaError("#ERROR!", "unexpected token");
    }
  }
  function unary() { return postfix(); }
  function postfix() {
    let e = primary();
    while (peek() && peek().t === "op" && peek().v === "%") { next(); e = { k: "pct", x: e }; }
    return e;
  }
  function expr(min) {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || !(t.v in PREC) || PREC[t.v] < min) break;
      next();
      const right = expr(PREC[t.v] + 1);
      left = { k: "bin", op: t.v, a: left, b: right };
    }
    return left;
  }
  const ast = expr(0);
  if (p < toks.length) throw new FormulaError("#ERROR!", "unexpected token");
  if (astCache.size > 5000) astCache.clear();
  astCache.set(raw, ast);
  return ast;
}

/* ───────────────────────────── evaluation ───────────────────────────── */

function cmp(a, b) {
  const an = typeof a === "number" || (typeof a === "string" && a.trim() !== "" && isFinite(Number(a)));
  const bn = typeof b === "number" || (typeof b === "string" && b.trim() !== "" && isFinite(Number(b)));
  if (an && bn) { const x = Number(a), y = Number(b); return x < y ? -1 : x > y ? 1 : 0; }
  const x = toStr(a).toLowerCase(), y = toStr(b).toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

async function evalNode(n, ctx) {
  switch (n.k) {
    case "num": case "str": case "bool": return n.v;
    case "word": return n.v;
    case "ref":
      if (!n.ok) throw new FormulaError("#REF!");
      return ctx.read(n.r, n.c);
    case "range": {
      if (!n.ok) throw new FormulaError("#REF!");
      const rows = [];
      for (let r = n.r1; r <= n.r2; r++) { const row = []; for (let c = n.c1; c <= n.c2; c++) row.push(ctx.read(r, c, true)); rows.push(row); }
      return new Range(rows);
    }
    case "neg": return -toNum(await evalNode(n.x, ctx));
    case "pct": return toNum(await evalNode(n.x, ctx)) / 100;
    case "bin": {
      const a = await evalNode(n.a, ctx), b = await evalNode(n.b, ctx);
      switch (n.op) {
        case "+": return toNum(a) + toNum(b);
        case "-": return toNum(a) - toNum(b);
        case "*": return toNum(a) * toNum(b);
        case "/": { const d = toNum(b); if (d === 0) throw new FormulaError("#DIV/0!"); return toNum(a) / d; }
        case "^": return toNum(a) ** toNum(b);
        case "&": return toStr(a) + toStr(b);
        case "=": return cmp(a, b) === 0;
        case "<>": return cmp(a, b) !== 0;
        case "<": return cmp(a, b) < 0;
        case ">": return cmp(a, b) > 0;
        case "<=": return cmp(a, b) <= 0;
        case ">=": return cmp(a, b) >= 0;
      }
      throw new FormulaError("#ERROR!");
    }
    case "call": {
      const f = FUNCS.get(n.name);
      if (!f) throw new FormulaError("#NAME?", `unknown function ${n.name}`);
      const argc = n.args.length;
      if (argc < f.min || argc > f.max) throw new FormulaError("#VALUE!", `${f.name} expects ${f.min}${f.max === f.min ? "" : f.max === Infinity ? "+" : "–" + f.max} argument(s)`);
      if (f.lazy) return f.fn(...n.args.map((a) => () => evalNode(a, ctx)));
      const vals = [];
      for (const a of n.args) vals.push(a.empty ? undefined : await evalNode(a, ctx));
      // optional args that were left empty ( f(a,,b) ) are treated as ""
      for (let i = 0; i < vals.length; i++) if (vals[i] === undefined && n.args[i].empty) vals[i] = "";
      return f.ctx ? f.fn.apply({ row: ctx.row, col: ctx.col }, vals) : f.fn(...vals);
    }
  }
  throw new FormulaError("#ERROR!");
}

/** Cells a formula reads (for ordering / cycle detection). Calls cb(r, c) per cell. */
function eachDep(n, cb) {
  switch (n.k) {
    case "ref": if (n.ok) cb(n.r, n.c); break;
    case "range": if (n.ok) for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) cb(r, c); break;
    case "neg": case "pct": eachDep(n.x, cb); break;
    case "bin": eachDep(n.a, cb); eachDep(n.b, cb); break;
    case "call": n.args.forEach((a) => eachDep(a, cb)); break;
  }
}

/* ───────────────────────────── the sheet ───────────────────────────── */

export class Sheet {
  constructor() {
    this.raw = Array.from({ length: ROWS }, () => new Array(COLS).fill(""));
    this.values = new Map();     // key -> displayed result of formula cells (string|number|boolean|CellError)
    this.gen = 0;
    this.pending = new Set();    // keys currently calculating
    this.running = false;
    this.progress = { done: 0, total: 0 };
    this.onUpdate = null;        // () => void   (throttled by the UI)
    this.onDone = null;
  }
  static key(r, c) { return r * COLS + c; }

  load(rows) {
    for (let r = 0; r < ROWS; r++) this.raw[r].fill("");
    for (let r = 0; r < Math.min(rows.length, ROWS); r++)
      for (let c = 0; c < Math.min(rows[r].length, COLS); c++) this.raw[r][c] = rows[r][c] == null ? "" : String(rows[r][c]);
    this.values.clear();
  }
  get(r, c) { return this.raw[r][c]; }
  set(r, c, v) {
    this.raw[r][c] = v;
    if (!isFormula(v)) this.values.delete(Sheet.key(r, c));
  }
  hasFormulas() {
    for (let r = 0; r < ROWS; r++) { const row = this.raw[r]; for (let c = 0; c < COLS; c++) if (isFormula(row[c])) return true; }
    return false;
  }

  /** Text shown in a cell. */
  display(r, c) {
    const raw = this.raw[r][c];
    if (!isFormula(raw)) return raw;
    const k = Sheet.key(r, c);
    if (!this.values.has(k)) return this.pending.has(k) || this.running ? "…" : "";
    const v = this.values.get(k);
    if (v instanceof CellError) return v.code;
    try { return toStr(v); } catch (e) { return "#VALUE!"; }
  }
  /** Value (not raw formula) for export / copy. Errors become their code. */
  valueText(r, c) {
    const raw = this.raw[r][c];
    if (!isFormula(raw)) return raw;
    const k = Sheet.key(r, c);
    if (!this.values.has(k)) return "";
    return this.display(r, c);
  }
  isError(r, c) { const v = this.values.get(Sheet.key(r, c)); return v instanceof CellError; }
  errorMessage(r, c) { const v = this.values.get(Sheet.key(r, c)); return v instanceof CellError ? (v.msg || v.code) : ""; }

  /**
   * Recalculate every formula cell. Safe to call repeatedly: a newer call cancels the
   * write-back of an older one (heavy results are memoised so no work is repeated).
   */
  async recalc() {
    const tok = ++this.gen;
    beginPass();
    const formulas = [];                 // {r,c,k,ast|err}
    const byKey = new Map();
    for (let r = 0; r < ROWS; r++) {
      const row = this.raw[r];
      for (let c = 0; c < COLS; c++) {
        if (!isFormula(row[c])) continue;
        const k = Sheet.key(r, c);
        const f = { r, c, k, raw: row[c], ast: null, err: null, deps: new Set(), out: new Set(), indeg: 0 };
        try { f.ast = parseFormula(row[c]); } catch (e) { f.err = e instanceof FormulaError ? new CellError(e.code, e.message) : new CellError("#ERROR!", String(e && e.message)); }
        formulas.push(f); byKey.set(k, f);
      }
    }
    // drop stale display values of cells that are no longer formulas
    for (const k of Array.from(this.values.keys())) if (!byKey.has(k)) this.values.delete(k);

    if (!formulas.length) { this.running = false; this.pending.clear(); this.progress = { done: 0, total: 0 }; if (this.onUpdate) this.onUpdate(); if (this.onDone) this.onDone(tok); endPass(); return; }

    // build dependency graph (formula -> formula cells it reads)
    for (const f of formulas) {
      if (!f.ast) continue;
      eachDep(f.ast, (r, c) => {
        const d = byKey.get(Sheet.key(r, c));
        if (d && d !== f && !f.deps.has(d)) { f.deps.add(d); d.out.add(f); }
        else if (d === f) f.selfRef = true;
      });
    }
    for (const f of formulas) f.indeg = f.deps.size;

    this.running = true;
    this.pending = new Set(formulas.map((f) => f.k));
    this.progress = { done: 0, total: formulas.length };
    const local = new Map();             // results of THIS pass
    const publish = (f, v) => {
      local.set(f.k, v);
      if (tok !== this.gen) return;
      this.values.set(f.k, v);
      this.pending.delete(f.k);
      this.progress.done++;
    };

    // Kahn's algorithm in waves; cells never released are part of / downstream of a cycle
    let wave = formulas.filter((f) => f.indeg === 0);
    const released = new Set(wave);
    let lastTick = 0;
    const tick = () => { const now = Date.now(); if (now - lastTick > 80 && tok === this.gen && this.onUpdate) { lastTick = now; this.onUpdate(); } };

    while (wave.length) {
      const nextWave = [];
      await Promise.all(wave.map(async (f) => {
        let result;
        if (f.err) result = f.err;
        else if (f.selfRef) result = new CellError("#CIRC!", "circular reference");
        else {
          const ctx = {
            row: f.r, col: f.c,
            read: (r, c, inRange) => {
              const dk = Sheet.key(r, c);
              if (local.has(dk) || byKey.has(dk)) {
                const v = local.get(dk);
                if (v instanceof CellError) { if (inRange) return v.code; throw new FormulaError(v.code, v.msg); }
                return v === undefined ? "" : v;
              }
              return this.raw[r][c];
            }
          };
          try { result = await evalNode(f.ast, ctx); if (isRange(result)) result = new CellError("#VALUE!", "result is a range"); }
          catch (e) { result = e instanceof FormulaError ? new CellError(e.code, e.message) : new CellError("#ERROR!", String(e && e.message)); }
        }
        publish(f, result);
        tick();
        for (const o of f.out) { if (--o.indeg === 0 && !released.has(o)) { released.add(o); nextWave.push(o); } }
      }));
      wave = nextWave;
    }
    for (const f of formulas) if (!released.has(f)) publish(f, new CellError("#CIRC!", "circular reference"));

    if (tok === this.gen) {
      this.running = false;
      this.pending.clear();
      endPass();
      if (this.onUpdate) this.onUpdate();
      if (this.onDone) this.onDone(tok);
    }
  }
}

/* ───────────────────────────── fill (autofill) ───────────────────────────── */

/**
 * Compute the cells produced by filling `src` (a rectangle) out to `target` (a rectangle
 * that contains src and extends it in exactly one direction).
 * Returns [{r, c, v}] for the NEW cells only.
 *
 *  • formulas: relative references shift by the distance from their source cell
 *  • plain values: repeated; a run of 2+ numeric cells continues as an arithmetic series
 */
export function fillCells(sheet, src, target) {
  const out = [];
  const h = src.r2 - src.r1 + 1, w = src.c2 - src.c1 + 1;
  const vertical = target.r1 !== src.r1 || target.r2 !== src.r2;
  const isNum = (s) => typeof s === "string" && s.trim() !== "" && isFinite(Number(s)) && !isFormula(s);

  if (vertical) {
    for (let c = src.c1; c <= src.c2; c++) {
      const col = []; for (let r = src.r1; r <= src.r2; r++) col.push(sheet.get(r, c));
      const series = h >= 2 && col.every(isNum);
      const step = series ? (Number(col[h - 1]) - Number(col[0])) / (h - 1) : 0;
      const cells = [];
      if (target.r2 > src.r2) for (let r = src.r2 + 1; r <= target.r2; r++) cells.push(r);
      if (target.r1 < src.r1) for (let r = src.r1 - 1; r >= target.r1; r--) cells.push(r);
      for (const r of cells) {
        let v;
        if (series) {
          v = r > src.r2 ? Number(col[h - 1]) + step * (r - src.r2) : Number(col[0]) - step * (src.r1 - r);
          v = numToStr(+v.toPrecision(12));
        } else {
          const rel = ((r - src.r1) % h + h) % h;
          const sr = src.r1 + rel;
          v = shiftFormula(col[rel], r - sr, 0);
        }
        out.push({ r, c, v });
      }
    }
  } else {
    for (let r = src.r1; r <= src.r2; r++) {
      const row = []; for (let c = src.c1; c <= src.c2; c++) row.push(sheet.get(r, c));
      const series = w >= 2 && row.every(isNum);
      const step = series ? (Number(row[w - 1]) - Number(row[0])) / (w - 1) : 0;
      const cells = [];
      if (target.c2 > src.c2) for (let c = src.c2 + 1; c <= target.c2; c++) cells.push(c);
      if (target.c1 < src.c1) for (let c = src.c1 - 1; c >= target.c1; c--) cells.push(c);
      for (const c of cells) {
        let v;
        if (series) {
          v = c > src.c2 ? Number(row[w - 1]) + step * (c - src.c2) : Number(row[0]) - step * (src.c1 - c);
          v = numToStr(+v.toPrecision(12));
        } else {
          const rel = ((c - src.c1) % w + w) % w;
          const sc = src.c1 + rel;
          v = shiftFormula(row[rel], 0, c - sc);
        }
        out.push({ r, c, v });
      }
    }
  }
  return out;
}

/** How far down should a double-tap on the fill handle go? (Excel: as far as the neighbouring column has data.) */
export function autoFillLastRow(sheet, sel) {
  const tryCol = (c) => {
    if (c < 0 || c >= COLS) return -1;
    if (sheet.get(sel.r2, c) === "") return -1;
    let last = sel.r2;
    for (let i = sel.r2 + 1; i < ROWS && sheet.get(i, c) !== ""; i++) last = i;
    return last;
  };
  let last = tryCol(sel.c1 - 1);
  if (last <= sel.r2) last = tryCol(sel.c2 + 1);
  return last > sel.r2 ? last : -1;
}
