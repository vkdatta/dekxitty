// UUIDs and passwords.
import { random, toHex, utf8, concat } from "./bytes.js";
import { md5, sha1 } from "./hash.js";

function fmt(b, version) {
  b[6] = (b[6] & 0x0f) | (version << 4); b[8] = (b[8] & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const NAMESPACES = { DNS: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", URL: "6ba7b811-9dad-11d1-80b4-00c04fd430c8", OID: "6ba7b812-9dad-11d1-80b4-00c04fd430c8", X500: "6ba7b814-9dad-11d1-80b4-00c04fd430c8" };
let v1Node = null, v1Clock = 0, v1Last = 0n, v7Last = 0, v7Seq = 0;
/** 100 ns ticks since 1582-10-15, strictly increasing. */
function gregorian() {
  let t = BigInt(Date.now()) * 10000n + 0x01b21dd213814000n;
  if (t <= v1Last) t = v1Last + 1n;
  v1Last = t;
  if (!v1Node) { v1Node = random(6); v1Node[0] |= 1; const c = random(2); v1Clock = (c[0] << 8) | c[1]; }
  return t.toString(16).padStart(15, "0");
}
const fromHexStr = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
export function uuid(version, { namespace, name } = {}) {
  if (version === 4) return fmt(random(16), 4);
  if (version === 3 || version === 5) {
    const ns = String(namespace || "").trim().replace(/^urn:uuid:/i, "").replace(/[{}-]/g, "");
    if (!/^[0-9a-f]{32}$/i.test(ns)) throw new Error("Namespace must be a valid UUID");
    return fmt((version === 3 ? md5 : sha1)(concat(fromHexStr(ns), utf8(name || ""))).slice(0, 16), version);
  }
  if (version === 1 || version === 6) {
    const t = gregorian(), b = new Uint8Array(16);
    const head = version === 1 ? t.slice(7) + t.slice(3, 7) + "0" + t.slice(0, 3) : t.slice(0, 12) + "0" + t.slice(12);
    b.set(fromHexStr(head)); b[8] = (v1Clock >> 8) & 255; b[9] = v1Clock & 255; b.set(v1Node, 10);
    return fmt(b, version);
  }
  if (version === 7) {
    const b = random(16);
    let now = Date.now();
    if (now <= v7Last) { now = v7Last; v7Seq++; if (v7Seq > 0xfff) { now++; v7Seq = 0; } } else v7Seq = ((b[6] & 7) << 8) | b[7];
    v7Last = now;
    for (let i = 5, t = now; i >= 0; i--) { b[i] = t % 256; t = Math.floor(t / 256); }
    b[6] = v7Seq >> 8; b[7] = v7Seq & 255;
    return fmt(b, 7);
  }
  throw new Error("Unsupported UUID version");
}
/** Unbiased integer in [0, n). */
export function randomInt(n) {
  const limit = 4294967296 - (4294967296 % n), a = new Uint32Array(1);
  do { crypto.getRandomValues(a); } while (a[0] >= limit);
  return a[0] % n;
}
export function password({ length = 16, lower = true, upper = true, digits = true, symbols = true, custom = "", excludeSimilar = false, requireEach = true }) {
  let sets = [lower && "abcdefghijklmnopqrstuvwxyz", upper && "ABCDEFGHIJKLMNOPQRSTUVWXYZ", digits && "0123456789", symbols && "!@#$%^&*()-_=+[]{};:,.?/", custom].filter(Boolean);
  if (excludeSimilar) sets = sets.map((s) => s.replace(/[Il1O0o|]/g, ""));
  sets = sets.map((s) => Array.from(new Set(s))).filter((s) => s.length);
  const all = Array.from(new Set(sets.flat()));
  if (!all.length) throw new Error("Select at least one character set");
  if (!(length >= 1 && length <= 4096)) throw new Error("Length must be 1–4096");
  if (requireEach && length < sets.length) throw new Error("Length is too short to include every selected set");
  for (;;) {
    const out = Array.from({ length }, () => all[randomInt(all.length)]);
    if (!requireEach || sets.every((s) => out.some((c) => s.includes(c)))) return { value: out.join(""), bits: Math.round(length * Math.log2(all.length)) };
  }
}
