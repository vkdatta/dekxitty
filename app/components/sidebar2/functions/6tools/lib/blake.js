// BLAKE2b / BLAKE2s (RFC 7693) and BLAKE3.
import { utf8 } from "./bytes.js";

const SIGMA = [
  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],[14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],[11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4],
  [7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],[9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13],[2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9],
  [12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11],[13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],[6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5],
  [10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0]];
const IV32 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const IV64 = [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n, 0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n];
const M64 = (1n << 64n) - 1n;
const LANES = [[0,4,8,12],[1,5,9,13],[2,6,10,14],[3,7,11,15],[0,5,10,15],[1,6,11,12],[2,7,8,13],[3,4,9,14]];
const EMPTY = new Uint8Array(0);

function blake2(data, wide, outLen, key = EMPTY) {
  const max = wide ? 64 : 32, bs = wide ? 128 : 64;
  if (outLen < 1 || outLen > max) throw new Error("Output length must be 1–" + max + " bytes");
  if (key.length > max) throw new Error("Key must be at most " + max + " bytes");
  let input = data;
  if (key.length) { input = new Uint8Array(bs + data.length); input.set(key); input.set(data, bs); }
  const IV = wide ? IV64 : IV32, h = IV.slice();
  const param = 0x01010000 ^ (key.length << 8) ^ outLen;
  h[0] = wide ? h[0] ^ BigInt(param) : h[0] ^ param;
  const rot = wide ? (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64 : (x, n) => ((x >>> n) | (x << (32 - n))) | 0;
  const add = wide ? (a, b, c) => (a + b + c) & M64 : (a, b, c) => (a + b + c) | 0;
  const R = wide ? [32, 24, 16, 63] : [16, 12, 8, 7], ZERO = wide ? 0n : 0;
  const blocks = Math.max(1, Math.ceil(input.length / bs)), buf = new Uint8Array(bs), dv = new DataView(buf.buffer);
  for (let i = 0; i < blocks; i++) {
    const last = i === blocks - 1;
    buf.fill(0); buf.set(input.subarray(i * bs, (i + 1) * bs));
    const m = Array.from({ length: 16 }, (_, j) => (wide ? dv.getBigUint64(j * 8, true) : dv.getInt32(j * 4, true)));
    const t = last ? input.length : (i + 1) * bs;
    const v = h.concat(IV);
    if (wide) { v[12] ^= BigInt(t); if (last) v[14] ^= M64; }
    else { v[12] ^= t | 0; v[13] ^= (t / 4294967296) | 0; if (last) v[14] = ~v[14]; }
    for (let r = 0; r < (wide ? 12 : 10); r++) {
      const s = SIGMA[r % 10];
      LANES.forEach(([a, b, c, d], g) => {
        v[a] = add(v[a], v[b], m[s[2 * g]]); v[d] = rot(v[d] ^ v[a], R[0]);
        v[c] = add(v[c], v[d], ZERO); v[b] = rot(v[b] ^ v[c], R[1]);
        v[a] = add(v[a], v[b], m[s[2 * g + 1]]); v[d] = rot(v[d] ^ v[a], R[2]);
        v[c] = add(v[c], v[d], ZERO); v[b] = rot(v[b] ^ v[c], R[3]);
      });
    }
    for (let j = 0; j < 8; j++) h[j] ^= v[j] ^ v[j + 8];
  }
  const out = new Uint8Array(max), ov = new DataView(out.buffer);
  h.forEach((x, j) => (wide ? ov.setBigUint64(j * 8, x, true) : ov.setInt32(j * 4, x, true)));
  return out.slice(0, outLen);
}
export const blake2b = (d, outLen = 64, key) => blake2(d, true, outLen, key);
export const blake2s = (d, outLen = 32, key) => blake2(d, false, outLen, key);

// ── BLAKE3 ──────────────────────────────────────────────────────────────────
const PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1, CHUNK_END = 2, PARENT = 4, ROOT = 8, KEYED = 16, DERIVE_CTX = 32, DERIVE_MAT = 64;
function compress(cv, block, counter, len, flags) {
  const v = [...cv, ...IV32.slice(0, 4), counter >>> 0 | 0, (counter / 4294967296) | 0, len, flags].map((x) => x | 0);
  let m = block;
  const g = (a, b, c, d, x, y) => {
    v[a] = (v[a] + v[b] + x) | 0; let t = v[d] ^ v[a]; v[d] = (t >>> 16) | (t << 16);
    v[c] = (v[c] + v[d]) | 0; t = v[b] ^ v[c]; v[b] = (t >>> 12) | (t << 20);
    v[a] = (v[a] + v[b] + y) | 0; t = v[d] ^ v[a]; v[d] = (t >>> 8) | (t << 24);
    v[c] = (v[c] + v[d]) | 0; t = v[b] ^ v[c]; v[b] = (t >>> 7) | (t << 25);
  };
  for (let r = 0; r < 7; r++) {
    LANES.forEach(([a, b, c, d], i) => g(a, b, c, d, m[2 * i], m[2 * i + 1]));
    m = PERM.map((p) => m[p]);
  }
  for (let i = 0; i < 8; i++) { v[i] ^= v[i + 8]; v[i + 8] ^= cv[i]; }
  return v;
}
const blockWords = (b) => { const buf = new Uint8Array(64); buf.set(b); const dv = new DataView(buf.buffer); return Array.from({ length: 16 }, (_, i) => dv.getInt32(i * 4, true)); };
function chunkNode(data, key, counter, flags) {
  let cv = key;
  const n = Math.max(1, Math.ceil(data.length / 64));
  for (let i = 0; ; i++) {
    const b = data.subarray(i * 64, (i + 1) * 64);
    const f = flags | (i === 0 ? CHUNK_START : 0) | (i === n - 1 ? CHUNK_END : 0);
    const node = { cv, block: blockWords(b), counter, len: b.length, flags: f };
    if (i === n - 1) return node;
    cv = compress(cv, node.block, counter, 64, f).slice(0, 8);
  }
}
const chain = (n) => compress(n.cv, n.block, n.counter, n.len, n.flags).slice(0, 8);
function tree(data, key, counter, flags) {
  if (data.length <= 1024) return chunkNode(data, key, counter, flags);
  let left = 1024;
  while (left * 2 < data.length) left *= 2;
  const l = chain(tree(data.subarray(0, left), key, counter, flags));
  const r = chain(tree(data.subarray(left), key, counter + left / 1024, flags));
  return { cv: key, block: l.concat(r), counter: 0, len: 64, flags: flags | PARENT };
}
function rootOutput(node, outLen) {
  const out = new Uint8Array(Math.ceil(outLen / 64) * 64), dv = new DataView(out.buffer);
  for (let i = 0; i * 64 < outLen; i++) compress(node.cv, node.block, i, node.len, node.flags | ROOT).forEach((w, j) => dv.setInt32(i * 64 + j * 4, w, true));
  return out.slice(0, outLen);
}
const keyWords = (k) => blockWords(k).slice(0, 8);
export function blake3(data, outLen = 32, { key, context } = {}) {
  const iv = IV32.map((x) => x | 0);
  if (context) {
    const ck = rootOutput(tree(utf8(context), iv, 0, DERIVE_CTX), 32);
    return rootOutput(tree(data, keyWords(ck), 0, DERIVE_MAT), outLen);
  }
  if (key && key.length) {
    if (key.length !== 32) throw new Error("BLAKE3 keyed mode needs a key of exactly 32 bytes");
    return rootOutput(tree(data, keyWords(key), 0, KEYED), outLen);
  }
  return rootOutput(tree(data, iv, 0, 0), outLen);
}
