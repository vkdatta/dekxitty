/**
 * csvexec — function library.
 * Every entry:  { name, cat, sig, desc, min, max?, fn, lazy? }
 *   fn(...args)  receives already-evaluated scalar values (string | number | boolean)
 *                or a Range object for A1:B9 style arguments. May return a Promise.
 *   lazy: true   receives thunks instead (used by IF / IFERROR so only one branch runs).
 * Categories (shown in the function picker): see CATEGORIES below.
 *
 * Existing app code is reused where it exists (MD5, cipher, html helpers) so that
 * =MD5(A1) / =DECRYPT(A1,k1,k2) give exactly what the sidebar buttons give.
 */
import { generateMD5 } from "../../../components/sidebar2/functions/3code/md5.js";
import { cipherTransform } from "../../../components/sidebar2/functions/3code/cipher.js";

/* ───────────────────────── errors & value helpers ───────────────────────── */

export class CellError {
  constructor(code, msg) { this.code = code; this.msg = msg || ""; }
  toString() { return this.code; }
}
export class FormulaError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}

/** 2-D block of values produced by A1:B9. */
export class Range {
  constructor(rows) { this.rows = rows; }
  flat() { const o = []; for (const r of this.rows) for (const v of r) o.push(v); return o; }
}

export const isRange = (v) => v instanceof Range;

export function toStr(v) {
  if (isRange(v)) throw new FormulaError("#VALUE!", "range used where text expected");
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return numToStr(v);
  return String(v);
}
export function numToStr(n) {
  if (!isFinite(n)) throw new FormulaError("#NUM!");
  if (Number.isInteger(n)) return String(n);
  return String(+n.toPrecision(15));
}
export function toNum(v) {
  if (isRange(v)) throw new FormulaError("#VALUE!");
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v == null) return 0;
  const s = String(v).trim();
  if (s === "") return 0;
  const n = Number(s);
  if (!isFinite(n)) throw new FormulaError("#VALUE!", `"${s}" is not a number`);
  return n;
}
export function toBool(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = toStr(v).trim().toUpperCase();
  if (s === "TRUE") return true;
  if (s === "FALSE" || s === "") return false;
  const n = Number(s);
  if (isFinite(n)) return n !== 0;
  throw new FormulaError("#VALUE!");
}
const isNumeric = (v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && isFinite(Number(v)));

/* ─────────────────────────── heavy-call cache + throttle ──────────────────────────
 * ENCRYPT is randomised (fresh salt/IV every call) and ENCRYPT/DECRYPT both run two
 * 150 000-iteration PBKDF2 derivations. Results are memoised by (function + args) so
 * that (a) re-calculating the sheet never re-encrypts and changes the ciphertext, and
 * (b) re-opening a sheet does not re-run 1000 decryptions. The cache is persisted
 * per note by the UI layer (see exportCache / importCache).
 */
const cache = new Map();      // key -> string result
const inflight = new Map();   // key -> Promise
let usedKeys = new Set();
let cacheListener = null;

export function importCache(obj) {
  cache.clear();
  if (obj && typeof obj === "object") for (const k of Object.keys(obj)) cache.set(k, obj[k]);
}
export function exportCache() { const o = {}; cache.forEach((v, k) => { o[k] = v; }); return o; }
export function clearCache() { cache.clear(); inflight.clear(); }
export function beginPass() { usedKeys = new Set(); }
/** Drop cache entries that the finished (un-cancelled) pass did not use. */
export function endPass() {
  // lazy GC: only prune once the cache is clearly bigger than what the sheet uses,
  // so undoing a formula edit doesn't force 1000 PBKDF2 derivations again
  if (cache.size <= usedKeys.size * 2 + 50) return;
  for (const k of Array.from(cache.keys())) if (!usedKeys.has(k)) cache.delete(k);
  if (cacheListener) cacheListener();
}
export function onCacheChange(fn) { cacheListener = fn; }

let active = 0;
const waiters = [];
const MAX_PARALLEL = 6;
async function throttled(task) {
  if (active >= MAX_PARALLEL) await new Promise((res) => waiters.push(res));
  active++;
  try { return await task(); }
  finally { active--; const w = waiters.shift(); if (w) w(); }
}

async function heavy(name, args, compute) {
  const key = name + "|" + generateMD5(utf8(JSON.stringify(args)));
  usedKeys.add(key);
  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);
  const p = throttled(compute).then((v) => {
    cache.set(key, v); inflight.delete(key);
    if (cacheListener) cacheListener();
    return v;
  }, (e) => { inflight.delete(key); throw e; });
  inflight.set(key, p);
  return p;
}

/* ───────────────────────────── encoding helpers ───────────────────────────── */

const enc = new TextEncoder();
const dec = new TextDecoder();
/** UTF-16 string -> "binary string" of its UTF-8 bytes (what the legacy MD5 routine expects). */
function utf8(s) {
  let out = "";
  const b = enc.encode(s);
  for (let i = 0; i < b.length; i++) out += String.fromCharCode(b[i]);
  return out;
}
const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
async function digest(algo, s) { return hex(await crypto.subtle.digest(algo, enc.encode(s))); }
async function hmac(algo, s, key) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: algo }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(s)));
}
function b64enc(s) {
  const b = enc.encode(s); let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64dec(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  while (s.length % 4) s += "=";
  let bin;
  try { bin = atob(s); } catch (e) { throw new FormulaError("#VALUE!", "invalid Base64"); }
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return dec.decode(arr);
}
const words = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);

/* ────────────────────────────── the library ────────────────────────────── */

export const CATEGORIES = [
  "Hash & Crypto", "Encoding", "Text Case", "Text Edit", "Text Search & Extract",
  "Code & Markup", "Regex", "Logic", "Math", "Info"
];

const F = [];
const def = (cat, sig, desc, min, max, fn, extra) => {
  const name = sig.slice(0, sig.indexOf("(")).toUpperCase();
  F.push(Object.assign({ name, cat, sig, desc, min, max, fn }, extra || {}));
};
/** sidebar-2 tool names also work as formula names, e.g. =UPPERCASE(A1) == =UPPER(A1) */
const ALIASES = {
  UPPER: ["UPPERCASE", "HANDLEUPPERCASE"], LOWER: ["LOWERCASE", "HANDLELOWERCASE"], PROPER: ["CAPITALIZEWORDS", "CAPITALISEWORDS"],
  SENTENCE: ["CAPITALIZESENTENCES", "CAPITALISESENTENCES"], REVERSE: ["REVERSETEXT"], SHA256: ["SHA-256"], REMOVEHTML: ["HANDLEREMOVEHTML"]
};
const S = toStr, N = toNum;

/* Hash & Crypto */
def("Hash & Crypto", "MD5(text)", "MD5 hash (hex) of the text, UTF-8.", 1, 1, (t) => generateMD5(utf8(S(t))));
def("Hash & Crypto", "SHA1(text)", "SHA-1 hash (hex).", 1, 1, (t) => digest("SHA-1", S(t)));
def("Hash & Crypto", "SHA256(text)", "SHA-256 hash (hex).", 1, 1, (t) => digest("SHA-256", S(t)));
def("Hash & Crypto", "SHA384(text)", "SHA-384 hash (hex).", 1, 1, (t) => digest("SHA-384", S(t)));
def("Hash & Crypto", "SHA512(text)", "SHA-512 hash (hex).", 1, 1, (t) => digest("SHA-512", S(t)));
def("Hash & Crypto", "HMACSHA256(text, key)", "HMAC-SHA256 (hex) of text with the given key.", 2, 2, (t, k) => hmac("SHA-256", S(t), S(k)));
def("Hash & Crypto", "ENCRYPT(text, key1, key2)", "Same as Cipher › Encrypt. Result is cached so it stays stable between recalculations.", 3, 3,
  (t, k1, k2) => { const a = [S(t), S(k1), S(k2)]; return heavy("ENCRYPT", a, () => cipherTransform(a[0], a[1], a[2], "encrypt")); });
def("Hash & Crypto", "DECRYPT(text, key1, key2)", "Same as Cipher › Decrypt. Wrong keys give a random 27-char string, like the Cipher tool.", 3, 3,
  (t, k1, k2) => { const a = [S(t), S(k1), S(k2)]; return heavy("DECRYPT", a, () => cipherTransform(a[0], a[1], a[2], "decrypt")); });

/* Encoding */
def("Encoding", "BASE64ENCODE(text)", "Base64 of the UTF-8 text.", 1, 1, (t) => b64enc(S(t)));
def("Encoding", "BASE64DECODE(text)", "Decode Base64 / Base64URL to text.", 1, 1, (t) => b64dec(S(t)));
def("Encoding", "URLENCODE(text)", "Percent-encode (encodeURIComponent).", 1, 1, (t) => encodeURIComponent(S(t)));
def("Encoding", "URLDECODE(text)", "Percent-decode.", 1, 1, (t) => { try { return decodeURIComponent(S(t)); } catch (e) { throw new FormulaError("#VALUE!"); } });
def("Encoding", "HEXENCODE(text)", "UTF-8 bytes as hex.", 1, 1, (t) => hex(enc.encode(S(t))));
def("Encoding", "HEXDECODE(hex)", "Hex bytes back to UTF-8 text.", 1, 1, (t) => {
  const h = S(t).replace(/\s+/g, "");
  if (h.length % 2 || /[^0-9a-fA-F]/.test(h)) throw new FormulaError("#VALUE!", "invalid hex");
  const a = new Uint8Array(h.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16);
  return dec.decode(a);
});
def("Encoding", "ROT13(text)", "ROT13 letter substitution.", 1, 1, (t) => S(t).replace(/[a-z]/gi, (c) => { const b = c <= "Z" ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); }));
def("Encoding", "CODE(text)", "Unicode code point of the first character.", 1, 1, (t) => { const s = S(t); if (!s) throw new FormulaError("#VALUE!"); return s.codePointAt(0); });
def("Encoding", "CHAR(number)", "Character for a Unicode code point.", 1, 1, (n) => { try { return String.fromCodePoint(N(n)); } catch (e) { throw new FormulaError("#VALUE!"); } });

/* Text Case */
def("Text Case", "UPPER(text)", "UPPERCASE.", 1, 1, (t) => S(t).toUpperCase());
def("Text Case", "LOWER(text)", "lowercase.", 1, 1, (t) => S(t).toLowerCase());
def("Text Case", "PROPER(text)", "Capitalise Words (same as the sidebar tool).", 1, 1, (t) => S(t).replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
def("Text Case", "SENTENCE(text)", "Capitalise Sentences (same as the sidebar tool).", 1, 1, (t) => S(t).toLowerCase().replace(/(^\s*[a-z])|([.!?]\s*[a-z])/g, (m) => m.toUpperCase()));
def("Text Case", "SWAPCASE(text)", "Swap upper/lower case.", 1, 1, (t) => S(t).replace(/[a-z]|[A-Z]/g, (c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())));
def("Text Case", "CAMELCASE(text)", "camelCase.", 1, 1, (t) => words(S(t)).map((w, i) => (i ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(""));
def("Text Case", "PASCALCASE(text)", "PascalCase.", 1, 1, (t) => words(S(t)).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(""));
def("Text Case", "SNAKECASE(text)", "snake_case.", 1, 1, (t) => words(S(t)).map((w) => w.toLowerCase()).join("_"));
def("Text Case", "KEBABCASE(text)", "kebab-case.", 1, 1, (t) => words(S(t)).map((w) => w.toLowerCase()).join("-"));
def("Text Case", "SLUGIFY(text)", "URL slug (accents removed).", 1, 1, (t) => S(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
def("Text Case", "REVERSE(text)", "Reverse all characters.", 1, 1, (t) => Array.from(S(t)).reverse().join(""));
def("Text Case", "REVERSEWORDS(text)", "Reverse the order of words.", 1, 1, (t) => S(t).split(/\s+/).reverse().join(" "));

/* Text Edit */
def("Text Edit", "TRIM(text)", "Trim ends and collapse inner whitespace to single spaces.", 1, 1, (t) => S(t).replace(/\s+/g, " ").trim());
def("Text Edit", "CLEAN(text)", "Remove control / non-printing characters.", 1, 1, (t) => S(t).replace(/[\u0000-\u001f\u007f]/g, ""));
def("Text Edit", "CONCAT(a, b, ...)", "Join values (ranges are flattened).", 1, Infinity, (...a) => a.flatMap((x) => (isRange(x) ? x.flat() : [x])).map(S).join(""));
def("Text Edit", "CONCATENATE(a, b, ...)", "Join values.", 1, Infinity, (...a) => a.flatMap((x) => (isRange(x) ? x.flat() : [x])).map(S).join(""));
def("Text Edit", "TEXTJOIN(delimiter, skip_empty, a, ...)", "Join with a delimiter.", 3, Infinity, (d, skip, ...a) => {
  let v = a.flatMap((x) => (isRange(x) ? x.flat() : [x])).map(S);
  if (toBool(skip)) v = v.filter((x) => x !== "");
  return v.join(S(d));
});
def("Text Edit", "SUBSTITUTE(text, old, new, [n])", "Replace text; optional n replaces only the nth match.", 3, 4, (t, o, n, k) => {
  t = S(t); o = S(o); n = S(n);
  if (o === "") return t;
  if (k === undefined) return t.split(o).join(n);
  const want = N(k); let i = -1, c = 0, pos = 0;
  while ((i = t.indexOf(o, pos)) !== -1) { c++; if (c === want) return t.slice(0, i) + n + t.slice(i + o.length); pos = i + o.length; }
  return t;
});
def("Text Edit", "REPLACE(text, start, length, new)", "Replace part of the text by position (1-based).", 4, 4, (t, s, l, n) => { t = S(t); const a = N(s) - 1; return t.slice(0, a) + S(n) + t.slice(a + N(l)); });
def("Text Edit", "REPT(text, times)", "Repeat text.", 2, 2, (t, n) => { const k = N(n); if (k < 0 || k > 10000) throw new FormulaError("#VALUE!"); return S(t).repeat(k); });
def("Text Edit", "LPAD(text, length, [pad])", "Left-pad to a length (default pad: space).", 2, 3, (t, l, p) => S(t).padStart(N(l), p === undefined ? " " : S(p)));
def("Text Edit", "RPAD(text, length, [pad])", "Right-pad to a length (default pad: space).", 2, 3, (t, l, p) => S(t).padEnd(N(l), p === undefined ? " " : S(p)));
/* ── ports of sidebar-2 › Operations tools (same rules as the modal dialogs) ── */
const CLEANUP_STYLES = ["remove_linebreaks", "remove_parabreaks", "remove_both", "whitespace_cleanup", "trim_columns", "tidy_lines"];
export function cleanupText(text, style, trimNumber, trimSide) {
  if (style === "remove_linebreaks") return text.replace(/\r\n|\r|\n/g, " ");
  if (style === "remove_parabreaks") return text.replace(/\n{3,}/g, "\n\n");
  if (style === "remove_both") return text.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
  if (style === "whitespace_cleanup") return text.replace(/\t+/g, " ").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
  if (style === "trim_columns") {
    const n = parseInt(trimNumber, 10) || 0;
    return text.split("\n").map((l) => (n <= 0 ? l : trimSide === "right" ? l.slice(0, -n) : trimSide === "left" ? l.slice(n) : l)).join("\n");
  }
  if (style === "tidy_lines") return text.split("\n").map((l) => l.trim()).join("\n");
  throw new FormulaError("#VALUE!", "style must be one of: " + CLEANUP_STYLES.join(", "));
}
def("Text Edit", "CLEANUP(text, style, [n], [side])", "Cleanup Text. style: remove_linebreaks | remove_parabreaks | remove_both | whitespace_cleanup | trim_columns | tidy_lines. trim_columns uses n and side (left/right).", 2, 4,
  (t, st, n, sd) => cleanupText(S(t), S(st).trim().toLowerCase(), n === undefined ? "1" : S(n), sd === undefined ? "left" : S(sd).trim().toLowerCase()));
def("Text Edit", "ADDTEXT(text, insert, [position], [column])", "Add Text to Lines. position: start (default) | end | column. In insert, %L = line number, %N = new line.", 2, 4, (t, ins, pos, col) => {
  const position = pos === undefined ? "start" : S(pos).trim().toLowerCase();
  if (!["start", "end", "column"].includes(position)) throw new FormulaError("#VALUE!", "position must be start, end or column");
  const c = parseInt(col === undefined ? "1" : S(col), 10) || 1;
  const lines = S(t).split("\n"); let out = "";
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const rep = S(ins).replace(/%L/g, String(i + 1)).replace(/%N/g, "\n");
    if (position === "start") line = rep + line;
    else if (position === "end") line = line + rep;
    else { const idx = Math.max(0, c - 1); if (line.length < idx) line = line.padEnd(idx, " "); line = line.slice(0, idx) + rep + line.slice(idx); }
    out += line + (i < lines.length - 1 ? "\n" : "");
  }
  return out;
});
export function findPairs(text, startDelim, endDelim) {
  const pairs = [];
  if (!startDelim || !endDelim) return pairs;
  const sLen = startDelim.length, eLen = endDelim.length, stack = [];
  let i = 0;
  while (i < text.length) {
    if (text.substr(i, sLen) === startDelim) { stack.push(i); i += sLen; continue; }
    if (text.substr(i, eLen) === endDelim) { if (stack.length > 0) pairs.push({ startIndex: stack.pop(), endIndex: i + eLen }); i += eLen; continue; }
    i++;
  }
  return pairs.sort((a, b) => a.startIndex - b.startIndex);
}
export function patternReplace(text, startDelim, endDelim, replaceText, includeDelims, from, to) {
  if (!startDelim) throw new FormulaError("#VALUE!", "start delimiter required");
  if (!endDelim) throw new FormulaError("#VALUE!", "end delimiter required");
  const pairs = findPairs(text, startDelim, endDelim);
  if (!pairs.length) return text;
  let f = 1, t = pairs.length;
  if (from !== undefined && from !== "") {
    const a = parseInt(from, 10); if (isNaN(a) || a < 1) throw new FormulaError("#VALUE!", "invalid instance number");
    if (to === undefined || to === "") f = t = Math.min(Math.max(a, 1), pairs.length);
    else { const b = parseInt(to, 10); if (isNaN(b)) throw new FormulaError("#VALUE!", "invalid range"); f = Math.min(Math.max(a, 1), pairs.length); t = Math.min(Math.max(b, f), pairs.length); }
  }
  let out = text;
  for (let i = pairs.length - 1; i >= 0; i--) {
    if (i + 1 < f || i + 1 > t) continue;
    out = out.slice(0, pairs[i].startIndex) + (includeDelims ? replaceText : startDelim + replaceText + endDelim) + out.slice(pairs[i].endIndex);
  }
  return out;
}
def("Text Edit", "PATTERNREPLACE(text, start, end, replacement, [include_delims], [from], [to])", "Replace Between Delimiters. include_delims TRUE replaces the delimiters too. Omit from/to = all pairs; from only = that pair; from+to = range.", 4, 7,
  (t, a, b, r, inc, f, to) => patternReplace(S(t), S(a), S(b), S(r), inc === undefined || inc === "" ? false : toBool(inc), f === undefined ? undefined : S(f), to === undefined ? undefined : S(to)));
export function findReplace(text, query, replacement, caseSensitive, isRegex) {
  if (!query) return text;
  let re;
  try { re = new RegExp(isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g" + (caseSensitive ? "" : "i")); } catch (e) { throw new FormulaError("#VALUE!", "bad regex"); }
  let out = "", last = 0, m;
  while ((m = re.exec(text)) !== null) {
    let rep = replacement;
    if (isRegex) { try { rep = m[0].replace(new RegExp(query, caseSensitive ? "g" : "gi"), replacement); } catch (e) {} }
    out += text.slice(last, m.index) + rep; last = m.index + m[0].length;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out + text.slice(last);
}
def("Text Edit", "FINDREPLACE(text, find, replace, [match_case], [regex])", "Find and Replace (all matches). Case-insensitive unless match_case is TRUE; regex TRUE treats find as a regular expression.", 3, 5,
  (t, f, r, mc, rg) => findReplace(S(t), S(f), S(r), mc === undefined || mc === "" ? false : toBool(mc), rg === undefined || rg === "" ? false : toBool(rg)));
def("Text Edit", "NUMBERFORMAT(number, decimals)", "Fixed decimals with thousands separators.", 2, 2, (n, d) => N(n).toLocaleString("en-US", { minimumFractionDigits: N(d), maximumFractionDigits: N(d) }));

/* Text Search & Extract */
def("Text Search & Extract", "LEN(text)", "Number of characters.", 1, 1, (t) => Array.from(S(t)).length);
def("Text Search & Extract", "LEFT(text, [n])", "First n characters (default 1).", 1, 2, (t, n) => Array.from(S(t)).slice(0, n === undefined ? 1 : N(n)).join(""));
def("Text Search & Extract", "RIGHT(text, [n])", "Last n characters (default 1).", 1, 2, (t, n) => { const a = Array.from(S(t)); const k = n === undefined ? 1 : N(n); return k <= 0 ? "" : a.slice(-k).join(""); });
def("Text Search & Extract", "MID(text, start, length)", "Substring from a 1-based start.", 3, 3, (t, s, l) => Array.from(S(t)).slice(N(s) - 1, N(s) - 1 + N(l)).join(""));
def("Text Search & Extract", "FIND(find, within, [start])", "Case-sensitive position (1-based).", 2, 3, (f, t, s) => { const i = S(t).indexOf(S(f), s === undefined ? 0 : N(s) - 1); if (i < 0) throw new FormulaError("#VALUE!"); return i + 1; });
def("Text Search & Extract", "SEARCH(find, within, [start])", "Case-insensitive position (1-based).", 2, 3, (f, t, s) => { const i = S(t).toLowerCase().indexOf(S(f).toLowerCase(), s === undefined ? 0 : N(s) - 1); if (i < 0) throw new FormulaError("#VALUE!"); return i + 1; });
def("Text Search & Extract", "EXACT(a, b)", "TRUE if identical (case-sensitive).", 2, 2, (a, b) => S(a) === S(b));
def("Text Search & Extract", "SPLITPART(text, delimiter, n)", "The nth piece (1-based) after splitting.", 3, 3, (t, d, n) => { const p = S(t).split(S(d)); const k = N(n); return k >= 1 && k <= p.length ? p[k - 1] : ""; });
def("Text Search & Extract", "TEXTBEFORE(text, delimiter)", "Text before the first delimiter.", 2, 2, (t, d) => { t = S(t); const i = t.indexOf(S(d)); if (i < 0) throw new FormulaError("#N/A"); return t.slice(0, i); });
def("Text Search & Extract", "TEXTAFTER(text, delimiter)", "Text after the first delimiter.", 2, 2, (t, d) => { t = S(t); d = S(d); const i = t.indexOf(d); if (i < 0) throw new FormulaError("#N/A"); return t.slice(i + d.length); });
def("Text Search & Extract", "CONTAINS(text, find)", "TRUE if text contains find (case-insensitive).", 2, 2, (t, f) => S(t).toLowerCase().includes(S(f).toLowerCase()));
def("Text Search & Extract", "STARTSWITH(text, prefix)", "TRUE if text starts with prefix.", 2, 2, (t, p) => S(t).startsWith(S(p)));
def("Text Search & Extract", "ENDSWITH(text, suffix)", "TRUE if text ends with suffix.", 2, 2, (t, p) => S(t).endsWith(S(p)));
def("Text Search & Extract", "WORDCOUNT(text)", "Number of words.", 1, 1, (t) => S(t).trim().split(/\s+/).filter(Boolean).length);

/* Code & Markup */
def("Code & Markup", "REMOVEHTML(html)", "HTML to plain text (same engine as Code › Remove HTML).", 1, 1, async (t) => {
  t = S(t);
  if (typeof DOMParser === "undefined") return t.replace(/<[^>]*>/g, "");
  const mod = await import("../../../components/sidebar2/functions/3code/html.js");
  return mod.htmlToPlainText(t);
});
def("Code & Markup", "ESCAPEHTML(text)", "Escape &, <, >, quotes.", 1, 1, async (t) => {
  t = S(t);
  try { const mod = await import("../../../components/sidebar2/functions/3code/html.js"); return mod.escapeHtmlText(t); }
  catch (e) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
});
def("Code & Markup", "UNESCAPEHTML(text)", "Unescape HTML entities.", 1, 1, async (t) => {
  t = S(t);
  try { const mod = await import("../../../components/sidebar2/functions/3code/html.js"); return mod.unescapeHtmlText(t); }
  catch (e) { return t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"); }
});

def("Code & Markup", "INDENT(text)", "Increase Indentation: a tab before every line.", 1, 1, (t) => "\t" + S(t).replace(/\n/g, "\n\t"));
def("Code & Markup", "OUTDENT(text)", "Decrease Indentation: removes a leading tab (or 4 characters when a line starts with a space).", 1, 1,
  (t) => S(t).split("\n").map((e) => (e.startsWith("\t") ? e.slice(1) : e.startsWith(" ") ? e.slice(4) : e)).join("\n"));
def("Code & Markup", "BULLETLIST(text, [format])", "Bullet List of the lines. format: markdown (default, \"- item\") or markup (<ul><li>).", 1, 2, (t, f) => {
  const lines = S(t).split(/\r?\n/), mu = f !== undefined && S(f).trim().toLowerCase() === "markup";
  return mu ? "<ul>\n" + lines.map((x) => "<li>" + x + "</li>").join("\n") + "\n</ul>" : lines.map((x) => "- " + x).join("\n");
});
def("Code & Markup", "NUMBEREDLIST(text, [format])", "Numbered List of the lines. format: markdown (default, \"1. item\") or markup (<ol><li>).", 1, 2, (t, f) => {
  const lines = S(t).split(/\r?\n/), mu = f !== undefined && S(f).trim().toLowerCase() === "markup";
  return mu ? "<ol>\n" + lines.map((x) => "<li>" + x + "</li>").join("\n") + "\n</ol>" : lines.map((x, i) => i + 1 + ". " + x).join("\n");
});
def("Code & Markup", "LINK(text, url, [format])", "Insert Link. format: markdown (default) or markup.", 2, 3, (t, u, f) =>
  (f !== undefined && S(f).trim().toLowerCase() === "markup" ? `<a href="${S(u)}">${S(t)}</a>` : `[${S(t)}](${S(u)})`));
def("Code & Markup", "IMAGE(url, [format])", "Insert Image. format: markdown (default) or markup.", 1, 2, (u, f) =>
  (f !== undefined && S(f).trim().toLowerCase() === "markup" ? `<img src="${S(u)}" alt="Image" />` : `![Image](${S(u)})`));
def("Code & Markup", "OPTIMISECSS(css)", "Optimise CSS (same engine as the sidebar tool).", 1, 1, async (t) => {
  const m = await import("../../../components/sidebar2/functions/3code/css.js");
  try { return m.optimiseCssText(S(t)); } catch (e) { throw new FormulaError("#VALUE!", "CSS optimisation failed"); }
});
def("Code & Markup", "MINIFYCSS(css)", "Minify CSS.", 1, 1, async (t) => (await import("../../../components/sidebar2/functions/3code/css.js")).minifyCssText(S(t)));
def("Code & Markup", "OPTIMISEJS(js)", "Optimise JS: remove comments and compact blank lines.", 1, 1, async (t) => {
  const m = await import("../../../components/sidebar2/functions/3code/js.js");
  try { return m.compact(m.removeComments(S(t))); } catch (e) { throw new FormulaError("#VALUE!", "JS optimisation failed"); }
});
def("Code & Markup", "MINIFYJS(js)", "Minify JS (same rules as the sidebar tool).", 1, 1, async (t) => {
  const m = await import("../../../components/sidebar2/functions/3code/js.js");
  try { return m.removeComments(S(t)).replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+/g, " ").replace(/^ | $/g, "")).filter((l) => l !== "").join("\n"); }
  catch (e) { throw new FormulaError("#VALUE!", "JS minify failed"); }
});

/* Regex */
const rx = (p, f) => { try { return new RegExp(S(p), f === undefined ? "" : S(f)); } catch (e) { throw new FormulaError("#VALUE!", "bad regex"); } };
def("Regex", "REGEXREPLACE(text, pattern, replacement, [flags])", "Regex replace. Flags e.g. \"gi\" (default: replace all = \"g\").", 3, 4, (t, p, r, f) => S(t).replace(rx(p, f === undefined ? "g" : f), S(r)));
def("Regex", "REGEXEXTRACT(text, pattern, [group])", "First regex match (or capture group).", 2, 3, (t, p, g) => { const m = S(t).match(rx(p)); if (!m) throw new FormulaError("#N/A"); return m[g === undefined ? 0 : N(g)] ?? ""; });
def("Regex", "REGEXMATCH(text, pattern, [flags])", "TRUE if the pattern matches.", 2, 3, (t, p, f) => rx(p, f).test(S(t)));

/* Logic */
def("Logic", "IF(test, then, [else])", "Returns one value or another.", 2, 3, async (c, a, b) => (toBool(await c()) ? await a() : (b ? await b() : false)), { lazy: true });
def("Logic", "IFERROR(value, fallback)", "Fallback when value is an error.", 2, 2, async (v, f) => { try { return await v(); } catch (e) { if (e instanceof FormulaError) return await f(); throw e; } }, { lazy: true });
def("Logic", "AND(a, b, ...)", "TRUE if all are TRUE.", 1, Infinity, (...a) => a.flatMap((x) => (isRange(x) ? x.flat() : [x])).every(toBool));
def("Logic", "OR(a, b, ...)", "TRUE if any is TRUE.", 1, Infinity, (...a) => a.flatMap((x) => (isRange(x) ? x.flat() : [x])).some(toBool));
def("Logic", "NOT(a)", "Negate.", 1, 1, (a) => !toBool(a));
def("Logic", "TRUE()", "TRUE.", 0, 0, () => true);
def("Logic", "FALSE()", "FALSE.", 0, 0, () => false);

/* Math */
const nums = (a) => a.flatMap((x) => (isRange(x) ? x.flat().filter(isNumeric) : [x])).map(N);
def("Math", "SUM(a, b, ...)", "Sum (ranges ignore text).", 1, Infinity, (...a) => nums(a).reduce((s, x) => s + x, 0));
def("Math", "AVERAGE(a, b, ...)", "Mean.", 1, Infinity, (...a) => { const n = nums(a); if (!n.length) throw new FormulaError("#DIV/0!"); return n.reduce((s, x) => s + x, 0) / n.length; });
def("Math", "MIN(a, b, ...)", "Smallest.", 1, Infinity, (...a) => { const n = nums(a); return n.length ? Math.min(...n) : 0; });
def("Math", "MAX(a, b, ...)", "Largest.", 1, Infinity, (...a) => { const n = nums(a); return n.length ? Math.max(...n) : 0; });
def("Math", "COUNT(a, b, ...)", "Count of numeric values.", 1, Infinity, (...a) => a.flatMap((x) => (isRange(x) ? x.flat() : [x])).filter(isNumeric).length);
def("Math", "COUNTA(a, b, ...)", "Count of non-empty values.", 1, Infinity, (...a) => a.flatMap((x) => (isRange(x) ? x.flat() : [x])).filter((v) => v !== "" && v != null).length);
def("Math", "ROUND(number, [digits])", "Round.", 1, 2, (n, d) => { const k = 10 ** (d === undefined ? 0 : N(d)); return Math.round((N(n) + Number.EPSILON) * k) / k; });
def("Math", "ABS(number)", "Absolute value.", 1, 1, (n) => Math.abs(N(n)));
def("Math", "INT(number)", "Round down to integer.", 1, 1, (n) => Math.floor(N(n)));
def("Math", "MOD(number, divisor)", "Remainder (sign of divisor).", 2, 2, (n, d) => { const x = N(n), y = N(d); if (y === 0) throw new FormulaError("#DIV/0!"); return x - y * Math.floor(x / y); });
def("Math", "POWER(base, exp)", "Exponent.", 2, 2, (a, b) => N(a) ** N(b));
def("Math", "VALUE(text)", "Text to number.", 1, 1, (t) => N(t));

/* Info */
def("Info", "ISBLANK(value)", "TRUE if empty.", 1, 1, (v) => v === "" || v == null);
def("Info", "ISNUMBER(value)", "TRUE if numeric.", 1, 1, (v) => isNumeric(v));
def("Info", "ISTEXT(value)", "TRUE if non-numeric text.", 1, 1, (v) => !isNumeric(v) && typeof v !== "boolean" && v !== "");
def("Info", "ROW([ref])", "Row number of the formula cell.", 0, 1, function () { return this && this.row != null ? this.row + 1 : 1; }, { ctx: true });
def("Info", "COLUMN([ref])", "Column number of the formula cell.", 0, 1, function () { return this && this.col != null ? this.col + 1 : 1; }, { ctx: true });
def("Info", "T(value)", "Text value, or empty if not text.", 1, 1, (v) => (typeof v === "string" ? v : ""));
def("Info", "N(value)", "Numeric value, 0 if not numeric.", 1, 1, (v) => (isNumeric(v) ? Number(v) : 0));

export const FUNCS = new Map(F.map((f) => [f.name, f]));
for (const [base, list] of Object.entries(ALIASES)) { const f = FUNCS.get(base); if (f) list.forEach((a) => FUNCS.set(a, f)); }
export const FUNCTION_LIST = F;
