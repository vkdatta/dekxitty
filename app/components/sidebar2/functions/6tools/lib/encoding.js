// Base32, Base58, CBOR, hex dump, HTML entities and URL helpers.
import { toHex, toBase64 } from "./bytes.js";

export const BASE32_ALPHABETS = { "RFC 4648": "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", "Base32hex": "0123456789ABCDEFGHIJKLMNOPQRSTUV", "Crockford": "0123456789ABCDEFGHJKMNPQRSTVWXYZ", "z-base-32": "ybndrfg8ejkmcpqxot1uwisza345h769" };
export function base32Encode(b, variant = "RFC 4648", padding = true) {
  const a = BASE32_ALPHABETS[variant];
  let bits = 0, v = 0, s = "";
  for (const x of b) { v = ((v << 8) | x) & 0xfff; bits += 8; while (bits >= 5) { bits -= 5; s += a[(v >> bits) & 31]; } }
  if (bits) s += a[(v << (5 - bits)) & 31];
  if (padding && (variant === "RFC 4648" || variant === "Base32hex")) while (s.length % 8) s += "=";
  return s;
}
export function base32Decode(str, variant = "RFC 4648") {
  const a = BASE32_ALPHABETS[variant];
  let s = String(str).replace(/[\s-]/g, "").replace(/=+$/, "");
  s = variant === "z-base-32" ? s.toLowerCase() : s.toUpperCase();
  if (variant === "Crockford") s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  if ([1, 3, 6].includes(s.length % 8)) throw new Error("Invalid Base32 length");
  const out = new Uint8Array(Math.floor((s.length * 5) / 8));
  let bits = 0, v = 0, o = 0;
  for (const c of s) {
    const i = a.indexOf(c);
    if (i < 0) throw new Error('Invalid Base32 character "' + c + '"');
    v = ((v << 5) | i) & 0xfff; bits += 5;
    if (bits >= 8) { bits -= 8; out[o++] = (v >> bits) & 255; }
  }
  return out;
}
export const BASE58_ALPHABETS = { Bitcoin: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz", Ripple: "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz", Flickr: "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ" };
function rebase(digits, from, to) {
  const out = [];
  for (let d of digits) {
    for (let i = 0; i < out.length; i++) { d += out[i] * from; out[i] = d % to; d = Math.floor(d / to); }
    while (d) { out.push(d % to); d = Math.floor(d / to); }
  }
  return out.reverse();
}
const B58_MAX = 20000;
export function base58Encode(b, variant = "Bitcoin") {
  if (b.length > B58_MAX) throw new Error("Base58 is quadratic; input is limited to " + B58_MAX + " bytes");
  const a = BASE58_ALPHABETS[variant];
  let z = 0; while (z < b.length && !b[z]) z++;
  return a[0].repeat(z) + rebase(b.subarray(z), 256, 58).map((d) => a[d]).join("");
}
export function base58Decode(str, variant = "Bitcoin") {
  const a = BASE58_ALPHABETS[variant], s = String(str).replace(/\s+/g, "");
  if (s.length > B58_MAX * 1.4) throw new Error("Base58 input is too long");
  const digits = Array.from(s, (c) => { const i = a.indexOf(c); if (i < 0) throw new Error('Invalid Base58 character "' + c + '"'); return i; });
  let z = 0; while (z < digits.length && !digits[z]) z++;
  const body = rebase(digits.slice(z), 58, 256), out = new Uint8Array(z + body.length);
  out.set(body, z);
  return out;
}
export function hexDump(b, width = 16) {
  if (b.length > 1 << 20) throw new Error("Hex dump is limited to 1 MB");
  const lines = [];
  for (let o = 0; o < b.length; o += width) {
    const row = Array.from(b.subarray(o, o + width));
    const hex = row.map((x) => x.toString(16).padStart(2, "0"));
    if (width > 8 && hex.length > width / 2) hex.splice(width / 2, 0, "");
    lines.push(o.toString(16).padStart(8, "0") + "  " + hex.join(" ").padEnd(width * 3 + (width > 8 ? 0 : -1)) + "  |" + row.map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : ".")).join("") + "|");
  }
  return lines.join("\n");
}

// ── CBOR (RFC 8949) ↔ JSON ──────────────────────────────────────────────────
export function cborEncode(value) {
  const out = [];
  const head = (major, n) => {
    const big = BigInt(n), m = major << 5;
    if (big < 24n) return out.push(m | Number(big));
    const size = big < 256n ? 1 : big < 65536n ? 2 : big < 4294967296n ? 4 : 8;
    out.push(m | (24 + Math.log2(size)));
    for (let i = size - 1; i >= 0; i--) out.push(Number((big >> BigInt(8 * i)) & 255n));
  };
  const walk = (v, depth) => {
    if (depth > 256) throw new Error("Value is nested too deeply");
    if (v === null) out.push(0xf6);
    else if (typeof v === "boolean") out.push(v ? 0xf5 : 0xf4);
    else if (typeof v === "number") {
      if (Number.isSafeInteger(v) && !Object.is(v, -0)) head(v < 0 ? 1 : 0, v < 0 ? -1 - v : v);
      else { const b = new Uint8Array(8), dv = new DataView(b.buffer); dv.setFloat32(0, v); if (Object.is(dv.getFloat32(0), v)) out.push(0xfa, ...b.subarray(0, 4)); else { dv.setFloat64(0, v); out.push(0xfb, ...b); } }
    } else if (typeof v === "string") { const b = new TextEncoder().encode(v); head(3, b.length); for (const x of b) out.push(x); }
    else if (Array.isArray(v)) { head(4, v.length); v.forEach((x) => walk(x, depth + 1)); }
    else { const k = Object.keys(v); head(5, k.length); k.forEach((x) => { walk(x, depth + 1); walk(v[x], depth + 1); }); }
  };
  walk(value, 0);
  return Uint8Array.from(out);
}
/** Returns a JSON-friendly value; byte strings become "h'..'" and tags {"@tag":n,"value":…}. */
export function cborDecode(b) {
  let o = 0;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const need = (n) => { if (o + n > b.length) throw new Error("CBOR data ends unexpectedly"); };
  const BREAK = Symbol();
  const read = (depth) => {
    if (depth > 256) throw new Error("CBOR is nested too deeply");
    need(1);
    const ib = b[o++], major = ib >> 5, ai = ib & 31;
    if (major === 7) {
      if (ai === 20) return false; if (ai === 21) return true; if (ai === 22) return null; if (ai === 23) return "undefined";
      if (ai === 25) { need(2); const h = dv.getUint16(o); o += 2; const e = (h >> 10) & 31, f = h & 1023, sg = h & 0x8000 ? -1 : 1; return sg * (e === 0 ? f * 2 ** -24 : e === 31 ? (f ? NaN : Infinity) : (f + 1024) * 2 ** (e - 25)); }
      if (ai === 26) { need(4); o += 4; return dv.getFloat32(o - 4); }
      if (ai === 27) { need(8); o += 8; return dv.getFloat64(o - 8); }
      if (ai === 31) return BREAK;
      if (ai < 24) return "simple(" + ai + ")";
      if (ai === 24) { need(1); return "simple(" + b[o++] + ")"; }
      throw new Error("Invalid CBOR");
    }
    let n = ai;
    if (ai >= 24 && ai <= 27) { const size = 1 << (ai - 24); need(size); let v = 0n; for (let i = 0; i < size; i++) v = (v << 8n) | BigInt(b[o++]); n = v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v; }
    else if (ai > 27 && ai !== 31) throw new Error("Invalid CBOR");
    const indef = ai === 31;
    if (indef && (major < 2 || major === 6)) throw new Error("Invalid CBOR");
    if (major === 0) return typeof n === "bigint" ? n.toString() : n;
    if (major === 1) return typeof n === "bigint" ? (-1n - n).toString() : -1 - n;
    const item = () => { const x = read(depth + 1); if (x === BREAK) throw new Error("Unexpected CBOR break"); return x; };
    if (major === 2 || major === 3) {
      if (indef) { let s = ""; for (;;) { const x = read(depth + 1); if (x === BREAK) break; s += major === 2 ? x.slice(2, -1) : x; } return major === 2 ? "h'" + s + "'" : s; }
      need(Number(n)); const part = b.subarray(o, (o += Number(n)));
      return major === 2 ? "h'" + toHex(part) + "'" : new TextDecoder().decode(part);
    }
    if (major === 4) { const a = []; if (indef) for (;;) { const x = read(depth + 1); if (x === BREAK) break; a.push(x); } else for (let i = 0; i < n; i++) a.push(item()); return a; }
    if (major === 5) {
      const entries = [];
      const pair = (k) => entries.push([typeof k === "string" ? k : JSON.stringify(k), item()]);
      if (indef) for (;;) { const k = read(depth + 1); if (k === BREAK) break; pair(k); } else for (let i = 0; i < n; i++) pair(item());
      return Object.fromEntries(entries);
    }
    return { "@tag": Number(n), value: item() };
  };
  const result = read(0);
  if (result === BREAK) throw new Error("Unexpected CBOR break");
  if (o !== b.length) throw new Error((b.length - o) + " extra bytes after the CBOR item");
  return result;
}

export function htmlEncode(s, all = false) {
  const named = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return all ? s.replace(/[&<>"']|[^\x00-\x7f]/gu, (c) => named[c] || "&#x" + c.codePointAt(0).toString(16) + ";") : s.replace(/[&<>"']/g, (c) => named[c]);
}
/** Uses the browser's own entity table (all named entities), never executes markup. */
export function htmlDecode(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body[0] === "#") { const hex = body[1] === "x" || body[1] === "X", n = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10); return n <= 0x10ffff ? String.fromCodePoint(n) : m; }
    if (typeof DOMParser === "undefined") return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" }[body] ?? m;
    return new DOMParser().parseFromString("<!doctype html><body>" + m, "text/html").body.textContent;
  });
}
export function urlEncode(s, mode) {
  if (mode === "full") return encodeURI(s);
  const r = encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return mode === "form" ? r.replace(/%20/g, "+") : r;
}
export function urlDecode(s, plus) {
  try { return decodeURIComponent(plus ? s.replace(/\+/g, " ") : s); } catch (e) { throw new Error("Invalid percent-encoding"); }
}
export function urlParse(s) {
  let u;
  try { u = new URL(s.trim()); } catch (e) { throw new Error("Not a valid absolute URL (include the scheme, e.g. https://)"); }
  const query = {};
  for (const [k, v] of u.searchParams) { if (Object.prototype.hasOwnProperty.call(query, k)) query[k] = [].concat(query[k], v); else Object.defineProperty(query, k, { value: v, enumerable: true, writable: true, configurable: true }); }
  return { href: u.href, protocol: u.protocol, origin: u.origin, username: u.username, password: u.password, hostname: u.hostname, port: u.port, pathname: u.pathname, search: u.search, hash: u.hash, query };
}
export { toBase64 };
