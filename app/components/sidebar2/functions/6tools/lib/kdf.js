// HMAC, PBKDF2, EvpKDF, HKDF, scrypt, Argon2 and bcrypt.
import * as H from "./hash.js";
import * as K from "./keccak.js";
import { blake2b } from "./blake.js";
import { concat, utf8, random, equal } from "./bytes.js";

/** name → { fn, block (bytes), size (bytes) } */
export const DIGESTS = {
  "MD2": { fn: H.md2, block: 16, size: 16 }, "MD4": { fn: H.md4, block: 64, size: 16 }, "MD5": { fn: H.md5, block: 64, size: 16 },
  "SHA1": { fn: H.sha1, block: 64, size: 20, web: "SHA-1" }, "SHA224": { fn: H.sha224, block: 64, size: 28 },
  "SHA256": { fn: H.sha256, block: 64, size: 32, web: "SHA-256" }, "SHA384": { fn: H.sha384, block: 128, size: 48, web: "SHA-384" },
  "SHA512": { fn: H.sha512, block: 128, size: 64, web: "SHA-512" }, "SHA512/224": { fn: H.sha512_224, block: 128, size: 28 },
  "SHA512/256": { fn: H.sha512_256, block: 128, size: 32 },
  "SHA3-224": { fn: (d) => K.sha3(d, 224), block: 144, size: 28 }, "SHA3-256": { fn: (d) => K.sha3(d, 256), block: 136, size: 32 },
  "SHA3-384": { fn: (d) => K.sha3(d, 384), block: 104, size: 48 }, "SHA3-512": { fn: (d) => K.sha3(d, 512), block: 72, size: 64 },
  "RIPEMD-160": { fn: H.ripemd160, block: 64, size: 20 }, "SM3": { fn: H.sm3, block: 64, size: 32 }, "Whirlpool": { fn: H.whirlpool, block: 64, size: 64 }
};
export function hmac(name, key, data) {
  const d = DIGESTS[name];
  if (!d) throw new Error("Unknown digest " + name);
  let k = key.length > d.block ? d.fn(key) : key;
  const i = new Uint8Array(d.block).fill(0x36), o = new Uint8Array(d.block).fill(0x5c);
  for (let j = 0; j < k.length; j++) { i[j] ^= k[j]; o[j] ^= k[j]; }
  return d.fn(concat(o, d.fn(concat(i, data))));
}
export async function pbkdf2(name, password, salt, iterations, length) {
  if (!(iterations >= 1) || !(length >= 1)) throw new Error("Iterations and length must be at least 1");
  const d = DIGESTS[name];
  if (d.web && globalThis.crypto && crypto.subtle && password.length) {
    const key = await crypto.subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: d.web }, key, length * 8));
  }
  if (iterations * Math.ceil(length / d.size) > 2e6) throw new Error("Too many iterations for " + name + " in the browser");
  const out = new Uint8Array(length);
  for (let block = 1, o = 0; o < length; block++, o += d.size) {
    let u = hmac(name, password, concat(salt, Uint8Array.of(block >>> 24, block >>> 16, block >>> 8, block)));
    const t = u.slice();
    for (let i = 1; i < iterations; i++) { u = hmac(name, password, u); for (let j = 0; j < t.length; j++) t[j] ^= u[j]; }
    out.set(t.subarray(0, Math.min(d.size, length - o)), o);
  }
  return out;
}
/** OpenSSL EVP_BytesToKey. */
export function evpkdf(name, password, salt, iterations, length) {
  if (iterations > 2e6) throw new Error("Too many iterations");
  const parts = [];
  let prev = new Uint8Array(0), have = 0;
  while (have < length) {
    prev = DIGESTS[name].fn(concat(prev, password, salt));
    for (let i = 1; i < iterations; i++) prev = DIGESTS[name].fn(prev);
    parts.push(prev); have += prev.length;
  }
  return concat(...parts).slice(0, length);
}
export function hkdf(name, ikm, salt, info, length) {
  const size = DIGESTS[name].size;
  if (length > 255 * size) throw new Error("HKDF length is limited to " + 255 * size + " bytes for " + name);
  const prk = hmac(name, salt.length ? salt : new Uint8Array(size), ikm), parts = [];
  let t = new Uint8Array(0);
  for (let i = 1; (i - 1) * size < length; i++) { t = hmac(name, prk, concat(t, info, Uint8Array.of(i))); parts.push(t); }
  return concat(...parts).slice(0, length);
}

// ── scrypt (RFC 7914) ────────────────────────────────────────────────────────
function salsa8(B, x) {
  x.set(B);
  const R = (d, a, b, n) => { const t = (x[a] + x[b]) | 0; x[d] ^= (t << n) | (t >>> (32 - n)); };
  for (let i = 0; i < 4; i++) {
    R(4,0,12,7); R(8,4,0,9); R(12,8,4,13); R(0,12,8,18); R(9,5,1,7); R(13,9,5,9); R(1,13,9,13); R(5,1,13,18);
    R(14,10,6,7); R(2,14,10,9); R(6,2,14,13); R(10,6,2,18); R(3,15,11,7); R(7,3,15,9); R(11,7,3,13); R(15,11,7,18);
    R(1,0,3,7); R(2,1,0,9); R(3,2,1,13); R(0,3,2,18); R(6,5,4,7); R(7,6,5,9); R(4,7,6,13); R(5,4,7,18);
    R(11,10,9,7); R(8,11,10,9); R(9,8,11,13); R(10,9,8,18); R(12,15,14,7); R(13,12,15,9); R(14,13,12,13); R(15,14,13,18);
  }
  for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
}
export async function scrypt(password, salt, N, r, p, length) {
  if (!(N > 1) || (N & (N - 1)) !== 0) throw new Error("N (cost) must be a power of two greater than 1");
  if (!(r >= 1) || !(p >= 1) || !(length >= 1)) throw new Error("r, p and length must be at least 1");
  if (128 * N * r > 512 * 1024 * 1024 || p > 64) throw new Error("These parameters need too much memory or time for the browser");
  const B = await pbkdf2("SHA256", password, salt, 1, p * 128 * r);
  const words = 32 * r, dv = new DataView(B.buffer);
  const V = new Int32Array(words * N), X = new Int32Array(words), Y = new Int32Array(words), T = new Int32Array(16), tmp = new Int32Array(16);
  const blockMix = () => {
    T.set(X.subarray(words - 16));
    for (let i = 0; i < 2 * r; i++) {
      for (let k = 0; k < 16; k++) T[k] ^= X[i * 16 + k];
      salsa8(T, tmp);
      Y.set(T, ((i >> 1) + (i & 1) * r) * 16);
    }
    X.set(Y);
  };
  for (let i = 0; i < p; i++) {
    for (let k = 0; k < words; k++) X[k] = dv.getInt32(i * 128 * r + 4 * k, true);
    for (let j = 0; j < N; j++) { V.set(X, j * words); blockMix(); }
    for (let j = 0; j < N; j++) {
      const q = (X[words - 16] >>> 0) % N;
      for (let k = 0; k < words; k++) X[k] ^= V[q * words + k];
      blockMix();
    }
    for (let k = 0; k < words; k++) dv.setInt32(i * 128 * r + 4 * k, X[k], true);
  }
  return pbkdf2("SHA256", password, B, 1, length);
}

// ── Argon2 (RFC 9106) ────────────────────────────────────────────────────────
const le32 = (n) => Uint8Array.of(n, n >>> 8, n >>> 16, n >>> 24);
function hprime(X, len) {
  const A = concat(le32(len), X);
  if (len <= 64) return blake2b(A, len);
  const out = new Uint8Array(len);
  let V = blake2b(A, 64), o = 0;
  out.set(V.subarray(0, 32)); o = 32;
  for (; len - o > 64; o += 32) { V = blake2b(V, 64); out.set(V.subarray(0, 32), o); }
  out.set(blake2b(V, len - o), o);
  return out;
}
/** a = a + b + 2·lo(a)·lo(b) on 64-bit words stored as [lo, hi] pairs. */
function blamka(v, a, b) {
  const al = v[a] >>> 0, bl = v[b] >>> 0;
  const a0 = al & 0xffff, a1 = al >>> 16, b0 = bl & 0xffff, b1 = bl >>> 16;
  const mid = a1 * b0 + a0 * b1;
  const low = a0 * b0 + (mid % 65536) * 65536;
  const pl = low % 4294967296, ph = a1 * b1 + Math.floor(mid / 65536) + Math.floor(low / 4294967296);
  const lo = al + bl + 2 * pl;
  v[a + 1] = (v[a + 1] >>> 0) + (v[b + 1] >>> 0) + 2 * ph + Math.floor(lo / 4294967296);
  v[a] = lo;
}
function xorRot(v, d, a, n) {
  let lo = v[d] ^ v[a], hi = v[d + 1] ^ v[a + 1];
  if (n >= 32) { const t = lo; lo = hi; hi = t; n -= 32; }
  if (n === 0) { v[d] = lo; v[d + 1] = hi; return; }
  v[d] = (lo >>> n) | (hi << (32 - n)); v[d + 1] = (hi >>> n) | (lo << (32 - n));
}
function gb(v, a, b, c, d) {
  blamka(v, a, b); xorRot(v, d, a, 32); blamka(v, c, d); xorRot(v, b, c, 24);
  blamka(v, a, b); xorRot(v, d, a, 16); blamka(v, c, d); xorRot(v, b, c, 63);
}
const R = new Uint32Array(256), Z = new Uint32Array(256);
function permuteRow(i) { // i = 16 word indices
  const w = i.map((x) => x * 2);
  gb(Z, w[0], w[4], w[8], w[12]); gb(Z, w[1], w[5], w[9], w[13]); gb(Z, w[2], w[6], w[10], w[14]); gb(Z, w[3], w[7], w[11], w[15]);
  gb(Z, w[0], w[5], w[10], w[15]); gb(Z, w[1], w[6], w[11], w[12]); gb(Z, w[2], w[7], w[8], w[13]); gb(Z, w[3], w[4], w[9], w[14]);
}
const ROWS = Array.from({ length: 8 }, (_, i) => Array.from({ length: 16 }, (_, j) => 16 * i + j));
const COLS = Array.from({ length: 8 }, (_, i) => Array.from({ length: 16 }, (_, j) => 2 * i + 16 * (j >> 1) + (j & 1)));
function fillBlock(mem, prev, ref, next, withXor) {
  for (let k = 0; k < 256; k++) R[k] = mem[prev + k] ^ mem[ref + k];
  Z.set(R);
  ROWS.forEach(permuteRow); COLS.forEach(permuteRow);
  for (let k = 0; k < 256; k++) mem[next + k] = Z[k] ^ R[k] ^ (withXor ? mem[next + k] : 0);
}
export async function argon2(type, password, salt, { t = 3, m = 4096, p = 1, length = 32, secret = new Uint8Array(0), ad = new Uint8Array(0), version = 19 } = {}) {
  const y = { argon2d: 0, argon2i: 1, argon2id: 2 }[type];
  if (y === undefined) throw new Error("Unknown Argon2 type");
  if (salt.length < 8) throw new Error("Argon2 salt must be at least 8 bytes");
  if (!(t >= 1) || !(p >= 1) || !(length >= 4)) throw new Error("Iterations and parallelism must be ≥ 1, hash length ≥ 4");
  if (m < 8 * p) throw new Error("Memory must be at least 8 × parallelism (KiB)");
  if (m > 262144 || t * m > 4e6 || p > 64) throw new Error("These parameters are too heavy for the browser (max 256 MiB)");
  const H0 = blake2b(concat(le32(p), le32(length), le32(m), le32(t), le32(version), le32(y), le32(password.length), password,
    le32(salt.length), salt, le32(secret.length), secret, le32(ad.length), ad), 64);
  const lane = Math.floor(m / (4 * p)) * 4, total = lane * p, seg = lane / 4;
  const mem = new Uint32Array(total * 256), view = new Uint8Array(mem.buffer); // little-endian hosts
  for (let i = 0; i < p; i++) for (let j = 0; j < 2; j++) view.set(hprime(concat(H0, le32(j), le32(i)), 1024), (i * lane + j) * 1024);
  const addr = new Uint32Array(768); // zero | input | address blocks
  for (let pass = 0; pass < t; pass++) {
    for (let slice = 0; slice < 4; slice++) {
      for (let l = 0; l < p; l++) {
        const independent = y === 1 || (y === 2 && pass === 0 && slice < 2);
        const nextAddresses = () => { addr[256 + 12]++; fillBlock(addr, 0, 256, 512, false); fillBlock(addr, 0, 512, 512, false); };
        if (independent) { addr.fill(0); [pass, l, slice, total, t, y].forEach((v, i) => (addr[256 + 2 * i] = v)); }
        let start = 0;
        if (pass === 0 && slice === 0) { start = 2; if (independent) nextAddresses(); }
        for (let idx = start; idx < seg; idx++) {
          const cur = l * lane + slice * seg + idx;
          const prev = cur % lane === 0 ? cur + lane - 1 : cur - 1;
          let j1, j2;
          if (independent) { if (idx % 128 === 0) nextAddresses(); j1 = addr[512 + 2 * (idx % 128)]; j2 = addr[512 + 2 * (idx % 128) + 1]; }
          else { j1 = mem[prev * 256]; j2 = mem[prev * 256 + 1]; }
          const refLane = pass === 0 && slice === 0 ? l : j2 % p;
          const same = refLane === l;
          let area;
          if (pass === 0) area = slice === 0 ? idx - 1 : same ? slice * seg + idx - 1 : slice * seg - (idx === 0 ? 1 : 0);
          else area = same ? lane - seg + idx - 1 : lane - seg - (idx === 0 ? 1 : 0);
          const x = Number((BigInt(j1) * BigInt(j1)) >> 32n);
          const rel = area - 1 - Number((BigInt(area) * BigInt(x)) >> 32n);
          const first = pass === 0 || slice === 3 ? 0 : (slice + 1) * seg;
          const ref = refLane * lane + ((first + rel) % lane);
          fillBlock(mem, prev * 256, ref * 256, cur * 256, version !== 16 && pass > 0);
        }
      }
    }
  }
  const C = view.slice((lane - 1) * 1024, lane * 1024);
  for (let l = 1; l < p; l++) for (let k = 0; k < 1024; k++) C[k] ^= view[(l * lane + lane - 1) * 1024 + k];
  return hprime(C, length);
}
const b64np = (b) => btoa(String.fromCharCode(...b)).replace(/=+$/, "");
export async function argon2Encoded(type, password, salt, o) {
  const opts = { t: 3, m: 4096, p: 1, length: 32, ...o };
  const hash = await argon2(type, password, salt, opts);
  return `$${type}$v=19$m=${opts.m},t=${opts.t},p=${opts.p}$${b64np(salt)}$${b64np(hash)}`;
}
export async function argon2Verify(encoded, password, secret) {
  const m = /^\$(argon2(?:d|i|id))\$(?:v=(\d+)\$)?m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(encoded.trim());
  if (!m) throw new Error("Not a valid encoded Argon2 hash");
  const dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const want = dec(m[7]);
  const got = await argon2(m[1], password, dec(m[6]), { version: m[2] ? +m[2] : 16, m: +m[3], t: +m[4], p: +m[5], length: want.length, secret });
  return equal(got, want);
}

// scrypt "$scrypt$ln=..,r=..,p=..$salt$hash" (PHC string format)
export async function scryptEncoded(password, salt, ln, r, p, length) {
  const h = await scrypt(password, salt, 2 ** ln, r, p, length);
  return `$scrypt$ln=${ln},r=${r},p=${p}$${b64np(salt)}$${b64np(h)}`;
}
export async function scryptVerify(encoded, password) {
  const m = /^\$scrypt\$ln=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/.exec(encoded.trim());
  if (!m) throw new Error("Expected $scrypt$ln=…,r=…,p=…$salt$hash");
  const dec = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const want = dec(m[5]);
  return equal(await scrypt(password, dec(m[4]), 2 ** +m[1], +m[2], +m[3], want.length), want);
}

// ── bcrypt ───────────────────────────────────────────────────────────────────
let PI_WORDS = null;
/** Blowfish's initial P-array and S-boxes are the hex digits of pi; compute them once. */
export function piWords() {
  if (PI_WORDS) return PI_WORDS;
  const n = 18 + 1024, bits = BigInt(n * 32 + 64), one = 1n << bits;
  const atan = (x) => { const x2 = BigInt(x * x); let term = one / BigInt(x), sum = term; for (let k = 3n, sign = -1n; term; k += 2n, sign = -sign) { term /= x2; sum += sign * (term / k); } return sum; };
  let frac = 16n * atan(5) - 4n * atan(239) - 3n * one;
  const hex = (frac >> 64n).toString(16).padStart(n * 8, "0");
  PI_WORDS = Int32Array.from({ length: n }, (_, i) => parseInt(hex.substr(i * 8, 8), 16) | 0);
  return PI_WORDS;
}
const B64 = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function bEncode(b) {
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0), chars = Math.min(4, b.length - i + 1);
    for (let k = 0; k < chars; k++) s += B64[(n >>> (18 - 6 * k)) & 63];
  }
  return s;
}
function bDecode(s, len) {
  const out = [];
  for (let i = 0; i < s.length && out.length < len; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64.indexOf(s[i + k]) : 0));
    if (v.includes(-1)) throw new Error("Invalid bcrypt salt");
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    out.push((n >>> 16) & 255, (n >>> 8) & 255, n & 255);
  }
  return Uint8Array.from(out.slice(0, len));
}
function bcryptRaw(key, salt, cost) {
  const init = piWords(), P = init.slice(0, 18), S = init.slice(18);
  let L = 0, Rr = 0;
  const F = (x) => ((((S[x >>> 24] + S[256 + ((x >>> 16) & 255)]) | 0) ^ S[512 + ((x >>> 8) & 255)]) + S[768 + (x & 255)]) | 0;
  const encrypt = () => {
    let l = L, r = Rr;
    for (let i = 0; i < 16; i += 2) { l ^= P[i]; r ^= F(l); r ^= P[i + 1]; l ^= F(r); }
    L = r ^ P[17]; Rr = l ^ P[16];
  };
  const stream = (d) => { let o = 0; return () => { let w = 0; for (let i = 0; i < 4; i++) { w = (w << 8) | d[o]; o = (o + 1) % d.length; } return w; }; };
  const expand = (k, data) => {
    const ks = stream(k);
    for (let i = 0; i < 18; i++) P[i] ^= ks();
    const ds = data ? stream(data) : null;
    L = 0; Rr = 0;
    for (const box of [P, S]) for (let i = 0; i < box.length; i += 2) { if (ds) { L ^= ds(); Rr ^= ds(); } encrypt(); box[i] = L; box[i + 1] = Rr; }
  };
  expand(key, salt);
  for (let i = 0, n = 2 ** cost; i < n; i++) { expand(key); expand(salt); }
  const magic = utf8("OrpheanBeholderScryDoubt"), out = new Uint8Array(24), dv = new DataView(magic.buffer, magic.byteOffset), ov = new DataView(out.buffer);
  for (let i = 0; i < 24; i += 8) {
    L = dv.getInt32(i); Rr = dv.getInt32(i + 4);
    for (let k = 0; k < 64; k++) encrypt();
    ov.setInt32(i, L); ov.setInt32(i + 4, Rr);
  }
  return out.slice(0, 23);
}
export function bcryptHash(password, cost = 10, saltBytes = random(16), version = "2b") {
  if (!(cost >= 4 && cost <= 16)) throw new Error("Cost must be between 4 and 16 in the browser");
  const key = concat(password, Uint8Array.of(0)).slice(0, 72);
  return `$${version}$${String(cost).padStart(2, "0")}$${bEncode(saltBytes)}${bEncode(bcryptRaw(key, saltBytes, cost))}`;
}
export function bcryptVerify(password, hash) {
  const m = /^\$(2[aby])\$(\d\d)\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/.exec(hash.trim());
  if (!m) throw new Error("Not a valid bcrypt hash");
  return equal(utf8(bcryptHash(password, +m[2], bDecode(m[3], 16), m[1])), utf8(hash.trim()));
}
