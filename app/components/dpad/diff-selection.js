(function () {
  if (window.__dexDiffSelectionLoaded) return;
  window.__dexDiffSelectionLoaded = true;

  const api = () => window.__dexMenuApi;
  function notify(m) { const a = api(); if (a) a.notify(m); }

  function domRangeOffsetInLineRow(lineRow, rangeContainer, rangeOffset) {
    let charCount = 0;
    const walker = document.createTreeWalker(lineRow, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while ((node = walker.nextNode())) {
      if (node === rangeContainer) return charCount + rangeOffset;
      charCount += node.textContent.length;
    }
    if (rangeContainer.nodeType !== 3) {
      const walker2 = document.createTreeWalker(lineRow, NodeFilter.SHOW_TEXT, null, false);
      charCount = 0;
      while ((node = walker2.nextNode())) {
        if (rangeContainer.childNodes[rangeOffset] &&
            rangeContainer.childNodes[rangeOffset].contains(node)) break;
        charCount += node.textContent.length;
      }
      return charCount;
    }
    return 0;
  }

  function diffGetLines(isRaw) {
    if (!diffElements || !diffElements.raw || !diffElements.morph || !diffElements.optBreaks) {
      throw new Error('diffElements not initialized');
    }
    const text = isRaw ? diffElements.raw.value : diffElements.morph.value;
    return diffElements.optBreaks.checked ? text.split(/\r?\n/) : [text.replace(/\r?\n/g, ' ')];
  }

  function diffSetLines(isRaw, linesArray) {
    if (!diffElements || !diffElements.raw || !diffElements.morph) {
      throw new Error('diffElements not initialized');
    }
    const result = linesArray.join('\n');
    if (isRaw) diffElements.raw.value = result;
    else       diffElements.morph.value = result;
  }

  let diffSavedText = '';

  function diffViewActions(sel) {
    const actions = [
      {
        label: 'Save selection', icon: 'bookmark',
        run: () => {
          diffSavedText = sel.text;
          const st = document.getElementById('diffStatSaved');
          if (st) st.textContent = diffSavedText;
        }
      },
      {
        label: 'Swap corresponding line(s)', icon: 'swap',
        run: () => {
          if (sel.startLine < 0) return;
          try {
            const isSourceRaw = sel.viewId === 'diffDiff1View';
            const sourceLines = diffGetLines(isSourceRaw);
            const targetLines = diffGetLines(!isSourceRaw);
            for (let i = sel.startLine; i <= sel.endLine; i++) {
              sourceLines[i] = targetLines[i] !== undefined ? targetLines[i] : sourceLines[i];
            }
            diffSetLines(isSourceRaw, sourceLines);
            if (typeof diffusion === 'function') diffusion();
          } catch (_e) { notify('Diff data unavailable'); }
        }
      }
    ];

    if (diffSavedText) {
      actions.push({
        label: 'Swap with saved text', icon: 'swapSaved',
        run: () => {
          if (!diffSavedText || sel.startLine < 0) return;
          try {
            const isSourceRaw = sel.viewId === 'diffDiff1View';
            const lines       = diffGetLines(isSourceRaw);
            const savedLines  = diffSavedText.split(/\r?\n/);
            const start = sel.startLine, end = sel.endLine;
            if (sel.isLineSelection || start !== end) {
              for (let i = start; i <= end; i++) {
                lines[i] = (i - start < savedLines.length) ? savedLines[i - start] : lines[i];
              }
            } else {
              const lineText = lines[start] || '';
              lines[start] = lineText.substring(0, sel.startCharOffset)
                           + diffSavedText
                           + lineText.substring(sel.endCharOffset);
            }
            diffSetLines(isSourceRaw, lines);
            if (typeof diffusion === 'function') diffusion();
          } catch (_e) { notify('Diff data unavailable'); }
        }
      });
    }
    return actions;
  }

  function hookDiffView() {
    document.addEventListener('selectionchange', () => {
      const m = api();
      if (!m) return;

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) { m.close('diff'); return; }

      const range     = sel.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const element   = container.nodeType === 3 ? container.parentElement : container;
      const view      = element && element.closest ? element.closest('.diff-view') : null;
      if (!view || (view.id !== 'diffDiff1View' && view.id !== 'diffDiff2View')) {
        m.close('diff'); return;
      }

      const startRow = (range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer).closest('.diff-line-row');
      const endRow   = (range.endContainer.nodeType   === 3 ? range.endContainer.parentElement   : range.endContainer  ).closest('.diff-line-row');
      if (!startRow || !endRow) { m.close('diff'); return; }

      const gutter = startRow.querySelector('.diff-gutter-cell');
      let isLineSelection = false;
      if (gutter && (range.intersectsNode(gutter) ||
                     gutter.contains(range.startContainer) ||
                     gutter.contains(range.endContainer))) {
        isLineSelection = true;
      }

      const startCharOffset = domRangeOffsetInLineRow(startRow, range.startContainer, range.startOffset);
      const endCharOffset   = domRangeOffsetInLineRow(endRow,   range.endContainer,   range.endOffset);
      const capturedSel = {
        viewId: view.id,
        startLine: parseInt(startRow.dataset.line, 10),
        endLine:   parseInt(endRow.dataset.line,   10),
        text: sel.toString(),
        isLineSelection, startCharOffset, endCharOffset
      };

      m.schedule('diff', () => {
        const currentSel = window.getSelection();
        if (!currentSel || currentSel.isCollapsed) return null;
        if (currentSel.toString() !== capturedSel.text) return null;

        const currentRange     = currentSel.getRangeAt(0);
        const currentContainer = currentRange.commonAncestorContainer;
        const currentEl        = currentContainer.nodeType === 3 ? currentContainer.parentElement : currentContainer;
        const currentView      = currentEl && currentEl.closest ? currentEl.closest('.diff-view') : null;
        if (!currentView || currentView.id !== view.id) return null;

        const rect = currentRange.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;

        return {
          actions: diffViewActions(capturedSel),
          rect: { left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom }
        };
      });
    });
  }

  function init() { hookDiffView(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();