// GZIP, DEFLATE (native streams), LZMA family, ZIP, TAR, plus Brotli / Zstandard through WASM.
import { crcRaw, crc32, sha256 } from "./hash.js";
import { concat, utf8, text, equal } from "./bytes.js";

const MAX_OUT = 256 * 1024 * 1024;
const tooBig = () => { throw new Error("Output is larger than 256 MB; stopped to protect the browser"); };
const u16 = (n) => Uint8Array.of(n, n >>> 8);
const u32 = (n) => Uint8Array.of(n, n >>> 8, n >>> 16, n >>> 24);
const u64 = (n) => concat(u32(n % 4294967296), u32(Math.floor(n / 4294967296)));
const rd16 = (d, o) => d[o] | (d[o + 1] << 8);
const rd32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const rd64 = (d, o) => rd32(d, o) + rd32(d, o + 4) * 4294967296;

/** Growable byte buffer. */
class Sink {
  constructor() { this.b = new Uint8Array(4096); this.n = 0; }
  room(k) { if (this.n + k <= this.b.length) return; if (this.n + k > MAX_OUT) tooBig(); const c = new Uint8Array(Math.max(this.b.length * 2, this.n + k)); c.set(this.b.subarray(0, this.n)); this.b = c; }
  push(x) { if (this.n === this.b.length) this.room(1); this.b[this.n++] = x; }
  add(a) { this.room(a.length); this.b.set(a, this.n); this.n += a.length; }
  bytes() { return this.b.slice(0, this.n); }
}

async function pipe(stream, data) {
  const writer = stream.writable.getWriter();
  const writing = writer.write(data).then(() => writer.close());
  writing.catch(() => {});
  const reader = stream.readable.getReader(), out = new Sink();
  for (;;) { const { value, done } = await reader.read(); if (done) break; out.add(value); }
  await writing;
  return out.bytes();
}
export async function deflate(data, format = "deflate-raw") { return pipe(new CompressionStream(format), data); }
export async function inflate(data, format = "deflate-raw") {
  try { return await pipe(new DecompressionStream(format), data); }
  catch (e) { throw new Error("Could not decompress: not valid " + format + " data" + (e && e.message ? " (" + e.message + ")" : "")); }
}
export async function gzipCreate(data, name = "") {
  const head = Uint8Array.of(31, 139, 8, name ? 8 : 0, ...u32((Date.now() / 1000) | 0), 0, 255);
  return concat(head, name ? concat(utf8(name.replace(/\0/g, "")), Uint8Array.of(0)) : new Uint8Array(0), await deflate(data), u32(crc32(data)), u32(data.length >>> 0));
}
export function gzipName(d) {
  if (d[0] !== 31 || d[1] !== 139) throw new Error("Not a gzip file");
  let o = 10;
  if (d[3] & 4) o += 2 + rd16(d, o);
  if (!(d[3] & 8)) return "";
  const end = d.indexOf(0, o);
  return text(d.subarray(o, end < 0 ? d.length : end));
}

// ── LZMA core ────────────────────────────────────────────────────────────────
const probs = (n) => new Uint16Array(n).fill(1024);
class Model {
  constructor(lc, lp, pb) {
    this.lc = lc; this.lp = lp; this.pb = pb;
    this.lit = probs(0x300 << (lc + lp));
    this.isMatch = probs(192); this.isRep = probs(12); this.isRep0 = probs(12); this.isRep1 = probs(12); this.isRep2 = probs(12); this.isRep0Long = probs(192);
    this.slot = [0, 1, 2, 3].map(() => probs(64)); this.special = probs(128); this.align = probs(16);
    const len = () => ({ c: probs(2), low: Array.from({ length: 16 }, () => probs(8)), mid: Array.from({ length: 16 }, () => probs(8)), high: probs(256) });
    this.len = len(); this.repLen = len();
    this.state = 0; this.reps = [0, 0, 0, 0];
  }
}
function decoderFor(data, start) {
  let pos = start + 5, range = 0xffffffff, code = ((data[start + 1] << 24) | (data[start + 2] << 16) | (data[start + 3] << 8) | data[start + 4]) >>> 0;
  if (data[start] !== 0) throw new Error("Corrupt LZMA stream");
  const norm = () => { if (range < 0x1000000) { if (pos >= data.length) throw new Error("LZMA data ends unexpectedly"); range = (range * 256) >>> 0; code = (code * 256 + data[pos++]) >>> 0; } };
  const bit = (p, i) => {
    const v = p[i], bound = (range >>> 11) * v;
    let r;
    if (code < bound) { range = bound; p[i] = v + ((2048 - v) >> 5); r = 0; }
    else { range -= bound; code -= bound; p[i] = v - (v >> 5); r = 1; }
    norm();
    return r;
  };
  const tree = (p, n) => { let m = 1; for (let i = 0; i < n; i++) m = (m << 1) | bit(p, m); return m - (1 << n); };
  const reverse = (p, base, n) => { let m = 1, s = 0; for (let i = 0; i < n; i++) { const b = bit(p, base + m); m = (m << 1) | b; s |= b << i; } return s; };
  const direct = (n) => { let r = 0; while (n--) { range >>>= 1; let b = 0; if (code >= range) { code -= range; b = 1; } r = r * 2 + b; norm(); } return r; };
  return { bit, tree, reverse, direct, pos: () => pos, done: () => code === 0 };
}
/** Decode until `end` bytes are in the sink, or (end < 0) until the end marker. */
function lzmaDecode(rc, m, out, dictStart, end) {
  const length = (l, ps) => (!rc.bit(l.c, 0) ? 2 + rc.tree(l.low[ps], 3) : !rc.bit(l.c, 1) ? 10 + rc.tree(l.mid[ps], 3) : 18 + rc.tree(l.high, 8));
  for (;;) {
    if (end >= 0 && out.n >= end) return;
    const rel = out.n - dictStart, ps = rel & ((1 << m.pb) - 1), st = m.state;
    if (!rc.bit(m.isMatch, (st << 4) + ps)) {
      const prev = rel ? out.b[out.n - 1] : 0;
      const base = 0x300 * (((rel & ((1 << m.lp) - 1)) << m.lc) + (prev >> (8 - m.lc)));
      let s = 1;
      if (st >= 7) {
        if (m.reps[0] >= rel) throw new Error("Corrupt LZMA data");
        let match = out.b[out.n - m.reps[0] - 1];
        while (s < 0x100) {
          const mb = (match >> 7) & 1; match <<= 1;
          const b = rc.bit(m.lit, base + ((1 + mb) << 8) + s);
          s = (s << 1) | b;
          if (mb !== b) break;
        }
      }
      while (s < 0x100) s = (s << 1) | rc.bit(m.lit, base + s);
      out.push(s & 255);
      m.state = st < 4 ? 0 : st < 10 ? st - 3 : st - 6;
      continue;
    }
    let len;
    if (rc.bit(m.isRep, st)) {
      if (!rel) throw new Error("Corrupt LZMA data");
      if (!rc.bit(m.isRep0, st)) {
        if (!rc.bit(m.isRep0Long, (st << 4) + ps)) {
          if (m.reps[0] >= rel) throw new Error("Corrupt LZMA data");
          m.state = st < 7 ? 9 : 11;
          out.push(out.b[out.n - m.reps[0] - 1]);
          continue;
        }
      } else {
        let k = 1;
        if (rc.bit(m.isRep1, st)) k = rc.bit(m.isRep2, st) ? 3 : 2;
        const d = m.reps[k];
        for (; k > 0; k--) m.reps[k] = m.reps[k - 1];
        m.reps[0] = d;
      }
      len = length(m.repLen, ps);
      m.state = st < 7 ? 8 : 11;
    } else {
      m.reps.pop(); m.reps.unshift(0);
      len = length(m.len, ps);
      m.state = st < 7 ? 7 : 10;
      const slot = rc.tree(m.slot[Math.min(len - 2, 3)], 6);
      let dist = slot;
      if (slot >= 4) {
        const n = (slot >> 1) - 1;
        dist = (2 | (slot & 1)) * 2 ** n;
        if (slot < 14) dist += rc.reverse(m.special, dist - slot - 1, n);
        else dist += rc.direct(n - 4) * 16 + rc.reverse(m.align, 0, 4);
      }
      m.reps[0] = dist;
      if (dist === 0xffffffff) { if (!rc.done()) throw new Error("Corrupt LZMA end marker"); if (end >= 0 && out.n !== end) throw new Error("LZMA data is shorter than declared"); return; }
    }
    if (m.reps[0] >= out.n - dictStart) throw new Error("Corrupt LZMA data: distance outside the window");
    if (end >= 0 && out.n + len > end) throw new Error("Corrupt LZMA data: output overruns declared size");
    out.room(len);
    for (let i = 0, s = out.n - m.reps[0] - 1; i < len; i++) out.b[out.n++] = out.b[s + i];
  }
}

/** Greedy LZ77 + range coder (lc=3, lp=0, pb=2). Valid LZMA; ratio is below xz -9. */
function lzmaEncode(data, endMarker) {
  const m = new Model(3, 0, 2), out = new Sink();
  let low = 0, range = 0xffffffff, cache = 0, pending = 1;
  const shift = () => {
    if (low < 0xff000000 || low >= 0x100000000) {
      const carry = low >= 0x100000000 ? 1 : 0;
      let t = cache;
      do { out.push((t + carry) & 255); t = 255; } while (--pending);
      cache = Math.floor(low / 0x1000000) & 255;
    }
    pending++;
    low = (low % 0x1000000) * 256;
  };
  const bit = (p, i, b) => {
    const v = p[i], bound = (range >>> 11) * v;
    if (!b) { range = bound; p[i] = v + ((2048 - v) >> 5); }
    else { low += bound; range -= bound; p[i] = v - (v >> 5); }
    while (range < 0x1000000) { range = (range * 256) >>> 0; shift(); }
  };
  const tree = (p, n, s) => { let x = 1; for (let i = n - 1; i >= 0; i--) { const b = (s >>> i) & 1; bit(p, x, b); x = (x << 1) | b; } };
  const reverse = (p, base, n, s) => { let x = 1; for (let i = 0; i < n; i++) { const b = (s >>> i) & 1; bit(p, base + x, b); x = (x << 1) | b; } };
  const direct = (v, n) => { for (let i = n - 1; i >= 0; i--) { range >>>= 1; if (Math.floor(v / 2 ** i) % 2) low += range; while (range < 0x1000000) { range = (range * 256) >>> 0; shift(); } } };
  const match = (len, dist, ps) => {
    const st = m.state;
    bit(m.isMatch, (st << 4) + ps, 1); bit(m.isRep, st, 0);
    const l = len - 2;
    if (l < 8) { bit(m.len.c, 0, 0); tree(m.len.low[ps], 3, l); }
    else if (l < 16) { bit(m.len.c, 0, 1); bit(m.len.c, 1, 0); tree(m.len.mid[ps], 3, l - 8); }
    else { bit(m.len.c, 0, 1); bit(m.len.c, 1, 1); tree(m.len.high, 8, l - 16); }
    const hb = dist >= 4 ? 31 - Math.clz32(dist >>> 0) : 0;
    const slot = dist < 4 ? dist : 2 * hb + ((dist >>> (hb - 1)) & 1);
    tree(m.slot[Math.min(l, 3)], 6, slot);
    if (slot >= 4) {
      const n = (slot >> 1) - 1, base = (2 | (slot & 1)) * 2 ** n, rest = dist - base;
      if (slot < 14) reverse(m.special, base - slot - 1, n, rest);
      else { direct(Math.floor(rest / 16), n - 4); reverse(m.align, 0, 4, rest % 16); }
    }
    m.state = st < 7 ? 7 : 10;
    m.reps.pop(); m.reps.unshift(dist);
  };
  const head = new Int32Array(1 << 16).fill(-1), chain = new Int32Array(data.length);
  const hash = (i) => (Math.imul(data[i] | (data[i + 1] << 8) | (data[i + 2] << 16), 0x9e3779b1) >>> 16);
  const insert = (i) => { if (i + 2 < data.length) { const h = hash(i); chain[i] = head[h]; head[h] = i; } };
  for (let i = 0; i < data.length; ) {
    let best = 0, dist = 0;
    if (i + 2 < data.length) {
      for (let j = head[hash(i)], tries = 48; j >= 0 && tries && i - j <= 1 << 23; j = chain[j], tries--) {
        let n = 0;
        while (n < 273 && i + n < data.length && data[j + n] === data[i + n]) n++;
        if (n > best) { best = n; dist = i - j - 1; if (n === 273) break; }
      }
    }
    const ps = i & 3;
    if (best >= 4 || (best === 3 && dist < 4096)) {
      match(best, dist, ps);
      for (let k = 0; k < best; k++) insert(i + k);
      i += best;
    } else {
      const st = m.state, prev = i ? data[i - 1] : 0, base = 0x300 * (prev >> 5), c = data[i];
      bit(m.isMatch, (st << 4) + ps, 0);
      let s = 1;
      if (st >= 7) {
        const mbyte = data[i - m.reps[0] - 1];
        let same = true;
        for (let k = 7; k >= 0; k--) {
          const b = (c >> k) & 1;
          if (same) { const mb = (mbyte >> k) & 1; bit(m.lit, base + ((1 + mb) << 8) + s, b); same = mb === b; }
          else bit(m.lit, base + s, b);
          s = (s << 1) | b;
        }
      } else for (let k = 7; k >= 0; k--) { const b = (c >> k) & 1; bit(m.lit, base + s, b); s = (s << 1) | b; }
      m.state = st < 4 ? 0 : st < 10 ? st - 3 : st - 6;
      insert(i); i++;
    }
  }
  if (endMarker) match(2, 0xffffffff, data.length & 3);
  for (let i = 0; i < 5; i++) shift();
  return out.bytes();
}
const PROPS = 93; // (pb*5 + lp)*9 + lc  for 3/0/2
function modelFrom(p) {
  if (p >= 225) throw new Error("Invalid LZMA properties");
  const lc = p % 9, rest = (p / 9) | 0, lp = rest % 5, pb = (rest / 5) | 0;
  return new Model(lc, lp, pb);
}

// ── LZMA-Alone (.lzma) ───────────────────────────────────────────────────────
export function lzmaCompress(data) { return concat(Uint8Array.of(PROPS), u32(1 << 23), new Uint8Array(8).fill(255), lzmaEncode(data, true)); }
export function lzmaDecompress(d) {
  if (d.length < 18) throw new Error("Not an .lzma file");
  const unknown = d.subarray(5, 13).every((x) => x === 255), size = unknown ? -1 : rd64(d, 5);
  if (size > MAX_OUT) tooBig();
  const m = modelFrom(d[0]), out = new Sink();
  lzmaDecode(decoderFor(d, 13), m, out, 0, size);
  return out.bytes();
}
// ── LZIP (.lz) ───────────────────────────────────────────────────────────────
export function lzipCompress(data) {
  const body = lzmaEncode(data, true);
  return concat(utf8("LZIP"), Uint8Array.of(1, 23), body, u32(crc32(data)), u64(data.length), u64(body.length + 26));
}
export function lzipDecompress(d) {
  const out = new Sink();
  let o = 0;
  while (o + 26 <= d.length && text(d.subarray(o, o + 4)) === "LZIP") {
    if (d[o + 4] !== 1) throw new Error("Unsupported lzip version");
    const rc = decoderFor(d, o + 6), start = out.n;
    lzmaDecode(rc, new Model(3, 0, 2), out, start, -1);
    const t = rc.pos();
    if (t + 20 > d.length || rd32(d, t) !== crc32(out.b.subarray(start, out.n)) || rd64(d, t + 4) !== out.n - start) throw new Error("lzip integrity check failed");
    o = t + 20;
  }
  if (!o) throw new Error("Not an lzip file");
  return out.bytes();
}
// ── XZ ───────────────────────────────────────────────────────────────────────
const XZ_MAGIC = Uint8Array.of(0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00);
const crc64 = (d) => crcRaw(d, 64, 0x42f0e1eba9ea3693n, 0xffffffffffffffffn, true, true, 0xffffffffffffffffn);
const vli = (n) => { const o = []; while (n >= 128) { o.push((n % 128) | 128); n = Math.floor(n / 128); } o.push(n); return Uint8Array.from(o); };
export function xzCompress(data) {
  const flags = Uint8Array.of(0, 1); // CRC32 check
  const chunks = [];
  for (let o = 0; o < data.length; o += 65536) {
    const part = data.subarray(o, o + 65536), packed = lzmaEncode(part, false), n = part.length - 1;
    if (packed.length < part.length && packed.length <= 65536) chunks.push(Uint8Array.of(0xe0, n >> 8, n, (packed.length - 1) >> 8, packed.length - 1, PROPS), packed);
    else chunks.push(Uint8Array.of(1, n >> 8, n), part);
  }
  chunks.push(Uint8Array.of(0));
  const lz = concat(...chunks);
  const bh = concat(Uint8Array.of(2, 0, 0x21, 1, 22), new Uint8Array(3)); // 12-byte header, LZMA2, 8 MiB dictionary
  const block = data.length ? concat(bh, u32(crc32(bh)), lz, new Uint8Array((4 - (lz.length % 4)) % 4), u32(crc32(data))) : new Uint8Array(0);
  let index = concat(Uint8Array.of(0), vli(data.length ? 1 : 0), data.length ? concat(vli(12 + lz.length + 4), vli(data.length)) : new Uint8Array(0));
  index = concat(index, new Uint8Array((4 - (index.length % 4)) % 4));
  index = concat(index, u32(crc32(index)));
  const back = concat(u32(index.length / 4 - 1), flags);
  return concat(XZ_MAGIC, flags, u32(crc32(flags)), block, index, u32(crc32(back)), back, Uint8Array.of(0x59, 0x5a));
}
function lzma2(d, o, out) {
  let m = null, dictStart = out.n;
  for (;;) {
    const c = d[o++];
    if (c === undefined) throw new Error("XZ data ends unexpectedly");
    if (c === 0) return o;
    if (c < 3) {
      const n = ((d[o] << 8) | d[o + 1]) + 1; o += 2;
      if (c === 1) dictStart = out.n;
      if (o + n > d.length) throw new Error("XZ data ends unexpectedly");
      out.add(d.subarray(o, o + n)); o += n;
      continue;
    }
    if (c < 128) throw new Error("Corrupt LZMA2 stream");
    const size = (c & 31) * 65536 + ((d[o] << 8) | d[o + 1]) + 1, packed = ((d[o + 2] << 8) | d[o + 3]) + 1, mode = (c >> 5) & 3;
    o += 4;
    if (mode >= 2) m = modelFrom(d[o++]);
    else if (!m) throw new Error("Corrupt LZMA2 stream");
    else if (mode === 1) m = new Model(m.lc, m.lp, m.pb);
    if (mode === 3) dictStart = out.n;
    lzmaDecode(decoderFor(d.subarray(0, o + packed), o), m, out, dictStart, out.n + size);
    o += packed;
  }
}
export function xzDecompress(d) {
  const out = new Sink();
  let o = 0;
  while (o + 12 <= d.length && equal(d.subarray(o, o + 6), XZ_MAGIC)) {
    const check = d[o + 7] & 15;
    if (rd32(d, o + 8) !== crc32(d.subarray(o + 6, o + 8))) throw new Error("Corrupt XZ header");
    const csize = check === 0 ? 0 : 4 << Math.floor((check - 1) / 3);
    o += 12;
    while (d[o] !== 0) {
      const hs = (d[o] + 1) * 4;
      if (o + hs > d.length || rd32(d, o + hs - 4) !== crc32(d.subarray(o, o + hs - 4))) throw new Error("Corrupt XZ block header");
      const flags = d[o + 1];
      let p = o + 2;
      const readV = () => { let v = 0, mul = 1, b; do { b = d[p++]; v += (b & 127) * mul; mul *= 128; } while (b & 128); return v; };
      if (flags & 0x40) readV();
      if (flags & 0x80) readV();
      if ((flags & 3) !== 0 || readV() !== 0x21) throw new Error("Only XZ files using the plain LZMA2 filter are supported (no BCJ/Delta)");
      const dataStart = o + hs, start = out.n;
      const end = lzma2(d, dataStart, out);
      o = end + ((4 - ((end - dataStart) % 4)) % 4);
      const got = out.b.subarray(start, out.n), want = d.subarray(o, o + csize);
      if (check === 1 && rd32(d, o) !== crc32(got)) throw new Error("XZ CRC32 check failed");
      if (check === 4) { let v = 0n; for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(want[i]); if (v !== crc64(got)) throw new Error("XZ CRC64 check failed"); }
      if (check === 10 && !equal(sha256(got), want)) throw new Error("XZ SHA-256 check failed");
      o += csize;
    }
    // skip index + footer, then any stream padding
    let p = o + 1;
    const readV = () => { let b; let v = 0, mul = 1; do { b = d[p++]; v += (b & 127) * mul; mul *= 128; } while (b & 128); return v; };
    for (let n = readV() * 2; n > 0; n--) readV();
    p += (4 - ((p - o) % 4)) % 4;
    o = p + 4 + 12;
    if (o > d.length) throw new Error("Truncated XZ file");
    while (o + 4 <= d.length && rd32(d, o) === 0) o += 4;
  }
  if (!o) throw new Error("Not an XZ file");
  return out.bytes();
}

// ── ZIP ──────────────────────────────────────────────────────────────────────
const dosTime = (d) => ({ t: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), d: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() });
/** files: [{ name, data }] */
export async function zipCreate(files) {
  if (files.length > 65535) throw new Error("Too many files");
  const parts = [], central = [], stamp = dosTime(new Date());
  let offset = 0;
  for (const f of files) {
    const name = utf8(f.name), packed = await deflate(f.data), store = packed.length >= f.data.length, body = store ? f.data : packed;
    const common = concat(u16(20), u16(0x800), u16(store ? 0 : 8), u16(stamp.t), u16(stamp.d), u32(crc32(f.data)), u32(body.length), u32(f.data.length), u16(name.length), u16(0));
    const local = concat(u32(0x04034b50), common, name, body);
    central.push(concat(u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset), name));
    parts.push(local); offset += local.length;
  }
  const cd = concat(...central);
  return concat(...parts, cd, u32(0x06054b50), u32(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0));
}
export async function zipExtract(d) {
  let e = d.length - 22;
  while (e >= 0 && rd32(d, e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("Not a ZIP file");
  const count = rd16(d, e + 10);
  let o = rd32(d, e + 16), total = 0;
  if (count === 0xffff || o === 0xffffffff) throw new Error("ZIP64 archives are not supported");
  const files = [];
  for (let i = 0; i < count; i++) {
    if (rd32(d, o) !== 0x02014b50) throw new Error("Corrupt ZIP directory");
    const flags = rd16(d, o + 8), method = rd16(d, o + 10), crc = rd32(d, o + 16), csize = rd32(d, o + 20), nlen = rd16(d, o + 28), local = rd32(d, o + 42);
    const name = text(d.subarray(o + 46, o + 46 + nlen));
    o += 46 + nlen + rd16(d, o + 30) + rd16(d, o + 32);
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error("Password-protected ZIP files are not supported");
    if (method !== 0 && method !== 8) throw new Error("Unsupported ZIP compression method " + method + " in " + name);
    const start = local + 30 + rd16(d, local + 26) + rd16(d, local + 28), raw = d.subarray(start, start + csize);
    const data = method === 8 ? await inflate(raw) : raw.slice();
    if (crc32(data) !== crc) throw new Error("CRC mismatch in " + name);
    if ((total += data.length) > MAX_OUT) tooBig();
    files.push({ name, data });
  }
  return files;
}
// ── TAR (ustar; long names via pax) ──────────────────────────────────────────
function tarHeader(name, size, type) {
  const h = new Uint8Array(512);
  const put = (s, o, n) => h.set(utf8(s).subarray(0, n), o);
  const oct = (v, o, n) => put(v.toString(8).padStart(n - 1, "0"), o, n - 1);
  put(name, 0, 100); oct(0o644, 100, 8); oct(0, 108, 8); oct(0, 116, 8); oct(size, 124, 12); oct((Date.now() / 1000) | 0, 136, 12);
  h.fill(32, 148, 156); put(type, 156, 1); put("ustar", 257, 5); put("00", 263, 2);
  const sum = h.reduce((a, b) => a + b, 0);
  put(sum.toString(8).padStart(6, "0"), 148, 6); h[154] = 0;
  return h;
}
const padded = (d) => concat(d, new Uint8Array((512 - (d.length % 512)) % 512));
export function tarCreate(files) {
  const parts = [];
  for (const f of files) {
    if (utf8(f.name).length > 100) {
      const body = utf8(" path=" + f.name + "\n");
      let len = body.length;
      while (String(len).length + body.length !== len) len = String(len).length + body.length;
      const rec = concat(utf8(String(len)), body);
      parts.push(tarHeader("PaxHeader", rec.length, "x"), padded(rec));
    }
    parts.push(tarHeader(f.name, f.data.length, "0"), padded(f.data));
  }
  parts.push(new Uint8Array(1024));
  return concat(...parts);
}
export function tarExtract(d) {
  const files = [];
  const str = (o, n) => { const s = d.subarray(o, o + n), z = s.indexOf(0); return text(z < 0 ? s : s.subarray(0, z)); };
  let long = null;
  for (let o = 0; o + 512 <= d.length; ) {
    if (d[o] === 0) break;
    const sum = d.subarray(o, o + 512).reduce((a, b, i) => a + (i >= 148 && i < 156 ? 32 : b), 0);
    if (parseInt(str(o + 148, 8).trim(), 8) !== sum) throw new Error("Not a TAR file (bad header checksum)");
    const size = parseInt(str(o + 124, 12).trim() || "0", 8), type = str(o + 156, 1) || "0";
    const prefix = str(o + 257, 5) === "ustar" ? str(o + 345, 155) : "";
    const name = long || (prefix ? prefix + "/" : "") + str(o, 100);
    const body = d.subarray(o + 512, o + 512 + size);
    if (body.length !== size) throw new Error("Truncated TAR file");
    long = null;
    if (type === "x") { const m = /\d+ path=([^\n]*)\n/.exec(text(body)); if (m) long = m[1]; }
    else if (type === "L") long = text(body).replace(/\0+$/, "");
    else if (type === "0" || type === "7") files.push({ name, data: body.slice() });
    o += 512 + Math.ceil(size / 512) * 512;
  }
  if (!files.length) throw new Error("No files found in the TAR archive");
  return files;
}

// ── Brotli / Zstandard: native stream when the browser has it, otherwise WASM from a CDN ─
const BROTLI_URL = "https://unpkg.com/brotli-wasm@3.0.1/index.web.js?module";
const ZSTD_BASE = "https://cdn.jsdelivr.net/npm/@bokuweb/zstd-wasm@0.0.21-alpha.5";
const native = (Ctor, f) => { try { new Ctor(f); return true; } catch (e) { return false; } };
let brotliLib = null, zstdLib = null;
async function loadBrotli() {
  try { return (brotliLib = brotliLib || (await (await import(BROTLI_URL)).default)); }
  catch (e) { throw new Error("Could not load the Brotli library (check your connection)"); }
}
async function loadZstd() {
  if (zstdLib) return zstdLib;
  try { const m = await import(ZSTD_BASE + "/+esm"); await m.init(ZSTD_BASE + "/dist/web/zstd.wasm"); return (zstdLib = m); }
  catch (e) {
    try { const m = await import(ZSTD_BASE + "/+esm"); await m.init(ZSTD_BASE + "/lib/wasm/zstd.wasm"); return (zstdLib = m); }
    catch (e2) { throw new Error("Could not load the Zstandard library (check your connection)"); }
  }
}
export async function brotliCompress(d) { return native(CompressionStream, "brotli") ? deflate(d, "brotli") : (await loadBrotli()).compress(d); }
export async function brotliDecompress(d) { return native(DecompressionStream, "brotli") ? inflate(d, "brotli") : (await loadBrotli()).decompress(d); }
export async function zstdCompress(d) { return native(CompressionStream, "zstd") ? deflate(d, "zstd") : (await loadZstd()).compress(d, 3); }
export async function zstdDecompress(d) { return native(DecompressionStream, "zstd") ? inflate(d, "zstd") : (await loadZstd()).decompress(d); }

/** Single-stream codecs: id → { ext, compress, decompress } */
export const CODECS = {
  gzip: { ext: "gz", compress: (d, name) => gzipCreate(d, name), decompress: (d) => inflate(d, "gzip") },
  brotli: { ext: "br", compress: brotliCompress, decompress: brotliDecompress },
  zstandard: { ext: "zst", compress: zstdCompress, decompress: zstdDecompress },
  xz: { ext: "xz", compress: async (d) => xzCompress(d), decompress: async (d) => xzDecompress(d) },
  lzip: { ext: "lz", compress: async (d) => lzipCompress(d), decompress: async (d) => lzipDecompress(d) },
  lzma: { ext: "lzma", compress: async (d) => lzmaCompress(d), decompress: async (d) => lzmaDecompress(d) }
};
