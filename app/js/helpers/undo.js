(function () {
  var editorReady = false;
  var pendingQueue = [];
  var pollTries = 0;
  var pollTimer = null;
  var MAX_POLL_TRIES = 250;

  function flushQueue() {
    var q = pendingQueue;
    pendingQueue = [];
    q.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  function poll() {
    if (window.dexEditor && window.dexEditor.cm) {
      editorReady = true;
      pollTimer = null;
      flushQueue();
      return;
    }
    if (pollTries++ > MAX_POLL_TRIES) {
      pollTimer = null;
      if (pendingQueue.length && typeof showNotification === 'function') {
        showNotification('Editor is still loading, please try again');
      }
      pendingQueue = [];
      return;
    }
    pollTimer = setTimeout(poll, 40);
  }

  function whenReady(fn) {
    if (editorReady || (window.dexEditor && window.dexEditor.cm)) {
      editorReady = true;
      fn();
      return;
    }
    pendingQueue.push(fn);
    if (!pollTimer) poll();
  }

  window.rebindUndoForNote = function (noteId, content) {
    whenReady(() => window.dexEditor.loadHistoryFor(noteId, content));
  };
  window.clearUndoHistoryForNote = function (noteId) {
    whenReady(() => window.dexEditor.clearHistoryFor(noteId));
  };
  window.performUndo = function () {
    whenReady(() => window.dexEditor.cm.undo());
  };
  window.performRedo = function () {
    whenReady(() => window.dexEditor.cm.redo());
  };
  window.clearUndoHistory = function () {
    whenReady(() => window.dexEditor.cm.clearHistory());
  };
  window.recordState = function () {};
  window.serializeUndoHistory = function () {
    if (!window.dexEditor || !window.dexEditor.cm) return null;
    try { return JSON.stringify(window.dexEditor.cm.getHistory()); } catch (e) { return null; }
  };

  function wireTopbarButtons() {
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');
    if (undoBtn && !undoBtn.__dexWired) {
      undoBtn.__dexWired = true;
      undoBtn.addEventListener('click', () => window.performUndo());
    }
    if (redoBtn && !redoBtn.__dexWired) {
      redoBtn.__dexWired = true;
      redoBtn.addEventListener('click', () => window.performRedo());
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireTopbarButtons);
  else wireTopbarButtons();
})();
