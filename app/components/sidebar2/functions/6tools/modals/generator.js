import { uuid, password, NAMESPACES } from "../lib/gen.js";
import { qrEncode, qrSvg } from "../lib/qr.js";
import { utf8 } from "../lib/bytes.js";
import { select, input, number, check, int } from "./shared.js";

const G = "Generator";
const count = number("count", "How many", 1);
const many = (v, fn) => Array.from({ length: int(v, "count", "Count", 1, 1000) }, fn).join("\n");
const uuidTool = (n) => {
  const named = n === 3 || n === 5;
  return { id: "uuid-v" + n, name: "UUID v" + n + " Generator", group: G, icon: "key", refs: ["UUID v" + n], input: "none", action: "Generate",
    fields: named ? [select("preset", "Namespace", [...Object.keys(NAMESPACES), { label: "Custom UUID", value: "custom" }]), input("namespace", "Custom namespace UUID", { showIf: (v) => v.preset === "custom" }), input("name", "Name", { optional: true })] : [count],
    run: async (c, v) => (named ? uuid(n, { namespace: v.preset === "custom" ? v.namespace : NAMESPACES[v.preset], name: v.name }) : many(v, () => uuid(n))) };
};

const SCANNER_URL = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
function loadScanner() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCANNER_URL;
    s.onload = () => (window.jsQR ? resolve(window.jsQR) : (s.remove(), reject(new Error("Could not load the QR scanner (check your connection)"))));
    s.onerror = () => { s.remove(); reject(new Error("Could not load the QR scanner (check your connection)")); };
    document.head.appendChild(s);
  });
}
async function scan(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch (e) { throw new Error("That file is not a readable image"); }
  if (window.BarcodeDetector) {
    try { const r = await new BarcodeDetector({ formats: ["qr_code"] }).detect(bmp); if (r.length) return r.map((x) => x.rawValue).join("\n"); } catch (e) {}
  }
  const jsQR = await loadScanner();
  for (const target of [1600, 800, 400]) {
    const k = Math.min(1, target / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const g = cv.getContext("2d", { willReadFrequently: true }); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(bmp, 0, 0, w, h);
    const r = jsQR(g.getImageData(0, 0, w, h).data, w, h);
    if (r) return r.data;
  }
  throw new Error("No QR code found in this image");
}

export default [
  ...[1, 3, 4, 5, 6, 7].map(uuidTool),
  { id: "password-generator", name: "Password Generator", group: G, icon: "key", refs: ["Password Generator"], input: "none", action: "Generate",
    fields: [number("length", "Length", 16), count, check("lower", "a–z", true), check("upper", "A–Z", true), check("digits", "0–9", true), check("symbols", "Symbols", true), input("custom", "Extra characters", { optional: true }), check("excludeSimilar", "Exclude look-alikes (I l 1 O 0 o |)"), check("requireEach", "At least one from each set", true)],
    run: async (c, v) => { const o = { ...v, length: int(v, "length", "Length", 1, 4096) }; let bits = 0; const text = many(v, () => { const p = password(o); bits = p.bits; return p.value; }); return { text, note: `About ${bits} bits of entropy each.` }; } },
  { id: "qr-generator", name: "QR Code Generator", group: G, icon: "apps", refs: ["QR Code Generator"], input: "text", action: "Generate",
    fields: [select("level", "Error correction", [{ label: "Medium (15%)", value: "M" }, { label: "Low (7%)", value: "L" }, { label: "Quartile (25%)", value: "Q" }, { label: "High (30%)", value: "H" }])],
    run: async (c, v) => { const s = await c.text(); if (!s) throw new Error("Enter some text first"); const q = qrEncode(utf8(s), v.level); return { svg: qrSvg(q), bytes: utf8(qrSvg(q)), name: "qrcode.svg", note: `Version ${q.version}, ${q.size}×${q.size} modules.` }; } },
  { id: "qr-scanner", name: "QR Code Scanner", group: G, icon: "image", refs: ["QR Code Scanner"], input: "image", action: "Scan", fields: [], run: async (c) => scan(await c.rawFile()) }
];
