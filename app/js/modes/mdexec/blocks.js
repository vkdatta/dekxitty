/**
 * mdexec / blocks — pure (DOM-free) Markdown helpers for Design mode.
 *
 *  • splitBlocks(src)  → top-level blocks with EXACT character offsets, so a block can be
 *                        edited / moved / deleted by patching the note text in place and
 *                        nothing outside it is ever re-serialised (lossless by construction).
 *  • blockInfo(text)   → what kind of block a chunk of text is.
 *  • format helpers    → inline wrap, block-type conversion, list indent, smart Enter.
 *  • table model       → parse / edit / serialise GFM tables.
 *  • block patches     → move / duplicate / delete / insert, returned as {from,to,text}.
 *
 * Nothing in here touches the document or the editor, which keeps it unit-testable.
 */

/* ───────── shared with the Read view ───────── */

/** Line indexes of every "- [ ]" / "1. [x]" task marker that is NOT inside a fenced code block. */
export function findTaskLines(src) {
  const lines = String(src).split(/\r?\n/);
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const f = l.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && /^ {0,3}(`{3,}|~{3,})\s*$/.test(l)) fence = null;
      continue;
    }
    if (f) { fence = f[1]; continue; }
    if (/^(?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\](?:\s|$)/.test(l)) out.push(i);
  }
  return out;
}

/** Flip the checkbox on one line; returns the new line text. */
export function setTaskChecked(line, checked) {
  return line.replace(/^((?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])\s+)\[[ xX]\]/, (_, pre) => pre + "[" + (checked ? "x" : " ") + "]");
}

export function slugify(text) {
  return String(text).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-");
}

/* ───────── block splitting ───────── */

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const QUOTE = /^ {0,3}>/;
const DELIM = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const HTML_BLOCK = /^ {0,3}(?:<!--|<\/?(?:div|p|table|details|summary|section|article|aside|center|iframe|img|video|audio|pre|style|script|ul|ol|li|h[1-6]|hr|br|figure|figcaption|nav|header|footer|form|blockquote|dl|dt|dd|tr|td|th|thead|tbody)\b)/i;
const blank = (t) => /^[ \t\r]*$/.test(t);

/** Cells of one table row (honours `\|` escapes; drops the optional leading / trailing pipe). */
export function splitRow(line) {
  let s = String(line).replace(/\r$/, "").trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out = []; let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
    else if (ch === "|") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Split a document into its top-level blocks.
 * Returns [{start, end, type, ...}] — `end` is exclusive and never includes the trailing newline,
 * so  src.slice(start, end)  is exactly the block and everything between blocks is untouched.
 */
export function splitBlocks(src) {
  src = String(src);
  const lines = [];
  let off = 0;
  for (const t of src.split("\n")) { lines.push({ t, s: off, e: off + t.length }); off += t.length + 1; }
  const n = lines.length, out = [];
  const push = (a, b) => { const start = lines[a].s, end = lines[b].e; out.push({ start, end, ...blockInfo(src.slice(start, end)) }); };
  let i = 0;
  while (i < n) {
    const L = lines[i].t;
    if (blank(L)) { i++; continue; }
    let m, end = i;

    // YAML front matter (first block only)
    if (!out.length && i === 0 && /^---[ \t]*$/.test(L)) {
      let j = i + 1; while (j < n && !/^(---|\.\.\.)[ \t]*$/.test(lines[j].t)) j++;
      if (j < n) { push(i, j); out[out.length - 1].type = "front"; i = j + 1; continue; }
    }
    // fenced code
    if ((m = L.match(FENCE)) && !(m[1][0] === "`" && m[2].includes("`"))) {
      const ch = m[1][0], len = m[1].length;
      let j = i + 1;
      while (j < n) { const c = lines[j].t.match(FENCE_CLOSE); if (c && c[1][0] === ch && c[1].length >= len) break; j++; }
      end = j < n ? j : n - 1;
      push(i, end); i = end + 1; continue;
    }
    if (ATX.test(L)) { push(i, i); i++; continue; }
    if (HR.test(L)) { push(i, i); i++; continue; }

    // table
    if (i + 1 < n && L.includes("|") && DELIM.test(lines[i + 1].t) && splitRow(L).length === splitRow(lines[i + 1].t).length) {
      end = i + 1;
      while (end + 1 < n && !blank(lines[end + 1].t) && lines[end + 1].t.includes("|")) end++;
      push(i, end); i = end + 1; continue;
    }
    // list
    if (LIST.test(L)) {
      let j = i + 1; end = i;
      while (j < n) {
        const t = lines[j].t;
        if (blank(t)) {
          let k = j + 1; while (k < n && blank(lines[k].t)) k++;
          if (k >= n) break;
          const nt = lines[k].t;
          if (/^( {2,}|\t)\S/.test(nt) || LIST.test(nt) && !HR.test(nt)) { end = k; j = k + 1; continue; }
          break;
        }
        if (ATX.test(t) || HR.test(t) || (FENCE.test(t) && !/^( {2,}|\t)/.test(t)) || (QUOTE.test(t) && !/^( {2,}|\t)/.test(t))) break;
        end = j; j++;
      }
      push(i, end); i = end + 1; continue;
    }
    // blockquote
    if (QUOTE.test(L)) {
      end = i;
      while (end + 1 < n) {
        const t = lines[end + 1].t;
        if (blank(t)) break;
        if (!QUOTE.test(t) && (ATX.test(t) || HR.test(t) || FENCE.test(t) || LIST.test(t))) break;
        end++;
      }
      push(i, end); i = end + 1; continue;
    }
    // raw HTML
    if (HTML_BLOCK.test(L)) {
      if (/^ {0,3}<!--/.test(L)) { let j = i; while (j < n && !/-->/.test(lines[j].t)) j++; end = Math.min(j, n - 1); }
      else { end = i; while (end + 1 < n && !blank(lines[end + 1].t)) end++; }
      push(i, end); i = end + 1; continue;
    }
    // paragraph (setext headings end it)
    end = i;
    while (end + 1 < n) {
      const t = lines[end + 1].t;
      if (blank(t)) break;
      if (SETEXT.test(t)) { end++; break; }
      const fm = t.match(FENCE);
      if (ATX.test(t) || HR.test(t) || QUOTE.test(t) || (fm && !(fm[1][0] === "`" && fm[2].includes("`")))) break;
      const lm = t.match(LIST);
      if (lm && !/^\s*(?:[-*+]|\d+[.)])\s*$/.test(t) && (!/^\d/.test(lm[2]) || /^1[.)]/.test(lm[2]))) break;
      end++;
    }
    push(i, end); i = end + 1;
  }
  return out;
}

/** Classify one block's text. */
export function blockInfo(text) {
  const first = String(text).split("\n", 1)[0];
  let m;
  if ((m = first.match(/^ {0,3}(#{1,6})(?:[ \t]|$)/))) return { type: "heading", level: m[1].length };
  const lines = String(text).split("\n");
  if (lines.length >= 2 && /^ {0,3}=+[ \t]*$/.test(lines[lines.length - 1]) && lines.length > 1) return { type: "heading", level: 1, setext: true };
  if (lines.length >= 2 && /^ {0,3}-+[ \t]*$/.test(lines[lines.length - 1]) && !HR.test(first) && lines.length > 1 && !LIST.test(first)) return { type: "heading", level: 2, setext: true };
  if ((m = first.match(FENCE)) && !(m[1][0] === "`" && m[2].includes("`"))) {
    const lang = (m[2].trim().split(/\s+/)[0] || "").toLowerCase();
    return { type: lang === "mermaid" ? "mermaid" : "code", lang };
  }
  if (HR.test(first) && lines.length === 1) return { type: "hr" };
  if (lines.length >= 2 && first.includes("|") && DELIM.test(lines[1]) && splitRow(first).length === splitRow(lines[1]).length) return { type: "table" };
  if ((m = first.match(LIST))) {
    const task = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\](?:\s|$)/.test(first);
    return { type: "list", ordered: /\d/.test(m[2]), task };
  }
  if (QUOTE.test(first)) return { type: "quote" };
  if (HTML_BLOCK.test(first)) return { type: "html" };
  return { type: "paragraph" };
}

/** Which block holds the offset (inclusive of the end, so a caret at the end of a block counts). -1 if none. */
export function blockAt(blocks, pos) {
  for (let i = 0; i < blocks.length; i++) if (pos >= blocks[i].start && pos <= blocks[i].end) return i;
  let best = -1;
  for (let i = 0; i < blocks.length; i++) if (blocks[i].start <= pos) best = i;
  return best;
}

/* ───────── inline formatting ───────── */

const WORD = /[\p{L}\p{N}_]/u;

/**
 * Toggle an inline wrapper around a selection.
 * With a caret only, wraps the word under it (or drops an empty pair and parks the caret between).
 * Returns { text, s, e } — the new text and selection.
 */
export function toggleWrap(text, s, e, L, R) {
  R = R == null ? L : R;
  if (s === e) {
    let a = s, b = e;
    while (a > 0 && WORD.test(text[a - 1])) a--;
    while (b < text.length && WORD.test(text[b])) b++;
    if (a === b) {
      const t = text.slice(0, s) + L + R + text.slice(e);
      return { text: t, s: s + L.length, e: s + L.length };
    }
    s = a; e = b;
  }
  const single = L.length === 1 && L === R;
  const bef = text.slice(s - L.length, s), aft = text.slice(e, e + R.length);
  const guard = (ch) => !single || (text[s - L.length - 1] !== ch && text[e + R.length] !== ch);
  // markers just outside the selection
  if (s - L.length >= 0 && bef === L && aft === R && guard(L)) {
    const t = text.slice(0, s - L.length) + text.slice(s, e) + text.slice(e + R.length);
    return { text: t, s: s - L.length, e: e - L.length };
  }
  // markers just inside the selection
  const sel = text.slice(s, e);
  if (sel.length >= L.length + R.length && sel.startsWith(L) && sel.endsWith(R) && (!single || (!sel.startsWith(L + L) || sel.length < 4))) {
    const inner = sel.slice(L.length, sel.length - R.length);
    return { text: text.slice(0, s) + inner + text.slice(e), s, e: s + inner.length };
  }
  return { text: text.slice(0, s) + L + sel + R + text.slice(e), s: s + L.length, e: e + L.length };
}

export function insertLink(text, s, e, url, label) {
  const sel = text.slice(s, e) || label || "link";
  const md = "[" + sel + "](" + url + ")";
  return { text: text.slice(0, s) + md + text.slice(e), s: s + md.length, e: s + md.length };
}
export function insertImage(text, s, e, url, alt) {
  const md = "![" + (alt || text.slice(s, e) || "image") + "](" + url + ")";
  return { text: text.slice(0, s) + md + text.slice(e), s: s + md.length, e: s + md.length };
}

/* ───────── block-type conversion ───────── */

const PREFIX_STRIP = /^(\s*)(?:(?:>\s?)+\s*)?(?:#{1,6}\s+)?(?:(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)?/;

/** Remove heading / quote / list / task markers from one line, returning {indent, body}. */
function stripLine(line) {
  const m = line.match(PREFIX_STRIP);
  return { indent: m ? m[1] : "", body: line.slice(m ? m[0].length : 0) };
}

/** Reduce a block's text to plain lines (unwrapping a code fence if there is one). */
function plainLines(text, info) {
  let lines = text.split("\n");
  if (info.type === "code" || info.type === "mermaid") {
    if (lines.length && FENCE.test(lines[0])) lines = lines.slice(1);
    if (lines.length && FENCE_CLOSE.test(lines[lines.length - 1])) lines = lines.slice(0, -1);
    return lines.map((l) => ({ indent: "", body: l }));
  }
  if (info.type === "table") return lines.filter((l, i) => i !== 1).map((l) => ({ indent: "", body: splitRow(l).join("  ") }));
  if (info.type === "hr") return [{ indent: "", body: "" }];
  if (info.setext) lines = lines.slice(0, -1);
  return lines.map((l) => stripLine(l));
}

/**
 * Convert a block to another type. target: p | h1…h6 | ul | ol | task | quote | code | mermaid
 * Converting to the type it already is toggles back to a paragraph.
 */
export function convertBlock(text, target) {
  const info = blockInfo(text);
  const same =
    (target === "p" && info.type === "paragraph") ||
    (/^h[1-6]$/.test(target) && info.type === "heading" && info.level === +target[1]) ||
    (target === "ul" && info.type === "list" && !info.ordered && !info.task) ||
    (target === "ol" && info.type === "list" && info.ordered) ||
    (target === "task" && info.type === "list" && info.task) ||
    (target === "quote" && info.type === "quote") ||
    (target === "code" && info.type === "code" && !info.lang) ||
    (target === "mermaid" && info.type === "mermaid");
  if (same && target !== "p") target = "p";
  const rows = plainLines(text, info);
  const nonEmpty = rows.filter((r) => r.body.trim() !== "");
  if (/^h[1-6]$/.test(target)) return "#".repeat(+target[1]) + " " + (nonEmpty.map((r) => r.body.trim()).join(" ") || "");
  if (target === "p") return rows.map((r) => r.indent + r.body).join("\n");
  if (target === "code" || target === "mermaid") {
    const body = rows.map((r) => r.indent + r.body).join("\n");
    return "```" + (target === "mermaid" ? "mermaid" : "") + "\n" + body + "\n```";
  }
  let n = 0;
  return rows.map((r) => {
    if (target === "quote") return r.body.trim() === "" ? ">" : "> " + r.indent + r.body;
    if (r.body.trim() === "" && rows.length > 1) return "";
    n++;
    if (target === "ul") return r.indent + "- " + r.body;
    if (target === "ol") return r.indent + n + ". " + r.body;
    if (target === "task") return r.indent + "- [ ] " + r.body;
    return r.indent + r.body;
  }).join("\n");
}

/** A ready-made block of the given kind, for "insert". */
export function seedBlock(kind) {
  switch (kind) {
    case "p": return "";
    case "h1": return "# ";
    case "h2": return "## ";
    case "h3": return "### ";
    case "ul": return "- ";
    case "ol": return "1. ";
    case "task": return "- [ ] ";
    case "quote": return "> ";
    case "code": return "```\n\n```";
    case "mermaid": return "```mermaid\nflowchart TD\n  A[Start] --> B[Next]\n```";
    case "hr": return "---";
    case "table": return serializeTable(newTable(3, 3));
    case "image": return "![image](https://)";
    default: return "";
  }
}
/** Where the caret should go inside a freshly seeded block. */
export function seedCaret(kind, text) {
  if (kind === "code") return 4;
  if (kind === "mermaid") return text.length - 4;
  if (kind === "image") return text.indexOf("(") + 1;
  return text.length;
}

/* ───────── list helpers ───────── */

/** Line ranges [a,b] (character offsets, whole lines) covered by a selection. */
function lineSpan(text, s, e) {
  const a = text.lastIndexOf("\n", s - 1) + 1;
  let b = text.indexOf("\n", e); if (b < 0) b = text.length;
  if (e > s && text[e - 1] === "\n") b = e - 1;
  return { a, b };
}

export function indentLines(text, s, e, dir) {
  const { a, b } = lineSpan(text, s, e);
  const lines = text.slice(a, b).split("\n");
  let dS = 0, dE = 0, off = a;
  const out = lines.map((l) => {
    const isOrd = /^\s*\d{1,9}[.)]\s/.test(l), step = isOrd ? 3 : 2;
    let nl = l, delta = 0;
    if (dir > 0) { nl = " ".repeat(step) + l; delta = step; }
    else { const m = l.match(/^( {1,}|\t)/); if (m) { const k = m[1] === "\t" ? 1 : Math.min(step, m[1].length); nl = l.slice(k); delta = -k; } }
    if (s >= off + (dir > 0 ? 0 : 0) && s > off) dS += delta; else if (s === off) dS += delta;
    if (e > off) dE += delta;
    off += l.length + 1;
    return nl;
  });
  const t = text.slice(0, a) + out.join("\n") + text.slice(b);
  return { text: t, s: Math.max(a, s + dS), e: Math.max(a, e + dE) };
}

/**
 * Smart Enter for list / task / quote lines.
 * Returns null when the default newline is right, else { text, s, e, exit } — `exit` means the
 * block has ended (Enter on an empty item) and the caller should move on to a fresh block.
 */
export function smartEnter(text, s, e) {
  if (s !== e) return null;
  const a = text.lastIndexOf("\n", s - 1) + 1;
  let b = text.indexOf("\n", s); if (b < 0) b = text.length;
  const line = text.slice(a, b);
  const info = blockInfo(text);
  if (info.type !== "list" && info.type !== "quote") return null;
  const lm = line.match(/^(\s*)((?:>\s?)*)(?:([-*+])|(\d{1,9})([.)]))(\s+)(\[[ xX]\]\s+)?/);
  const qm = !lm && line.match(/^(\s*)((?:>\s?)+)/);
  if (!lm && !qm) return null;
  const prefixLen = lm ? lm[0].length : qm[0].length;
  if (s - a < prefixLen) return null;                       // caret inside the marker itself
  const body = line.slice(prefixLen);
  if (body.trim() === "" && s === b) {                      // empty item → leave the list
    if (lm && lm[1].length >= 2) {                           // nested: outdent one level instead
      const out = indentLines(text, s, s, -1);
      return { text: out.text, s: out.s, e: out.e, exit: false };
    }
    const before = text.slice(0, a), after = text.slice(b);
    const joined = before.replace(/\n$/, "");
    if (a === 0) return { text: "", s: 0, e: 0, exit: true };
    return { text: joined + after, s: joined.length, e: joined.length, exit: true };
  }
  let marker;
  if (lm) {
    const q = lm[2] || "";
    marker = lm[1] + q + (lm[3] ? lm[3] : (+lm[4] + 1) + lm[5]) + lm[6] + (lm[7] ? "[ ] " : "");
  } else marker = qm[1] + qm[2];
  const t = text.slice(0, s) + "\n" + marker + text.slice(s);
  const p = s + 1 + marker.length;
  // renumber the following siblings if we split in the middle of an ordered list
  return { text: renumber(t, a), s: p, e: p, exit: false };
}

/** Keep ordered-list numbering consecutive from the item at offset `from` downward (same indent). */
export function renumber(text, from) {
  const lines = text.split("\n");
  let off = 0, idx = 0;
  while (idx < lines.length && off + lines[idx].length < from) { off += lines[idx].length + 1; idx++; }
  const m0 = (lines[idx] || "").match(/^(\s*)(\d{1,9})([.)])\s/);
  if (!m0) return text;
  let n = +m0[2];
  const indent = m0[1].length;
  for (let k = idx + 1; k < lines.length; k++) {
    const m = lines[k].match(/^(\s*)(\d{1,9})([.)])(\s.*)?$/);
    if (!m) { if (blank(lines[k]) || lines[k].match(/^\s*([-*+]|\d)/)) { if (blank(lines[k])) break; continue; } if (/^\s{2,}/.test(lines[k])) continue; break; }
    if (m[1].length < indent) break;
    if (m[1].length > indent) continue;
    n++; lines[k] = m[1] + n + m[3] + (m[4] || "");
  }
  return lines.join("\n");
}

/* ───────── tables ───────── */

export function newTable(rows, cols) {
  return {
    head: Array.from({ length: cols }, (_, i) => "Column " + (i + 1)),
    align: Array(cols).fill(""),
    rows: Array.from({ length: rows }, () => Array(cols).fill("")),
  };
}

export function parseTable(text) {
  const lines = String(text).split("\n").filter((l) => l.trim() !== "");
  const head = splitRow(lines[0] || "");
  const align = splitRow(lines[1] || "").map((c) => { const l = c.startsWith(":"), r = c.endsWith(":"); return l && r ? "c" : r ? "r" : l ? "l" : ""; });
  const cols = head.length;
  const rows = lines.slice(2).map((l) => { const r = splitRow(l); while (r.length < cols) r.push(""); return r.slice(0, cols); });
  while (align.length < cols) align.push("");
  return { head, align: align.slice(0, cols), rows };
}

const cellOut = (v) => String(v == null ? "" : v).replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");

export function serializeTable(t) {
  const cols = t.head.length;
  const H = t.head.map(cellOut), B = t.rows.map((r) => r.map(cellOut));
  const w = Array.from({ length: cols }, (_, c) => Math.max(3, H[c].length, ...B.map((r) => (r[c] || "").length)));
  const pad = (s, c) => {
    const a = t.align[c], gap = w[c] - s.length;
    if (a === "r") return " ".repeat(gap) + s;
    if (a === "c") { const l = Math.floor(gap / 2); return " ".repeat(l) + s + " ".repeat(gap - l); }
    return s + " ".repeat(gap);
  };
  const row = (r) => "| " + r.map((s, c) => pad(s, c)).join(" | ") + " |";
  const delim = "| " + t.align.map((a, c) => { const d = "-".repeat(w[c] - (a === "c" ? 2 : a ? 1 : 0)); return a === "c" ? ":" + d + ":" : a === "l" ? ":" + d : a === "r" ? d + ":" : d; }).join(" | ") + " |";
  return [row(H), delim, ...B.map(row)].join("\n");
}

export const tableOps = {
  addRow(t, at) { t.rows.splice(Math.max(0, Math.min(t.rows.length, at)), 0, Array(t.head.length).fill("")); },
  delRow(t, at) { if (t.rows.length > 0) t.rows.splice(at, 1); },
  addCol(t, at) { at = Math.max(0, Math.min(t.head.length, at)); t.head.splice(at, 0, "Column " + (t.head.length + 1)); t.align.splice(at, 0, ""); t.rows.forEach((r) => r.splice(at, 0, "")); },
  delCol(t, at) { if (t.head.length <= 1) return; t.head.splice(at, 1); t.align.splice(at, 1); t.rows.forEach((r) => r.splice(at, 1)); },
  moveCol(t, at, dir) { const to = at + dir; if (to < 0 || to >= t.head.length) return at; for (const arr of [t.head, t.align, ...t.rows]) { const x = arr[at]; arr[at] = arr[to]; arr[to] = x; } return to; },
  moveRow(t, at, dir) { const to = at + dir; if (to < 0 || to >= t.rows.length) return at; const x = t.rows[at]; t.rows[at] = t.rows[to]; t.rows[to] = x; return to; },
  setAlign(t, at, a) { t.align[at] = t.align[at] === a ? "" : a; },
  sort(t, col, dir) {
    const num = (s) => { const n = parseFloat(String(s).replace(/[, $€£%]/g, "")); return isNaN(n) ? null : n; };
    t.rows.sort((x, y) => {
      const a = x[col] || "", b = y[col] || "", na = num(a), nb = num(b);
      const c = na != null && nb != null ? na - nb : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      return c * dir;
    });
  },
  /** Paste a TSV / CSV grid with its top-left at (r, c); grows the table as needed. r = -1 means the header row. */
  paste(t, r, c, grid) {
    grid.forEach((row, i) => row.forEach((v, j) => {
      const cc = c + j, rr = r + i;
      while (cc >= t.head.length) tableOps.addCol(t, t.head.length);
      if (rr < 0) { t.head[cc] = v; return; }
      while (rr >= t.rows.length) tableOps.addRow(t, t.rows.length);
      t.rows[rr][cc] = v;
    }));
  },
};

/** Parse clipboard text as a grid: tab-separated if it has tabs, else comma-separated with quotes. null if it is just one value. */
export function parseGrid(text) {
  const t = String(text).replace(/\r\n?/g, "\n").replace(/\n$/, "");
  if (!t.includes("\t") && !t.includes("\n")) return null;
  if (t.includes("\t")) return t.split("\n").map((l) => l.split("\t"));
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  row.push(cur); rows.push(row);
  return rows.length > 1 || rows[0].length > 1 ? rows : null;
}

/* ───────── whole-document block patches ───────── */
/* Each returns { from, to, text, focus } — replace src[from,to) with text; `focus` is the block index to select next. */

export function patchMove(src, blocks, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= blocks.length) return null;
  const a = blocks[Math.min(i, j)], b = blocks[Math.max(i, j)];
  const ta = src.slice(a.start, a.end), tb = src.slice(b.start, b.end), gap = src.slice(a.end, b.start);
  return { from: a.start, to: b.end, text: tb + gap + ta, focus: j };
}
export function patchDuplicate(src, blocks, i) {
  const b = blocks[i];
  return { from: b.end, to: b.end, text: "\n\n" + src.slice(b.start, b.end), focus: i + 1 };
}
export function patchDelete(src, blocks, i) {
  const b = blocks[i];
  if (blocks.length === 1) return { from: 0, to: src.length, text: "", focus: -1 };
  if (i < blocks.length - 1) return { from: b.start, to: blocks[i + 1].start, text: "", focus: i };
  return { from: blocks[i - 1].end, to: b.end, text: "", focus: i - 1 };
}
/** Insert a block (given text) after block i (or at the very start when i = -1). */
export function patchInsert(src, blocks, i, text) {
  if (!blocks.length) return { from: src.length, to: src.length, text: (src.length && !/\n\n$/.test(src) ? (src.endsWith("\n") ? "\n" : "\n\n") : "") + text, focus: 0 };
  if (i < 0) return { from: blocks[0].start, to: blocks[0].start, text: text + "\n\n", focus: 0 };
  return { from: blocks[i].end, to: blocks[i].end, text: "\n\n" + text, focus: i + 1 };
}

/** Apply a patch to a string (used by tests; the editor applies the same patch with replaceRange). */
export function applyPatch(src, p) { return src.slice(0, p.from) + p.text + src.slice(p.to); }
