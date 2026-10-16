/**
 * execbar — the Read / Design bottom bar shown under a .csv or .md note in exec view.
 *
 * Same bar as Diffusion / Mermaid (#execBottombar uses .diff-bottombar). Read is the default and
 * shows the file without letting anything change; Design makes it editable. The state itself lives
 * in viewmode.js (window.dexView.editing / setEditing) — this file only draws it and reacts to taps.
 *
 * The bar is shown exactly when an exec pane is showing (body.csvexec-active / mdexec-active), so
 * it can never disagree with what is on screen, and it steps aside while a soft keyboard is up.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const paneUp = () => document.body.classList.contains("csvexec-active") || document.body.classList.contains("mdexec-active");

  function paint() {
    const bar = $("execBottombar");
    if (!bar || !window.dexView) return;
    const note = (typeof currentNote !== "undefined" && currentNote) || null;
    const show = !!note && paneUp() && window.dexView.isExec(note) && !window.dexView.exclusiveActive();
    document.body.classList.toggle("execbar-on", show);
    if (!show) { document.body.classList.remove("execbar-typing"); return; }
    const design = window.dexView.editing(note);
    bar.querySelectorAll(".diff-topbar-button").forEach((b) => b.classList.toggle("active", (b.dataset.target === "design") === design));
  }

  function wire() {
    const bar = $("execBottombar");
    if (!bar) { setTimeout(wire, 80); return; }
    if (bar.__dexWired) return;
    bar.__dexWired = true;
    bar.addEventListener("click", (e) => {
      const btn = e.target.closest(".diff-topbar-button");
      if (!btn) return;
      const note = (typeof currentNote !== "undefined" && currentNote) || null;
      if (!note || !window.dexView) return;
      const toDesign = btn.dataset.target === "design";
      window.dexView.setEditing(note, toDesign);
      paint();
      if (typeof showNotification === "function") showNotification(toDesign ? "Design — editing on" : "Read — view only");
    });
  }

  // hide the bar while a text field inside an exec pane has focus (the keyboard would sit on top of it)
  const inPane = (el) => !!(el && el.closest && el.closest("#csvexecPane, #mdexecPane") && /^(INPUT|TEXTAREA)$/.test(el.tagName));
  let typingT = null;
  document.addEventListener("focusin", (e) => { clearTimeout(typingT); if (inPane(e.target)) document.body.classList.add("execbar-typing"); });
  document.addEventListener("focusout", () => { clearTimeout(typingT); typingT = setTimeout(() => { if (!inPane(document.activeElement)) document.body.classList.remove("execbar-typing"); }, 180); });

  window.addEventListener("dexNoteOpened", paint);
  window.addEventListener("dexViewModeChanged", paint);
  window.addEventListener("dexEditModeChanged", paint);
  setInterval(paint, 400);
  wire(); paint();
})();
