// XXH32, XXH64, XXH3-64 and XXH3-128 (xxHash 0.8 specification). BigInt for the 64-bit variants.
const M = (1n << 64n) - 1n, M32 = 0xffffffffn;
const P32 = [0x9e3779b1, 0x85ebca77, 0xc2b2ae3d, 0x27d4eb2f, 0x165667b1];
const [Q1, Q2, Q3, Q4, Q5] = P32.map(BigInt);
const P1 = 0x9e3779b185ebca87n, P2 = 0xc2b2ae3d27d4eb4fn, P3 = 0x165667b19e3779f9n, P4 = 0x85ebca77c2b2ae63n, P5 = 0x27d4eb2f165667c5n;
const MX1 = 0x165667919e3779f9n, MX2 = 0x9fb21c651e98df25n;

const rd32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const rd = (d, o) => BigInt(rd32(d, o)) | (BigInt(rd32(d, o + 4)) << 32n);
const rotl = (x, n) => ((x << n) | (x >> (64n - n))) & M;
function be(v, bytes) { const o = new Uint8Array(bytes); for (let i = bytes - 1; i >= 0; i--) { o[i] = Number(v & 255n); v >>= 8n; } return o; }

export function xxh32(d, seed = 0n) {
  const s = Number(seed & M32), n = d.length, rol = (x, r) => ((x << r) | (x >>> (32 - r))) >>> 0;
  const round = (a, x) => Math.imul(rol((a + Math.imul(x, P32[1])) >>> 0, 13), P32[0]) >>> 0;
  let o = 0, h;
  if (n >= 16) {
    let v = [(s + P32[0] + P32[1]) >>> 0, (s + P32[1]) >>> 0, s, (s - P32[0]) >>> 0];
    for (; o + 16 <= n; o += 16) v = v.map((a, i) => round(a, rd32(d, o + 4 * i)));
    h = (rol(v[0], 1) + rol(v[1], 7) + rol(v[2], 12) + rol(v[3], 18)) >>> 0;
  } else h = (s + P32[4]) >>> 0;
  h = (h + n) >>> 0;
  for (; o + 4 <= n; o += 4) h = Math.imul(rol((h + Math.imul(rd32(d, o), P32[2])) >>> 0, 17), P32[3]) >>> 0;
  for (; o < n; o++) h = Math.imul(rol((h + Math.imul(d[o], P32[4])) >>> 0, 11), P32[0]) >>> 0;
  h = Math.imul(h ^ (h >>> 15), P32[1]) >>> 0; h = Math.imul(h ^ (h >>> 13), P32[2]) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
  return be(BigInt(h), 4);
}

const avalanche64 = (h) => { h ^= h >> 33n; h = (h * P2) & M; h ^= h >> 29n; h = (h * P3) & M; return h ^ (h >> 32n); };
export function xxh64(d, seed = 0n) {
  const n = d.length;
  const round = (a, x) => (rotl((a + x * P2) & M, 31n) * P1) & M;
  let o = 0, h;
  if (n >= 32) {
    let v = [(seed + P1 + P2) & M, (seed + P2) & M, seed & M, (seed - P1) & M];
    for (; o + 32 <= n; o += 32) v = v.map((a, i) => round(a, rd(d, o + 8 * i)));
    h = (rotl(v[0], 1n) + rotl(v[1], 7n) + rotl(v[2], 12n) + rotl(v[3], 18n)) & M;
    for (const a of v) h = ((h ^ round(0n, a)) * P1 + P4) & M;
  } else h = (seed + P5) & M;
  h = (h + BigInt(n)) & M;
  for (; o + 8 <= n; o += 8) h = (rotl(h ^ round(0n, rd(d, o)), 27n) * P1 + P4) & M;
  if (o + 4 <= n) { h = (rotl(h ^ ((BigInt(rd32(d, o)) * P1) & M), 23n) * P2 + P3) & M; o += 4; }
  for (; o < n; o++) h = (rotl(h ^ ((BigInt(d[o]) * P5) & M), 11n) * P1) & M;
  return be(avalanche64(h), 8);
}

// ── XXH3 ────────────────────────────────────────────────────────────────────
const SECRET = Uint8Array.from(("b8fe6c3923a44bbe7c01812cf721ad1cded46de9839097db7240a4a4b7b3671fcb79e64eccc0e578825ad07dccff7221" +
  "b8084674f743248ee03590e6813a264c3c2852bb91c300cb88d0658b1b532ea371644897a20df94e3819ef46a9deacd8" +
  "a8fa763fe39c343ff9dcbbc7c70b4f1d8a51e04bcdb45931c89f7ec9d9787364eac5ac8334d3ebc3c581a0fffa1363eb" +
  "170ddd51b7f0da49d316552629d4689e2b16be587d47a1fc8ff8b8d17ad031ce45cb3a8f95160428afd7fbcabb4b407e").match(/../g), (x) => parseInt(x, 16));

const bswap64 = (v) => { let r = 0n; for (let i = 0; i < 8; i++) { r = (r << 8n) | (v & 255n); v >>= 8n; } return r; };
const bswap32 = (v) => { let r = 0n; for (let i = 0; i < 4; i++) { r = (r << 8n) | (v & 255n); v >>= 8n; } return r; };
const mul128fold = (a, b) => { const p = a * b; return (p & M) ^ (p >> 64n); };
const avalanche3 = (h) => { h ^= h >> 37n; h = (h * MX1) & M; return h ^ (h >> 32n); };
const rrmxmx = (h, len) => { h ^= rotl(h, 49n) ^ rotl(h, 24n); h = (h * MX2) & M; h ^= (h >> 35n) + len; h = (h * MX2) & M; return h ^ (h >> 28n); };
const mix16 = (d, o, sec, s, seed) => mul128fold(rd(d, o) ^ ((rd(sec, s) + seed) & M), rd(d, o + 8) ^ ((rd(sec, s + 8) - seed) & M));

/** Stripe accumulation for inputs longer than 240 bytes. */
function hashLong(d, seed) {
  let sec = SECRET;
  if (seed !== 0n) {
    sec = new Uint8Array(192);
    const dv = new DataView(sec.buffer);
    for (let i = 0; i < 192; i += 16) { dv.setBigUint64(i, (rd(SECRET, i) + seed) & M, true); dv.setBigUint64(i + 8, (rd(SECRET, i + 8) - seed) & M, true); }
  }
  const acc = [Q3, P1, P2, P3, P4, Q2, P5, Q1];
  const stripe = (o, s) => {
    for (let i = 0; i < 8; i++) {
      const val = rd(d, o + 8 * i), key = val ^ rd(sec, s + 8 * i);
      acc[i ^ 1] = (acc[i ^ 1] + val) & M;
      acc[i] = (acc[i] + (key & M32) * (key >> 32n)) & M;
    }
  };
  const n = d.length, perBlock = 16, blockLen = 1024, nb = Math.floor((n - 1) / blockLen);
  for (let b = 0; b < nb; b++) {
    for (let s = 0; s < perBlock; s++) stripe(b * blockLen + s * 64, s * 8);
    for (let i = 0; i < 8; i++) acc[i] = ((acc[i] ^ (acc[i] >> 47n) ^ rd(sec, 128 + 8 * i)) * Q1) & M;
  }
  const rest = Math.floor((n - 1 - nb * blockLen) / 64);
  for (let s = 0; s < rest; s++) stripe(nb * blockLen + s * 64, s * 8);
  stripe(n - 64, 121);
  const merge = (s, start) => {
    let r = start;
    for (let i = 0; i < 4; i++) r = (r + mul128fold(acc[2 * i] ^ rd(sec, s + 16 * i), acc[2 * i + 1] ^ rd(sec, s + 16 * i + 8))) & M;
    return avalanche3(r);
  };
  const len = BigInt(n);
  return { lo: merge(11, (len * P1) & M), hi: () => merge(117, ~(len * P2) & M) };
}

export function xxh3_64(d, seed = 0n) {
  seed &= M;
  const n = d.length, len = BigInt(n), K = SECRET;
  let h;
  if (n === 0) h = avalanche64(seed ^ rd(K, 56) ^ rd(K, 64));
  else if (n <= 3) {
    const c = (BigInt(d[0]) << 16n) | (BigInt(d[n >> 1]) << 24n) | BigInt(d[n - 1]) | (len << 8n);
    h = avalanche64(c ^ ((BigInt((rd32(K, 0) ^ rd32(K, 4)) >>> 0) + seed) & M));
  } else if (n <= 8) {
    const s = seed ^ (bswap32(seed & M32) << 32n);
    const input = BigInt(rd32(d, n - 4)) + (BigInt(rd32(d, 0)) << 32n);
    h = rrmxmx(input ^ (((rd(K, 8) ^ rd(K, 16)) - s) & M), len);
  } else if (n <= 16) {
    const lo = rd(d, 0) ^ (((rd(K, 24) ^ rd(K, 32)) + seed) & M), hi = rd(d, n - 8) ^ (((rd(K, 40) ^ rd(K, 48)) - seed) & M);
    h = avalanche3((len + bswap64(lo) + hi + mul128fold(lo, hi)) & M);
  } else if (n <= 128) {
    let a = (len * P1) & M;
    for (let i = (n - 1) >> 5; i >= 0; i--) a = (a + mix16(d, 16 * i, K, 32 * i, seed) + mix16(d, n - 16 * (i + 1), K, 32 * i + 16, seed)) & M;
    h = avalanche3(a);
  } else if (n <= 240) {
    let a = (len * P1) & M;
    for (let i = 0; i < 8; i++) a = (a + mix16(d, 16 * i, K, 16 * i, seed)) & M;
    a = avalanche3(a);
    for (let i = 8; i < n >> 4; i++) a = (a + mix16(d, 16 * i, K, 16 * (i - 8) + 3, seed)) & M;
    a = (a + mix16(d, n - 16, K, 136 - 17, seed)) & M;
    h = avalanche3(a);
  } else h = hashLong(d, seed).lo;
  return be(h, 8);
}

export function xxh3_128(d, seed = 0n) {
  seed &= M;
  const n = d.length, len = BigInt(n), K = SECRET;
  let lo, hi;
  if (n === 0) { lo = avalanche64(seed ^ rd(K, 64) ^ rd(K, 72)); hi = avalanche64(seed ^ rd(K, 80) ^ rd(K, 88)); }
  else if (n <= 3) {
    const cl = ((d[0] << 16) | (d[n >> 1] << 24) | d[n - 1] | (n << 8)) >>> 0;
    const sw = Number(bswap32(BigInt(cl))), ch = ((sw << 13) | (sw >>> 19)) >>> 0;
    lo = avalanche64(BigInt(cl) ^ ((BigInt((rd32(K, 0) ^ rd32(K, 4)) >>> 0) + seed) & M));
    hi = avalanche64(BigInt(ch) ^ ((BigInt((rd32(K, 8) ^ rd32(K, 12)) >>> 0) - seed) & M));
  } else if (n <= 8) {
    const s = seed ^ (bswap32(seed & M32) << 32n);
    const input = BigInt(rd32(d, 0)) + (BigInt(rd32(d, n - 4)) << 32n);
    const keyed = input ^ (((rd(K, 16) ^ rd(K, 24)) + s) & M);
    const m = keyed * ((P1 + (len << 2n)) & M);
    let l = m & M, h = m >> 64n;
    h = (h + (l << 1n)) & M; l ^= h >> 3n;
    l ^= l >> 35n; l = (l * MX2) & M; l ^= l >> 28n;
    lo = l; hi = avalanche3(h);
  } else if (n <= 16) {
    const fl = ((rd(K, 32) ^ rd(K, 40)) - seed) & M, fh = ((rd(K, 48) ^ rd(K, 56)) + seed) & M;
    const il = rd(d, 0);
    let ih = rd(d, n - 8);
    const m = (il ^ ih ^ fl) * P1;
    let l = (m + ((len - 1n) << 54n)) & M, h = m >> 64n;
    ih ^= fh;
    h = (h + ih + (ih & M32) * (Q2 - 1n)) & M;
    l ^= bswap64(h);
    const m2 = l * P2;
    lo = avalanche3(m2 & M); hi = avalanche3(((m2 >> 64n) + h * P2) & M);
  } else if (n <= 240) {
    let a = (len * P1) & M, b = 0n;
    const mix32 = (o1, o2, s, sd) => {
      a = (a + mix16(d, o1, K, s, sd)) & M; a ^= (rd(d, o2) + rd(d, o2 + 8)) & M;
      b = (b + mix16(d, o2, K, s + 16, sd)) & M; b ^= (rd(d, o1) + rd(d, o1 + 8)) & M;
    };
    if (n <= 128) { for (let i = (n - 1) >> 5; i >= 0; i--) mix32(16 * i, n - 16 * (i + 1), 32 * i, seed); }
    else {
      for (let i = 32; i < 160; i += 32) mix32(i - 32, i - 16, i - 32, seed);
      a = avalanche3(a); b = avalanche3(b);
      for (let i = 160; i <= n; i += 32) mix32(i - 32, i - 16, 3 + i - 160, seed);
      mix32(n - 16, n - 32, 136 - 17 - 16, (-seed) & M);
    }
    const l = (a + b) & M, h = (a * P1 + b * P4 + ((len - seed) & M) * P2) & M;
    lo = avalanche3(l); hi = (-avalanche3(h)) & M;
  } else { const r = hashLong(d, seed); lo = r.lo; hi = r.hi(); }
  return be((hi << 64n) | lo, 16);
}
