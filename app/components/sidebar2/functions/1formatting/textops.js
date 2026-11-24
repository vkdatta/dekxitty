// Pure text transforms (string in → string out). No editor, no selection, no UI.
// Used by both the interactive sidebar functions and by automated workflows, so
// a function behaves identically in both places.

export const toUpper = (t) => t.toUpperCase();
export const toLower = (t) => t.toLowerCase();

export const capitalizeWordsText = (t) =>
  t.replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

export const capitalizeSentencesText = (t) =>
  t.toLowerCase().replace(/(^\s*[a-z])|([.!?]\s*[a-z])/g, (m) => m.toUpperCase());

export const reverseWordsText = (t) => t.split(/\s+/).reverse().join(" ");
export const reverseAllText = (t) => t.split("").reverse().join("");

// format: "1" = Markdown, "2" = HTML
export function bulletListText(t, format) {
  const lines = t.split(/\r?\n/);
  if (String(format) === "2") return "<ul>\n" + lines.map((l) => "<li>" + l + "</li>").join("\n") + "\n</ul>";
  return lines.map((l) => "- " + l).join("\n");
}

export function numberedListText(t, format) {
  const lines = t.split(/\r?\n/);
  if (String(format) === "2") return "<ol>\n" + lines.map((l) => "<li>" + l + "</li>").join("\n") + "\n</ol>";
  return lines.map((l, i) => i + 1 + ". " + l).join("\n");
}

export const indentText = (t) => "\t" + t.replace(/\n/g, "\n\t");

export const outdentText = (t) =>
  t.split("\n").map((l) => (l.startsWith("\t") ? l.slice(1) : l.startsWith(" ") ? l.slice(4) : l)).join("\n");
