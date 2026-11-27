// MD2/4/5, SHA-1, SHA-2, RIPEMD, SM3, Whirlpool, Adler-32 and parametric CRC.

/** Merkle–Damgård padding: 0x80, zeros, then the bit length. */
function pad(data, block, lenBytes, le) {
  const n = data.length;
  const total = Math.ceil((n + 1 + lenBytes) / block) * block;
  const m = new Uint8Array(total);
  m.set(data);
  m[n] = 0x80;
  let bits = BigInt(n) * 8n;
  for (let i = 0; i < 8; i++) { m[le ? total - lenBytes + i : total - 1 - i] = Number(bits & 255n); bits >>= 8n; }
  return m;
}
function words(m, off, count, le) {
  const dv = new DataView(m.buffer, m.byteOffset + off, count * 4), w = new Array(count);
  for (let i = 0; i < count; i++) w[i] = dv.getUint32(i * 4, le) | 0;
  return w;
}
function out32(h, le, bytes) {
  const o = new Uint8Array(h.length * 4), dv = new DataView(o.buffer);
  h.forEach((v, i) => dv.setUint32(i * 4, v >>> 0, le));
  return bytes ? o.slice(0, bytes) : o;
}
const rol = (x, n) => (x << n) | (x >>> (32 - n));
const ror = (x, n) => (x >>> n) | (x << (32 - n));

// RFC 1319 substitution table (a permutation derived from the digits of pi).
const MD2_S = Uint8Array.of(
  41, 46, 67, 201, 162, 216, 124, 1, 61, 54, 84, 161, 236, 240, 6, 19, 98, 167, 5, 243, 192, 199, 115, 140, 152, 147, 43, 217, 188, 76, 130, 202,
  30, 155, 87, 60, 253, 212, 224, 22, 103, 66, 111, 24, 138, 23, 229, 18, 190, 78, 196, 214, 218, 158, 222, 73, 160, 251, 245, 142, 187, 47, 238, 122,
  169, 104, 121, 145, 21, 178, 7, 63, 148, 194, 16, 137, 11, 34, 95, 33, 128, 127, 93, 154, 90, 144, 50, 39, 53, 62, 204, 231, 191, 247, 151, 3,
  255, 25, 48, 179, 72, 165, 181, 209, 215, 94, 146, 42, 172, 86, 170, 198, 79, 184, 56, 210, 150, 164, 125, 182, 118, 252, 107, 226, 156, 116, 4, 241,
  69, 157, 112, 89, 100, 113, 135, 32, 134, 91, 207, 101, 230, 45, 168, 2, 27, 96, 37, 173, 174, 176, 185, 246, 28, 70, 97, 105, 52, 64, 126, 15,
  85, 71, 163, 35, 221, 81, 175, 58, 195, 92, 249, 206, 186, 197, 234, 38, 44, 83, 13, 110, 133, 40, 132, 9, 211, 223, 205, 244, 65, 129, 77, 82,
  106, 220, 55, 200, 108, 193, 171, 250, 36, 225, 123, 8, 12, 189, 177, 74, 120, 136, 149, 139, 227, 99, 232, 109, 233, 203, 213, 254, 59, 0, 29, 57,
  242, 239, 183, 14, 102, 88, 208, 228, 166, 119, 114, 248, 235, 117, 75, 10, 49, 68, 80, 180, 143, 237, 31, 26, 219, 153, 141, 51, 159, 17, 131, 20);
export function md2(data) {
  const p = 16 - (data.length % 16);
  const m = new Uint8Array(data.length + p + 16);
  m.set(data); m.fill(p, data.length, data.length + p);
  let L = 0;
  const body = data.length + p;
  for (let i = 0; i < body; i += 16) for (let j = 0; j < 16; j++) { L = m[body + j] ^= MD2_S[m[i + j] ^ L]; }
  const x = new Uint8Array(48);
  for (let i = 0; i < m.length; i += 16) {
    for (let j = 0; j < 16; j++) { x[16 + j] = m[i + j]; x[32 + j] = x[16 + j] ^ x[j]; }
    let t = 0;
    for (let j = 0; j < 18; j++) { for (let k = 0; k < 48; k++) t = x[k] ^= MD2_S[t]; t = (t + j) & 255; }
  }
  return x.slice(0, 16);
}

export function md4(data) {
  const m = pad(data, 64, 8, true), h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let o = 0; o < m.length; o += 64) {
    const X = words(m, o, 16, true);
    let [a, b, c, d] = h;
    const step = (f, k, s) => { const t = rol((a + f + X[k] + 0) | 0, s); a = d; d = c; c = b; b = t; };
    for (let i = 0; i < 16; i++) step((b & c) | (~b & d), i, [3, 7, 11, 19][i % 4]);
    for (let i = 0; i < 16; i++) { const k = (i % 4) * 4 + (i >> 2); step((((b & c) | (b & d) | (c & d)) + 0x5a827999) | 0, k, [3, 5, 9, 13][i % 4]); }
    const r3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    for (let i = 0; i < 16; i++) step(((b ^ c ^ d) + 0x6ed9eba1) | 0, r3[i], [3, 9, 11, 15][i % 4]);
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  }
  return out32(h, true);
}

const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
export function md5(data) {
  const m = pad(data, 64, 8, true), h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let o = 0; o < m.length; o += 64) {
    const X = words(m, o, 16, true);
    let [a, b, c, d] = h;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) & 15; }
      else { f = c ^ (b | ~d); g = (7 * i) & 15; }
      const t = d; d = c; c = b;
      b = (b + rol((a + f + MD5_K[i] + X[g]) | 0, S[(i >> 4) * 4 + (i & 3)])) | 0;
      a = t;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  }
  return out32(h, true);
}

export function sha1(data) {
  const m = pad(data, 64, 8, false), h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0], w = new Int32Array(80);
  for (let o = 0; o < m.length; o += 64) {
    w.set(words(m, o, 16, false));
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? ((b & c) | (~b & d)) + 0x5a827999 : i < 40 ? (b ^ c ^ d) + 0x6ed9eba1 : i < 60 ? ((b & c) | (b & d) | (c & d)) + 0x8f1bbcdc : (b ^ c ^ d) + 0xca62c1d6;
      const t = (rol(a, 5) + f + e + w[i]) | 0;
      e = d; d = c; c = rol(b, 30); b = a; a = t;
    }
    [a, b, c, d, e].forEach((v, i) => (h[i] = (h[i] + v) | 0));
  }
  return out32(h, false);
}

// SHA-2 constants are the fractional bits of roots of the first primes; derive them instead of listing them.
const PRIMES = (() => { const p = []; for (let n = 2; p.length < 80; n++) if (p.every((q) => n % q)) p.push(n); return p; })();
function iroot(n, k) { let x = 1n << BigInt(Math.ceil(n.toString(2).length / Number(k))); for (;;) { const y = ((k - 1n) * x + n / x ** (k - 1n)) / k; if (y >= x) return x; x = y; } }
const M64 = (1n << 64n) - 1n;
const frac64 = (p, k) => iroot(BigInt(p) << (k * 64n), k) & M64;
const K512 = PRIMES.map((p) => frac64(p, 3n));
const K256 = K512.slice(0, 64).map((v) => Number(v >> 32n) | 0);
const H512 = PRIMES.slice(0, 8).map((p) => frac64(p, 2n));
const H384 = PRIMES.slice(8, 16).map((p) => frac64(p, 2n));
const H256 = H512.map((v) => Number(v >> 32n) | 0);
const H224 = H384.map((v) => Number(v & 0xffffffffn) | 0);

function sha256core(data, iv, outLen) {
  const m = pad(data, 64, 8, false), h = iv.slice(), w = new Int32Array(64);
  for (let o = 0; o < m.length; o += 64) {
    w.set(words(m, o, 16, false));
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = (w[i - 16] + (ror(x, 7) ^ ror(x, 18) ^ (x >>> 3)) + w[i - 7] + (ror(y, 17) ^ ror(y, 19) ^ (y >>> 10))) | 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
      const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, k].forEach((v, i) => (h[i] = (h[i] + v) | 0));
  }
  return out32(h, false, outLen);
}
export const sha256 = (d) => sha256core(d, H256, 32);
export const sha224 = (d) => sha256core(d, H224, 28);

const rot64 = (x, n) => ((x >> n) | (x << (64n - n))) & M64;
function sha512core(data, iv, outLen) {
  const m = pad(data, 128, 16, false), h = iv.slice(), w = new Array(80);
  const dv = new DataView(m.buffer);
  for (let o = 0; o < m.length; o += 128) {
    for (let i = 0; i < 16; i++) w[i] = dv.getBigUint64(o + i * 8);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 15], y = w[i - 2];
      w[i] = (w[i - 16] + (rot64(x, 1n) ^ rot64(x, 8n) ^ (x >> 7n)) + w[i - 7] + (rot64(y, 19n) ^ rot64(y, 61n) ^ (y >> 6n))) & M64;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 80; i++) {
      const t1 = k + (rot64(e, 14n) ^ rot64(e, 18n) ^ rot64(e, 41n)) + ((e & f) ^ ((e ^ M64) & g)) + K512[i] + w[i];
      const t2 = (rot64(a, 28n) ^ rot64(a, 34n) ^ rot64(a, 39n)) + ((a & b) ^ (a & c) ^ (b & c));
      k = g; g = f; f = e; e = (d + t1) & M64; d = c; c = b; b = a; a = (t1 + t2) & M64;
    }
    [a, b, c, d, e, f, g, k].forEach((v, i) => (h[i] = (h[i] + v) & M64));
  }
  const o = new Uint8Array(64), ov = new DataView(o.buffer);
  h.forEach((v, i) => ov.setBigUint64(i * 8, v));
  return o.slice(0, outLen);
}
function ivT(t) {
  const iv = H512.map((v) => v ^ 0xa5a5a5a5a5a5a5a5n);
  const r = sha512core(new TextEncoder().encode("SHA-512/" + t), iv, 64), dv = new DataView(r.buffer);
  return Array.from({ length: 8 }, (_, i) => dv.getBigUint64(i * 8));
}
export const sha512 = (d) => sha512core(d, H512, 64);
export const sha384 = (d) => sha512core(d, H384, 48);
export const sha512_224 = (d) => sha512core(d, ivT(224), 28);
export const sha512_256 = (d) => sha512core(d, ivT(256), 32);

// ── RIPEMD ─────────────────────────────────────────────────────────────────
const RL = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8,3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12,1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2,4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13];
const RR = [5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12,6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2,15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13,8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14,12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11];
const SL = [11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8,7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12,11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5,11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12,9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6];
const SR = [8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6,9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11,9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5,15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8,8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11];
const KL = [0, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const rf = (j, x, y, z) => (j === 0 ? x ^ y ^ z : j === 1 ? (x & y) | (~x & z) : j === 2 ? (x | ~y) ^ z : j === 3 ? (x & z) | (y & ~z) : x ^ (y | ~z));
function ripemd(data, size) {
  const five = size === 160 || size === 320, wide = size >= 256, rounds = five ? 5 : 4;
  const KR = five ? [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0] : [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0];
  const n = five ? 5 : 4;
  const base = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0].slice(0, n);
  const alt = [0x76543210, 0xfedcba98, 0x89abcdef, 0x01234567, 0x3c2d1e0f].slice(0, n);
  const h = wide ? base.concat(alt) : base.slice();
  const m = pad(data, 64, 8, true);
  for (let o = 0; o < m.length; o += 64) {
    const X = words(m, o, 16, true);
    const L = h.slice(0, n), R = wide ? h.slice(n) : h.slice(0, n);
    for (let r = 0; r < rounds; r++) {
      for (let i = r * 16; i < r * 16 + 16; i++) {
        for (const [V, idx, sh, K, fj] of [[L, RL, SL, KL[r], r], [R, RR, SR, KR[r], rounds - 1 - r]]) {
          if (five) {
            const t = (rol((V[0] + rf(fj, V[1], V[2], V[3]) + X[idx[i]] + K) | 0, sh[i]) + V[4]) | 0;
            V[0] = V[4]; V[4] = V[3]; V[3] = rol(V[2], 10); V[2] = V[1]; V[1] = t;
          } else {
            const t = rol((V[0] + rf(fj, V[1], V[2], V[3]) + X[idx[i]] + K) | 0, sh[i]);
            V[0] = V[3]; V[3] = V[2]; V[2] = V[1]; V[1] = t;
          }
        }
      }
      if (wide) { // exchange one chaining word between the two lines after each round
        const k = five ? [1, 3, 0, 2, 4][r] : r;
        const t = L[k]; L[k] = R[k]; R[k] = t;
      }
    }
    if (wide) { for (let i = 0; i < n; i++) { h[i] = (h[i] + L[i]) | 0; h[n + i] = (h[n + i] + R[i]) | 0; } }
    else {
      const t = (h[1] + L[2] + R[3]) | 0;
      for (let i = 1; i < n; i++) h[i] = (h[(i + 1) % n] + L[(i + 2) % n] + R[(i + 3) % n]) | 0;
      h[0] = t;
    }
  }
  return out32(h, true);
}
export const ripemd128 = (d) => ripemd(d, 128);
export const ripemd160 = (d) => ripemd(d, 160);
export const ripemd256 = (d) => ripemd(d, 256);
export const ripemd320 = (d) => ripemd(d, 320);

export function sm3(data) {
  const m = pad(data, 64, 8, false);
  const h = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e].map((v) => v | 0);
  const w = new Int32Array(68);
  const p0 = (x) => x ^ rol(x, 9) ^ rol(x, 17), p1 = (x) => x ^ rol(x, 15) ^ rol(x, 23);
  for (let o = 0; o < m.length; o += 64) {
    w.set(words(m, o, 16, false));
    for (let j = 16; j < 68; j++) w[j] = p1(w[j - 16] ^ w[j - 9] ^ rol(w[j - 3], 15)) ^ rol(w[j - 13], 7) ^ w[j - 6];
    let [a, b, c, d, e, f, g, k] = h;
    for (let j = 0; j < 64; j++) {
      const T = j < 16 ? 0x79cc4519 : 0x7a879d8a, r = j % 32;
      const a12 = rol(a, 12), ss1 = rol((a12 + e + (r ? rol(T, r) : T)) | 0, 7), ss2 = ss1 ^ a12;
      const ff = j < 16 ? a ^ b ^ c : (a & b) | (a & c) | (b & c), gg = j < 16 ? e ^ f ^ g : (e & f) | (~e & g);
      const t1 = (ff + d + ss2 + (w[j] ^ w[j + 4])) | 0, t2 = (gg + k + ss1 + w[j]) | 0;
      d = c; c = rol(b, 9); b = a; a = t1; k = g; g = rol(f, 19); f = e; e = p0(t2);
    }
    [a, b, c, d, e, f, g, k].forEach((v, i) => (h[i] ^= v));
  }
  return out32(h, false);
}

// ── Whirlpool (ISO/IEC 10118-3) ─────────────────────────────────────────────
let WP = null;
function whirlpoolTables() {
  const E = [1, 11, 9, 12, 13, 6, 15, 3, 14, 8, 7, 4, 10, 2, 5, 0], R = [7, 12, 11, 13, 14, 4, 9, 15, 6, 3, 8, 10, 2, 5, 1, 0], Ei = [];
  E.forEach((v, i) => (Ei[v] = i));
  const S = new Uint8Array(256);
  for (let x = 0; x < 256; x++) { const u = E[x >> 4], v = Ei[x & 15], r = R[u ^ v]; S[x] = (E[u ^ r] << 4) | Ei[v ^ r]; }
  const mul = (a, b) => { let p = 0; while (b) { if (b & 1) p ^= a; a <<= 1; if (a & 256) a ^= 0x11d; b >>= 1; } return p; };
  const C = [1, 1, 4, 1, 8, 5, 2, 9];
  const T = [Array.from({ length: 256 }, (_, x) => C.reduce((acc, c) => (acc << 8n) | BigInt(mul(S[x], c)), 0n))];
  for (let t = 1; t < 8; t++) T.push(T[0].map((v) => ((v >> BigInt(8 * t)) | (v << BigInt(64 - 8 * t))) & M64));
  const rc = Array.from({ length: 10 }, (_, r) => { let v = 0n; for (let j = 0; j < 8; j++) v = (v << 8n) | BigInt(S[8 * r + j]); return v; });
  return { T, rc };
}
export function whirlpool(data) {
  WP = WP || whirlpoolTables();
  const { T, rc } = WP;
  const m = pad(data, 64, 32, false), dv = new DataView(m.buffer);
  let H = new Array(8).fill(0n);
  const round = (s) => s.map((_, i) => { let v = 0n; for (let t = 0; t < 8; t++) v ^= T[t][Number((s[(i - t + 8) % 8] >> BigInt(56 - 8 * t)) & 255n)]; return v; });
  for (let o = 0; o < m.length; o += 64) {
    const block = Array.from({ length: 8 }, (_, i) => dv.getBigUint64(o + i * 8));
    let K = H.slice(), s = block.map((b, i) => b ^ K[i]);
    for (let r = 0; r < 10; r++) {
      K = round(K); K[0] ^= rc[r];
      s = round(s).map((v, i) => v ^ K[i]);
    }
    H = H.map((v, i) => v ^ s[i] ^ block[i]);
  }
  const o = new Uint8Array(64), ov = new DataView(o.buffer);
  H.forEach((v, i) => ov.setBigUint64(i * 8, v));
  return o;
}

export function adler32(data) {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; ) {
    const end = Math.min(data.length, i + 3800);
    for (; i < end; i++) { a += data[i]; b += a; }
    a %= 65521; b %= 65521;
  }
  return out32([((b << 16) | a) >>> 0], false);
}

// ── CRC (Rocksoft model) ───────────────────────────────────────────────────
// name: [width, poly, init, refin, refout, xorout]
export const CRC_PRESETS = {
  "CRC-3/GSM": [3, "3", "0", false, false, "7"],
  "CRC-4/G-704": [4, "3", "0", true, true, "0"],
  "CRC-5/USB": [5, "05", "1f", true, true, "1f"],
  "CRC-6/G-704": [6, "03", "00", true, true, "00"],
  "CRC-7/MMC": [7, "09", "00", false, false, "00"],
  "CRC-8/SMBUS": [8, "07", "00", false, false, "00"],
  "CRC-8/MAXIM-DOW": [8, "31", "00", true, true, "00"],
  "CRC-8/AUTOSAR": [8, "2f", "ff", false, false, "ff"],
  "CRC-10/ATM": [10, "233", "000", false, false, "000"],
  "CRC-12/UMTS": [12, "80f", "000", false, true, "000"],
  "CRC-15/CAN": [15, "4599", "0000", false, false, "0000"],
  "CRC-16/ARC": [16, "8005", "0000", true, true, "0000"],
  "CRC-16/MODBUS": [16, "8005", "ffff", true, true, "0000"],
  "CRC-16/USB": [16, "8005", "ffff", true, true, "ffff"],
  "CRC-16/IBM-3740 (CCITT-FALSE)": [16, "1021", "ffff", false, false, "0000"],
  "CRC-16/XMODEM": [16, "1021", "0000", false, false, "0000"],
  "CRC-16/KERMIT": [16, "1021", "0000", true, true, "0000"],
  "CRC-16/IBM-SDLC (X-25)": [16, "1021", "ffff", true, true, "ffff"],
  "CRC-24/OPENPGP": [24, "864cfb", "b704ce", false, false, "000000"],
  "CRC-32/ISO-HDLC": [32, "04c11db7", "ffffffff", true, true, "ffffffff"],
  "CRC-32/ISCSI (CRC-32C)": [32, "1edc6f41", "ffffffff", true, true, "ffffffff"],
  "CRC-32/BZIP2": [32, "04c11db7", "ffffffff", false, false, "ffffffff"],
  "CRC-32/MPEG-2": [32, "04c11db7", "ffffffff", false, false, "00000000"],
  "CRC-32/CKSUM": [32, "04c11db7", "00000000", false, false, "ffffffff"],
  "CRC-64/XZ": [64, "42f0e1eba9ea3693", "ffffffffffffffff", true, true, "ffffffffffffffff"],
  "CRC-64/ECMA-182": [64, "42f0e1eba9ea3693", "0000000000000000", false, false, "0000000000000000"]
};
const reflect = (v, w) => { let r = 0n; for (let i = 0; i < w; i++) { r = (r << 1n) | (v & 1n); v >>= 1n; } return r; };
const crcCache = new Map();
export function crcRaw(data, width, poly, init, refin, refout, xorout) {
  const w = BigInt(width), mask = (1n << w) - 1n, shift = BigInt(Math.max(0, 8 - width)), W = w + shift;
  const P = (poly & mask) << shift, M = (1n << W) - 1n, top = 1n << (W - 1n);
  const key = width + ":" + poly + ":" + refin;
  let table = crcCache.get(key);
  if (!table) {
    table = Array.from({ length: 256 }, (_, i) => {
      if (refin) { let c = BigInt(i); const rp = reflect(poly & mask, width); for (let k = 0; k < 8; k++) c = c & 1n ? (c >> 1n) ^ rp : c >> 1n; return c; }
      let c = BigInt(i) << (W - 8n);
      for (let k = 0; k < 8; k++) c = c & top ? ((c << 1n) ^ P) & M : (c << 1n) & M;
      return c;
    });
    if (width <= 32) table = Uint32Array.from(table, Number);
    crcCache.set(key, table);
  }
  let c;
  if (width <= 32 && (refin || width >= 8)) { // fast 32-bit path
    if (refin) { let x = Number(reflect(init & mask, width)); for (let i = 0; i < data.length; i++) x = (table[(x ^ data[i]) & 255] ^ (x >>> 8)) >>> 0; c = BigInt(x); }
    else { const s = width - 8, mm = width === 32 ? 0xffffffff : (1 << width) - 1; let x = Number(init & mask); for (let i = 0; i < data.length; i++) x = ((table[((x >>> s) ^ data[i]) & 255] ^ (x << 8)) & mm) >>> 0; c = BigInt(x); }
  } else if (refin) {
    c = reflect(init & mask, width);
    for (let i = 0; i < data.length; i++) c = BigInt(table[Number((c ^ BigInt(data[i])) & 255n)]) ^ (c >> 8n);
  } else {
    c = (init & mask) << shift;
    for (let i = 0; i < data.length; i++) c = BigInt(table[Number(((c >> (W - 8n)) ^ BigInt(data[i])) & 255n)]) ^ ((c << 8n) & M);
    c >>= shift;
  }
  if (refin !== refout) c = reflect(c, width);
  return (c ^ xorout) & mask;
}
export function crc(data, width, poly, init, refin, refout, xorout) {
  const v = crcRaw(data, width, poly, init, refin, refout, xorout);
  const hex = v.toString(16).padStart(Math.ceil(width / 4), "0");
  const even = hex.length % 2 ? "0" + hex : hex;
  return Uint8Array.from(even.match(/../g), (x) => parseInt(x, 16));
}
export function crcPreset(data, name) {
  const [w, p, i, ri, ro, x] = CRC_PRESETS[name];
  return crc(data, w, BigInt("0x" + p), BigInt("0x" + i), ri, ro, BigInt("0x" + x));
}
export const crc32 = (data) => Number(crcRaw(data, 32, 0x04c11db7n, 0xffffffffn, true, true, 0xffffffffn));
