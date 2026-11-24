export function findPairs(text, startDelim, endDelim) {
  const pairs = [];
  if (!startDelim || !endDelim) return pairs;
  const sLen = startDelim.length,
    eLen = endDelim.length,
    stack = [];
  let i = 0;
  while (i < text.length) {
    if (text.substr(i, sLen) === startDelim) {
      stack.push(i);
      i += sLen;
      continue;
    }
    if (text.substr(i, eLen) === endDelim) {
      if (stack.length > 0) {
        const startIdx = stack.pop(),
          endIdx = i + eLen;
        pairs.push({ startIndex: startIdx, endIndex: endIdx });
      }
      i += eLen;
      continue;
    }
    i++;
  }
  return pairs.sort((a, b) => a.startIndex - b.startIndex);
}

// Pure: string in → { text, count } or { error }. Shared by the sidebar function and workflows.
export function replaceBetweenDelimiters(text, o) {
  const { startDelim, endDelim, includeDelims, replaceText, mode, singleInstance, rangeFrom, rangeTo } = o;
  if (!startDelim) return { error: "Start delimiter required" };
  if (!endDelim) return { error: "End delimiter required" };
  const pairs = findPairs(text, startDelim, endDelim);
  if (!pairs.length) return { error: "No matches found" };
  let from = 1,
    to = pairs.length;
  if (mode === "single") {
    const n = parseInt(singleInstance, 10);
    if (isNaN(n) || n < 1) return { error: "Invalid instance number" };
    from = to = Math.min(Math.max(n, 1), pairs.length);
  } else if (mode === "range") {
    const f = parseInt(rangeFrom, 10),
      t = parseInt(rangeTo, 10);
    if (isNaN(f) || isNaN(t)) return { error: "Invalid range" };
    from = Math.min(Math.max(f, 1), pairs.length);
    to = Math.min(Math.max(t, from), pairs.length);
  }
  let out = text;
  for (let i = pairs.length - 1; i >= 0; i--) {
    const pair = pairs[i],
      idx1 = i + 1;
    if (idx1 < from || idx1 > to) continue;
    const before = out.slice(0, pair.startIndex),
      after = out.slice(pair.endIndex);
    const middle = includeDelims ? replaceText : startDelim + replaceText + endDelim;
    out = before + middle + after;
  }
  return { text: out, count: Math.max(0, Math.min(to, pairs.length) - from + 1) };
}

export async function handlePattern() {
  if (!currentNote || !noteTextarea) return;
  const r = await showModal({
    header: `<div class="modal-title">Replace Between Delimiters</div>`,
    body: `<div><label class="modal-label">Start delimiter</label><input type="text" id="startDelim" placeholder="Start delimiter (required)"></div><div><label class="modal-label">End delimiter</label><input type="text" id="endDelim" placeholder="End delimiter (required)"></div><div style="display:flex;align-items:center;gap:8px;margin-top:6px;"><input type="checkbox" id="includeDelims"><label for="includeDelims" class="modal-label">Include delimiters in replacement</label></div><div><label class="modal-label">Replacement text</label><input type="text" id="replaceText" placeholder="Replacement text" data-skip-validation></div><div style="margin-top:8px;font-weight:600;">Which instances to replace?</div><div style="display:flex;gap:8px;margin-top:4px;"><button type="button" id="allMode" class="modal-btn active" data-mode="all">All</button><button type="button" id="singleMode" class="modal-btn" data-mode="single">Single</button><button type="button" id="rangeMode" class="modal-btn" data-mode="range">Range</button></div><div id="singleContainer" style="display:none;margin-top:6px;"><label class="modal-label">Instance number (1-based)</label><input type="number" id="singleInstance" min="1" value="1"></div><div id="rangeContainer" style="display:none;margin-top:6px;display:flex;gap:8px;"><div><label class="modal-label">From (1-based)</label><input type="number" id="rangeFrom" min="1" value="1"></div><div><label class="modal-label">To (1-based)</label><input type="number" id="rangeTo" min="1" value="1"></div></div><div id="matchInfo" style="font-size:13px;color:var(--blueink);margin-top:6px;">Matches: 0</div>`,
    footer: `<button onclick="closeModal()">Cancel</button><button onclick="handlePatternSubmit()" class="modal-btn">Replace</button>`
  });
  if (!r || r.action !== "submit") return;
  const {
    startDelim,
    endDelim,
    includeDelims,
    replaceText,
    mode,
    singleInstance,
    rangeFrom,
    rangeTo
  } = r;
  if (!startDelim) return showNotification("Start delimiter required");
  if (!endDelim) return showNotification("End delimiter required");
  const out = replaceBetweenDelimiters(noteTextarea.value, {
    startDelim, endDelim, includeDelims, replaceText, mode, singleInstance, rangeFrom, rangeTo
  });
  if (out.error) return showNotification(out.error);
  noteTextarea.value = out.text;
  typeof updateNoteMetadata === "function" && updateNoteMetadata();
  showNotification(`Replacement done! (${out.count} instance(s) replaced)`);
}

export function handlePatternSubmit() {
  const s = modalScope.startDelim ? modalScope.startDelim.value.trim() : "",
    e = modalScope.endDelim ? modalScope.endDelim.value.trim() : "",
    inc = modalScope.includeDelims ? modalScope.includeDelims.checked : false,
    rep = modalScope.replaceText ? modalScope.replaceText.value : "",
    mode =
      modalScope.allMode && modalScope.allMode.classList.contains("active")
        ? "all"
        : modalScope.singleMode &&
          modalScope.singleMode.classList.contains("active")
        ? "single"
        : "range",
    si = modalScope.singleInstance ? modalScope.singleInstance.value : "1",
    rf = modalScope.rangeFrom ? modalScope.rangeFrom.value : "1",
    rt = modalScope.rangeTo ? modalScope.rangeTo.value : "1";
  closeModal({
    action: "submit",
    startDelim: s,
    endDelim: e,
    includeDelims: inc,
    replaceText: rep,
    mode: mode,
    singleInstance: si,
    rangeFrom: rf,
    rangeTo: rt
  });
}

document.addEventListener("click", function (e) {
  if (!modalScope) return;
  const id = e.target && e.target.id;
  if (id === "allMode" || id === "singleMode" || id === "rangeMode") {
    ["allMode", "singleMode", "rangeMode"].forEach(
      (i) => modalScope[i] && modalScope[i].classList.remove("active")
    );
    e.target.classList.add("active");
    modalScope.singleContainer &&
      (modalScope.singleContainer.style.display =
        id === "singleMode" ? "block" : "none");
    modalScope.rangeContainer &&
      (modalScope.rangeContainer.style.display =
        id === "rangeMode" ? "flex" : "none");
  }
});

document.addEventListener("input", function (e) {
  if (!modalScope) return;
  const tid = e.target && e.target.id;
  if (tid === "startDelim" || tid === "endDelim") {
    const s = modalScope.startDelim ? modalScope.startDelim.value : "",
      f = modalScope.endDelim ? modalScope.endDelim.value : "";
    if (!s || !f) {
      modalScope.matchInfo && (modalScope.matchInfo.textContent = "Matches: 0");
      return;
    }
    const pairs = findPairs(noteTextarea.value, s, f);
    modalScope.matchInfo &&
      (modalScope.matchInfo.textContent = `Matches: ${pairs.length}`);
    if (pairs.length) {
      modalScope.rangeFrom && (modalScope.rangeFrom.value = "1");
      modalScope.rangeTo && (modalScope.rangeTo.value = String(pairs.length));
      modalScope.singleInstance && (modalScope.singleInstance.value = "1");
    }
  }
});
