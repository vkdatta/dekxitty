import * as E from "../lib/encoding.js";
import * as P from "../lib/pubkey.js";
import { toHex, fromHex, toBase64, fromBase64, textStrict, utf8 } from "../lib/bytes.js";
import { jsonParse } from "../lib/format.js";
import { select, number, check, int } from "./shared.js";

const G = "Encoding";
const t = (id, name, refs, input, fields, run, extra = {}) => ({ id, name, group: G, icon: "swap_horiz", refs, input, fields, run, auto: true, ...extra });
const decoded = (b) => { const s = textStrict(b); return s === null ? { text: toHex(b), bytes: b, name: "decoded.bin", binary: true, note: "Decoded data is binary: shown as hex. Download keeps the raw bytes." } : { text: s, bytes: b, name: "decoded.txt" }; };
const saved = (b) => ({ text: textStrict(b) ?? "", bytes: b, name: "decoded.bin", note: `${b.length} bytes decoded. Press Download to save the file.` });

/** Encode / Decode / File → X / X → File. The file variants reuse the same codec. */
function family(id, label, encode, decode, encFields = [], decFields = []) {
  return [
    t(id + "-encode", label + " Encode", [label + " Encode", "File to " + label], "data", encFields, async (c, v) => encode(await c.data(), v), { action: "Encode" }),
    t(id + "-decode", label + " Decode", [label + " Decode"], "text", decFields, async (c, v) => decoded(decode(await c.text(), v)), { action: "Decode" }),
    t(id + "-to-file", label + " to File", [label + " to File"], "text", decFields, async (c, v) => saved(decode(await c.text(), v)), { action: "Convert", auto: false })
  ];
}
const b32 = select("variant", "Alphabet", Object.keys(E.BASE32_ALPHABETS));
const b58 = select("variant", "Alphabet", Object.keys(E.BASE58_ALPHABETS));
const binEnc = select("binary", "CBOR bytes as", [{ label: "Hex", value: "hex" }, { label: "Base64", value: "base64" }]);

export default [
  ...family("hex", "Hex", (d, v) => { const h = toHex(d); const s = v.upper ? h.toUpperCase() : h; return v.sep ? s.replace(/..(?=.)/g, "$&" + (v.sep === "space" ? " " : ":")) : s; }, (s) => fromHex(s),
    [check("upper", "Uppercase", false), select("sep", "Separator", [{ label: "None", value: "" }, { label: "Space", value: "space" }, { label: "Colon", value: "colon" }])]),
  t("hex-dump", "Hex Dump", ["Hex Dump"], "data", [select("width", "Bytes per line", [16, 8, 32])], async (c, v) => E.hexDump(await c.data(), Number(v.width)), { action: "Dump" }),
  ...family("base32", "Base32", (d, v) => E.base32Encode(d, v.variant, v.padding), (s, v) => E.base32Decode(s, v.variant), [b32, check("padding", "Add = padding", true)], [b32]),
  ...family("base58", "Base58", (d, v) => E.base58Encode(d, v.variant), (s, v) => E.base58Decode(s, v.variant), [b58], [b58]),
  ...family("base64", "Base64", (d, v) => { let s = toBase64(d, v.url); if (v.wrap) s = s.replace(/.{76}(?=.)/g, "$&\n"); return s; }, (s) => fromBase64(s),
    [check("url", "URL-safe alphabet (no padding)"), check("wrap", "Wrap at 76 characters")]),
  t("cbor-encode", "CBOR Encode (from JSON)", ["CBOR Encode"], "text", [binEnc], async (c, v) => { const b = E.cborEncode(jsonParse(await c.text())); return { text: v.binary === "base64" ? toBase64(b) : toHex(b), bytes: b, name: "data.cbor" }; }, { action: "Encode" }),
  t("cbor-decode", "CBOR Decode (to JSON)", ["CBOR Decode"], "data", [], async (c) => JSON.stringify(E.cborDecode(await c.data()), null, 2), { action: "Decode", inputEnc: "hex" }),
  t("html-entity-encode", "HTML Entity Encode", ["HTML Encode"], "text", [check("all", "Also encode non-ASCII characters")], async (c, v) => E.htmlEncode(await c.text(), v.all), { action: "Encode" }),
  t("html-entity-decode", "HTML Entity Decode (all entities)", ["HTML Decode"], "text", [], async (c) => E.htmlDecode(await c.text()), { action: "Decode" }),
  t("url-encode", "URL Encode", ["URL Encode"], "text", [select("mode", "Mode", [{ label: "Component", value: "component" }, { label: "Full URL (keep : / ? & =)", value: "full" }, { label: "Form (space → +)", value: "form" }])], async (c, v) => E.urlEncode(await c.text(), v.mode), { action: "Encode" }),
  t("url-decode", "URL Decode", ["URL Decode"], "text", [check("plus", "Treat + as space")], async (c, v) => E.urlDecode(await c.text(), v.plus), { action: "Decode" }),
  t("url-parser", "URL Parser", ["URL Parser"], "text", [], async (c) => JSON.stringify(E.urlParse(await c.text()), null, 2), { action: "Parse" }),
  t("jwt-decoder", "JWT Decoder", ["JWT Decoder"], "text", [], async (c) => JSON.stringify(P.jwtDecode(await c.text()), null, 2), { action: "Decode" })
];
