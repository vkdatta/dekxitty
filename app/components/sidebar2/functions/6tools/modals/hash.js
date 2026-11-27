import * as H from "../lib/hash.js";
import * as K from "../lib/keccak.js";
import { blake2b, blake2s, blake3 } from "../lib/blake.js";
import * as X from "../lib/xxhash.js";
import * as D from "../lib/kdf.js";
import { utf8, random, toHex } from "../lib/bytes.js";
import { select, input, secret, number, check, area, outField, keyed, val, out, int, ENC } from "./shared.js";

const G = "Hash";
const hash = (id, name, refs, fn, fields = []) => ({ id, name, group: G, icon: "encrypted", refs, input: "data", auto: true, action: "Hash",
  fields: [...fields, outField()], run: async (ctx, v) => out(await fn(await ctx.data(), v), v) });
const simple = (id, label, fn, file = true) => hash(id, label + " Hash", file ? [label, label + " File"] : [label], (d) => fn(d));
// WebCrypto is much faster for large files when the page is secure
const web = (alg, fallback) => async (d) => (globalThis.crypto && crypto.subtle ? new Uint8Array(await crypto.subtle.digest(alg, d)) : fallback(d));

const bytesLen = (def) => number("length", "Output length (bytes)", def);
const len = (v) => int(v, "length", "Output length", 1, 4096);
const custom = input("custom", "Customization string (S)", { optional: true });
const S = (v) => utf8(v.custom || "");
const seed = input("seed", "Seed (decimal or 0x hex)", { default: "0" });
const seedOf = (v) => { try { const n = BigInt(String(v.seed || "0").trim()); if (n < 0n || n >= 1n << 64n) throw 0; return n; } catch (e) { throw new Error("Seed must be an unsigned 64-bit integer"); } };
const hexParam = (v, key, label) => { const s = String(v[key] || "0").trim().replace(/^0x/i, ""); if (!/^[0-9a-f]+$/i.test(s)) throw new Error(label + " must be hex"); return BigInt("0x" + s); };

const crcTool = (id, name, refs, filter, def) => {
  const names = Object.keys(H.CRC_PRESETS).filter(filter);
  const custom = (v) => v.preset === "custom", w = Number(def.match(/CRC-(\d+)/)[1]);
  return hash(id, name, refs, (d, v) => {
    if (!custom(v)) return H.crcPreset(d, v.preset);
    const width = int(v, "width", "Width", 1, 64);
    return H.crc(d, width, hexParam(v, "poly", "Polynomial"), hexParam(v, "init", "Initial value"), !!v.refin, !!v.refout, hexParam(v, "xorout", "XOR out"));
  }, [select("preset", "Algorithm", [...names, { label: "Custom parameters", value: "custom" }], def),
    number("width", "Width (bits)", w, { showIf: custom }), input("poly", "Polynomial (hex)", { default: w === 16 ? "8005" : "04c11db7", showIf: custom }),
    input("init", "Initial value (hex)", { default: "0", showIf: custom }), input("xorout", "XOR out (hex)", { default: "0", showIf: custom }),
    check("refin", "Reflect input", true, { showIf: custom }), check("refout", "Reflect output", true, { showIf: custom })]);
};

const xx = { XXH32: X.xxh32, XXH64: X.xxh64, XXH3: X.xxh3_64, XXH128: X.xxh3_128 };
const digestNames = Object.keys(D.DIGESTS);
const kdfBase = (extra) => [...keyed("password", "Password", "utf8", { secret: true }), ...extra, outField()];
const saltFields = keyed("salt", "Salt", "utf8", { optional: true });
const gen = (id, name, refs, fields, run) => ({ id, name, group: G, icon: "key", refs, input: "none", fields, run, action: "Generate" });

const argonFields = [select("type", "Variant", ["argon2id", "argon2i", "argon2d"]), number("t", "Iterations", 3), number("m", "Memory (KiB)", 4096), number("p", "Parallelism", 1), number("length", "Hash length (bytes)", 32)];
const argonOpts = (v) => ({ t: int(v, "t", "Iterations", 1, 1000), m: int(v, "m", "Memory", 8, 262144), p: int(v, "p", "Parallelism", 1, 64), length: int(v, "length", "Length", 4, 1024), secret: utf8(v.pepper || "") });
const scryptFields = [number("N", "Cost N (power of two)", 16384), number("r", "Block size r", 8), number("p", "Parallelism p", 1), number("length", "Key length (bytes)", 32)];
const verdict = (ok) => (ok ? "✔ Match: the password matches this hash" : "✘ No match: the password does not match this hash");

export default [
  crcTool("crc", "CRC (all widths)", ["CRC"], () => true, "CRC-32/ISO-HDLC"),
  crcTool("crc16", "CRC-16", ["CRC-16"], (n) => n.startsWith("CRC-16/"), "CRC-16/ARC"),
  crcTool("crc32", "CRC-32", ["CRC-32"], (n) => n.startsWith("CRC-32/"), "CRC-32/ISO-HDLC"),
  simple("adler32", "Adler-32", H.adler32, false),
  hash("xxhash", "XXHash", ["XXHash"], (d, v) => xx[v.variant](d, seedOf(v)), [select("variant", "Variant", Object.keys(xx), "XXH64"), seed]),
  ...Object.entries(xx).map(([n, fn]) => hash(n.toLowerCase(), n + " Hash", [n], (d, v) => fn(d, seedOf(v)), [seed])),
  simple("md2", "MD2", H.md2), simple("md4", "MD4", H.md4), simple("md5", "MD5", H.md5),
  simple("sha1", "SHA1", web("SHA-1", H.sha1)),
  simple("sha224", "SHA224", H.sha224), simple("sha256", "SHA256", web("SHA-256", H.sha256)),
  hash("double-sha256", "Double SHA256 Hash", ["Double SHA256"], async (d) => H.sha256(H.sha256(d))),
  simple("sha384", "SHA384", web("SHA-384", H.sha384)), simple("sha512", "SHA512", web("SHA-512", H.sha512)),
  simple("sha512-224", "SHA512/224", H.sha512_224), simple("sha512-256", "SHA512/256", H.sha512_256),
  ...[224, 256, 384, 512].map((b) => simple("sha3-" + b, "SHA3-" + b, (d) => K.sha3(d, b))),
  ...[224, 256, 384, 512].map((b) => simple("keccak-" + b, "Keccak-" + b, (d) => K.keccak(d, b))),
  ...[128, 256].map((s) => hash("shake" + s, `SHAKE${s} Hash`, ["SHAKE" + s, `SHAKE${s} File`], (d, v) => K.shake(d, s, len(v)), [bytesLen(s / 4)])),
  ...[128, 256].map((s) => hash("cshake" + s, `cSHAKE${s} Hash`, ["cSHAKE" + s, `cSHAKE${s} File`], (d, v) => K.cshake(d, s, len(v), utf8(v.fname || ""), S(v)),
    [bytesLen(s / 4), input("fname", "Function name (N)", { optional: true }), custom])),
  ...[128, 256].flatMap((s) => [false, true].map((xof) => {
    const label = (xof ? "KMACXOF" : "KMAC") + s;
    return hash(label.toLowerCase(), label, xof ? [label] : [label, label + " File"], (d, v) => K.kmac(val(v, "key"), d, s, len(v), S(v), xof), [...keyed("key", "Key", "utf8", { secret: true }), bytesLen(s / 4), custom]);
  })),
  ...[128, 256].flatMap((s) => [false, true].map((xof) => {
    const label = "TupleHash" + (xof ? "XOF" : "") + s;
    return { ...hash(label.toLowerCase(), label, [label], null, [select("split", "Tuple items are", [{ label: "Each line of the input", value: "lines" }, { label: "The whole input (one item)", value: "one" }]), bytesLen(s / 4), custom]),
      auto: false, run: async (ctx, v) => { const d = await ctx.data(); let items = [d];
        if (v.split === "lines") { items = []; let a = 0; for (let i = 0; i <= d.length; i++) if (i === d.length || d[i] === 10) { items.push(d.subarray(a, i > a && d[i - 1] === 13 ? i - 1 : i)); a = i + 1; } }
        return out(K.tupleHash(items, s, len(v), S(v), xof), v); } };
  })),
  ...[128, 256].flatMap((s) => [false, true].map((xof) => {
    const label = "ParallelHash" + (xof ? "XOF" : "") + s;
    return hash(label.toLowerCase(), label, [label], (d, v) => K.parallelHash(d, int(v, "block", "Block size", 1, 1 << 24), s, len(v), S(v), xof), [number("block", "Block size (bytes)", 8192), bytesLen(s / 4), custom]);
  })),
  ...[128, 160, 256, 320].map((b) => simple("ripemd" + b, "RIPEMD-" + b, H["ripemd" + b])),
  simple("sm3", "SM3", H.sm3, false), simple("whirlpool", "Whirlpool", H.whirlpool, false),
  ...[["blake2b", "BLAKE2b", blake2b, 64], ["blake2s", "BLAKE2s", blake2s, 32]].map(([id, n, fn, max]) =>
    hash(id, n + " Hash", [n, n + " File"], (d, v) => fn(d, int(v, "length", "Output length", 1, max), val(v, "key")), [bytesLen(max), ...keyed("key", "Key (optional)", "utf8", { optional: true })])),
  hash("blake3", "BLAKE3 Hash", ["BLAKE3", "BLAKE3 File"], (d, v) => blake3(d, len(v), v.mode === "keyed" ? { key: val(v, "key") } : v.mode === "derive" ? { context: v.context } : {}),
    [select("mode", "Mode", [{ label: "Hash", value: "hash" }, { label: "Keyed (32-byte key)", value: "keyed" }, { label: "Derive key", value: "derive" }]),
      ...keyed("key", "Key", "hex", { showIf: (v) => v.mode === "keyed" }), input("context", "Context string", { showIf: (v) => v.mode === "derive" }), bytesLen(32)]),
  { ...hash("hmac", "HMAC Calculator", ["HMAC Calculator"], (d, v) => D.hmac(v.digest, val(v, "key"), d), [select("digest", "Hash function", digestNames, "SHA256"), ...keyed("key", "Secret key", "utf8", { secret: true, optional: true })]), action: "Calculate" },

  gen("pbkdf2", "PBKDF2 Key Derivation", ["PBKDF2"], kdfBase([...saltFields, select("digest", "Hash function", digestNames, "SHA256"), number("iterations", "Iterations", 100000), number("length", "Key length (bytes)", 32)]),
    async (c, v) => out(await D.pbkdf2(v.digest, val(v, "password"), val(v, "salt"), int(v, "iterations", "Iterations", 1, 10000000), len(v)), v)),
  gen("evpkdf", "EvpKDF (OpenSSL)", ["EvpKDF"], kdfBase([...saltFields, select("digest", "Hash function", digestNames, "MD5"), number("iterations", "Iterations", 1), number("length", "Key length (bytes)", 48)]),
    async (c, v) => out(D.evpkdf(v.digest, val(v, "password"), val(v, "salt"), int(v, "iterations", "Iterations", 1, 2000000), len(v)), v)),
  gen("hkdf", "HKDF Key Derivation", ["HKDF"], [...keyed("ikm", "Input key material", "utf8", { secret: true }), ...saltFields, ...keyed("info", "Info", "utf8", { optional: true }), select("digest", "Hash function", digestNames, "SHA256"), number("length", "Key length (bytes)", 32), outField()],
    async (c, v) => out(D.hkdf(v.digest, val(v, "ikm"), val(v, "salt"), val(v, "info"), len(v)), v)),
  gen("scrypt", "Scrypt Key Derivation", ["Scrypt"], kdfBase([...saltFields, ...scryptFields]),
    async (c, v) => out(await D.scrypt(val(v, "password"), val(v, "salt"), int(v, "N", "N", 2, 1 << 20), int(v, "r", "r", 1, 64), int(v, "p", "p", 1, 64), len(v)), v)),
  gen("argon2", "Argon2 Key Derivation", ["Argon2"], kdfBase([...saltFields, ...argonFields]),
    async (c, v) => out(await D.argon2(v.type, val(v, "password"), val(v, "salt"), argonOpts(v)), v)),
  gen("bcrypt-gen", "Bcrypt Password Generator", ["Bcrypt Generator"], [secret("password", "Password"), number("cost", "Cost (4–16)", 10)],
    async (c, v) => { const p = utf8(v.password); const h = D.bcryptHash(p, int(v, "cost", "Cost", 4, 16)); return p.length > 72 ? { text: h, note: "Bcrypt only uses the first 72 bytes of a password." } : h; }),
  gen("bcrypt-verify", "Bcrypt Password Verify", ["Bcrypt Verify"], [secret("password", "Password"), input("hash", "Bcrypt hash")], async (c, v) => verdict(D.bcryptVerify(utf8(v.password), v.hash))),
  gen("scrypt-gen", "Scrypt Password Generator", ["Scrypt Generator"], [secret("password", "Password"), ...keyed("salt", "Salt (blank = random)", "utf8", { optional: true }), ...scryptFields],
    async (c, v) => { const N = int(v, "N", "N", 2, 1 << 20); if (N & (N - 1)) throw new Error("N must be a power of two"); return D.scryptEncoded(utf8(v.password), v.salt ? val(v, "salt") : random(16), Math.log2(N), int(v, "r", "r", 1, 64), int(v, "p", "p", 1, 64), len(v)); }),
  gen("scrypt-verify", "Scrypt Password Verify", ["Scrypt Verify"], [secret("password", "Password"), input("hash", "Encoded hash ($scrypt$…)")], async (c, v) => verdict(await D.scryptVerify(v.hash, utf8(v.password)))),
  gen("argon2-gen", "Argon2 Password Generator", ["Argon2 Generator"], [secret("password", "Password"), ...keyed("salt", "Salt (blank = random)", "utf8", { optional: true }), secret("pepper", "Secret / pepper", { optional: true }), ...argonFields],
    async (c, v) => D.argon2Encoded(v.type, utf8(v.password), v.salt ? val(v, "salt") : random(16), argonOpts(v))),
  gen("argon2-verify", "Argon2 Password Verify", ["Argon2 Verify"], [secret("password", "Password"), input("hash", "Encoded hash ($argon2…)"), secret("pepper", "Secret / pepper", { optional: true })],
    async (c, v) => verdict(await D.argon2Verify(v.hash, utf8(v.password), utf8(v.pepper || ""))))
];
