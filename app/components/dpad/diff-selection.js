(function () {
  if (window.__dexDiffSelectionLoaded) return;
  window.__dexDiffSelectionLoaded = true;

  let diffSavedText = '';

  const notify = window.__dexDpad && typeof window.__dexDpad.notify === 'function'
    ? window.__dexDpad.notify
    : () => {};

  function getDiffElements() {
    const source = window.diffElements;
    if (source && source.raw && source.morph && source.optBreaks) return source;

    const raw = document.getElementById('diffRaw');
    const morph = document.getElementById('diffMorph');
    const optBreaks = document.getElementById('diffOptBreaks');
    if (raw && morph && optBreaks) {
      return { raw, morph, optBreaks };
    }
    return null;
  }

  function diffGetLines(isRaw) {
    const diffElements = getDiffElements();
    if (!diffElements) throw new Error('diffElements not initialized');
    const text = isRaw ? diffElements.raw.value : diffElements.morph.value;
    return diffElements.optBreaks.checked
      ? text.split(/\r?\n/)
      : [text.replace(/\r?\n/g, ' ')];
  }

  function diffSetLines(isRaw, linesArray) {
    const diffElements = getDiffElements();
    if (!diffElements) throw new Error('diffElements not initialized');
    const result = linesArray.join('\n');
    if (isRaw) diffElements.raw.value = result;
    else diffElements.morph.value = result;
  }

  window.diffGetLines = diffGetLines;
  window.diffSetLines = diffSetLines;
  Object.defineProperty(window, 'diffSavedText', {
    configurable: true,
    enumerable: false,
    get: () => diffSavedText,
    set: (value) => { diffSavedText = String(value == null ? '' : value); }
  });

  function domRangeOffsetInLineRow(lineRow, rangeContainer, rangeOffset) {
    let charCount = 0;
    const walker = document.createTreeWalker(lineRow, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      if (node === rangeContainer) return charCount + rangeOffset;
      charCount += node.textContent.length;
    }

    if (rangeContainer.nodeType !== Node.TEXT_NODE) {
      const walker2 = document.createTreeWalker(lineRow, NodeFilter.SHOW_TEXT, null, false);
      charCount = 0;
      while ((node = walker2.nextNode())) {
        const child = rangeContainer.childNodes[rangeOffset];
        if (child && child.contains(node)) break;
        charCount += node.textContent.length;
      }
      return charCount;
    }
    return 0;
  }

  function runDiffRefresh() {
    if (typeof window.diffusion === 'function') window.diffusion();
  }

  function saveSelection(sel) {
    diffSavedText = sel.text;
    const status = document.getElementById('diffStatSaved');
    if (status) status.textContent = diffSavedText;
    notify('Selection saved');
  }

  function swapCorrespondingLines(sel) {
    if (sel.startLine < 0 || sel.endLine < sel.startLine) return;

    try {
      const sourceIsRaw = sel.viewId === 'diffDiff1View';
      const source = diffGetLines(sourceIsRaw);
      const target = diffGetLines(!sourceIsRaw);

      for (let i = sel.startLine; i <= sel.endLine; i++) {
        if (i >= source.length || i >= target.length) continue;
        const tmp = source[i];
        source[i] = target[i];
        target[i] = tmp;
      }

      diffSetLines(sourceIsRaw, source);
      diffSetLines(!sourceIsRaw, target);
      runDiffRefresh();
      notify('Lines swapped');
    } catch (_e) {
      notify('Diff data unavailable');
    }
  }

  function replaceSelectedText(lines, sel, replacement) {
    const full = lines.join('\n');
    const lineStart = Math.max(0, Math.min(sel.startLine, lines.length - 1));
    const lineEnd = Math.max(lineStart, Math.min(sel.endLine, lines.length - 1));
    let startOffset = 0;
    for (let i = 0; i < lineStart; i++) startOffset += lines[i].length + 1;
    let endOffset = 0;
    for (let i = 0; i < lineEnd; i++) endOffset += lines[i].length + 1;
    startOffset += Math.max(0, Math.min(sel.startCharOffset, lines[lineStart].length));
    endOffset += Math.max(0, Math.min(sel.endCharOffset, lines[lineEnd].length));
    if (endOffset < startOffset) [startOffset, endOffset] = [endOffset, startOffset];
    const oldText = full.slice(startOffset, endOffset);
    const next = full.slice(0, startOffset) + replacement + full.slice(endOffset);
    return { oldText, lines: next.split('\n') };
  }

  function swapWithSavedText(sel) {
    if (!diffSavedText || sel.startLine < 0 || sel.endLine < sel.startLine) return;

    try {
      const sourceIsRaw = sel.viewId === 'diffDiff1View';
      const lines = diffGetLines(sourceIsRaw);
      const start = sel.startLine;
      const end = Math.min(sel.endLine, lines.length - 1);

      if (sel.isLineSelection) {
        const count = end - start + 1;
        const oldLines = lines.slice(start, start + count);
        const savedLines = diffSavedText.split(/\r?\n/);
        lines.splice(start, count, ...savedLines);
        diffSavedText = oldLines.join('\n');
      } else {
        const result = replaceSelectedText(lines, sel, diffSavedText);
        lines.splice(0, lines.length, ...result.lines);
        diffSavedText = result.oldText;
      }

      const status = document.getElementById('diffStatSaved');
      if (status) status.textContent = diffSavedText;
      diffSetLines(sourceIsRaw, lines);
      runDiffRefresh();
      notify('Swapped with saved text');
    } catch (_e) {
      notify('Diff data unavailable');
    }
  }

  function diffActions(sel) {
    const actions = [
      { label: 'Save selection', icon: 'bookmark', run: () => saveSelection(sel) },
      { label: 'Swap corresponding line(s)', icon: 'swap', run: () => swapCorrespondingLines(sel) }
    ];
    if (diffSavedText) {
      actions.push({ label: 'Swap with saved text', icon: 'swapSaved', run: () => swapWithSavedText(sel) });
    }
    return actions;
  }

  function findRow(node) {
    const element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return element && element.closest ? element.closest('.diff-line-row') : null;
  }

  function findDiffView(node) {
    const element = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    return element && element.closest ? element.closest('.diff-view') : null;
  }

  function isDiffView(view) {
    return !!(view && (view.id === 'diffDiff1View' || view.id === 'diffDiff2View'));
  }

  function captureSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;

    const range = selection.getRangeAt(0);
    const view = findDiffView(range.commonAncestorContainer);
    if (!isDiffView(view)) return null;

    const startRow = findRow(range.startContainer);
    const endRow = findRow(range.endContainer);
    if (!startRow || !endRow) return null;

    const startGutter = startRow.querySelector('.diff-gutter-cell');
    const endGutter = endRow.querySelector('.diff-gutter-cell');
    const touchesGutter = (gutter) => !!(
      gutter && (
        range.intersectsNode(gutter) ||
        gutter.contains(range.startContainer) ||
        gutter.contains(range.endContainer)
      )
    );
    // Treat the selection as a line selection if either endpoint/range
    // touches a gutter. This makes gutter -> text and text -> gutter
    // deterministic instead of depending on drag direction.
    const isLineSelection = touchesGutter(startGutter) || touchesGutter(endGutter);

    return {
      viewId: view.id,
      startLine: Number(startRow.dataset.line),
      endLine: Number(endRow.dataset.line),
      text: selection.toString(),
      isLineSelection,
      startCharOffset: domRangeOffsetInLineRow(startRow, range.startContainer, range.startOffset),
      endCharOffset: domRangeOffsetInLineRow(endRow, range.endContainer, range.endOffset)
    };
  }

  let diffSelectionTimer = null;
  let diffSelectionSerial = 0;

  function clearDiffSelectionTimer() {
    if (diffSelectionTimer !== null) {
      clearTimeout(diffSelectionTimer);
      diffSelectionTimer = null;
    }
    diffSelectionSerial++;
  }

  function closeDiffMenuIfActive() {
    if (typeof window.dexNativeMenuSurface === 'function' &&
        window.dexNativeMenuSurface() === 'diff' &&
        typeof window.dexCloseNativeMenu === 'function') {
      window.dexCloseNativeMenu();
    }
  }

  window.addEventListener('popstate', clearDiffSelectionTimer);
  window.addEventListener('hashchange', clearDiffSelectionTimer);

  document.addEventListener('selectionchange', () => {
    clearDiffSelectionTimer();

    const captured = captureSelection();
    if (!captured || !captured.text) {
      closeDiffMenuIfActive();
      return;
    }

    const serial = diffSelectionSerial;
    // selectionchange fires continuously while the user drags. Do not rebuild
    // the menu for every intermediate range; wait for a settled selection.
    diffSelectionTimer = setTimeout(() => {
      diffSelectionTimer = null;
      if (serial !== diffSelectionSerial) return;

      const current = captureSelection();
      if (!current || !current.text) {
        closeDiffMenuIfActive();
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        closeDiffMenuIfActive();
        return;
      }
      const range = selection.getRangeAt(0);
      const view = findDiffView(range.commonAncestorContainer);
      if (!isDiffView(view)) {
        closeDiffMenuIfActive();
        return;
      }

      const rect = range.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      if (typeof window.dexOpenSelectionMenu !== 'function') return;

      window.dexOpenSelectionMenu(
        diffActions(current),
        { left: rect.left, top: rect.top, bottom: rect.bottom },
        'diff'
      );
    }, 180);
  });
})();
