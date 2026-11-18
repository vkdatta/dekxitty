/**
 * Docs copier — saved preferences (pure, no DOM besides localStorage).
 *
 * One schema drives everything: the Settings screen renders it, the converter reads it.
 *   key       storage / lookup key
 *   def       default value (boolean toggles, or a number for type:"number")
 *   children  sub-options; each child's `showWhen` is "on" or "off" — it is only shown
 *             (and only matters) while its parent toggle is in that state.
 */
export const DOCS_COPIER_OPTIONS = [
  {
    key: "headings", label: "Retain headings", def: true,
    desc: "Keep headings as real Google Docs headings (Heading 1–6).",
    children: [
      { key: "headingsBold", label: "Use bold instead", def: true, showWhen: "off",
        desc: "Turn each heading into a bold paragraph. Off makes it plain text." }
    ]
  },
  {
    key: "lists", label: "Retain lists", def: true,
    desc: "Keep bullet and numbered lists as real Docs lists.",
    children: [
      { key: "listsText", label: "Keep bullets and numbers as typed text", def: true, showWhen: "off",
        desc: "Write • or 1. in front of each item. Off leaves plain lines." }
    ]
  },
  { key: "bold",        label: "Retain bold",           def: true, desc: "Keep **bold** text." },
  { key: "italics",     label: "Retain italics",        def: true, desc: "Keep *italic* text." },
  { key: "underlines",  label: "Retain underlines",     def: true, desc: "Keep underlined text. Markdown has no underline of its own, so this only affects text written as <u>…</u>." },
  { key: "strike",      label: "Retain strikethrough",  def: true, desc: "Keep ~~struck-out~~ text." },
  { key: "links",       label: "Retain hyperlinks",     def: true, desc: "Keep links clickable. Off keeps just the link text." },
  { key: "code",        label: "Retain inline code",    def: true, desc: "Keep `code` in a monospace font." },
  { key: "codeBlocks",  label: "Retain code blocks",    def: true, desc: "Keep fenced code blocks in a monospace font." },
  { key: "blockquotes", label: "Retain quotes",         def: true, desc: "Keep > quoted text indented." },
  {
    key: "tables", label: "Retain tables", def: true,
    desc: "Keep tables as real Docs tables. Off turns them into tab-separated lines.",
    children: [
      { key: "tableWidth", type: "number", label: "Table width", def: 450, min: 100, max: 2000, unit: "px", showWhen: "on",
        desc: "Total width, shared equally between the columns (450 → 2 columns = 225 each). Default 450." },
      { key: "tableHeader", label: "Bold, shaded header row", def: true, showWhen: "on",
        desc: "Make the first row bold with a light grey background." },
      { key: "tableBorders", label: "Table borders", def: true, showWhen: "on",
        desc: "Draw a thin border around every cell." }
    ]
  }
];

export const DOCS_COPIER_STORAGE_KEY = "dexDocsCopierPrefs";

const flat = () => DOCS_COPIER_OPTIONS.flatMap((o) => [o, ...(o.children || [])]);

export const DOCS_COPIER_DEFAULTS = Object.freeze(Object.fromEntries(flat().map((o) => [o.key, o.def])));

/** Clamp a width to its allowed range; anything unusable falls back to the default. */
export function cleanWidth(v) {
  const spec = flat().find((o) => o.key === "tableWidth");
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return spec.def;
  return Math.min(spec.max, Math.max(spec.min, n));
}

export function getPrefs() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DOCS_COPIER_STORAGE_KEY) || "{}") || {}; } catch (e) { saved = {}; }
  const out = {};
  flat().forEach((o) => {
    const v = saved[o.key];
    if (o.type === "number") out[o.key] = v == null ? o.def : cleanWidth(v);
    else out[o.key] = typeof v === "boolean" ? v : o.def;
  });
  return out;
}

export function setPref(key, value) {
  const spec = flat().find((o) => o.key === key);
  if (!spec) return getPrefs();
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DOCS_COPIER_STORAGE_KEY) || "{}") || {}; } catch (e) { saved = {}; }
  saved[key] = spec.type === "number" ? cleanWidth(value) : !!value;
  try { localStorage.setItem(DOCS_COPIER_STORAGE_KEY, JSON.stringify(saved)); } catch (e) {}
  return getPrefs();
}

/** Is a sub-option currently relevant, given its parent's state? */
export function childVisible(child, prefs, parentKey) {
  return child.showWhen === "off" ? !prefs[parentKey] : !!prefs[parentKey];
}
