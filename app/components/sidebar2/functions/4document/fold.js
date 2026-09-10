// ── Helpers ──────────────────────────────────────────────────────────────────

function getCM() {
  if (window.dexEditor && window.dexEditor.cm) return window.dexEditor.cm;
  return null;
}

function applyFoldToAllLines(action) {
  const cm = getCM();
  if (!cm) return;
  const lineCount = cm.lineCount();
  for (let line = 0; line < lineCount; line++) {
    try { cm.foldCode({ line, ch: 0 }, null, action); } catch (_) {}
  }
}

// ── Fold state persistence ────────────────────────────────────────────────────

function foldStateKey(noteId) {
  return 'dexFolds:' + noteId;
}

function saveFoldState() {
  const cm = getCM();
  if (!cm) return;
  const noteId = (typeof currentNote !== 'undefined' && currentNote) ? currentNote.id : null;
  if (!noteId) return;

  const ranges = cm.getAllMarks()
    .filter(m => m.collapsed)
    .map(m => m.find())
    .filter(Boolean)
    .map(({ from, to }) => ({ from, to }));

  try {
    if (ranges.length === 0) {
      localStorage.removeItem(foldStateKey(noteId));
    } else {
      localStorage.setItem(foldStateKey(noteId), JSON.stringify(ranges));
    }
  } catch (_) {}
}

// Called from undo.js after cm.setValue() has finished loading the note content.
window.dexRestoreFolds = function (noteId) {
  if (!noteId) return;
  let ranges;
  try {
    const raw = localStorage.getItem(foldStateKey(noteId));
    if (!raw) return;
    ranges = JSON.parse(raw);
  } catch (_) { return; }
  if (!Array.isArray(ranges) || ranges.length === 0) return;

  // rAF lets CM finish its own post-setValue layout before we fold.
  requestAnimationFrame(() => {
    const cm = getCM();
    if (!cm) return;
    cm.operation(() => {
      for (const { from } of ranges) {
        try { cm.foldCode(from, null, 'fold'); } catch (_) {}
      }
    });
  });
};

// ── Public actions ────────────────────────────────────────────────────────────

export const foldAll = (...a) => preserveSelection(async () => {
  const cm = getCM();
  if (!cm) { showNotification("Editor not ready"); return; }
  applyFoldToAllLines("fold");
  saveFoldState();
  showNotification("Folded all");
})(...a);

export const unfoldAll = (...a) => preserveSelection(async () => {
  const cm = getCM();
  if (!cm) { showNotification("Editor not ready"); return; }
  applyFoldToAllLines("unfold");
  saveFoldState();
  showNotification("Unfolded all");
})(...a);

export const removeContentInsideFolds = (...a) => preserveSelection(async () => {
  const cm = getCM();
  if (!cm) { showNotification("Editor not ready"); return; }

  const allMarks = cm.getAllMarks().filter(m => m.collapsed);
  if (allMarks.length === 0) { showNotification("Nothing is folded"); return; }

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
      const firstChar = foldedText[0];
      const lastChar  = foldedText[foldedText.length - 1];
      const PAIRS = { "{": "}", "(": ")", "[": "]", "<": ">" };
      if (firstChar in PAIRS && PAIRS[firstChar] === lastChar) {
        cm.replaceRange(firstChar + lastChar, from, to);
      } else {
        cm.replaceRange("", from, to);
      }
      mark.clear();
    }
  });

  applyFoldToAllLines("unfold");
  saveFoldState(); // clears stale folds since content changed
  if (typeof updateNoteMetadata === "function") updateNoteMetadata();
  showNotification("Removed contents inside folds");
})(...a);
