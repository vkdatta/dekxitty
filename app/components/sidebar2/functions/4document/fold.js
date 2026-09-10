// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the CodeMirror instance attached to the app.
 * Falls back gracefully if CM is not yet initialised.
 */
function getCM() {
  if (window.dexEditor && window.dexEditor.cm) return window.dexEditor.cm;
  return null;
}
/**
 * Walk every line of the editor and run a fold / unfold operation on it.
 * @param {"fold"|"unfold"} action
 */
function applyFoldToAllLines(action) {
  const cm = getCM();
  if (!cm) return;

  const lineCount = cm.lineCount();
  for (let line = 0; line < lineCount; line++) {
    try {
      cm.foldCode({ line, ch: 0 }, null, action);
    } catch (_) {
      // foldCode throws when the fold helper finds nothing — that is fine.
    }
  }
}

// ── Fold-state persistence ────────────────────────────────────────────────────

function saveFoldState() {
  const cm = getCM();
  if (!cm) return;
  if (typeof currentNote === 'undefined' || !currentNote) return;
  const folds = [];
  cm.getAllMarks().forEach(mark => {
    if (!mark.collapsed) return;
    const range = mark.find();
    if (range) folds.push({
      from: { line: range.from.line, ch: range.from.ch },
      to:   { line: range.to.line,   ch: range.to.ch   }
    });
  });
  currentNote.foldPositions = folds;
  if (typeof saveNotes === 'function') saveNotes();
}

// ── Public actions ────────────────────────────────────────────────────────────

/**
 * Fold every foldable region in the editor.
 */
export const foldAll = (...a) => preserveSelection(async () => {
  const cm = getCM();
  if (!cm) { showNotification("Editor not ready"); return; }

  applyFoldToAllLines("fold");
  saveFoldState();
  showNotification("Folded all");
})(...a);

/**
 * Unfold every folded region in the editor.
 */
export const unfoldAll = (...a) => preserveSelection(async () => {
  const cm = getCM();
  if (!cm) { showNotification("Editor not ready"); return; }

  applyFoldToAllLines("unfold");
  saveFoldState();
  showNotification("Unfolded all");
})(...a);

/**
 * Remove the contents *inside* every currently-folded region and unfold it,
 * leaving just the opening signature.
 *
 * Example – before:
 *   function greet(...) {
 *     console.log("hello");
 *   }
 *
 * After (if that range was folded):
 *   function greet() {}
 *
 * The algorithm:
 *   1. Collect all active TextMarker marks that CodeMirror uses to represent
 *      collapsed (folded) ranges.
 *   2. For each mark, determine the folded character range.
 *   3. Analyse the text that was folded:
 *        • If the fold widget collapsed a brace/bracket block  → replace
 *          everything from the opening delimiter to the matching closing
 *          delimiter with just `()` or `{}` (keeping the delimiters).
 *        • Otherwise → delete the folded span entirely.
 *   4. After all replacements, unfold so the editor is back in a clean state.
 */
export const removeContentInsideFolds = (...a) => preserveSelection(async () => {
  const cm = getCM();
  if (!cm) { showNotification("Editor not ready"); return; }

  // Gather all marks that represent collapsed folds.
  // CM marks a fold by setting { collapsed: true } on a TextMarker.
  const allMarks = cm.getAllMarks().filter(m => m.collapsed);

  if (allMarks.length === 0) {
    showNotification("Nothing is folded");
    return;
  }

  // Sort in REVERSE document order so that replacing later ranges first does
  // not invalidate the positions of earlier ranges.
  allMarks.sort((a, b) => {
    const pa = a.find(), pb = b.find();
    if (!pa || !pb) return 0;
    return CodeMirror.cmpPos(pb.from, pa.from);
  });

  cm.operation(() => {
    for (const mark of allMarks) {
      const range = mark.find();
      if (!range) continue;

      const { from, to } = range;
      const foldedText = cm.getRange(from, to);

      // Detect delimiter pairs: brace blocks  { … }  or paren groups  ( … )
      const firstChar = foldedText[0];
      const lastChar  = foldedText[foldedText.length - 1];

      const PAIRS = { "{": "}", "(": ")", "[": "]", "<": ">" };
      const isDelimiterBlock =
        firstChar in PAIRS && PAIRS[firstChar] === lastChar;

      if (isDelimiterBlock) {
        // Replace  { …long body… }  →  {}
        // Replace  ( …long args… )  →  ()
        cm.replaceRange(firstChar + lastChar, from, to);
      } else {
        // Generic fold — just delete the folded span.
        cm.replaceRange("", from, to);
      }

      // Clear the mark so CM does not try to reference the now-stale range.
      mark.clear();
    }
  });

  // Ensure nothing is left folded after the destructive edit.
  applyFoldToAllLines("unfold");
  saveFoldState();

  if (typeof updateNoteMetadata === "function") updateNoteMetadata();
  showNotification("Removed contents inside folds");
})(...a);
