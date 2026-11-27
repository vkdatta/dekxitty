import * as F from "../lib/format.js";
import { select, check, area } from "./shared.js";

const G = "Format";
const t = (id, name, refs, fields, run, extra = {}) => ({ id, name, group: G, icon: "data_object", refs, input: "text", fields, run, auto: true, ...extra });
const indent = select("indent", "Indent", [{ label: "2 spaces", value: "2" }, { label: "4 spaces", value: "4" }, { label: "Tab", value: "tab" }]);
const pad = (v) => (v.indent === "tab" ? "\t" : " ".repeat(Number(v.indent) || 2));

export default [
  t("json-validate", "JSON Validator", ["JSON Validator"], [], async (c) => { const v = F.jsonParse(await c.text()); return "✔ Valid JSON (" + (Array.isArray(v) ? `array, ${v.length} items` : v && typeof v === "object" ? `object, ${Object.keys(v).length} keys` : v === null ? "null" : typeof v) + ")"; }, { action: "Validate", auto: false }),
  t("json-minify", "JSON Minifier", ["JSON Minifier"], [], async (c) => F.jsonReformat(await c.text(), ""), { action: "Minify" }),
  t("json-format", "JSON Formatter", ["JSON Formatter"], [indent, check("sort", "Sort keys (numbers beyond 2⁵³ lose precision)")],
    async (c, v) => { const s = await c.text(); return F.jsonReformat(v.sort ? JSON.stringify(F.sortKeys(F.jsonParse(s))) : s, pad(v)); }, { action: "Format" }),
  t("json-view", "JSON Viewer", ["JSON Viewer"], [], async (c) => { const s = await c.text(); return { text: F.jsonReformat(s, "  "), tree: { value: F.jsonParse(s) }, treeOnly: true }; }, { action: "View", auto: false }),
  t("json-compare", "JSON Compare", ["JSON Compare"], [area("other", "Second JSON (compared against the input)")],
    async (c, v) => { const d = F.jsonDiff(F.jsonParse(await c.text()), F.jsonParse(v.other)); return d.length ? `${d.length} difference(s)   (− removed, + added, ~ changed)\n\n` + d.join("\n") : "✔ Both documents are equal (key order ignored)"; }, { action: "Compare", auto: false }),
  t("xml-validate", "XML Validator", ["XML Validator"], [], async (c) => { const d = F.xmlParse(await c.text()); return `✔ Well-formed XML (root <${d.documentElement.nodeName}>, ${d.getElementsByTagName("*").length} elements)`; }, { action: "Validate", auto: false }),
  t("xml-minify", "XML Minifier", ["XML Minifier"], [check("comments", "Remove comments", true)],
    async (c, v) => { let s = await c.text(); F.xmlParse(s); const r = F.xmlReformat(s, ""); return v.comments ? r.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, (m) => (m.startsWith("<!--") ? "" : m)) : r; }, { action: "Minify" }),
  t("xml-format", "XML Formatter", ["XML Formatter"], [indent], async (c, v) => { const s = await c.text(); F.xmlParse(s); return F.xmlReformat(s, pad(v)); }, { action: "Format" }),
  t("sitemap-validate", "Sitemap Validator", ["Sitemap Validator"], [], async (c) => { const r = F.sitemapValidate(await c.text()); return [(r.errors.length ? `✘ ${r.errors.length} error(s)` : "✔ Valid sitemap") + ` — <${r.type}> with ${r.entries} entries`, ...r.errors.slice(0, 200).map((e) => "Error: " + e), ...r.warnings.slice(0, 100).map((e) => "Warning: " + e)].join("\n"); }, { action: "Validate", auto: false })
];
