// RSA, ECDSA, JWS, JWE and JWT on top of WebCrypto.
import { utf8, text, toBase64, fromBase64, concat, equal, random } from "./bytes.js";

const subtle = () => { if (!globalThis.crypto || !crypto.subtle) throw new Error("WebCrypto needs a secure (https) page"); return crypto.subtle; };
export const HASHES = ["SHA-256", "SHA-384", "SHA-512", "SHA-1"];
export const CURVES = ["P-256", "P-384", "P-521"];

export function pem(buf, label) { return `-----BEGIN ${label}-----\n${toBase64(new Uint8Array(buf)).match(/.{1,64}/g).join("\n")}\n-----END ${label}-----`; }
function derLen(n) { if (n < 128) return [n]; const b = []; for (; n; n >>= 8) b.unshift(n & 255); return [128 | b.length, ...b]; }
const der = (tag, body) => concat(Uint8Array.of(tag, ...derLen(body.length)), body);
const RSA_ALG = Uint8Array.of(0x30, 13, 6, 9, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 1, 1, 1, 5, 0);
/** Accepts a PEM block (PKCS#8, SPKI, PKCS#1 RSA) or a JWK JSON string. */
export function parseKey(input) {
  const s = String(input || "").trim();
  if (!s) throw new Error("A key is required");
  if (s[0] === "{") { let j; try { j = JSON.parse(s); } catch (e) { throw new Error("Key is not valid JWK JSON"); } return { format: "jwk", data: j, isPrivate: !!j.d }; }
  const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(s);
  if (!m) throw new Error("Key must be a PEM block or a JWK object");
  if (/ENCRYPTED/.test(m[0])) throw new Error("Encrypted private keys are not supported");
  let bytes = fromBase64(m[2]);
  const label = m[1];
  if (label === "PRIVATE KEY") return { format: "pkcs8", data: bytes, isPrivate: true };
  if (label === "PUBLIC KEY") return { format: "spki", data: bytes, isPrivate: false };
  if (label === "RSA PRIVATE KEY") return { format: "pkcs8", data: der(0x30, concat(Uint8Array.of(2, 1, 0), RSA_ALG, der(4, bytes))), isPrivate: true };
  if (label === "RSA PUBLIC KEY") return { format: "spki", data: der(0x30, concat(RSA_ALG, der(3, concat(Uint8Array.of(0), bytes)))), isPrivate: false };
  throw new Error("Unsupported PEM type: " + label + " (use PKCS#8 / SPKI)");
}
async function importKey(input, algorithm, usage) {
  const k = parseKey(input);
  const needPrivate = ["sign", "decrypt", "unwrapKey"].includes(usage);
  let data = k.data;
  if (needPrivate && !k.isPrivate) throw new Error("This operation needs the private key");
  if (!needPrivate && k.isPrivate) {
    // derive the public half so a private key can also verify / encrypt
    const full = await subtle().importKey(k.format, data, algorithm, true, [algorithm.name === "RSA-OAEP" ? "decrypt" : "sign"]);
    const j = await subtle().exportKey("jwk", full);
    for (const f of ["d", "p", "q", "dp", "dq", "qi", "key_ops", "alg"]) delete j[f];
    return subtle().importKey("jwk", j, algorithm, false, [usage]);
  }
  if (k.format === "jwk") { data = { ...data }; delete data.key_ops; delete data.alg; delete data.use; }
  try { return await subtle().importKey(k.format, data, algorithm, false, [usage]); }
  catch (e) { throw new Error("Could not import the key for " + algorithm.name + (algorithm.namedCurve ? " " + algorithm.namedCurve : "") + ". Check key type and curve."); }
}
async function exportPair(pair, format) {
  if (format === "jwk") return JSON.stringify({ publicKey: await subtle().exportKey("jwk", pair.publicKey), privateKey: await subtle().exportKey("jwk", pair.privateKey) }, null, 2);
  return pem(await subtle().exportKey("pkcs8", pair.privateKey), "PRIVATE KEY") + "\n\n" + pem(await subtle().exportKey("spki", pair.publicKey), "PUBLIC KEY");
}
export async function rsaGenerate(bits, format = "pem") {
  const pair = await subtle().generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: bits, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" }, true, ["sign", "verify"]);
  return exportPair(pair, format);
}
export async function ecdsaGenerate(curve, format = "pem") { return exportPair(await subtle().generateKey({ name: "ECDSA", namedCurve: curve }, true, ["sign", "verify"]), format); }

const rsaParams = (scheme, hash) => (scheme === "PSS" ? { name: "RSA-PSS", saltLength: { "SHA-1": 20, "SHA-256": 32, "SHA-384": 48, "SHA-512": 64 }[hash] } : { name: "RSASSA-PKCS1-v1_5" });
export async function rsaSign(key, data, scheme, hash) { const p = rsaParams(scheme, hash); return new Uint8Array(await subtle().sign(p, await importKey(key, { name: p.name, hash }, "sign"), data)); }
export async function rsaVerify(key, data, sig, scheme, hash) { const p = rsaParams(scheme, hash); return subtle().verify(p, await importKey(key, { name: p.name, hash }, "verify"), sig, data); }

// ECDSA signatures: WebCrypto uses r‖s; OpenSSL and most tools use DER.
export function sigToDer(raw) {
  const int = (b) => { let i = 0; while (i < b.length - 1 && !b[i]) i++; b = b.subarray(i); return der(2, b[0] & 128 ? concat(Uint8Array.of(0), b) : b); };
  const n = raw.length / 2;
  return der(0x30, concat(int(raw.subarray(0, n)), int(raw.subarray(n))));
}
export function sigFromDer(d, size) {
  let o = 1;
  const len = () => { let n = d[o++]; if (n & 128) { let k = n & 127; n = 0; while (k--) n = n * 256 + d[o++]; } return n; };
  if (d[0] !== 0x30) throw new Error("Signature is not DER encoded");
  len();
  const out = new Uint8Array(size * 2);
  for (let part = 0; part < 2; part++) {
    if (d[o++] !== 2) throw new Error("Signature is not DER encoded");
    const n = len();
    let b = d.subarray(o, o + n); o += n;
    while (b.length > size && !b[0]) b = b.subarray(1);
    if (b.length > size) throw new Error("Signature does not match the curve size");
    out.set(b, part * size + size - b.length);
  }
  return out;
}
const CURVE_SIZE = { "P-256": 32, "P-384": 48, "P-521": 66 };
export async function ecdsaSign(key, data, curve, hash, format = "der") {
  const raw = new Uint8Array(await subtle().sign({ name: "ECDSA", hash }, await importKey(key, { name: "ECDSA", namedCurve: curve }, "sign"), data));
  return format === "der" ? sigToDer(raw) : raw;
}
export async function ecdsaVerify(key, data, sig, curve, hash, format = "der") {
  const raw = format === "der" ? sigFromDer(sig, CURVE_SIZE[curve]) : sig;
  return subtle().verify({ name: "ECDSA", hash }, await importKey(key, { name: "ECDSA", namedCurve: curve }, "verify"), raw, data);
}

export async function rsaEncrypt(key, data, hash) {
  const k = await importKey(key, { name: "RSA-OAEP", hash }, "encrypt");
  const max = Math.ceil(k.algorithm.modulusLength / 8) - 2 * { "SHA-1": 20, "SHA-256": 32, "SHA-384": 48, "SHA-512": 64 }[hash] - 2;
  if (data.length > max) throw new Error("RSA can encrypt at most " + max + " bytes with this key. Use JWE for longer text.");
  return new Uint8Array(await subtle().encrypt({ name: "RSA-OAEP" }, k, data));
}
export async function rsaDecrypt(key, data, hash) {
  const k = await importKey(key, { name: "RSA-OAEP", hash }, "decrypt");
  try { return new Uint8Array(await subtle().decrypt({ name: "RSA-OAEP" }, k, data)); } catch (e) { throw new Error("Decryption failed: wrong key, hash or ciphertext"); }
}

// ── JWT / JWS ────────────────────────────────────────────────────────────────
export const JWS_ALGS = ["HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512"];
const b64u = (b) => toBase64(b, true);
const jsonPart = (s, what) => { try { return JSON.parse(text(fromBase64(s))); } catch (e) { throw new Error("The " + what + " is not Base64URL-encoded JSON"); } };
export function jwtDecode(token) {
  const p = String(token).trim().replace(/^Bearer\s+/i, "").split(".");
  if (p.length === 5) return { type: "JWE", header: jsonPart(p[0], "header"), note: "Encrypted token: use JWE Decryption to read the payload." };
  if (p.length !== 3) throw new Error("A JWT has 3 dot-separated parts (JWE has 5)");
  const header = jsonPart(p[0], "header");
  let payload; const body = text(fromBase64(p[1]));
  try { payload = JSON.parse(body); } catch (e) { payload = body; }
  const times = {};
  for (const k of ["iat", "nbf", "exp"]) if (payload && typeof payload[k] === "number") times[k] = new Date(payload[k] * 1000).toISOString();
  if (times.exp) times.expired = payload.exp * 1000 < Date.now();
  return { header, payload, ...(Object.keys(times).length ? { times } : {}), signature: p[2], verified: "NOT verified — use JWS Verify Signature" };
}
function jwsParams(alg) {
  const hash = "SHA-" + alg.slice(2), fam = alg.slice(0, 2);
  if (fam === "HS") return { fam, imp: { name: "HMAC", hash }, op: { name: "HMAC" } };
  if (fam === "ES") return { fam, imp: { name: "ECDSA", namedCurve: { ES256: "P-256", ES384: "P-384", ES512: "P-521" }[alg] }, op: { name: "ECDSA", hash } };
  const op = rsaParams(fam === "PS" ? "PSS" : "v1.5", hash);
  return { fam, imp: { name: op.name, hash }, op };
}
export async function jwsSign(alg, headerJson, payload, key) {
  if (!JWS_ALGS.includes(alg)) throw new Error("Unsupported algorithm");
  let header = {};
  if (headerJson.trim()) { try { header = JSON.parse(headerJson); } catch (e) { throw new Error("Extra header is not valid JSON"); } }
  header = { alg, typ: "JWT", ...header }; header.alg = alg;
  const input = b64u(utf8(JSON.stringify(header))) + "." + b64u(utf8(payload));
  const p = jwsParams(alg);
  if (p.fam === "HS" && !key.length) throw new Error("A secret is required");
  const k = p.fam === "HS" ? await subtle().importKey("raw", key, p.imp, false, ["sign"]) : await importKey(text(key), p.imp, "sign");
  return input + "." + b64u(new Uint8Array(await subtle().sign(p.op, k, utf8(input))));
}
export async function jwsVerify(token, key, expected = "") {
  const parts = String(token).trim().split(".");
  if (parts.length !== 3) throw new Error("A JWS token has 3 dot-separated parts");
  const header = jsonPart(parts[0], "header"), alg = header.alg;
  if (!JWS_ALGS.includes(alg)) throw new Error('Unsupported or unsafe algorithm "' + alg + '"');
  if (expected && expected !== alg) throw new Error("Token says " + alg + " but you expected " + expected);
  const p = jwsParams(alg);
  // never treat a public key as an HMAC secret (algorithm confusion)
  if (p.fam === "HS" && /-----BEGIN|"kty"\s*:\s*"(RSA|EC)"/.test(text(key))) throw new Error("This token uses HMAC but you supplied a public/private key. Rejected.");
  if (p.fam === "HS" && !key.length) throw new Error("A secret is required");
  const k = p.fam === "HS" ? await subtle().importKey("raw", key, p.imp, false, ["verify"]) : await importKey(text(key), p.imp, "verify");
  const valid = await subtle().verify(p.op, k, fromBase64(parts[2]), utf8(parts[0] + "." + parts[1]));
  return { valid, header, payload: text(fromBase64(parts[1])) };
}

// ── JWE (compact serialisation) ──────────────────────────────────────────────
export const JWE_ALGS = ["RSA-OAEP-256", "RSA-OAEP", "A128KW", "A192KW", "A256KW", "dir"];
export const JWE_ENCS = ["A256GCM", "A192GCM", "A128GCM", "A128CBC-HS256", "A192CBC-HS384", "A256CBC-HS512"];
const cekSize = (enc) => (enc.endsWith("GCM") ? +enc.slice(1, 4) / 8 : +enc.slice(1, 4) / 4);
async function content(enc, cek, iv, data, aad, tag) {
  const decrypting = !!tag;
  if (cek.length !== cekSize(enc)) throw new Error(enc + " needs a " + cekSize(enc) + "-byte content key");
  if (enc.endsWith("GCM")) {
    const k = await subtle().importKey("raw", cek, "AES-GCM", false, ["encrypt", "decrypt"]), p = { name: "AES-GCM", iv, additionalData: aad };
    if (decrypting) return new Uint8Array(await subtle().decrypt(p, k, concat(data, tag)));
    const r = new Uint8Array(await subtle().encrypt(p, k, data));
    return { ct: r.slice(0, -16), tag: r.slice(-16) };
  }
  const half = cek.length / 2, hash = "SHA-" + enc.slice(-3);
  const mac = await subtle().importKey("raw", cek.subarray(0, half), { name: "HMAC", hash }, false, ["sign"]);
  const aes = await subtle().importKey("raw", cek.subarray(half), "AES-CBC", false, ["encrypt", "decrypt"]);
  const al = new Uint8Array(8); new DataView(al.buffer).setBigUint64(0, BigInt(aad.length) * 8n);
  const tagOf = async (ct) => new Uint8Array(await subtle().sign("HMAC", mac, concat(aad, iv, ct, al))).slice(0, half);
  if (decrypting) {
    if (!equal(await tagOf(data), tag)) throw new Error("tag");
    return new Uint8Array(await subtle().decrypt({ name: "AES-CBC", iv }, aes, data));
  }
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv }, aes, data));
  return { ct, tag: await tagOf(ct) };
}
const oaep = (alg) => ({ name: "RSA-OAEP", hash: alg === "RSA-OAEP-256" ? "SHA-256" : "SHA-1" });
async function kek(alg, key, usage) {
  const n = +alg.slice(1, 4) / 8;
  if (key.length !== n) throw new Error(alg + " needs a " + n + "-byte key (got " + key.length + ")");
  return subtle().importKey("raw", key, "AES-KW", false, [usage]);
}
export async function jweEncrypt(alg, enc, plaintext, key) {
  const header = b64u(utf8(JSON.stringify({ alg, enc })));
  let cek = random(cekSize(enc)), wrapped = new Uint8Array(0);
  if (alg === "dir") cek = key;
  else if (alg.startsWith("RSA")) wrapped = new Uint8Array(await subtle().encrypt({ name: "RSA-OAEP" }, await importKey(text(key), oaep(alg), "encrypt"), cek));
  else {
    const raw = await subtle().importKey("raw", cek, { name: "HMAC", hash: "SHA-256" }, true, ["sign"]);
    wrapped = new Uint8Array(await subtle().wrapKey("raw", raw, await kek(alg, key, "wrapKey"), "AES-KW"));
  }
  const iv = random(enc.endsWith("GCM") ? 12 : 16);
  const { ct, tag } = await content(enc, cek, iv, plaintext, utf8(header));
  return [header, b64u(wrapped), b64u(iv), b64u(ct), b64u(tag)].join(".");
}
export async function jweDecrypt(token, key) {
  const p = String(token).trim().split(".");
  if (p.length !== 5) throw new Error("A JWE token has 5 dot-separated parts");
  const header = jsonPart(p[0], "header"), { alg, enc } = header;
  if (!JWE_ALGS.includes(alg) || !JWE_ENCS.includes(enc)) throw new Error("Unsupported alg/enc: " + alg + " / " + enc);
  if (header.zip) throw new Error("Compressed JWE payloads are not supported");
  const wrapped = fromBase64(p[1]);
  let cek;
  try {
    if (alg === "dir") cek = key;
    else if (alg.startsWith("RSA")) cek = new Uint8Array(await subtle().decrypt({ name: "RSA-OAEP" }, await importKey(text(key), oaep(alg), "decrypt"), wrapped));
    else {
      const k = await subtle().unwrapKey("raw", wrapped, await kek(alg, key, "unwrapKey"), "AES-KW", { name: "HMAC", hash: "SHA-256", length: cekSize(enc) * 8 }, true, ["sign"]);
      cek = new Uint8Array(await subtle().exportKey("raw", k));
    }
    return { header, plaintext: await content(enc, cek, fromBase64(p[2]), fromBase64(p[3]), utf8(p[0]), fromBase64(p[4])) };
  } catch (e) {
    if (e && /needs|key is required|PEM|import|private/.test(e.message)) throw e;
    throw new Error("Decryption failed: wrong key or modified token");
  }
}
