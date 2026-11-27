// Keccak-f[1600] family: SHA-3, Keccak, SHAKE, cSHAKE, KMAC, TupleHash, ParallelHash (FIPS 202 / SP 800-185).
import { concat, utf8 } from "./bytes.js";

const RC = new Int32Array(48), ROT = new Array(25), PI = new Array(25);
(() => {
  let lfsr = 1;
  for (let r = 0; r < 24; r++) {
    let lo = 0, hi = 0;
    for (let j = 0; j < 7; j++) {
      if (lfsr & 1) { const bit = (1 << j) - 1; if (bit < 32) lo ^= 1 << bit; else hi ^= 1 << (bit - 32); }
      lfsr = lfsr & 0x80 ? ((lfsr << 1) ^ 0x71) & 255 : lfsr << 1;
    }
    RC[2 * r] = lo; RC[2 * r + 1] = hi;
  }
  ROT[0] = 0;
  let x = 1, y = 0;
  for (let t = 0; t < 24; t++) { ROT[x + 5 * y] = (((t + 1) * (t + 2)) / 2) % 64; [x, y] = [y, (2 * x + 3 * y) % 5]; }
  for (let i = 0; i < 25; i++) { const a = i % 5, b = (i / 5) | 0; PI[i] = b + 5 * ((2 * a + 3 * b) % 5); }
})();

function permute(s) {
  const C = new Int32Array(10), B = new Int32Array(50);
  for (let r = 0; r < 24; r++) {
    for (let x = 0; x < 10; x++) C[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 5; x++) {
      const a = ((x + 1) % 5) * 2, b = ((x + 4) % 5) * 2;
      const lo = C[b] ^ ((C[a] << 1) | (C[a + 1] >>> 31)), hi = C[b + 1] ^ ((C[a + 1] << 1) | (C[a] >>> 31));
      for (let y = 0; y < 50; y += 10) { s[y + 2 * x] ^= lo; s[y + 2 * x + 1] ^= hi; }
    }
    for (let i = 0; i < 25; i++) {
      let lo = s[2 * i], hi = s[2 * i + 1], n = ROT[i];
      if (n >= 32) { const t = lo; lo = hi; hi = t; n -= 32; }
      const j = PI[i] * 2;
      if (n) { B[j] = (lo << n) | (hi >>> (32 - n)); B[j + 1] = (hi << n) | (lo >>> (32 - n)); }
      else { B[j] = lo; B[j + 1] = hi; }
    }
    for (let y = 0; y < 50; y += 10) for (let x = 0; x < 10; x++) s[y + x] = B[y + x] ^ (~B[y + ((x + 2) % 10)] & B[y + ((x + 4) % 10)]);
    s[0] ^= RC[2 * r]; s[1] ^= RC[2 * r + 1];
  }
}

export function sponge(data, rate, suffix, outLen) {
  const s = new Int32Array(50);
  const absorb = (block, off) => {
    for (let i = 0; i < rate; i += 4) s[i >> 2] ^= block[off + i] | (block[off + i + 1] << 8) | (block[off + i + 2] << 16) | (block[off + i + 3] << 24);
    permute(s);
  };
  let o = 0;
  for (; o + rate <= data.length; o += rate) absorb(data, o);
  const last = new Uint8Array(rate);
  last.set(data.subarray(o));
  last[data.length - o] ^= suffix;
  last[rate - 1] ^= 0x80;
  absorb(last, 0);
  const out = new Uint8Array(outLen);
  for (let p = 0; p < outLen; ) {
    for (let i = 0; i < rate && p < outLen; i++, p++) out[p] = (s[i >> 2] >>> (8 * (i & 3))) & 255;
    if (p < outLen) permute(s);
  }
  return out;
}

export const sha3 = (data, bits) => sponge(data, 200 - bits / 4, 0x06, bits / 8);
export const keccak = (data, bits) => sponge(data, 200 - bits / 4, 0x01, bits / 8);
export const shake = (data, strength, outLen) => sponge(data, 200 - strength / 4, 0x1f, outLen);

function enc(x) { const b = []; let v = BigInt(x); do { b.unshift(Number(v & 255n)); v >>= 8n; } while (v); return b; }
export const leftEncode = (x) => { const b = enc(x); return Uint8Array.from([b.length, ...b]); };
export const rightEncode = (x) => { const b = enc(x); return Uint8Array.from([...b, b.length]); };
export const encodeString = (s) => concat(leftEncode(s.length * 8), s);
function bytepad(x, w) { const z = concat(leftEncode(w), x); const out = new Uint8Array(Math.ceil(z.length / w) * w); out.set(z); return out; }

export function cshake(data, strength, outLen, N = new Uint8Array(0), S = new Uint8Array(0)) {
  if (!N.length && !S.length) return shake(data, strength, outLen);
  const rate = 200 - strength / 4;
  return sponge(concat(bytepad(concat(encodeString(N), encodeString(S)), rate), data), rate, 0x04, outLen);
}
export function kmac(key, data, strength, outLen, S = new Uint8Array(0), xof = false) {
  const x = concat(bytepad(encodeString(key), 200 - strength / 4), data, rightEncode(xof ? 0 : outLen * 8));
  return cshake(x, strength, outLen, utf8("KMAC"), S);
}
export function tupleHash(items, strength, outLen, S = new Uint8Array(0), xof = false) {
  return cshake(concat(...items.map(encodeString), rightEncode(xof ? 0 : outLen * 8)), strength, outLen, utf8("TupleHash"), S);
}
export function parallelHash(data, blockSize, strength, outLen, S = new Uint8Array(0), xof = false) {
  if (!(blockSize > 0)) throw new Error("Block size must be a positive number of bytes");
  const parts = [leftEncode(blockSize)];
  let n = 0;
  for (let o = 0; o < data.length; o += blockSize, n++) parts.push(shake(data.subarray(o, o + blockSize), strength, strength / 4));
  parts.push(rightEncode(n), rightEncode(xof ? 0 : outLen * 8));
  return cshake(concat(...parts), strength, outLen, utf8("ParallelHash"), S);
}
