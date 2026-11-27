// JSON, XML, sitemap, letter case and time conversion.

export function jsonParse(s) {
  try { return JSON.parse(s.replace(/^\uFEFF/, "")); }
  catch (e) {
    let msg = e.message;
    const m = /position (\d+)/.exec(msg);
    if (m && !/line \d+/.test(msg)) { const head = s.slice(0, +m[1]).split("\n"); msg += ` (line ${head.length}, column ${head[head.length - 1].length + 1})`; }
    throw new Error("Invalid JSON: " + msg);
  }
}
/** Re-indents JSON text without reparsing values, so big integers and key order survive. */
export function jsonReformat(s, indent) {
  jsonParse(s);
  const tokens = s.replace(/^\uFEFF/, "").match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,"]+/g);
  if (indent === "") return tokens.join("");
  let out = "", depth = 0;
  const nl = () => "\n" + indent.repeat(depth);
  tokens.forEach((t, i) => {
    if (t === "{" || t === "[") { const close = t === "{" ? "}" : "]"; out += t; depth++; if (tokens[i + 1] !== close) out += nl(); }
    else if (t === "}" || t === "]") { depth--; if (tokens[i - 1] !== "{" && tokens[i - 1] !== "[") out += nl(); out += t; }
    else if (t === ",") out += t + nl();
    else if (t === ":") out += ": ";
    else out += t;
  });
  return out;
}
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}
export function jsonDiff(a, b, path = "$", out = []) {
  if (Object.is(a, b)) return out;
  const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
  if (kind(a) !== kind(b) || (kind(a) !== "object" && kind(a) !== "array")) { out.push(`~ ${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`); return out; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p = Array.isArray(a) ? `${path}[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
    const ina = Object.prototype.hasOwnProperty.call(a, k), inb = Object.prototype.hasOwnProperty.call(b, k);
    if (!inb) out.push(`- ${p}: ${JSON.stringify(a[k])}`);
    else if (!ina) out.push(`+ ${p}: ${JSON.stringify(b[k])}`);
    else jsonDiff(a[k], b[k], p, out);
  }
  return out;
}

export function xmlParse(s) {
  const doc = new DOMParser().parseFromString(s.replace(/^\uFEFF/, "").trim(), "application/xml");
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error("Invalid XML: " + err.textContent.replace(/This page contains the following errors:|Below is a rendering.*$/gs, "").trim());
  return doc;
}
/** Tokenises already-validated XML, keeping comments, CDATA, declarations and doctype verbatim. */
export function xmlReformat(s, indent) {
  const tokens = s.replace(/^\uFEFF/, "").trim().match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE(?:[^\[>]|\[[\s\S]*?\])*>|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+/gi) || [];
  const kind = (t) => (t.startsWith("<![CDATA[") ? "text" : t[0] !== "<" ? "text" : t.startsWith("</") ? "close" : t[1] === "!" || t[1] === "?" ? "misc" : t.endsWith("/>") ? "single" : "open");
  const items = [];
  const preserve = [false];
  for (const t of tokens) {
    const k = kind(t);
    if (k === "text" && !t.trim() && !preserve[preserve.length - 1]) continue;
    items.push({ t, k, keep: preserve[preserve.length - 1] });
    if (k === "open") preserve.push(preserve[preserve.length - 1] || /xml:space\s*=\s*["']preserve/.test(t));
    if (k === "close") preserve.pop();
  }
  let out = "", depth = 0;
  const line = (t) => { out += (out && indent !== "" ? "\n" : "") + indent.repeat(Math.max(0, depth)) + t; };
  for (let i = 0; i < items.length; i++) {
    const { t, k, keep } = items[i];
    if (keep) { out += t; if (k === "open") depth++; if (k === "close") depth--; continue; }
    if (k === "open") {
      // keep <a>text</a> and mixed content on one line
      let j = i + 1, level = 1, mixed = false, direct = false;
      for (; j < items.length && level; j++) { const x = items[j]; if (x.k === "open") level++; else if (x.k === "close") level--; else if (x.k === "text" && level === 1) direct = true; }
      mixed = direct || /xml:space\s*=\s*["']preserve/.test(t);
      if (mixed) { line(items.slice(i, j).map((x) => x.t).join("")); i = j - 1; }
      else if (items[i + 1] && items[i + 1].k === "close") { line(t + items[i + 1].t); i++; }
      else { line(t); depth++; }
    } else if (k === "close") { depth--; line(t); }
    else line(k === "text" ? t.trim() : t);
  }
  return out;
}
export function sitemapValidate(s) {
  const doc = xmlParse(s), root = doc.documentElement, errors = [], warnings = [];
  const NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
  const type = root.localName;
  if (type !== "urlset" && type !== "sitemapindex") throw new Error(`Root element must be <urlset> or <sitemapindex>, found <${type}>`);
  if (root.namespaceURI !== NS) errors.push("Root element must declare xmlns=\"" + NS + '"');
  const entry = type === "urlset" ? "url" : "sitemap";
  const items = Array.from(root.children).filter((e) => e.namespaceURI === root.namespaceURI);
  if (!items.length) errors.push(`No <${entry}> entries`);
  if (items.length > 50000) errors.push("More than 50,000 entries");
  if (new TextEncoder().encode(s).length > 52428800) errors.push("File is larger than 50 MB");
  const seen = new Set();
  items.forEach((el, i) => {
    const at = `Entry ${i + 1}`;
    if (el.localName !== entry) return errors.push(`${at}: unexpected <${el.localName}>`);
    const kids = Array.from(el.children).filter((c) => c.namespaceURI === root.namespaceURI);
    const get = (n) => { const m = kids.filter((c) => c.localName === n); if (m.length > 1) errors.push(`${at}: <${n}> appears more than once`); return m[0] ? m[0].textContent.trim() : null; };
    for (const c of kids) if (!(type === "urlset" ? ["loc", "lastmod", "changefreq", "priority"] : ["loc", "lastmod"]).includes(c.localName)) errors.push(`${at}: unknown element <${c.localName}>`);
    const loc = get("loc"), mod = get("lastmod"), freq = get("changefreq"), pr = get("priority");
    if (!loc) errors.push(`${at}: <loc> is required`);
    else {
      if (!/^https?:\/\/[^\s]+$/i.test(loc)) errors.push(`${at}: <loc> must be an absolute http(s) URL`);
      if (loc.length >= 2048) errors.push(`${at}: <loc> is longer than 2,048 characters`);
      if (seen.has(loc)) warnings.push(`${at}: duplicate URL ${loc}`);
      seen.add(loc);
    }
    if (mod !== null && !(/^\d{4}(-\d\d(-\d\d(T\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d))?)?)?$/.test(mod) && !isNaN(Date.parse(mod)))) errors.push(`${at}: <lastmod> "${mod}" is not a W3C date`);
    if (freq !== null && !["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"].includes(freq)) errors.push(`${at}: invalid <changefreq> "${freq}"`);
    if (pr !== null && !(/^(0(\.\d+)?|1(\.0+)?)$/.test(pr))) errors.push(`${at}: <priority> must be between 0.0 and 1.0`);
  });
  return { type, entries: items.length, errors, warnings };
}

// ── Letter case: applied line by line so document structure survives ─────────
export function splitWords(line) {
  return line.replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, "$1 $2").replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2").split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
}
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const CASES = {
  "lower-camel": (w) => w.map((x, i) => (i ? cap(x) : x.toLowerCase())).join(""),
  "upper-camel": (w) => w.map(cap).join(""),
  snake: (w) => w.join("_").toLowerCase(),
  kebab: (w) => w.join("-").toLowerCase(),
  constant: (w) => w.join("_").toUpperCase()
};
export function convertCase(text, kind) {
  if (kind === "lower") return text.toLowerCase();
  if (kind === "upper") return text.toUpperCase();
  return text.split("\n").map((l) => { const w = splitWords(l); return w.length ? /^[ \t]*/.exec(l)[0] + CASES[kind](w) : l; }).join("\n");
}

export function convertTime(input, unit = "auto") {
  const s = String(input).trim();
  let ms;
  if (!s) ms = Date.now();
  else if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s), digits = s.replace(/^-/, "").split(".")[0].length;
    const u = unit !== "auto" ? unit : digits <= 11 ? "s" : digits <= 14 ? "ms" : digits <= 17 ? "us" : "ns";
    ms = n * { s: 1000, ms: 1, us: 1e-3, ns: 1e-6 }[u];
  } else ms = Date.parse(s);
  const d = new Date(ms);
  if (isNaN(d.getTime())) throw new Error("Could not read that date or timestamp");
  const secs = Math.floor(d.getTime() / 1000), diff = (d.getTime() - Date.now()) / 1000;
  const step = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [60, "minute"], [1, "second"]].find(([n]) => Math.abs(diff) >= n) || [1, "second"];
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return [
    "Unix seconds       : " + secs,
    "Unix milliseconds  : " + d.getTime(),
    "ISO 8601 (UTC)     : " + d.toISOString(),
    "RFC 7231 (HTTP)    : " + d.toUTCString(),
    "Local time         : " + d.toString(),
    "Local (formatted)  : " + d.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" }),
    "Relative           : " + new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.trunc(diff / step[0]), step[1]),
    "Day of year (UTC)  : " + (Math.floor((d.getTime() - start) / 86400000) + 1)
  ].join("\n");
}
