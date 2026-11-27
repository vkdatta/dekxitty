// Field builders shared by the modal definitions.
import { decodeAs, encodeAs } from "../lib/bytes.js";

const opts = (list) => list.map((o) => (typeof o === "object" ? o : { label: String(o), value: String(o) }));
export const select = (key, label, list, def, extra = {}) => ({ key, label, type: "select", options: opts(list), default: String(def ?? opts(list)[0].value), ...extra });
export const input = (key, label, extra = {}) => ({ key, label, type: "text", default: "", ...extra });
export const secret = (key, label, extra = {}) => ({ key, label, type: "password", default: "", ...extra });
export const number = (key, label, def, extra = {}) => ({ key, label, type: "number", default: def, ...extra });
export const check = (key, label, def = false, extra = {}) => ({ key, label, type: "checkbox", default: def, ...extra });
export const area = (key, label, extra = {}) => ({ key, label, type: "textarea", default: "", ...extra });

export const ENC = [{ label: "UTF-8 text", value: "utf8" }, { label: "Hex", value: "hex" }, { label: "Base64", value: "base64" }];
export const OUT = [{ label: "Hex (lowercase)", value: "hex" }, { label: "Hex (uppercase)", value: "HEX" }, { label: "Base64", value: "base64" }, { label: "Base64URL", value: "base64url" }];
export const outField = (def = "hex") => select("output", "Output format", OUT, def);

/** A value plus the selector that says how to read it (key, salt, nonce…). */
export const keyed = (key, label, def = "utf8", extra = {}) => [
  (extra.secret ? secret : input)(key, label, extra),
  select(key + "Enc", label.replace(/\s*\(.*\)\s*$/, "") + " format", ENC, def, extra.showIf ? { showIf: extra.showIf } : {})
];
export const val = (v, key) => decodeAs(v[key] || "", v[key + "Enc"] || "utf8");
export const out = (bytes, v) => encodeAs(bytes, v.output || "hex");

export function int(v, key, label, min, max) {
  const n = Number(v[key]);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}`);
  return n;
}
