import * as C from "../lib/cipher.js";
import * as P from "../lib/pubkey.js";
import { utf8, random, concat, toHex, fromHex, toBase64, decodeAs, encodeAs, textStrict } from "../lib/bytes.js";
import { select, input, number, check, area, keyed, val, int, ENC } from "./shared.js";

const G = "Cryptography";
const CT = [{ label: "Base64", value: "base64" }, { label: "Hex", value: "hex" }];
const MODES = ["CBC", "ECB", "CFB", "OFB", "CTR"];
const plainOut = (b, name = "decrypted.bin") => { const t = textStrict(b); return t === null ? { text: toHex(b), bytes: b, name, note: "Result is binary: shown as hex. Download keeps the raw bytes." } : { text: t, bytes: b, name }; };
const cipherOut = (b, v, note) => ({ text: encodeAs(b, v.output), bytes: b, name: "encrypted.bin", note });

/** Builds the Encrypt and Decrypt modals for one symmetric cipher. */
function pair(id, label, { fields = [], keyHint, run }) {
  return [false, true].map((dec) => ({
    id: `${id}-${dec ? "decrypt" : "encrypt"}`, name: `${label} ${dec ? "Decrypt" : "Encrypt"}`, group: G, icon: "encrypted", refs: [`${label} ${dec ? "Decrypt" : "Encrypt"}`],
    input: "data", inputEnc: dec ? "base64" : "utf8", action: dec ? "Decrypt" : "Encrypt",
    fields: [...keyed("key", `Key (${keyHint})`, "utf8", { secret: true }), ...fields, ...(dec ? [] : [select("output", "Output format", CT)])],
    run: async (ctx, v) => { const r = await run(await ctx.data(), val(v, "key"), v, dec); return dec ? plainOut(r.data) : cipherOut(r.data, v, r.note); }
  }));
}
const ivFields = (size, show) => keyed("iv", "IV / nonce", "hex", { optional: true, showIf: show, placeholder: `${size} bytes, or blank for random` });
/** Handles "blank IV = random and prefixed" the same way for every cipher that takes one. */
function withIv(data, v, size, dec) {
  let iv = v.iv ? val(v, "iv") : null, note = "";
  if (!iv) {
    if (dec) { if (data.length < size) throw new Error("Ciphertext is too short to contain an IV"); return { iv: data.subarray(0, size), body: data.subarray(size), wrap: (x) => x, note }; }
    iv = random(size);
    return { iv, body: data, wrap: (x) => concat(iv, x), note: `Random IV ${toHex(iv)} is stored at the start of the output. Leave the IV blank when decrypting.` };
  }
  return { iv, body: data, wrap: (x) => x, note };
}
const needsIv = (v) => v.mode !== "ECB";
const padded = (v) => v.mode === "ECB" || v.mode === "CBC";
const blockPair = (id, label, keyHint, makeKey, blockSize, extraModes = [], extra = []) => pair(id, label, {
  keyHint,
  fields: [...extra, select("mode", "Mode", [...extraModes, ...MODES], extraModes[0] || "CBC"), select("padding", "Padding", C.PADDINGS, "PKCS7", { showIf: padded }),
    ...ivFields(extraModes.length ? "12 (GCM) or 16" : "one block", needsIv), ...(extraModes.length ? keyed("aad", "Additional data (AAD)", "utf8", { optional: true, showIf: (v) => v.mode === "GCM" }) : [])],
  run: async (data, key, v, dec) => {
    if (v.mode === "GCM") {
      if (![16, 24, 32].includes(key.length)) throw new Error("AES key must be 16, 24 or 32 bytes (got " + key.length + ")");
      const x = withIv(data, v, 12, dec);
      const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
      try { const r = new Uint8Array(await crypto.subtle[dec ? "decrypt" : "encrypt"]({ name: "AES-GCM", iv: x.iv, additionalData: val(v, "aad") }, k, x.body)); return { data: dec ? r : x.wrap(r), note: x.note }; }
      catch (e) { throw new Error("Decryption failed: wrong key, IV, AAD or modified data"); }
    }
    const c = makeKey(key, v), size = c.block;
    const x = v.mode === "ECB" ? { iv: new Uint8Array(0), body: data, wrap: (y) => y } : withIv(data, v, size, dec);
    const r = C.blockCrypt(c, v.mode, dec, x.body, x.iv, v.padding);
    return { data: dec ? r : x.wrap(r), note: x.note };
  }
});

const hashSel = (def = "SHA-256") => select("hash", "Hash", P.HASHES, def);
const pubKey = area("key", "Public key (PEM or JWK)", { placeholder: "-----BEGIN PUBLIC KEY-----" });
const privKey = area("key", "Private key (PEM PKCS#8 or JWK)", { placeholder: "-----BEGIN PRIVATE KEY-----" });
const sigFmt = select("sigEnc", "Signature encoding", CT);
const verdict = (ok) => (ok ? "✔ Signature is valid" : "✘ Signature is NOT valid");
const tool = (id, name, refs, input_, fields, run, action) => ({ id, name, group: G, icon: "key", refs: refs, input: input_, fields, run, action });
const curve = select("curve", "Curve", P.CURVES);
const ecFmt = select("format", "Signature format", [{ label: "DER (OpenSSL)", value: "der" }, { label: "Raw r‖s (IEEE P1363)", value: "raw" }]);
const keyFmt = select("format", "Key format", [{ label: "PEM", value: "pem" }, { label: "JWK", value: "jwk" }]);
const secretKey = (v) => (/^HS/.test(v.alg || "") ? decodeAs(v.key || "", v.keyEnc) : utf8(v.key || ""));

export default [
  ...blockPair("aes", "AES", "16 / 24 / 32 bytes", (k) => C.aesKey(k), 16, ["GCM"]),
  ...blockPair("des", "DES", "8 bytes", (k) => C.desKey(k), 8),
  ...blockPair("triple-des", "Triple DES", "16 / 24 bytes", (k) => C.tripleDesKey(k), 8),
  ...pair("rc4", "RC4", { keyHint: "1–256 bytes", fields: [number("drop", "Drop first N keystream bytes", 0)], run: async (d, k, v) => ({ data: C.rc4(k, d, int(v, "drop", "Drop", 0, 1000000)) }) }),
  ...pair("chacha20", "ChaCha20", { keyHint: "32 bytes", fields: [...ivFields(12, null), number("counter", "Initial counter", 1)],
    run: async (d, k, v, dec) => { const x = withIv(d, v, 12, dec); const r = C.chacha20(k, x.iv, x.body, int(v, "counter", "Counter", 0, 4294967295)); return { data: dec ? r : x.wrap(r), note: x.note }; } }),
  ...pair("chacha20-poly1305", "ChaCha20-Poly1305", { keyHint: "32 bytes", fields: [...ivFields(12, null), ...keyed("aad", "Additional data (AAD)", "utf8", { optional: true })],
    run: async (d, k, v, dec) => {
      const x = withIv(d, v, 12, dec);
      if (dec) { if (x.body.length < 16) throw new Error("Ciphertext must end with a 16-byte tag"); return { data: C.chachaPolyDecrypt(k, x.iv, x.body.subarray(0, -16), x.body.subarray(-16), val(v, "aad")) }; }
      const e = C.chachaPolyEncrypt(k, x.iv, x.body, val(v, "aad"));
      return { data: x.wrap(concat(e.ct, e.tag)), note: (x.note + " The last 16 bytes are the authentication tag.").trim() };
    } }),
  ...blockPair("speck", "SPECK", "size depends on variant", (k, v) => C.speckKey(k, v.variant), 16, [], [select("variant", "Block / key bits", Object.keys(C.SPECK_VARIANTS), "128/128")]),
  ...pair("xxtea", "XXTEA", { keyHint: "16 bytes; shorter is zero-padded", fields: [check("withLength", "Store original length (xxtea-js compatible)", true)],
    run: async (d, k, v, dec) => { if (!k.length) throw new Error("A key is required"); return { data: C.xxtea(d, k, dec, !!v.withLength), note: k.length > 16 ? "Only the first 16 key bytes are used." : "" }; } }),

  tool("ecdsa-keys", "ECDSA Key Generator", ["ECDSA Key Generator"], "none", [curve, keyFmt], (c, v) => P.ecdsaGenerate(v.curve, v.format), "Generate"),
  tool("ecdsa-sign", "ECDSA Sign Message", ["ECDSA Sign"], "data", [privKey, curve, hashSel(), ecFmt, select("output", "Signature encoding", CT)],
    async (c, v) => encodeAs(await P.ecdsaSign(v.key, await c.data(), v.curve, v.hash, v.format), v.output), "Sign"),
  tool("ecdsa-verify", "ECDSA Verify Signature", ["ECDSA Verify"], "data", [pubKey, area("signature", "Signature"), sigFmt, curve, hashSel(), ecFmt],
    async (c, v) => verdict(await P.ecdsaVerify(v.key, await c.data(), decodeAs(v.signature.trim(), v.sigEnc), v.curve, v.hash, v.format)), "Verify"),
  tool("rsa-keys", "RSA Key Generator", ["RSA Key Generator"], "none", [select("bits", "Key size (bits)", [2048, 3072, 4096, 1024], 2048), keyFmt], (c, v) => P.rsaGenerate(Number(v.bits), v.format), "Generate"),
  tool("rsa-sign", "RSA Sign Message", ["RSA Sign"], "data", [privKey, select("scheme", "Scheme", [{ label: "PSS", value: "PSS" }, { label: "PKCS#1 v1.5", value: "v1.5" }]), hashSel(), select("output", "Signature encoding", CT)],
    async (c, v) => encodeAs(await P.rsaSign(v.key, await c.data(), v.scheme, v.hash), v.output), "Sign"),
  tool("rsa-verify", "RSA Verify Signature", ["RSA Verify"], "data", [pubKey, area("signature", "Signature"), sigFmt, select("scheme", "Scheme", [{ label: "PSS", value: "PSS" }, { label: "PKCS#1 v1.5", value: "v1.5" }]), hashSel()],
    async (c, v) => verdict(await P.rsaVerify(v.key, await c.data(), decodeAs(v.signature.trim(), v.sigEnc), v.scheme, v.hash)), "Verify"),
  tool("rsa-encrypt", "RSA Encryption (OAEP)", ["RSA Encrypt"], "data", [pubKey, hashSel(), select("output", "Output format", CT)],
    async (c, v) => encodeAs(await P.rsaEncrypt(v.key, await c.data(), v.hash), v.output), "Encrypt"),
  { ...tool("rsa-decrypt", "RSA Decryption (OAEP)", ["RSA Decrypt"], "data", [privKey, hashSel()], async (c, v) => plainOut(await P.rsaDecrypt(v.key, await c.data(), v.hash)), "Decrypt"), inputEnc: "base64" },
  tool("jws-sign", "JWS / JWT Sign", ["JWS Sign"], "text", [select("alg", "Algorithm", P.JWS_ALGS), area("header", "Extra header (JSON)", { optional: true, placeholder: '{"kid":"1"}' }),
    area("key", "Secret (HS*) or private key (PEM / JWK)"), select("keyEnc", "Secret format (HS* only)", ENC, "utf8", { showIf: (v) => /^HS/.test(v.alg) })],
    async (c, v) => P.jwsSign(v.alg, v.header || "", await c.text(), secretKey(v)), "Sign"),
  tool("jws-verify", "JWS / JWT Verify", ["JWS Verify"], "text", [select("alg", "Expected algorithm", P.JWS_ALGS), area("key", "Secret (HS*) or public key (PEM / JWK)"), select("keyEnc", "Secret format (HS* only)", ENC, "utf8", { showIf: (v) => /^HS/.test(v.alg) })],
    async (c, v) => { const r = await P.jwsVerify(await c.text(), secretKey(v), v.alg); return verdict(r.valid) + "\n\nHeader:\n" + JSON.stringify(r.header, null, 2) + "\n\nPayload:\n" + r.payload; }, "Verify"),
  tool("jwe-encrypt", "JWE Encryption", ["JWE Encrypt"], "text", [select("alg", "Key management (alg)", P.JWE_ALGS), select("enc", "Content encryption (enc)", P.JWE_ENCS),
    area("key", "RSA public key, or the shared key"), select("keyEnc", "Shared key format", ENC, "base64", { showIf: (v) => !/^RSA/.test(v.alg) })],
    async (c, v) => P.jweEncrypt(v.alg, v.enc, utf8(await c.text()), /^RSA/.test(v.alg) ? utf8(v.key) : decodeAs(v.key.trim(), v.keyEnc)), "Encrypt"),
  tool("jwe-decrypt", "JWE Decryption", ["JWE Decrypt"], "text", [area("key", "RSA private key, or the shared key"), select("keyEnc", "Shared key format (ignored for PEM / JWK)", ENC, "base64")],
    async (c, v) => { const raw = v.key.trim(), r = await P.jweDecrypt(await c.text(), raw.startsWith("-----") || raw.startsWith("{") ? utf8(raw) : decodeAs(raw, v.keyEnc)); return plainOut(r.plaintext); }, "Decrypt")
];
