// Byte helpers shared by every tool. Everything is Uint8Array in / Uint8Array out.
export const utf8 = (s) => new TextEncoder().encode(String(s));
export const text = (b) => new TextDecoder().decode(b);
export function textStrict(b) { try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch (e) { return null; } }
export const toHex = (b) => { let s = ""; for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16); return s; };
export function fromHex(s) {
  const h = String(s).replace(/0x/gi, "").replace(/[\s:,-]+/g, "");
  if (h.length % 2 || /[^0-9a-f]/i.test(h)) throw new Error("Invalid hex input");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
export function toBase64(b, url = false) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  const r = btoa(s);
  return url ? r.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : r;
}
export function fromBase64(s) {
  let t = String(s).replace(/^data:[^,]*,/, "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (/[^A-Za-z0-9+/]/.test(t) || t.length % 4 === 1) throw new Error("Invalid Base64 input");
  while (t.length % 4) t += "=";
  const bin = atob(t), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
export const random = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, i + 65536)); return b; };
/** Decode a user string according to an encoding chosen in a modal. */
export function decodeAs(s, enc) {
  if (enc === "hex") return fromHex(s);
  if (enc === "base64") return fromBase64(s);
  return utf8(s);
}
export function encodeAs(b, enc) {
  if (enc === "base64") return toBase64(b);
  if (enc === "base64url") return toBase64(b, true);
  if (enc === "HEX") return toHex(b).toUpperCase();
  if (enc === "text") { const t = textStrict(b); if (t === null) throw new Error("Result is not valid UTF-8 text. Choose Hex or Base64 output."); return t; }
  return toHex(b);
}
