/**
 * mdexec / wysiwyg — the visual (Google Docs / MS Word style) editor behind Design mode.
 *
 * Design mode used to open a block as a textarea of raw Markdown. Now the open block is a
 * contenteditable made of the SAME HTML the Read view shows — bold looks bold, headings look
 * like headings — and this file turns what you did back into Markdown.
 *
 *  • serialize(host)      DOM → Markdown for ONE block, plus a map from every text node to
 *                         its exact character offsets in that Markdown. The map is what lets
 *                         Sidebar 2 (Uppercase, Find & Replace, Cipher …) act on precisely the
 *                         text you selected, even though you never see the Markdown.
 *  • mdOffsetAt / domPointAt   DOM selection ⇄ Markdown offset.
 *  • toggleMark / applyLink / list helpers   the actual editing commands (DOM only).
 *  • htmlToMd             pasted HTML (web pages, Google Docs, Word) → Markdown.
 *
 * Nothing here knows about CodeMirror or the note — it is DOM in, strings out, so it can be
 * tested in a plain browser page.
 */
import { serializeTable } from "./blocks.js";

const ZW = "\u200b";                       // zero-width space: parks the caret inside an empty bold/italic/…
const NOMARK = Object.freeze({ strong: 0, em: 0, del: 0, code: 0, a: null });
const isW = (c) => !!c && /[\p{L}\p{N}]/u.test(c);

/* ═════════════════ result algebra: a string + where each DOM text node landed in it ═════════════════ */

const mk = (s = "", rec = []) => ({ s, rec });

function cat(parts) {
  let s = "", rec = [];
  for (const p of parts) {
    if (!p) continue;
    if (s.length) for (const x of p.rec) { const o = x.offs, b = s.length; for (let i = 0; i < o.length; i++) o[i] += b; }
    for (const x of p.rec) rec.push(x);
    s += p.s;
  }
  return mk(s, rec);
}
function joinR(parts, sep) {
  const live = parts.filter((p) => p && p.s.length);
  const out = [];
  live.forEach((p, i) => { if (i) out.push(mk(sep)); out.push(p); });
  return cat(out);
}

/**
 * Apply insert / delete operations to a result and re-point every text-node offset.
 * ops: [{p, del?, ins?}]. Offsets that START a character move after an insertion made at that
 * point; offsets that END a node (caret at the end of a word) stay before it.
 */
function edit(r, ops) {
  const merged = [];
  for (const o of ops.filter((x) => x && (x.del || x.ins)).sort((a, b) => a.p - b.p)) {
    const last = merged[merged.length - 1];
    if (last && last.p === o.p && !last.del && !o.del) last.ins += o.ins || "";
    else merged.push({ p: o.p, del: o.del || 0, ins: o.ins || "" });
  }
  if (!merged.length) return r;
  const n = r.s.length, mS = new Array(n + 1), mE = new Array(n + 1);
  let out = "", last = 0, delta = 0;
  const fill = (a, b) => { for (let o = a; o < b; o++) { mS[o] = o + delta; mE[o] = o + delta; } };
  for (const op of merged) {
    const p = Math.max(op.p, last);
    fill(last, p);
    out += r.s.slice(last, p);
    const after = p + delta + op.ins.length;
    mS[p] = after; mE[p] = p + delta;
    for (let o = p + 1; o < p + op.del && o <= n; o++) { mS[o] = after; mE[o] = after; }
    out += op.ins;
    last = Math.min(n, p + op.del);
    delta += op.ins.length - op.del;
  }
  fill(last, n + 1);
  out += r.s.slice(last);
  for (const x of r.rec) { const o = x.offs, end = o.length - 1; for (let i = 0; i < o.length; i++) o[i] = (i === end ? mE : mS)[o[i]]; }
  return mk(out, r.rec);
}

/** Put a prefix at the start of every line (first line gets `first`, the rest `rest`; empty lines get `rest` trimmed). */
function prefixLines(r, first, rest) {
  const ops = []; let p = 0;
  r.s.split("\n").forEach((ln, k) => {
    const pre = k === 0 ? first : (ln === "" ? rest.replace(/\s+$/, "") : rest);
    if (pre) ops.push({ p, ins: pre });
    p += ln.length + 1;
  });
  return edit(r, ops);
}

/* ═════════════════ text → Markdown (escaping) ═════════════════ */

function escRun(text, o) {
  let s = "";
  const offs = new Array(text.length + 1);
  const t1 = text.indexOf("~"), pairTilde = t1 >= 0 && t1 !== text.lastIndexOf("~");
  const hasOpen = text.indexOf("[") >= 0;
  for (let i = 0; i < text.length; i++) {
    offs[i] = s.length;
    const c = text[i];
    switch (c) {
      case ZW: case "\r": break;
      case "\u00a0": s += " "; break;
      case "\n": s += o.single ? " " : "\n"; break;
      case "\\": case "*": case "`": case "[": s += "\\" + c; break;
      case "]": s += hasOpen ? "\\]" : "]"; break;
      case "~": s += pairTilde ? "\\~" : "~"; break;
      case "_": s += isW(text[i - 1]) && isW(text[i + 1]) ? "_" : "\\_"; break;
      case "<": s += /[A-Za-z/!?]/.test(text[i + 1] || "") ? "\\<" : "<"; break;
      case "&": s += /^&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i.test(text.slice(i, i + 14)) ? "\\&" : "&"; break;
      case "|": s += o.pipe ? "\\|" : "|"; break;
      default: s += c;
    }
  }
  offs[text.length] = s.length;
  return { s, offs };
}

/** Lines of a paragraph: trim, drop blank lines, and stop line-start text from turning into block syntax. */
function fixLines(r) {
  const ops = [], lines = r.s.split("\n");
  let ls = 0;
  lines.forEach((ln, k) => {
    const start = ls, end = ls + ln.length; ls = end + 1;
    if (!ln.trim()) {
      if (k < lines.length - 1) ops.push({ p: start, del: ln.length + 1 });
      else if (k > 0) ops.push({ p: start - 1, del: ln.length + 1 });
      else ops.push({ p: start, del: ln.length });
      return;
    }
    const lead = ln.match(/^[ \t]*/)[0].length, trail = ln.length - ln.replace(/[ \t]+$/, "").length;
    if (lead) ops.push({ p: start, del: lead });
    if (trail) ops.push({ p: end - trail, del: trail });
    const c = ln.slice(lead, ln.length - trail), base = start + lead;
    let m;
    if (/^#{1,6}(?:\s|$)/.test(c) || /^>/.test(c) || /^[-+](?:\s|$)/.test(c) || /^-{2,}\s*$/.test(c) || /^=+\s*$/.test(c)) ops.push({ p: base, ins: "\\" });
    else if ((m = c.match(/^(\d{1,9})([.)])(?:\s|$)/))) ops.push({ p: base + m[1].length, ins: "\\" });
  });
  return edit(r, ops);
}

/* ═════════════════ inline: DOM → flat items → nested marks → Markdown ═════════════════ */

const RAW_INLINE = new Set(["SUP", "SUB", "MARK", "KBD", "U", "INS", "ABBR", "SMALL", "Q", "CITE", "VAR", "SAMP"]);

function styleBits(el) {
  const st = el.style || {}, fw = String(st.fontWeight || ""), td = String(st.textDecorationLine || st.textDecoration || "");
  return { bold: fw === "bold" || fw === "bolder" || +fw >= 600, plain: fw === "normal" || fw === "400" || fw === "lighter", italic: st.fontStyle === "italic" || st.fontStyle === "oblique", strike: /line-through/.test(td) };
}

function walkInline(node, marks, out) {
  if (node.nodeType === 3) { if (node.nodeValue) out.push({ k: "t", node, text: node.nodeValue, m: marks }); return; }
  if (node.nodeType !== 1) return;
  const tag = node.tagName;
  if (node.classList && node.classList.contains("dex-check-wrap")) return;
  if (tag === "BR") { out.push({ k: "br" }); return; }
  if (tag === "INPUT" || tag === "SCRIPT" || tag === "STYLE" || tag === "SVG") return;
  if (tag === "IMG") { out.push({ k: "img", el: node, m: marks }); return; }
  const sb = styleBits(node);
  const m = { ...marks };
  if ((tag === "STRONG" || tag === "B") && !sb.plain) m.strong = 1;
  else if (tag === "EM" || tag === "I") m.em = 1;
  else if (tag === "DEL" || tag === "S" || tag === "STRIKE") m.del = 1;
  else if (tag === "CODE" || tag === "TT") m.code = 1;
  else if (tag === "A" && node.getAttribute("href")) m.a = { href: node.getAttribute("href"), title: node.getAttribute("title") || "" };
  if (sb.bold) m.strong = 1;
  if (sb.italic) m.em = 1;
  if (sb.strike) m.del = 1;
  if (RAW_INLINE.has(tag)) {
    const t = tag.toLowerCase();
    out.push({ k: "raw", html: "<" + t + ">" });
    for (const c of node.childNodes) walkInline(c, m, out);
    out.push({ k: "raw", html: "</" + t + ">" });
    return;
  }
  for (const c of node.childNodes) walkInline(c, m, out);
}

const markList = (m) => {
  const l = [];
  if (m.a) l.push({ id: "a\u0000" + m.a.href + "\u0000" + m.a.title, t: "a", href: m.a.href, title: m.a.title });
  if (m.em) l.push({ id: "em", t: "em" });
  if (m.strong) l.push({ id: "strong", t: "strong" });
  if (m.del) l.push({ id: "del", t: "del" });
  if (m.code) l.push({ id: "code", t: "code" });
  return l;
};

function buildTree(items) {
  const root = { mark: null, kids: [] }, stack = [root];
  for (const it of items) {
    if (it.k === "br" || it.k === "raw") { stack.length = 1; root.kids.push(it); continue; }
    if (it.k === "t" && !it.text.replace(/\u200b/g, "")) { if (!it.text) continue; }
    const N = markList(it.m);
    let j = 1;
    while (j < stack.length && N.some((x) => x.id === stack[j].mark.id)) j++;
    stack.length = j;
    for (const x of N) {
      if (stack.some((s, i) => i > 0 && s.mark.id === x.id)) continue;
      const seg = { mark: x, kids: [] };
      stack[stack.length - 1].kids.push(seg);
      stack.push(seg);
    }
    stack[stack.length - 1].kids.push(it);
  }
  return root;
}

const longestRun = (s, ch) => { let best = 0, cur = 0; for (const c of s) { cur = c === ch ? cur + 1 : 0; if (cur > best) best = cur; } return best; };

function codeSpan(kids) {
  const parts = kids.filter((k) => k.k === "t");
  const raw = parts.map((k) => k.text.replace(/\u200b|\r/g, "").replace(/\u00a0/g, " ").replace(/\n/g, " ")).join("");
  if (!raw.trim()) return mk(raw);
  const fence = "`".repeat(longestRun(raw, "`") + 1);
  const pad = /^`|`$/.test(raw) || (/^ .* $/.test(raw) && raw.trim()) ? " " : "";
  const head = fence + pad;
  let at = head.length;
  const rec = parts.map((k) => {
    const offs = new Array(k.text.length + 1);
    for (let i = 0; i < k.text.length; i++) { offs[i] = at; const c = k.text[i]; if (c !== ZW && c !== "\r") at++; }
    offs[k.text.length] = at;
    return { node: k.node, offs };
  });
  return mk(head + raw + pad + fence, rec);
}

function emph(inner, d) {
  const s = inner.s;
  if (!s.trim()) return inner;
  const lead = s.length - s.trimStart().length, trail = s.length - s.trimEnd().length;
  return edit(inner, [{ p: lead, ins: d }, { p: s.length - trail, ins: d }]);
}

function linkDest(url) {
  let u = String(url);
  if (/[\s<>]/.test(u) || (u.match(/\(/g) || []).length !== (u.match(/\)/g) || []).length) return "<" + u.replace(/[<>]/g, (c) => encodeURIComponent(c)) + ">";
  return u;
}

function renderKids(kids, o) {
  const parts = [];
  for (const k of kids) {
    if (k.k === "t") { const e = escRun(k.text, o); parts.push(mk(e.s, [{ node: k.node, offs: e.offs }])); }
    else if (k.k === "br") parts.push(mk(o.br != null ? o.br : "\\\n"));
    else if (k.k === "raw") parts.push(mk(k.html));
    else if (k.k === "img") {
      const alt = (k.el.getAttribute("alt") || "").replace(/[\[\]\\]/g, "\\$&"), src = k.el.getAttribute("src") || "", title = k.el.getAttribute("title");
      parts.push(mk("![" + alt + "](" + linkDest(src) + (title ? ' "' + title.replace(/"/g, '\\"') + '"' : "") + ")"));
    } else parts.push(renderSeg(k, o));
  }
  return cat(parts);
}

function renderSeg(seg, o) {
  const t = seg.mark.t;
  if (t === "code") return codeSpan(seg.kids);
  const inner = renderKids(seg.kids, o);
  if (t === "em") return emph(inner, "*");
  if (t === "strong") return emph(inner, "**");
  if (t === "del") return emph(inner, "~~");
  // link
  if (!inner.s.trim()) return inner;
  const text = seg.kids.map(function flat(k) { return k.k === "t" ? k.text : k.kids ? k.kids.map(flat).join("") : ""; }).join("");
  const href = seg.mark.href;
  if (text === href || "http://" + text === href || "https://" + text === href || "mailto:" + text === href) {
    if (/^(?:https?:\/\/|www\.)\S+$/.test(text) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return inner;
  }
  const title = seg.mark.title ? ' "' + seg.mark.title.replace(/"/g, '\\"') + '"' : "";
  return edit(inner, [{ p: 0, ins: "[" }, { p: inner.s.length, ins: "](" + linkDest(href) + title + ")" }]);
}

function inlineMd(nodes, o) {
  const items = [];
  for (const n of nodes) walkInline(n, NOMARK, items);
  while (items.length && items[items.length - 1].k === "br") items.pop();
  while (items.length && items[0].k === "br") items.shift();
  return renderKids(buildTree(items).kids, o);
}

/* ═════════════════ blocks ═════════════════ */

const BLOCK = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "HR", "TABLE", "DIV", "SECTION", "ARTICLE", "ASIDE", "HEADER", "FOOTER", "FIGURE", "DL", "MAIN", "NAV", "DETAILS"]);
const isBlockEl = (n) => n.nodeType === 1 && BLOCK.has(n.tagName);

function paraMd(nodes, o) { return fixLines(inlineMd(nodes, o)); }

function blocksOf(parent, o) {
  const out = []; let run = [];
  const flush = () => { if (run.length) { const r = paraMd(run, o); if (r.s.trim()) out.push(r); run = []; } };
  for (const n of parent.childNodes) {
    if (isBlockEl(n)) { flush(); const r = blockMd(n, o); if (r && r.s.length) out.push(r); }
    else if (n.nodeType === 3 || n.nodeType === 1) run.push(n);
  }
  flush();
  return out;
}

function findCheckbox(li) {
  const walk = (n) => {
    for (const c of n.children) {
      if (c.tagName === "UL" || c.tagName === "OL") continue;
      if (c.tagName === "INPUT" && c.type === "checkbox") return c;
      const r = walk(c); if (r) return r;
    }
    return null;
  };
  return walk(li);
}

function listMd(el, o) {
  const ordered = el.tagName === "OL";
  let n = ordered ? parseInt(el.getAttribute("start"), 10) : 0;
  if (ordered && !(n >= 0)) n = 1;
  const lis = [...el.children].filter((c) => c.tagName === "LI");
  const loose = lis.some((li) => [...li.children].some((c) => c.tagName === "P"));
  const parts = [];
  for (const li of lis) {
    const marker = ordered ? (n++) + ". " : "- ";
    const chk = findCheckbox(li);
    let body = joinR(blocksOf(li, o), loose ? "\n\n" : "\n");
    if (chk) body = body.s ? edit(body, [{ p: 0, ins: chk.checked ? "[x] " : "[ ] " }]) : mk(chk.checked ? "[x]" : "[ ]");
    parts.push(body.s ? prefixLines(body, marker, " ".repeat(marker.length)) : mk(marker.trimEnd()));
  }
  return joinR(parts, loose ? "\n\n" : "\n");
}

function headingMd(el, o) {
  const level = +el.tagName[1];
  const inner = fixLines(inlineMd(el.childNodes, { ...o, single: true, br: " " }));
  const flat = edit(inner, []);
  return cat([mk("#".repeat(level) + " "), flat]);
}

function preMd(el) {
  const code = el.querySelector("code");
  const lang = ((code && /language-(\S+)/.exec(code.className || "")) || [])[1] || "";
  const t = (code || el).textContent.replace(/\n$/, "");
  const fence = "`".repeat(Math.max(3, longestRun(t, "`") + 1));
  return mk(fence + lang + "\n" + t + "\n" + fence);
}

function tableMd(el, o) {
  const rows = [...el.querySelectorAll("tr")];
  if (!rows.length) return mk("");
  const cellsOf = (tr) => [...tr.children].filter((c) => c.tagName === "TH" || c.tagName === "TD");
  const cell = (c) => inlineMd(c.childNodes, { ...o, br: "<br>", pipe: false, single: false }).s.replace(/\n/g, " ").trim();
  const head = cellsOf(rows[0]), cols = Math.max(1, head.length);
  const al = head.map((c) => { const a = (c.getAttribute("align") || (c.style && c.style.textAlign) || "").toLowerCase(); return a === "center" ? "c" : a === "right" ? "r" : a === "left" ? "l" : ""; });
  while (al.length < cols) al.push("");
  const body = rows.slice(1).map((tr) => { const r = cellsOf(tr).map(cell); while (r.length < cols) r.push(""); return r.slice(0, cols); });
  return mk(serializeTable({ head: head.map(cell), align: al, rows: body }));
}

function blockMd(el, o) {
  const tag = el.tagName;
  if (tag === "P") return paraMd(el.childNodes, o);
  if (/^H[1-6]$/.test(tag)) return headingMd(el, o);
  if (tag === "UL" || tag === "OL") return listMd(el, o);
  if (tag === "BLOCKQUOTE") {
    const body = joinR(blocksOf(el, o), "\n\n");
    return body.s ? prefixLines(body, "> ", "> ") : mk(">");
  }
  if (tag === "PRE") return preMd(el);
  if (tag === "HR") return mk("---");
  if (tag === "TABLE") return tableMd(el, o);
  return joinR(blocksOf(el, o), "\n\n");     // div, section, li outside a list …
}

/* ═════════════════ public: serialise ═════════════════ */

/**
 * Markdown for a block's DOM. `host` is the editable element itself (p, h1…h6, ul, ol, blockquote)
 * or any container of blocks. Returns { md, map } — map is the text-node offset table.
 */
export function serialize(host, opt = {}) {
  const o = { pipe: false, single: false, ...opt };
  const r = isBlockEl(host) && host.tagName !== "DIV" ? blockMd(host, o) : joinR(blocksOf(host, o), "\n\n");
  return { md: r.s, map: r.rec };
}

/** Markdown for the contents of one table cell (pipes are escaped later, by serializeTable). */
export function serializeCell(el) {
  return inlineMd(el.childNodes, { pipe: false, single: false, br: "<br>" }).s.replace(/\n/g, " ").trim();
}

/** Pasted HTML (a web page, Google Docs, Word) → Markdown. */
export function htmlToMd(html, sanitize) {
  const doc = document.implementation.createHTMLDocument("");
  const clean = sanitize ? sanitize(html) : html;
  const box = doc.createElement("div");
  box.innerHTML = clean;
  box.querySelectorAll("meta,style,script,title,link").forEach((x) => x.remove());
  return joinR(blocksOf(box, { pipe: false, single: false }), "\n\n").s;
}

/** Normalise an HTML string so two renderings of the same document compare equal. */
export function normHtml(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.innerHTML.replace(/\s+/g, " ").replace(/> </g, "><").replace(/<br> /g, "<br>").trim();
}

/* ═════════════════ selection ⇄ Markdown offsets ═════════════════ */

/** The Markdown offset of a DOM point. */
export function mdOffsetAt(map, node, off) {
  if (!map.length) return 0;
  if (node.nodeType === 3) { const r = map.find((x) => x.node === node); if (r) return r.offs[Math.min(off, r.offs.length - 1)]; }
  const rg = node.ownerDocument.createRange();
  try { rg.setStart(node, off); } catch (e) { return map[0].offs[0]; }
  rg.collapse(true);
  let best = null;
  for (const x of map) { if (rg.comparePoint(x.node, 0) <= 0) best = x; else break; }
  if (!best) return map[0].offs[0];
  return best.offs[best.offs.length - 1];
}

/** The DOM point for a Markdown offset (nearest text). */
export function domPointAt(map, mdOff) {
  if (!map.length) return null;
  let prev = null;
  for (const x of map) {
    const o = x.offs, n = o.length - 1;
    if (mdOff < o[0]) return prev && mdOff <= prev.offs[prev.offs.length - 1] ? { node: prev.node, offset: prev.offs.length - 1 } : { node: x.node, offset: 0 };
    if (mdOff <= o[n]) { let i = 0; while (i < n && o[i + 1] <= mdOff) i++; return { node: x.node, offset: i }; }
    prev = x;
  }
  return { node: prev.node, offset: prev.offs.length - 1 };
}

/* ═════════════════ plain-text positions (stable across re-renders) ═════════════════ */

export function textNodes(root) {
  const out = [];
  const w = root.ownerDocument.createTreeWalker(root, 4, { acceptNode: (n) => (n.parentElement && n.parentElement.closest(".dex-check-wrap") ? 2 : 1) });
  for (let n; (n = w.nextNode());) out.push(n);
  return out;
}
export function plainOf(host, node, off) {
  const rg = host.ownerDocument.createRange();
  try { rg.setStart(node, off); } catch (e) { return 0; }
  rg.collapse(true);
  let acc = 0;
  for (const t of textNodes(host)) {
    if (t === node) return acc + Math.min(off, t.length);
    if (rg.comparePoint(t, t.length) <= 0) acc += t.length; else break;
  }
  return acc;
}
export function domPlain(host, k) {
  const ts = textNodes(host);
  for (const t of ts) { if (k <= t.length) return { node: t, offset: k }; k -= t.length; }
  if (ts.length) { const t = ts[ts.length - 1]; return { node: t, offset: t.length }; }
  return { node: host, offset: host.childNodes.length };
}
export function setSel(doc, a, ao, b, bo) {
  const s = doc.getSelection(); if (!s) return;
  const r = doc.createRange();
  try { r.setStart(a, ao); r.setEnd(b || a, b ? bo : ao); } catch (e) { return; }
  s.removeAllRanges(); s.addRange(r);
}
export function selRange(host) {
  const s = host.ownerDocument.getSelection();
  if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  return host.contains(r.startContainer) && host.contains(r.endContainer) ? r : null;
}
export function savePlain(host) {
  const r = selRange(host); if (!r) return null;
  return { s: plainOf(host, r.startContainer, r.startOffset), e: plainOf(host, r.endContainer, r.endOffset) };
}
export function restorePlain(host, p) {
  if (!p) return;
  const a = domPlain(host, p.s), b = p.e === p.s ? a : domPlain(host, p.e);
  setSel(host.ownerDocument, a.node, a.offset, b.node, b.offset);
}

/* ═════════════════ inline commands: bold / italic / strike / code / link ═════════════════ */

const MARKS = { strong: "strong,b", em: "em,i", del: "del,s,strike", code: "code", a: "a" };
const TAG = { strong: "strong", em: "em", del: "del", code: "code", a: "a" };

function markAncestors(host, tn, kind) {
  const out = [];
  for (let el = tn.parentElement; el && el !== host && host.contains(el); el = el.parentElement) if (el.matches(MARKS[kind])) out.push(el);
  return out;
}
const hasContent = (n) => !!(n.textContent || (n.querySelector && n.querySelector("img,br,input")));

function coveredTexts(range) {
  let { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = range;
  if (ec.nodeType === 3 && eo > 0 && eo < ec.length) ec.splitText(eo);
  if (sc.nodeType === 3 && so > 0 && so < sc.length) {
    const t = sc.splitText(so);
    if (ec === sc) { ec = t; eo -= so; }
    sc = t; so = 0;
  }
  range.setStart(sc, so); range.setEnd(ec, eo);
  const root = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
  return textNodes(root).filter((t) => t.length && range.comparePoint(t, 0) === 0 && range.comparePoint(t, t.length) === 0);
}

/** Make `node` the only content of a copy of ancestor A, splitting A before / after it, then unwrap A. */
function stripAround(A, node) {
  const doc = A.ownerDocument, parent = A.parentNode;
  const after = doc.createRange(); after.setStartAfter(node); after.setEndAfter(A.lastChild);
  const tail = after.extractContents();
  if (hasContent(tail)) { const A2 = A.cloneNode(false); A2.appendChild(tail); parent.insertBefore(A2, A.nextSibling); }
  const before = doc.createRange(); before.setStartBefore(A.firstChild); before.setEndBefore(node);
  const head = before.extractContents();
  if (hasContent(head)) { const A0 = A.cloneNode(false); A0.appendChild(head); parent.insertBefore(A0, A); }
  while (A.firstChild) parent.insertBefore(A.firstChild, A);
  A.remove();
}

/** Remove empty marks, merge neighbouring identical marks, join text nodes. */
export function tidy(host) {
  const sel = Array.from(host.querySelectorAll("strong,b,em,i,del,s,strike,code,a,span,font"));
  for (const el of sel) if (!hasContent(el) && !el.contains(host.ownerDocument.activeElement)) { if (!/\u200b/.test(el.textContent)) el.remove(); }
  const merge = (root) => {
    for (const el of Array.from(root.children || [])) {
      if (!el.parentNode) continue;
      if (/^(STRONG|B|EM|I|DEL|S|STRIKE|CODE|A)$/.test(el.tagName)) {
        let nx = el.nextSibling;
        while (nx && nx.nodeType === 1 && nx.tagName === el.tagName && sameAttrs(el, nx)) { while (nx.firstChild) el.appendChild(nx.firstChild); const d = nx; nx = nx.nextSibling; d.remove(); }
      }
      merge(el);
    }
  };
  merge(host);
  host.normalize();
}
const sameAttrs = (a, b) => a.getAttribute("href") === b.getAttribute("href") && a.getAttribute("title") === b.getAttribute("title");

/** Word under a collapsed caret, as a [start,end] pair inside its text node (or null). */
function wordAt(tn, off) {
  const t = tn.nodeValue; let a = off, b = off;
  while (a > 0 && /[\p{L}\p{N}_'’]/u.test(t[a - 1])) a--;
  while (b < t.length && /[\p{L}\p{N}_'’]/u.test(t[b])) b++;
  return a === b ? null : [a, b];
}

/**
 * Toggle bold / italic / strikethrough / inline code on the selection (Ctrl+B …).
 * With nothing selected it acts on the word under the caret, or arms the next typed text.
 */
export function toggleMark(host, kind) {
  const doc = host.ownerDocument, sel = doc.getSelection();
  let range = selRange(host); if (!range) return false;
  if (range.collapsed) {
    const c = range.startContainer;
    if (c.nodeType === 3) {
      const w = wordAt(c, range.startOffset);
      if (w) { range = doc.createRange(); range.setStart(c, w[0]); range.setEnd(c, w[1]); sel.removeAllRanges(); sel.addRange(range); }
    }
    if (range.collapsed) {                                       // empty spot → arm the next characters
      const inside = c.nodeType === 3 ? markAncestors(host, c, kind) : [];
      if (inside.length) return false;
      const el = doc.createElement(TAG[kind]); el.appendChild(doc.createTextNode(ZW));
      range.insertNode(el);
      setSel(doc, el.firstChild, 1);
      return true;
    }
  }
  const keep = savePlain(host);
  const texts = coveredTexts(range);
  if (!texts.length) return false;
  const all = texts.every((t) => markAncestors(host, t, kind).length);
  for (const t of texts) {
    if (all) { let A; while ((A = markAncestors(host, t, kind)[0])) stripAround(A, t); }
    else if (!markAncestors(host, t, kind).length) { const el = doc.createElement(TAG[kind]); t.replaceWith(el); el.appendChild(t); }
  }
  tidy(host);
  restorePlain(host, keep);
  return true;
}

/** Which marks cover the whole selection (for lighting up the toolbar). */
export function marksAt(host) {
  const out = { strong: false, em: false, del: false, code: false, a: false };
  const range = selRange(host); if (!range) return out;
  let texts;
  if (range.collapsed) { const c = range.startContainer; texts = c.nodeType === 3 ? [c] : []; if (c.nodeType === 1) { for (const k of Object.keys(out)) out[k] = !!(c.closest && c.closest(MARKS[k]) && host.contains(c.closest(MARKS[k])) && c.closest(MARKS[k]) !== host); return out; } }
  else {
    const probe = range.cloneRange();
    const root = probe.commonAncestorContainer.nodeType === 1 ? probe.commonAncestorContainer : probe.commonAncestorContainer.parentNode;
    texts = textNodes(root).filter((t) => t.length && probe.intersectsNode(t) && !(t === probe.endContainer && probe.endOffset === 0) && !(t === probe.startContainer && probe.startOffset === t.length));
  }
  if (!texts.length) return out;
  for (const k of Object.keys(out)) out[k] = texts.every((t) => markAncestors(host, t, k).length > 0);
  return out;
}

/** The link under the caret / selection, if any. */
export function linkAt(host) {
  const r = selRange(host); if (!r) return null;
  const n = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer;
  const a = n && n.closest ? n.closest("a") : null;
  return a && host.contains(a) ? a : null;
}

/** Make the selection a link (or update / remove the one under the caret). */
export function applyLink(host, range, href, label) {
  const doc = host.ownerDocument;
  if (range) setSel(doc, range.startContainer, range.startOffset, range.endContainer, range.endOffset);
  const cur = selRange(host); if (!cur) return false;
  if (cur.collapsed) {
    const a = linkAt(host);
    if (a) { if (href) a.setAttribute("href", href); else { while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a); a.remove(); } return true; }
    if (!href) return false;
    const el = doc.createElement("a"); el.setAttribute("href", href); el.textContent = label || href;
    cur.insertNode(el);
    setSel(doc, el, el.childNodes.length);
    const after = doc.createTextNode(ZW); el.after(after); setSel(doc, after, 1);
    return true;
  }
  const keep = savePlain(host);
  const texts = coveredTexts(cur);
  for (const t of texts) {
    let A; while ((A = markAncestors(host, t, "a")[0])) stripAround(A, t);
    if (href) { const el = doc.createElement("a"); el.setAttribute("href", href); t.replaceWith(el); el.appendChild(t); }
  }
  tidy(host); restorePlain(host, keep);
  return true;
}

/** Put an image at the caret. */
export function insertImageAt(host, src, alt) {
  const doc = host.ownerDocument, r = selRange(host); if (!r) return false;
  r.deleteContents();
  const img = doc.createElement("img"); img.setAttribute("src", src); img.setAttribute("alt", alt || "image");
  r.insertNode(img);
  setSel(doc, img.parentNode, Array.prototype.indexOf.call(img.parentNode.childNodes, img) + 1);
  return true;
}

/* ═════════════════ caret / position questions ═════════════════ */

export function insideStart(el, range) {
  if (!range || !range.collapsed) return false;
  const pre = el.ownerDocument.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const frag = pre.cloneContents();
  return !frag.textContent.replace(/\u200b/g, "") && !frag.querySelector("img");
}
export function insideEnd(el, range) {
  if (!range || !range.collapsed) return false;
  const post = el.ownerDocument.createRange();
  post.selectNodeContents(el);
  post.setStart(range.startContainer, range.startOffset);
  const frag = post.cloneContents();
  return !frag.textContent.replace(/\u200b/g, "") && !frag.querySelector("img");
}
/** Everything before / after the caret inside `el`, as two detached clones of `el`. */
export function splitAround(el, range) {
  const doc = el.ownerDocument;
  const a = doc.createRange(); a.selectNodeContents(el); a.setEnd(range.startContainer, range.startOffset);
  const b = doc.createRange(); b.selectNodeContents(el); b.setStart(range.endContainer, range.endOffset);
  const left = el.cloneNode(false), right = el.cloneNode(false);
  left.appendChild(a.cloneContents()); right.appendChild(b.cloneContents());
  return { left, right };
}
export const isEmptyEl = (el) => !hasContent(el) || (!el.textContent.replace(/\u200b/g, "") && !el.querySelector("img,input"));

/* ═════════════════ lists ═════════════════ */

const isList = (n) => n && n.nodeType === 1 && (n.tagName === "UL" || n.tagName === "OL");
export const closest = (node, sel, within) => { let el = node && node.nodeType === 3 ? node.parentElement : node; el = el && el.closest ? el.closest(sel) : null; return el && within.contains(el) ? el : null; };

/** The element that holds a list item's own text (the li, or its <p> in a loose list). */
export function liBody(li) { const p = [...li.children].find((c) => c.tagName === "P"); return p || li; }

function placeholder(el) { if (isEmptyEl(el) && !el.querySelector("br")) el.appendChild(el.ownerDocument.createElement("br")); }

/** Enter inside a list item: the text after the caret (and any sub-list) moves to a new item below. */
export function splitItem(li, range) {
  const doc = li.ownerDocument;
  const body = liBody(li);
  const tail = doc.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  const lastInline = [...body.childNodes].reverse().find((n) => !isList(n));
  if (lastInline) tail.setEndAfter(lastInline); else tail.setEnd(body, body.childNodes.length);
  const frag = tail.extractContents();
  const nu = li.cloneNode(false);
  const chk = findCheckbox(li);
  if (chk) { const c = doc.createElement("input"); c.type = "checkbox"; nu.appendChild(c); }
  let target = nu;
  if (body !== li) { target = doc.createElement("p"); nu.appendChild(target); }
  target.appendChild(frag);
  [...li.children].filter(isList).forEach((l) => nu.appendChild(l));
  li.after(nu);
  placeholder(body); placeholder(target);
  return nu;
}

export function indentItem(li) {
  const prev = li.previousElementSibling;
  if (!prev || prev.tagName !== "LI") return false;
  const list = li.parentElement;
  let sub = [...prev.children].reverse().find(isList);
  if (!sub) { sub = li.ownerDocument.createElement(list.tagName.toLowerCase()); prev.appendChild(sub); }
  sub.appendChild(li);
  return true;
}
export function outdentItem(li) {
  const list = li.parentElement, parentLi = list && list.parentElement;
  if (!parentLi || parentLi.tagName !== "LI") return false;
  const sibs = []; for (let n = li.nextElementSibling; n; n = n.nextElementSibling) sibs.push(n);
  if (sibs.length) {
    let sub = [...li.children].reverse().find(isList);
    if (!sub) { sub = li.ownerDocument.createElement(list.tagName.toLowerCase()); li.appendChild(sub); }
    sibs.forEach((s) => sub.appendChild(s));
  }
  parentLi.after(li);
  if (!list.children.length) list.remove();
  return true;
}

/** Split a top-level list at item `li`: everything before it, and everything after it (li itself is dropped). */
export function splitListAt(list, li) {
  const items = [...list.children], idx = items.indexOf(li);
  const left = list.cloneNode(false), right = list.cloneNode(false);
  items.slice(0, idx).forEach((n) => left.appendChild(n.cloneNode(true)));
  items.slice(idx + 1).forEach((n) => right.appendChild(n.cloneNode(true)));
  if (list.tagName === "OL") right.setAttribute("start", String((parseInt(list.getAttribute("start"), 10) || 1) + idx));
  return { left, right };
}
