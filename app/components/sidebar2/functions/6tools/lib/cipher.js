// AES, DES, Triple DES, RC4, ChaCha20(-Poly1305), SPECK and XXTEA.
import { concat, equal } from "./bytes.js";

// ── AES ──────────────────────────────────────────────────────────────────────
let AT = null;
function aesTables() {
  const mul = (a, b) => { let p = 0; for (; b; b >>= 1) { if (b & 1) p ^= a; a = (a << 1) ^ (a & 0x80 ? 0x11b : 0); } return p & 255; };
  const S = new Uint8Array(256), Si = new Uint8Array(256), inv = new Uint8Array(256);
  for (let a = 1; a < 256; a++) for (let b = 1; b < 256; b++) if (mul(a, b) === 1) { inv[a] = b; break; }
  for (let i = 0; i < 256; i++) { let x = inv[i], s = x; for (let k = 0; k < 4; k++) { x = ((x << 1) | (x >> 7)) & 255; s ^= x; } S[i] = s ^ 0x63; Si[S[i]] = i; }
  const M = {};
  for (const c of [2, 3, 9, 11, 13, 14]) M[c] = Uint8Array.from({ length: 256 }, (_, i) => mul(i, c));
  return { S, Si, M };
}
export function aesKey(key) {
  AT = AT || aesTables();
  if (![16, 24, 32].includes(key.length)) throw new Error("AES key must be 16, 24 or 32 bytes (got " + key.length + ")");
  const { S, M } = AT, Nk = key.length / 4, Nr = Nk + 6, w = new Uint8Array(16 * (Nr + 1));
  w.set(key);
  let rcon = 1;
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    let t = w.slice(4 * i - 4, 4 * i);
    if (i % Nk === 0) { t = Uint8Array.of(S[t[1]] ^ rcon, S[t[2]], S[t[3]], S[t[0]]); rcon = M[2][rcon]; }
    else if (Nk > 6 && i % Nk === 4) t = t.map((b) => S[b]);
    for (let j = 0; j < 4; j++) w[4 * i + j] = w[4 * (i - Nk) + j] ^ t[j];
  }
  const add = (s, r) => { for (let i = 0; i < 16; i++) s[i] ^= w[16 * r + i]; };
  const encrypt = (block) => {
    const s = Uint8Array.from(block), t = new Uint8Array(16);
    add(s, 0);
    for (let r = 1; r <= Nr; r++) {
      for (let i = 0; i < 16; i++) t[i] = S[s[(i + 4 * (i & 3)) & 15]];
      if (r < Nr) for (let c = 0; c < 16; c += 4) {
        const a = t[c], b = t[c + 1], d = t[c + 2], e = t[c + 3];
        s[c] = M[2][a] ^ M[3][b] ^ d ^ e; s[c + 1] = a ^ M[2][b] ^ M[3][d] ^ e; s[c + 2] = a ^ b ^ M[2][d] ^ M[3][e]; s[c + 3] = M[3][a] ^ b ^ d ^ M[2][e];
      } else s.set(t);
      add(s, r);
    }
    return s;
  };
  const decrypt = (block) => {
    const { Si } = AT, s = Uint8Array.from(block), t = new Uint8Array(16);
    add(s, Nr);
    for (let r = Nr - 1; r >= 0; r--) {
      for (let i = 0; i < 16; i++) t[(i + 4 * (i & 3)) & 15] = s[i];
      for (let i = 0; i < 16; i++) s[i] = Si[t[i]];
      add(s, r);
      if (r > 0) for (let c = 0; c < 16; c += 4) {
        const a = s[c], b = s[c + 1], d = s[c + 2], e = s[c + 3];
        s[c] = M[14][a] ^ M[11][b] ^ M[13][d] ^ M[9][e]; s[c + 1] = M[9][a] ^ M[14][b] ^ M[11][d] ^ M[13][e];
        s[c + 2] = M[13][a] ^ M[9][b] ^ M[14][d] ^ M[11][e]; s[c + 3] = M[11][a] ^ M[13][b] ^ M[9][d] ^ M[14][e];
      }
    }
    return s;
  };
  return { block: 16, encrypt, decrypt };
}

// ── DES / 3DES ───────────────────────────────────────────────────────────────
const t = (s) => s.split(" ").map(Number);
const IP = t("58 50 42 34 26 18 10 2 60 52 44 36 28 20 12 4 62 54 46 38 30 22 14 6 64 56 48 40 32 24 16 8 57 49 41 33 25 17 9 1 59 51 43 35 27 19 11 3 61 53 45 37 29 21 13 5 63 55 47 39 31 23 15 7");
const FP = (() => { const r = []; IP.forEach((v, i) => (r[v - 1] = i + 1)); return r; })();
const E = t("32 1 2 3 4 5 4 5 6 7 8 9 8 9 10 11 12 13 12 13 14 15 16 17 16 17 18 19 20 21 20 21 22 23 24 25 24 25 26 27 28 29 28 29 30 31 32 1");
const PP = t("16 7 20 21 29 12 28 17 1 15 23 26 5 18 31 10 2 8 24 14 32 27 3 9 19 13 30 6 22 11 4 25");
const PC1 = t("57 49 41 33 25 17 9 1 58 50 42 34 26 18 10 2 59 51 43 35 27 19 11 3 60 52 44 36 63 55 47 39 31 23 15 7 62 54 46 38 30 22 14 6 61 53 45 37 29 21 13 5 28 20 12 4");
const PC2 = t("14 17 11 24 1 5 3 28 15 6 21 10 23 19 12 4 26 8 16 7 27 20 13 2 41 52 31 37 47 55 30 40 51 45 33 48 44 49 39 56 34 53 46 42 50 36 29 32");
const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const SBOX = [
  "e4d12fb83a6c59070f74e2d1a6cb953841e8d62bfc973a50fc8249175b3ea06d",
  "f18e6b34972dc05a3d47f28ec01a69b50e7ba4d158c6932fd8a13f42b67c05e9",
  "a09e63f51dc7b428d709346a285ecbf1d6498f30b12c5ae71ad069874fe3b52c",
  "7de3069a1285bc4fd8b56f03472c1ae9a690cb7df13e52843f06a1d8945bc72e",
  "2c417ab6853fd0e9eb2c47d150fa3986421bad78f9c5630eb8c71e2d6f09a453",
  "c1af92680d34e75baf427c9561de0b389ef528c3704a1db6432c95fabe17608d",
  "4b2ef08d3c975a61d0b7491ae35c2f8614bdc37eaf6805926bd814a7950fe23c",
  "d2846fb1a93e50c71fd8a374c56b0e927b419ce206adf35821e74a8dfc90356b"
].map((s) => Array.from(s, (c) => parseInt(c, 16)));
const permuteBits = (v, table, inBits) => table.reduce((r, p) => (r << 1n) | ((v >> BigInt(inBits - p)) & 1n), 0n);
const toBig = (b) => b.reduce((r, x) => (r << 8n) | BigInt(x), 0n);
const fromBig = (v, n) => { const o = new Uint8Array(n); for (let i = n - 1; i >= 0; i--) { o[i] = Number(v & 255n); v >>= 8n; } return o; };
let SP = null;
function desSchedule(key) {
  const k = permuteBits(toBig(key), PC1, 64);
  let c = k >> 28n, d = k & 0xfffffffn;
  return SHIFTS.map((s) => {
    const S = BigInt(s);
    c = ((c << S) | (c >> (28n - S))) & 0xfffffffn; d = ((d << S) | (d >> (28n - S))) & 0xfffffffn;
    const sub = permuteBits((c << 28n) | d, PC2, 56);
    return Array.from({ length: 8 }, (_, i) => Number((sub >> BigInt(42 - 6 * i)) & 63n));
  });
}
function desBlock(block, ks) {
  if (!SP) SP = SBOX.map((box, i) => Int32Array.from({ length: 64 }, (_, x) => {
    const v = box[((x & 32) | ((x & 1) << 4)) | ((x >> 1) & 15)];
    return Number(permuteBits(BigInt(v) << BigInt(28 - 4 * i), PP, 32)) | 0;
  }));
  const v = permuteBits(toBig(block), IP, 64);
  let l = Number(v >> 32n) | 0, r = Number(v & 0xffffffffn) | 0;
  for (const k of ks) {
    let f = 0;
    for (let i = 0; i < 8; i++) { // expansion E = six consecutive bits (cyclic) per S-box
      const rot = (4 * i + 5) & 31;
      const six = ((r << rot) | (r >>> (32 - rot))) & 63;
      f |= SP[i][six ^ k[i]];
    }
    const next = l ^ f; l = r; r = next;
  }
  return fromBig(permuteBits((BigInt(r >>> 0) << 32n) | BigInt(l >>> 0), FP, 64), 8);
}
export function desKey(key) {
  if (key.length !== 8) throw new Error("DES key must be exactly 8 bytes (got " + key.length + ")");
  const ks = desSchedule(key), rev = ks.slice().reverse();
  return { block: 8, encrypt: (b) => desBlock(b, ks), decrypt: (b) => desBlock(b, rev) };
}
export function tripleDesKey(key) {
  if (key.length !== 16 && key.length !== 24) throw new Error("Triple DES key must be 16 or 24 bytes (got " + key.length + ")");
  const a = desKey(key.subarray(0, 8)), b = desKey(key.subarray(8, 16)), c = key.length === 24 ? desKey(key.subarray(16)) : a;
  return { block: 8, encrypt: (x) => c.encrypt(b.decrypt(a.encrypt(x))), decrypt: (x) => a.decrypt(b.encrypt(c.decrypt(x))) };
}

// ── SPECK (words are little-endian, key bytes as in the NSA implementation guide) ─
export const SPECK_VARIANTS = {
  "32/64": [16, 4, 22], "48/72": [24, 3, 22], "48/96": [24, 4, 23], "64/96": [32, 3, 26], "64/128": [32, 4, 27],
  "96/96": [48, 2, 28], "96/144": [48, 3, 29], "128/128": [64, 2, 32], "128/192": [64, 3, 33], "128/256": [64, 4, 34]
};
export function speckKey(key, variant) {
  const spec = SPECK_VARIANTS[variant];
  if (!spec) throw new Error("Unknown SPECK variant");
  const [n, m, T] = spec, wb = n / 8;
  if (key.length !== wb * m) throw new Error("SPECK " + variant + " needs a " + wb * m + "-byte key (got " + key.length + ")");
  const N = BigInt(n), mask = (1n << N) - 1n, a = n === 16 ? 7n : 8n, b = n === 16 ? 2n : 3n;
  const ror = (x, r) => ((x >> r) | (x << (N - r))) & mask, rol = (x, r) => ((x << r) | (x >> (N - r))) & mask;
  const read = (d, o) => { let v = 0n; for (let i = wb - 1; i >= 0; i--) v = (v << 8n) | BigInt(d[o + i]); return v; };
  const write = (d, o, v) => { for (let i = 0; i < wb; i++) { d[o + i] = Number(v & 255n); v >>= 8n; } };
  const k = [read(key, 0)], l = [];
  for (let i = 1; i < m; i++) l.push(read(key, i * wb));
  for (let i = 0; i < T - 1; i++) { l.push(((k[i] + ror(l[i], a)) & mask) ^ BigInt(i)); k.push(rol(k[i], b) ^ l[i + m - 1]); }
  return {
    block: 2 * wb,
    encrypt(blk) { let y = read(blk, 0), x = read(blk, wb); for (let i = 0; i < T; i++) { x = ((ror(x, a) + y) & mask) ^ k[i]; y = rol(y, b) ^ x; } const o = new Uint8Array(2 * wb); write(o, 0, y); write(o, wb, x); return o; },
    decrypt(blk) { let y = read(blk, 0), x = read(blk, wb); for (let i = T - 1; i >= 0; i--) { y = ror(y ^ x, b); x = rol(((x ^ k[i]) - y) & mask, a); } const o = new Uint8Array(2 * wb); write(o, 0, y); write(o, wb, x); return o; }
  };
}

// ── Block modes and padding ──────────────────────────────────────────────────
export const PADDINGS = ["PKCS7", "ISO7816", "ANSIX923", "ISO10126", "Zero", "None"];
function padTo(d, bs, how) {
  if (how === "None") { if (d.length % bs) throw new Error("Without padding the input length must be a multiple of " + bs + " bytes"); return d; }
  let n = bs - (d.length % bs);
  if (how === "Zero") n %= bs;
  const o = new Uint8Array(d.length + n);
  o.set(d);
  if (how === "PKCS7") o.fill(n, d.length);
  else if (how === "ISO7816") o[d.length] = 0x80;
  else if (how === "ANSIX923") o[o.length - 1] = n;
  else if (how === "ISO10126") { crypto.getRandomValues(o.subarray(d.length)); o[o.length - 1] = n; }
  return o;
}
function unpad(d, bs, how) {
  if (how === "None") return d;
  let end = d.length;
  const bad = () => { throw new Error("Decryption failed: wrong key, IV, mode or padding"); };
  if (how === "Zero") { while (end && d[end - 1] === 0) end--; }
  else if (how === "ISO7816") { while (end && d[end - 1] === 0) end--; if (d[--end] !== 0x80) bad(); }
  else {
    const n = d[end - 1];
    if (!(n >= 1 && n <= bs && n <= end)) bad();
    if (how === "PKCS7") for (let i = end - n; i < end; i++) if (d[i] !== n) bad();
    if (how === "ANSIX923") for (let i = end - n; i < end - 1; i++) if (d[i] !== 0) bad();
    end -= n;
  }
  return d.subarray(0, end);
}
export function blockCrypt(c, mode, decrypt, data, iv, padding = "PKCS7") {
  const bs = c.block, padded = mode === "ECB" || mode === "CBC";
  if (mode !== "ECB" && iv.length !== bs) throw new Error(mode + " needs a " + bs + "-byte IV (got " + iv.length + ")");
  const input = padded && !decrypt ? padTo(data, bs, padding) : data;
  if (padded && decrypt && (data.length % bs || !data.length)) throw new Error("Ciphertext length must be a multiple of " + bs + " bytes");
  const out = new Uint8Array(input.length);
  let reg = mode === "ECB" ? null : Uint8Array.from(iv);
  for (let o = 0; o < input.length; o += bs) {
    const blk = input.subarray(o, o + bs);
    if (mode === "ECB") out.set(decrypt ? c.decrypt(blk) : c.encrypt(blk), o);
    else if (mode === "CBC") {
      if (decrypt) { const p = c.decrypt(blk); for (let i = 0; i < bs; i++) out[o + i] = p[i] ^ reg[i]; reg = blk; }
      else { reg = c.encrypt(blk.map((x, i) => x ^ reg[i])); out.set(reg, o); }
    } else {
      const ks = c.encrypt(reg);
      for (let i = 0; i < blk.length; i++) out[o + i] = blk[i] ^ ks[i];
      if (mode === "CFB") reg = Uint8Array.from(decrypt ? blk : out.subarray(o, o + bs));
      else if (mode === "OFB") reg = ks;
      else if (mode === "CTR") { for (let i = bs - 1; i >= 0; i--) { reg[i] = (reg[i] + 1) & 255; if (reg[i]) break; } }
      else throw new Error("Unknown mode " + mode);
    }
  }
  return padded && decrypt ? unpad(out, bs, padding).slice() : out;
}

export function rc4(key, data, drop = 0) {
  if (!key.length || key.length > 256) throw new Error("RC4 key must be 1–256 bytes");
  const S = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; [S[i], S[j]] = [S[j], S[i]]; }
  let i = 0, j = 0;
  const next = () => { i = (i + 1) & 255; j = (j + S[i]) & 255; [S[i], S[j]] = [S[j], S[i]]; return S[(S[i] + S[j]) & 255]; };
  for (let k = 0; k < drop; k++) next();
  return data.map((b) => b ^ next());
}

// ── ChaCha20 and Poly1305 (RFC 8439) ─────────────────────────────────────────
export function chacha20(key, nonce, data, counter = 1) {
  if (key.length !== 32) throw new Error("ChaCha20 key must be 32 bytes (got " + key.length + ")");
  if (nonce.length !== 12 && nonce.length !== 8) throw new Error("Nonce must be 12 bytes (IETF) or 8 bytes (original)");
  const kv = new DataView(Uint8Array.from(key).buffer), nv = new DataView(Uint8Array.from(nonce).buffer);
  const st = new Int32Array(16);
  st.set([0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
  for (let i = 0; i < 8; i++) st[4 + i] = kv.getInt32(4 * i, true);
  st[12] = counter | 0;
  const first = nonce.length === 12 ? 13 : 14;
  for (let i = 0; i < nonce.length / 4; i++) st[first + i] = nv.getInt32(4 * i, true);
  const out = new Uint8Array(data.length), x = new Int32Array(16);
  const q = (a, b, c, d) => {
    let t;
    x[a] += x[b]; t = x[d] ^ x[a]; x[d] = (t << 16) | (t >>> 16);
    x[c] += x[d]; t = x[b] ^ x[c]; x[b] = (t << 12) | (t >>> 20);
    x[a] += x[b]; t = x[d] ^ x[a]; x[d] = (t << 8) | (t >>> 24);
    x[c] += x[d]; t = x[b] ^ x[c]; x[b] = (t << 7) | (t >>> 25);
  };
  for (let o = 0; o < data.length; o += 64) {
    x.set(st);
    for (let r = 0; r < 10; r++) { q(0,4,8,12); q(1,5,9,13); q(2,6,10,14); q(3,7,11,15); q(0,5,10,15); q(1,6,11,12); q(2,7,8,13); q(3,4,9,14); }
    for (let i = 0; i < 64 && o + i < data.length; i++) out[o + i] = data[o + i] ^ (((x[i >> 2] + st[i >> 2]) >>> (8 * (i & 3))) & 255);
    st[12]++;
    if (st[12] === 0 && nonce.length === 8) st[13]++;
  }
  return out;
}
const leBig = (b) => { let v = 0n; for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]); return v; };
export function poly1305(key, msg) {
  const r = leBig(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn, s = leBig(key.subarray(16, 32)), P = (1n << 130n) - 5n;
  let a = 0n;
  for (let o = 0; o < msg.length; o += 16) { const b = msg.subarray(o, o + 16); a = ((a + leBig(b) + (1n << BigInt(8 * b.length))) * r) % P; }
  a += s;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) { out[i] = Number(a & 255n); a >>= 8n; }
  return out;
}
function aeadTag(key, nonce, ct, aad) {
  const otk = chacha20(key, nonce, new Uint8Array(32), 0);
  const pad16 = (n) => new Uint8Array((16 - (n % 16)) % 16);
  const len = (n) => { const o = new Uint8Array(8); new DataView(o.buffer).setBigUint64(0, BigInt(n), true); return o; };
  return poly1305(otk, concat(aad, pad16(aad.length), ct, pad16(ct.length), len(aad.length), len(ct.length)));
}
export function chachaPolyEncrypt(key, nonce, data, aad = new Uint8Array(0)) {
  if (nonce.length !== 12) throw new Error("ChaCha20-Poly1305 needs a 12-byte nonce");
  const ct = chacha20(key, nonce, data, 1);
  return { ct, tag: aeadTag(key, nonce, ct, aad) };
}
export function chachaPolyDecrypt(key, nonce, ct, tag, aad = new Uint8Array(0)) {
  if (nonce.length !== 12) throw new Error("ChaCha20-Poly1305 needs a 12-byte nonce");
  if (!equal(aeadTag(key, nonce, ct, aad), tag)) throw new Error("Authentication failed: wrong key, nonce, AAD, tag or ciphertext");
  return chacha20(key, nonce, ct, 1);
}

// ── XXTEA ────────────────────────────────────────────────────────────────────
export function xxtea(data, key, decrypt, includeLength = true) {
  const k = new Uint8Array(16);
  k.set(key.subarray(0, 16));
  const words = (b, len) => { const n = Math.ceil(b.length / 4), v = new Uint32Array(n + (len ? 1 : 0)); b.forEach((x, i) => (v[i >> 2] |= x << (8 * (i & 3)))); if (len) v[n] = b.length; return v; };
  if (!data.length) return new Uint8Array(0);
  if (decrypt && (data.length % 4 || data.length < 8)) throw new Error("XXTEA ciphertext must be at least 8 bytes and a multiple of 4");
  if (!includeLength && !decrypt && (data.length % 4 || data.length < 8)) throw new Error("Without the length word, input must be ≥ 8 bytes and a multiple of 4");
  const v = words(data, includeLength && !decrypt), kw = words(k, false), n = v.length - 1;
  const mx = (z, y, sum, p, e) => ((((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^ ((sum ^ y) + (kw[(p & 3) ^ e] ^ z)));
  let rounds = Math.floor(6 + 52 / (n + 1));
  const DELTA = 0x9e3779b9;
  if (n >= 1) {
    if (!decrypt) {
      let z = v[n], sum = 0;
      while (rounds--) { sum = (sum + DELTA) >>> 0; const e = (sum >>> 2) & 3; for (let p = 0; p <= n; p++) { const y = v[(p + 1) % (n + 1)]; z = v[p] = v[p] + mx(z, y, sum, p, e); } }
    } else {
      let y = v[0], sum = Math.imul(rounds, DELTA) >>> 0;
      while (rounds--) { const e = (sum >>> 2) & 3; for (let p = n; p >= 0; p--) { const z = v[(p + n) % (n + 1)]; y = v[p] = v[p] - mx(z, y, sum, p, e); } sum = (sum - DELTA) >>> 0; }
    }
  }
  const out = new Uint8Array(v.length * 4);
  v.forEach((x, i) => { for (let j = 0; j < 4; j++) out[i * 4 + j] = (x >>> (8 * j)) & 255; });
  if (decrypt && includeLength) {
    const len = v[n];
    if (len < out.length - 7 || len > out.length - 4) throw new Error("Decryption failed: wrong key or data");
    return out.slice(0, len);
  }
  return out;
}
