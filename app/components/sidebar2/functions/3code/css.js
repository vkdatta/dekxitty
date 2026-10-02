export function optimiseCssText(input) {
  function extractStyleBlocks(text) {
    if (!text) return "";
    const styleRE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
    const matches = [];
    let m;
    while ((m = styleRE.exec(text)) !== null) matches.push(m[1]);
    if (matches.length) return matches.join("\n\n");
    return text;
  }

  class Tokenizer {
    constructor(css) {
      this.css = css || "";
      this.len = this.css.length;
      this.pos = 0;
    }
    eof() {
      return this.pos >= this.len;
    }
    peek(n = 0) {
      return this.css[this.pos + n];
    }
    next() {
      const c = this.css[this.pos];
      this.pos++;
      return c;
    }
    isWhitespace(ch) {
      if (!ch) return false;
      return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
    }
    skipWhitespaceAndComments() {
      while (!this.eof()) {
        const ch = this.peek();
        if (this.isWhitespace(ch)) {
          this.pos++;
          continue;
        }
        if (ch === "/" && this.peek(1) === "*") {
          this.pos += 2;
          while (!this.eof()) {
            if (this.peek() === "*" && this.peek(1) === "/") {
              this.pos += 2;
              break;
            }
            this.pos++;
          }
          continue;
        }
        break;
      }
    }
    consumeString(quote) {
      let out = quote;
      this.pos++;
      while (!this.eof()) {
        const ch = this.next();
        out += ch;
        if (ch === "\\") {
          if (!this.eof()) {
            out += this.consumeEscapeForString();
          }
        } else if (ch === quote) {
          break;
        }
      }
      return out;
    }
    consumeEscapeForString() {
      if (this.eof()) return "";
      const hexMatch = /^[0-9A-Fa-f]$/.test(this.peek()) ? true : false;
      let acc = "";
      if (hexMatch) {
        let count = 0;
        while (!this.eof() && count < 6 && /^[0-9A-Fa-f]$/.test(this.peek())) {
          acc += this.next();
          count++;
        }
        if (!this.eof() && this.isWhitespace(this.peek())) {
          acc += this.next();
        }
        return acc;
      } else {
        acc += this.next();
        return acc;
      }
    }
    consumeUntil(delimiters = []) {
      let out = "";
      while (!this.eof()) {
        const ch = this.peek();
        if (delimiters.includes(ch)) break;
        if (ch === "\\") {
          out += this.next();
          out += this.consumeEscapeForString();
          continue;
        }
        if (ch === '"' || ch === "'") {
          out += this.consumeString(this.peek());
          continue;
        }
        if (ch === "(") {
          out += this.next();
          let depth = 1;
          while (!this.eof() && depth > 0) {
            const c2 = this.peek();
            if (c2 === '"' || c2 === "'") {
              out += this.consumeString(this.peek());
            } else {
              if (c2 === "(") depth++;
              if (c2 === ")") depth--;
              out += this.next();
            }
          }
          continue;
        }
        out += this.next();
      }
      return out.trim();
    }
  }

  class Parser extends Tokenizer {
    constructor(css) {
      super(css);
    }
    parseDeclarations() {
      const decls = [];
      while (!this.eof()) {
        this.skipWhitespaceAndComments();
        if (this.eof()) break;
        const ch = this.peek();
        if (ch === "}") break;
        const rawProp = this.consumeUntil([":", ";", "}"]);
        if (this.eof()) break;
        if (this.peek() !== ":") {
          if (this.peek() === ";") {
            this.next();
            continue;
          }
          while (!this.eof() && this.peek() !== ";" && this.peek() !== "}") this.pos++;
          if (this.peek() === ";") this.next();
          continue;
        }
        this.next();
        const rawVal = this.consumeUntil([";", "}"]);
        if (this.peek() === ";") this.next();
        let prop = rawProp.trim();
        let val = rawVal.trim();
        if (!prop) continue;
        let important = false;
        const impIdx = val.toLowerCase().lastIndexOf("!important");
        if (impIdx !== -1 && val.slice(impIdx).toLowerCase().startsWith("!important")) {
          important = true;
          val = val.slice(0, impIdx).trim();
        }
        decls.push({ prop: prop.toLowerCase(), val, important });
      }
      return decls;
    }
    parseKeyframesBody() {
      const frames = [];
      while (!this.eof()) {
        this.skipWhitespaceAndComments();
        if (this.eof()) break;
        if (this.peek() === "}") break;
        const selector = this.consumeUntil(["{"]);
        if (this.peek() !== "{") {
          while (!this.eof() && this.peek() !== "{" && this.peek() !== "}") this.pos++;
          if (this.peek() !== "{") continue;
        }
        this.next();
        const decls = this.parseDeclarations();
        frames.push({ selector: selector.trim(), decls });
        if (this.peek() === "}") this.next();
      }
      return frames;
    }
    parseBlock() {
      const nodes = [];
      while (!this.eof()) {
        this.skipWhitespaceAndComments();
        if (this.eof()) break;
        if (this.peek() === "}") break;
        const header = this.consumeUntil(["{", ";", "}"]);
        if (this.peek() === ";") {
          this.next();
          nodes.push({ type: "stmt", header: header.trim() });
          continue;
        }
        if (this.peek() === "{") {
          this.next();
          const hLower = header.trim().toLowerCase();
          const isKeyframes =
            hLower.startsWith("@keyframes") ||
            hLower.startsWith("@-webkit-keyframes") ||
            hLower.startsWith("@-moz-keyframes");
          const isAtRule = header.trim().startsWith("@");
          if (isKeyframes) {
            const children = this.parseKeyframesBody();
            nodes.push({ type: "keyframes", header: header.trim(), children });
            if (this.peek() === "}") this.next();
            continue;
          }
          if (isAtRule) {
            if (hLower.startsWith("@font-face") || hLower.startsWith("@page")) {
              const decls = this.parseDeclarations();
              nodes.push({ type: "rule", selector: header.trim(), decls });
              if (this.peek() === "}") this.next();
            } else {
              const children = this.parseBlock();
              nodes.push({ type: "at-block", header: header.trim(), children });
              if (this.peek() === "}") this.next();
            }
            continue;
          }
          const decls = this.parseDeclarations();
          nodes.push({ type: "rule", selector: header.trim(), decls });
          if (this.peek() === "}") this.next();
          continue;
        }
        this.pos++;
      }
      return nodes;
    }
  }

  function hasCustomPropertyOrVarUsage(decls) {
    for (const d of decls) {
      if (d.prop && d.prop.startsWith("--")) return true;
      if (d.val && /\bvar\s*\(/.test(d.val)) return true;
    }
    return false;
  }
  function declSignature(decls) {
    return decls.map((d) => `${d.prop}:${d.val}${d.important ? "!imp" : ""}`).join(";");
  }
  function shallowCloneDecl(d) {
    return { prop: d.prop, val: d.val, important: !!d.important };
  }
  function optimizeNodes(nodes) {
    const out = [];
    for (const node of nodes) {
      if (node.type === "at-block") {
        node.children = optimizeNodes(node.children || []);
        out.push(node);
        continue;
      }
      if (node.type === "stmt" || node.type === "keyframes") {
        out.push(node);
        continue;
      }
      if (node.type === "rule") {
        const seenIndex = new Map();
        const resultDecls = [];
        for (const d of node.decls) {
          const prop = d.prop;
          if (seenIndex.has(prop)) {
            const idx = seenIndex.get(prop);
            const existing = resultDecls[idx];
            if (existing.important && !d.important) {
              continue;
            }
            resultDecls[idx] = shallowCloneDecl(d);
            continue;
          } else {
            seenIndex.set(prop, resultDecls.length);
            resultDecls.push(shallowCloneDecl(d));
          }
        }
        node.decls = resultDecls;
        if (node.decls.length === 0) continue;
        const prev = out.length ? out[out.length - 1] : null;
        if (prev && prev.type === "rule" && prev.selector === node.selector) {
          for (const d of node.decls) {
            const idx = prev.decls.findIndex((p) => p.prop === d.prop);
            if (idx >= 0) {
              const existing = prev.decls[idx];
              if (existing.important && !d.important) {
                continue;
              } else {
                prev.decls[idx] = shallowCloneDecl(d);
              }
            } else {
              prev.decls.push(shallowCloneDecl(d));
            }
          }
          continue;
        }
        if (prev && prev.type === "rule") {
          if (!hasCustomPropertyOrVarUsage(prev.decls) && !hasCustomPropertyOrVarUsage(node.decls)) {
            const sigPrev = declSignature(prev.decls);
            const sigNode = declSignature(node.decls);
            if (sigPrev === sigNode) {
              prev.selector = `${prev.selector}, ${node.selector}`;
              continue;
            }
          }
        }
        out.push(node);
      }
    }
    return out;
  }
  function serialize(nodes, depth = 0) {
    const indent = " ".repeat(depth);
    let out = "";
    for (const node of nodes) {
      if (node.type === "stmt") {
        out += `${indent}${node.header};\n`;
      } else if (node.type === "keyframes") {
        out += `${indent}${node.header} {\n`;
        for (const frame of node.children) {
          out += `${indent}  ${frame.selector} {\n`;
          for (const d of frame.decls) {
            out += `${indent}    ${d.prop}: ${d.val}${d.important ? " !important" : ""};\n`;
          }
          out += `${indent}  }\n`;
        }
        out += `${indent}}\n`;
      } else if (node.type === "at-block") {
        out += `${indent}${node.header} {\n`;
        out += serialize(node.children, depth + 1);
        out += `${indent}}\n`;
      } else if (node.type === "rule") {
        const sel = node.selector
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
          .join(", ");
        out += `${indent}${sel} {\n`;
        for (const d of node.decls) {
          out += `${indent}  ${d.prop}: ${d.val}${d.important ? " !important" : ""};\n`;
        }
        out += `${indent}}\n`;
      }
    }
    return out;
  }

  input = extractStyleBlocks(input || "");
  const parser = new Parser(input);
  const ast = parser.parseBlock();
  const optimizedAst = optimizeNodes(ast);
  let finalCss = serialize(optimizedAst);
  return finalCss.replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function minifyCssText(input) {
  let t = input || "";
  try { t = optimiseCssText(t); } catch (e) {}
  return t.replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
}

export const optimisecss = (...a) => preserveSelection(async () => {
  if (!currentNote || !noteTextarea) return;
  try {
    if (!noteTextarea) {
      const msg = "No textarea found to optimize.";
      if (typeof showNotification === "function") showNotification(msg);
      else console.warn(msg);
      return;
    }
    noteTextarea.value = optimiseCssText(noteTextarea.value || "");
    if (typeof updateNoteMetadata === "function") {
      try {
        updateNoteMetadata();
      } catch (e) {}
    }
    if (typeof showNotification === "function") showNotification("CSS optimized (safe mode)");
    else console.info("CSS optimized (safe mode)");
  } catch (err) {
    console.error("Optimizer error:", err);
    if (typeof showNotification === "function")
      showNotification("CSS optimization failed: " + (err && err.message ? err.message : String(err)));
  }
})(...a);

export const minifycss = (...a) => preserveSelection(async () => {
  if (!currentNote || !noteTextarea) return;
  const originalShowNotification = window.showNotification;
  window.showNotification = () => {};
  try {
    if (typeof optimisecss === "function") {
      await optimisecss();
    } else {
      throw new Error("optimisecss is not defined");
    }
    noteTextarea.value = noteTextarea.value
      .replace(/\r\n|\r|\n/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch (err) {
    console.error("minifycss error:", err);
  } finally {
    window.showNotification = originalShowNotification;
  }
  showNotification("Minified CSS");
});
