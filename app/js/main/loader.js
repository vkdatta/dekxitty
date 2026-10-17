/**
 * Dekxitty - script loader. index.html carries exactly one <script> tag (this
 * file); everything else is pulled in from here, in order.
 *
 * APP is derived from this file's own URL, so the version tag
 * (dekxitty@vX.Y.Z) only has to be bumped in index.html - never in here.
 */
(function () {
  "use strict";

  const FALLBACK_APP = "https://cdn.jsdelivr.net/gh/vkdatta/dekxitty@v0.0.63/app/";
  const self = document.currentScript && document.currentScript.src;
  const APP = self ? new URL("../../", self).href : FALLBACK_APP;

  function loadScript(src) { const s = document.createElement("script"); s.src = src; s.async = false; document.body.appendChild(s); }
  function loadModule(src) { const s = document.createElement("script"); s.src = src; s.type = "module"; document.body.appendChild(s); }

  // App shell - routing, expanded navigation, click wiring (must precede everything else)

  loadScript(APP + "js/main/nav.js");
  loadScript(APP + "components/navexpand/navexpand.js");
  loadScript(APP + "js/main/wiring.js");

  // Ex Libs
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js");
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/foldcode.min.js");
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/foldgutter.min.js");
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/brace-fold.min.js");
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/indent-fold.min.js");
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/comment-fold.min.js");
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/xml-fold.min.js");
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/meta.min.js");
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/mode/loadmode.min.js");
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/matchbrackets.min.js");
  loadScript("https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/selection/active-line.min.js");
  loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js");
  loadScript("https://cdn.jsdelivr.net/npm/mermaid@10.9.0/dist/mermaid.min.js");

  // Icons

  loadScript("https://cdn.jsdelivr.net/gh/vkdatta/delluna@v0.0.121/dist/delluna.js");
  loadScript(APP + "components/icons/icon-config.js");

  // Dpad

  loadModule(APP + "components/dpad/core.js");


  // Modal

  loadScript(APP + "components/modal/modal.js");

  // Settings

  loadModule(APP + "components/settings/core.js");

  // Sidebar1

  loadModule(APP + "components/sidebar1/batch.js");
  loadScript(APP + "components/sidebar1/sidebar1.js");

  // Voldemort

  loadScript(APP + "components/voldemort/voldemort.js");

  // Helpers

  loadScript(APP + "js/helpers/asteroidbelt.js");
  loadScript(APP + "js/helpers/checkbox.js");
  loadScript(APP + "js/helpers/docs.js");
  loadScript(APP + "js/helpers/drive_sync.js");
  loadScript(APP + "js/helpers/undo.js");

  // Main

  loadScript(APP + "js/main/editor.js");
  loadScript(APP + "js/main/notes-state.js");

  // Diffusion

  loadScript(APP + "js/modes/diffusion/diffusion.js");
  loadScript(APP + "js/modes/diffusion/mode.js");
  loadScript(APP + "js/modes/diffusion/overlay.js");
  loadScript(APP + "js/modes/diffusion/setup.js");
  loadScript(APP + "js/modes/diffusion/syncscroll.js");

  // Mermaid

  loadModule(APP + "js/modes/mermaid/core.js");

  // View modes - per-note raw / exec choice (sidebar 1 toggle). Must come before the exec modes.

  loadScript(APP + "js/modes/viewmode/viewmode.js");
  loadScript(APP + "js/modes/viewmode/execbar.js");

  // CSVExec (spreadsheet grid for .csv notes in exec view)

  loadModule(APP + "js/modes/csvexec/core.js");

  // MDExec (rendered markdown for .md notes in exec view)

  loadScript("https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.umd.js");
  loadScript("https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js");
  loadModule(APP + "js/modes/mdexec/core.js");

  // Functions Registry

  loadScript(APP + "components/sidebar2/registry/fx_ui.js");
  loadScript(APP + "components/sidebar2/registry/registry.js");

  // Sidebar2

  loadScript(APP + "components/sidebar2/sidebar2.js");

  // Functions

  loadModule(APP + "components/sidebar2/functions/1formatting/core.js");
  loadModule(APP + "components/sidebar2/functions/2operations/core.js");
  loadModule(APP + "components/sidebar2/functions/3code/core.js");
  loadModule(APP + "components/sidebar2/functions/4document/core.js");


  // Bootstrap

  loadScript(APP + "js/main/bootstrap.js");
})();
